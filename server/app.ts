import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { verifyMessage } from "viem";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import { parseMon } from "../shared/chain";
import type { Config } from "./config";
import type { Db } from "./db";
import { requireViewer, sessionMiddleware, signSession, type AppEnv } from "./auth";
import type { ChainReader } from "./chain";
import { RateLimiter } from "./ratelimit";
import { HttpError, isAddress, isTxHash, newReferralCode, slugify } from "./util";
import { audit, getCreator, getEvent, getRecommendation, listCreators, listEvents, listRecommendations } from "./services/data";
import { issueDoorToken, performCheckin } from "./services/checkin";
import { approveDistribution, cancelDistribution, createPool, getDistributionOnchainArgs, getPoolRow, previewDistribution, syncPoolFromChain } from "./services/rewards";
import { recordTransaction } from "./services/chainRecord";
import { buildImpact, curatorDashboard, participantHistory } from "./services/views";
import { seedDemo } from "./seed";

const CATEGORIES = ["music", "visual-art", "performance", "craft", "film", "writing", "food"] as const;
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const httpUrl = z.string().trim().max(300).url().refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

const recommendationInput = z.object({
  title: trimmed(4, 120),
  reason: trimmed(40, 800),
  sourceUrl: httpUrl.optional().or(z.literal("").transform(() => undefined)),
  eventId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  creator: z.union([
    z.object({ existingId: z.string().uuid() }),
    z.object({ name: trimmed(2, 80), category: z.enum(CATEGORIES), bio: trimmed(10, 600), externalUrl: httpUrl.optional().or(z.literal("").transform(() => undefined)) }),
  ]),
});

export function createApp(deps: { db: Db; config: Config; chain: ChainReader }) {
  const { db, config, chain } = deps;
  const app = new Hono<AppEnv>();

  const ip = (c: Context) => {
    // Behind one trusted proxy the right-most entry is the address the proxy saw. In dev/tests the first entry is honoured.
    const fwd = c.req.header("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
    if (fwd?.length) return config.isProd ? fwd[fwd.length - 1]! : fwd[0]!;
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
  const limits = {
    guest: new RateLimiter(10, 60 * 60 * 1000),
    login: new RateLimiter(30, 60 * 1000),
    checkin: new RateLimiter(12, 60 * 1000),
    token: new RateLimiter(60, 60 * 1000),
    write: new RateLimiter(30, 60 * 60 * 1000),
    record: new RateLimiter(30, 60 * 1000),
  };
  const limit = (l: RateLimiter, key: string, what: string) => {
    if (!l.take(key)) throw new HttpError(429, `Too many ${what} attempts. Slow down and try again shortly.`, "rate_limited");
  };

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
  });
  app.use("/api/*", bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: { message: "Request body too large." } }, 413) }));
  app.use("/api/*", sessionMiddleware(db, config.sessionSecret));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { message: err.message, code: err.code } }, err.status);
    if (err instanceof ZodError) {
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join(".") || "_", i.message]));
      return c.json({ error: { message: "Please fix the highlighted fields.", code: "validation", fields } }, 422);
    }
    console.error("[api] unhandled", err);
    return c.json({ error: { message: "Something went wrong on our side." } }, 500);
  });

  const json = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new HttpError(400, "Request body must be valid JSON.");
    }
    return schema.parse(body);
  };

  // ---------- public config & health ----------
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/config", (c) =>
    c.json({
      chainId: config.chainId,
      networkName: "Monad Testnet",
      explorerUrl: config.explorerUrl,
      rpcUrl: config.rpcUrl,
      contractAddress: chain.contractAddress,
      chainEnabled: chain.enabled,
      currency: "MON (testnet — no monetary value)",
    }),
  );

  // ---------- auth ----------
  app.get("/api/auth/personas", async (c) =>
    c.json(await db.query("SELECT id, display_name AS \"displayName\", role FROM profiles WHERE is_persona = true ORDER BY role, display_name")),
  );
  app.post("/api/auth/demo", async (c) => {
    limit(limits.login, ip(c), "sign-in");
    const { profileId } = await json(c, z.object({ profileId: z.string().uuid() }));
    const p = (await db.query<{ id: string }>("SELECT id FROM profiles WHERE id = $1 AND is_persona = true", [profileId]))[0];
    if (!p) throw new HttpError(404, "Demo persona not found.");
    return c.json({ token: signSession(config.sessionSecret, p.id) });
  });
  app.post("/api/auth/guest", async (c) => {
    limit(limits.guest, ip(c), "sign-up");
    const input = await json(c, z.object({ displayName: trimmed(2, 40), role: z.enum(["curator", "participant", "sponsor"]) }));
    const p = (await db.query<{ id: string }>("INSERT INTO profiles (display_name, role) VALUES ($1,$2) RETURNING id", [input.displayName, input.role]))[0]!;
    await audit(db, p.id, "profile.created", "profile", p.id, { role: input.role });
    return c.json({ token: signSession(config.sessionSecret, p.id) }, 201);
  });
  app.get("/api/me", (c) => c.json({ viewer: c.get("viewer") }));

  app.post("/api/me/wallet/nonce", async (c) => {
    const v = requireViewer(c);
    const nonce = randomBytes(16).toString("hex");
    await db.query("UPDATE profiles SET wallet_nonce = $2 WHERE id = $1", [v.id, nonce]);
    return c.json({ message: walletMessage(v.id, nonce) });
  });
  app.post("/api/me/wallet", async (c) => {
    const v = requireViewer(c);
    limit(limits.login, v.id, "wallet-link");
    const { address, signature } = await json(c, z.object({ address: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }));
    if (!isAddress(address)) throw new HttpError(422, "Invalid wallet address.");
    const row = (await db.query<{ wallet_nonce: string | null }>("SELECT wallet_nonce FROM profiles WHERE id = $1", [v.id]))[0];
    if (!row?.wallet_nonce) throw new HttpError(409, "Request a signing message first.", "no_nonce");
    const ok = await verifyMessage({ address: address as `0x${string}`, message: walletMessage(v.id, row.wallet_nonce), signature: signature as `0x${string}` }).catch(() => false);
    if (!ok) throw new HttpError(422, "Signature does not match that wallet.", "bad_signature");
    try {
      await db.query("UPDATE profiles SET wallet_address = $2, wallet_nonce = NULL WHERE id = $1", [v.id, address.toLowerCase()]);
    } catch (e) {
      if (/duplicate key|profiles_wallet_address_key/i.test((e as Error).message)) throw new HttpError(409, "That wallet is already linked to another OFFBEAT profile.", "wallet_taken");
      throw e;
    }
    await audit(db, v.id, "wallet.linked", "profile", v.id, { address: address.toLowerCase() });
    return c.json({ walletAddress: address.toLowerCase() });
  });

  // ---------- discovery ----------
  app.get("/api/feed", async (c) => {
    const category = c.req.query("category");
    if (category && !(CATEGORIES as readonly string[]).includes(category)) throw new HttpError(422, "Unknown category.");
    const q = c.req.query("q")?.slice(0, 80);
    return c.json({ items: await listRecommendations(db, { category, q }), categories: CATEGORIES });
  });
  app.get("/api/recommendations/:slug", async (c) => {
    const rec = await getRecommendation(db, c.req.param("slug"));
    if (!rec || rec.status !== "published") {
      const v = c.get("viewer");
      if (!rec || v?.id !== rec.curator.id) throw new HttpError(404, "Recommendation not found.");
    }
    return c.json(rec);
  });
  /** Resolve a shareable referral link (/r/CODE) to its event so the client can carry the code through the journey. */
  app.get("/api/referrals/:code", async (c) => {
    const code = c.req.param("code").toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) throw new HttpError(404, "That referral link is not valid.");
    const row = (
      await db.query<{ slug: string; title: string; event_slug: string | null }>(
        "SELECT r.slug, r.title, e.slug AS event_slug FROM recommendations r LEFT JOIN events e ON e.id = r.event_id WHERE r.referral_code = $1 AND r.status = 'published'",
        [code],
      )
    )[0];
    if (!row) throw new HttpError(404, "That referral link is not valid.");
    return c.json({ code, recommendationSlug: row.slug, title: row.title, eventSlug: row.event_slug });
  });
  app.get("/api/creators", async (c) => c.json(await listCreators(db)));
  app.get("/api/creators/:slug", async (c) => {
    const creator = await getCreator(db, c.req.param("slug"));
    if (!creator) throw new HttpError(404, "Creator not found.");
    const [recs, events] = await Promise.all([listRecommendations(db, { creatorId: creator.id }), listEvents(db)]);
    return c.json({ creator, recommendations: recs, events: events.filter((e) => e.creator.id === creator.id) });
  });
  app.get("/api/events", async (c) => c.json(await listEvents(db)));
  app.get("/api/events/:slug", async (c) => {
    const ev = await getEvent(db, c.req.param("slug"));
    if (!ev) throw new HttpError(404, "Event not found.");
    const [recs, counts] = await Promise.all([
      listRecommendations(db, { eventId: ev.id }),
      db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM checkins WHERE event_id = $1 GROUP BY status", [ev.id]),
    ]);
    const now = Date.now();
    const v = c.get("viewer");
    const mine = v ? (await db.query<{ status: string }>("SELECT status FROM checkins WHERE event_id = $1 AND user_id = $2", [ev.id, v.id]))[0] : undefined;
    return c.json({
      event: ev,
      recommendations: recs,
      checkinWindow: now < new Date(ev.checkInOpensAt).getTime() ? "not_open" : now > new Date(ev.checkInClosesAt).getTime() ? "closed" : "open",
      checkinCounts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
      myCheckin: mine ?? null,
      isOrganizer: v?.id === ev.organizerId,
    });
  });

  // ---------- recommendations (curators) ----------
  app.post("/api/recommendations", async (c) => {
    const v = requireViewer(c, "curator");
    limit(limits.write, v.id, "submission");
    const input = await json(c, recommendationInput);

    const rec = await db.tx(async (t) => {
      let creatorId: string;
      if ("existingId" in input.creator) {
        const cr = await t.query<{ id: string }>("SELECT id FROM creators WHERE id = $1", [input.creator.existingId]);
        if (!cr.length) throw new HttpError(422, "That creator does not exist.");
        creatorId = cr[0]!.id;
      } else {
        const base = slugify(input.creator.name) || "creator";
        const taken = await t.query("SELECT 1 FROM creators WHERE lower(name) = lower($1)", [input.creator.name]);
        if (taken.length) throw new HttpError(409, "A creator with that name already exists. Pick them from the list instead.", "duplicate_creator");
        const slug = (await t.query("SELECT 1 FROM creators WHERE slug = $1", [base])).length ? `${base}-${randomBytes(2).toString("hex")}` : base;
        creatorId = (
          await t.query<{ id: string }>("INSERT INTO creators (slug, name, category, bio, external_url, art_seed, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [slug, input.creator.name, input.creator.category, input.creator.bio, input.creator.externalUrl ?? null, slug, v.id])
        )[0]!.id;
      }
      if (input.eventId) {
        const evRow = await t.query<{ creator_id: string }>("SELECT creator_id FROM events WHERE id = $1", [input.eventId]);
        if (!evRow.length) throw new HttpError(422, "That event does not exist.");
        if (evRow[0]!.creator_id !== creatorId) throw new HttpError(422, "That event is not by this creator.", "event_creator_mismatch");
      }
      if (input.sourceUrl) {
        const dupe = await t.query("SELECT 1 FROM recommendations WHERE curator_id = $1 AND source_url = $2", [v.id, input.sourceUrl]);
        if (dupe.length) throw new HttpError(409, "You have already recommended something with that link.", "duplicate_recommendation");
      }
      const dupeRec = async () => (await t.query("SELECT 1 FROM recommendations WHERE curator_id = $1 AND creator_id = $2 AND event_id IS NOT DISTINCT FROM $3", [v.id, creatorId, input.eventId ?? null])).length > 0;
      const dupeMsg = "You have already recommended this creator for this event.";
      if (await dupeRec()) throw new HttpError(409, dupeMsg, "duplicate_recommendation");
      const slugBase = slugify(input.title) || "recommendation";
      for (let attempt = 0; attempt < 5; attempt++) {
        const slug = attempt === 0 ? slugBase : `${slugBase}-${randomBytes(2).toString("hex")}`;
        // ON CONFLICT DO NOTHING keeps the transaction usable if the slug or referral code happens to collide.
        const row = await t.query<{ id: string }>(
          "INSERT INTO recommendations (slug, curator_id, creator_id, event_id, title, reason, source_url, referral_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",
          [slug, v.id, creatorId, input.eventId ?? null, input.title, input.reason, input.sourceUrl ?? null, newReferralCode()],
        );
        if (row[0]) {
          await audit(t, v.id, "recommendation.created", "recommendation", row[0].id);
          return row[0].id;
        }
        if (await dupeRec()) throw new HttpError(409, dupeMsg, "duplicate_recommendation");
      }
      throw new HttpError(500, "Could not allocate a unique link. Try again.");
    });
    return c.json(await getRecommendation(db, rec), 201);
  });

  app.post("/api/recommendations/:id/ratings", async (c) => {
    const v = requireViewer(c);
    limit(limits.write, v.id, "rating");
    const { stars } = await json(c, z.object({ stars: z.number().int().min(1).max(5) }));
    const rec = await getRecommendation(db, c.req.param("id"));
    if (!rec || rec.status !== "published") throw new HttpError(404, "Recommendation not found.");
    if (rec.curator.id === v.id) throw new HttpError(403, "You cannot rate your own recommendation.", "self_rating");
    if (!rec.event) throw new HttpError(409, "Only recommendations tied to an event can be rated.", "no_event");
    const attended = await db.query("SELECT 1 FROM checkins WHERE event_id = $1 AND user_id = $2", [rec.event.id, v.id]);
    if (!attended.length) throw new HttpError(403, "Only people who checked in to this event can rate its recommendations.", "not_attendee");
    await db.query("INSERT INTO ratings (recommendation_id, rater_id, stars) VALUES ($1,$2,$3) ON CONFLICT (recommendation_id, rater_id) DO UPDATE SET stars = EXCLUDED.stars", [rec.id, v.id, stars]);
    return c.json(await getRecommendation(db, rec.id));
  });

  // ---------- proof of discovery ----------
  app.post("/api/events/:id/tokens", async (c) => {
    const v = requireViewer(c);
    limit(limits.token, v.id, "token");
    return c.json(await issueDoorToken(db, v, c.req.param("id")), 201);
  });
  app.post("/api/checkins", async (c) => {
    const v = requireViewer(c);
    limit(limits.checkin, `${v.id}`, "check-in");
    limit(limits.checkin, `ip:${ip(c)}`, "check-in");
    const input = await json(c, z.object({ eventId: z.string().uuid(), token: z.string().min(10).max(80), referralCode: z.string().regex(/^[A-Za-z2-9]{8}$/).optional().or(z.literal("").transform(() => undefined)) }));
    return c.json(await performCheckin(db, v, input), 201);
  });
  app.get("/api/me/checkins", async (c) => c.json(await participantHistory(db, requireViewer(c).id)));

  // ---------- dashboards ----------
  app.get("/api/me/curator", async (c) => c.json(await curatorDashboard(db, chain, requireViewer(c, "curator"))));

  // ---------- pools & rewards ----------
  app.get("/api/pools", async (c) => {
    const rows = await db.query("SELECT p.*, e.title AS event_title, e.slug AS event_slug, s.display_name AS sponsor_name FROM reward_pools p JOIN events e ON e.id = p.event_id JOIN profiles s ON s.id = p.sponsor_id ORDER BY p.created_at DESC");
    return c.json(rows);
  });
  app.post("/api/pools", async (c) => {
    const v = requireViewer(c, "sponsor");
    limit(limits.write, v.id, "pool");
    const input = await json(c, z.object({ title: trimmed(4, 120), description: z.string().trim().max(400).default(""), eventId: z.string().uuid(), budgetMon: z.string() }));
    const budget = parseMon(input.budgetMon);
    if (budget === null || budget <= 0n) throw new HttpError(422, "Budget must be a positive MON amount, e.g. 0.5", "bad_budget");
    if (budget > 100n * 10n ** 18n) throw new HttpError(422, "Budget above 100 testnet MON is not supported in this prototype.", "bad_budget");
    return c.json(await createPool(db, v, config.chainId, { title: input.title, description: input.description, eventId: input.eventId, budgetWei: budget }), 201);
  });
  app.get("/api/pools/:id", async (c) => {
    let pool = await getPoolRow(db, c.req.param("id"));
    if (c.req.query("sync") === "1") pool = await syncPoolFromChain(db, chain, pool).catch(() => pool);
    const [preview, dists, txs, event, sponsor] = await Promise.all([
      previewDistribution(db, pool),
      db.query("SELECT d.id, d.status, d.total_wei, d.tx_hash, d.formula_version, d.created_at, d.is_demo FROM distributions d WHERE pool_id = $1 ORDER BY created_at DESC", [pool.id]),
      db.query("SELECT kind, tx_hash, actor_address, amount_wei, block_number, status, created_at FROM chain_transactions WHERE pool_id = $1 ORDER BY created_at", [pool.id]),
      getEvent(db, pool.event_id),
      db.query("SELECT display_name, wallet_address FROM profiles WHERE id = $1", [pool.sponsor_id]),
    ]);
    return c.json({ pool, preview, distributions: dists, transactions: txs, event, sponsor: sponsor[0] });
  });
  app.post("/api/pools/:id/approve", async (c) => {
    const v = requireViewer(c, "sponsor");
    const pool = await getPoolRow(db, c.req.param("id"));
    return c.json(await approveDistribution(db, v, pool, chain), 201);
  });
  app.get("/api/distributions/:id/onchain-args", async (c) => {
    const v = requireViewer(c, "sponsor");
    const d = (await db.query<{ id: string; sponsor_id: string; status: string; contract_pool_id: number | null }>("SELECT d.id, d.status, p.sponsor_id, p.contract_pool_id FROM distributions d JOIN reward_pools p ON p.id = d.pool_id WHERE d.id = $1", [c.req.param("id")]))[0];
    if (!d || d.sponsor_id !== v.id) throw new HttpError(404, "Distribution not found.");
    if (d.status === "failed") throw new HttpError(409, "That distribution was cancelled.");
    return c.json({ contractPoolId: d.contract_pool_id, ...(await getDistributionOnchainArgs(db, d.id)) });
  });
  app.post("/api/distributions/:id/cancel", async (c) => {
    await cancelDistribution(db, requireViewer(c, "sponsor"), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/me/pools", async (c) => {
    const v = requireViewer(c, "sponsor");
    return c.json(await db.query("SELECT p.*, e.title AS event_title FROM reward_pools p JOIN events e ON e.id = p.event_id WHERE p.sponsor_id = $1 ORDER BY p.created_at DESC", [v.id]));
  });

  app.post("/api/chain/record", async (c) => {
    const v = requireViewer(c);
    limit(limits.record, v.id, "verification");
    const input = await json(c, z.object({ kind: z.enum(["create_pool", "fund_pool", "allocate", "claim", "close_pool"]), txHash: z.string(), poolId: z.string().uuid().optional(), distributionId: z.string().uuid().optional() }));
    if (!isTxHash(input.txHash)) throw new HttpError(422, "Invalid transaction hash.");
    const result = await recordTransaction(db, chain, v, { ...input, txHash: input.txHash.toLowerCase() as `0x${string}` });
    return c.json({ verified: true, result });
  });

  // ---------- public impact ledger ----------
  app.get("/api/impact", async (c) => c.json(await buildImpact(db, config.explorerUrl)));

  // ---------- optional demo reset (disabled unless DEMO_ADMIN_TOKEN is set) ----------
  app.post("/api/admin/reset", async (c) => {
    if (!config.adminToken) throw new HttpError(404, "Not found.");
    const supplied = c.req.header("x-admin-token") ?? "";
    if (supplied.length !== config.adminToken.length || supplied !== config.adminToken) throw new HttpError(403, "Forbidden.");
    await resetAndSeed(db);
    return c.json({ ok: true });
  });

  app.all("/api/*", () => {
    throw new HttpError(404, "Not found.");
  });

  return app;
}

export const walletMessage = (profileId: string, nonce: string) => `OFFBEAT wallet link\nProfile: ${profileId}\nNonce: ${nonce}\n\nSigning proves you control this wallet. It does not move funds.`;

export async function resetAndSeed(db: Db) {
  await db.exec("TRUNCATE chain_transactions, distribution_items, distributions, reward_pools, checkins, checkin_tokens, ratings, recommendations, events, creators, profiles RESTART IDENTITY CASCADE");
  await db.exec("ALTER TABLE audit_events DISABLE TRIGGER audit_no_update");
  await db.exec("DELETE FROM audit_events");
  await db.exec("ALTER TABLE audit_events ENABLE TRIGGER audit_no_update");
  await seedDemo(db);
}


