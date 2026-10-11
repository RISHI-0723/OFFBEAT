import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CONTRACT, makeLog, nextHash, receipt, setup } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setup>>;
let t: Ctx;
beforeAll(async () => {
  t = await setup();
});

const lower = (a: string) => a.toLowerCase();

async function eventAndRec() {
  const ev = (await t.call("GET", "/api/events/harbour-field-recordings")).json;
  return { event: ev.event as { id: string; slug: string }, recs: ev.recommendations as { id: string; slug: string; referralCode: string; curator: { id: string } }[] };
}
async function doorToken(eventId: string) {
  const org = await t.persona("Harbourlight");
  const r = await t.call("POST", `/api/events/${eventId}/tokens`, { token: org.token });
  expect(r.status).toBe(201);
  return r.json.token as string;
}

describe("auth & input validation", () => {
  it("requires sign-in for protected routes", async () => {
    expect((await t.call("POST", "/api/checkins", { body: {} })).status).toBe(401);
    expect((await t.call("GET", "/api/me/curator")).status).toBe(401);
  });

  it("rejects tampered or foreign session tokens", async () => {
    const g = await t.guest("participant");
    const bad = g.token.slice(0, -2) + "xx";
    expect((await t.call("GET", "/api/me", { token: bad })).json.viewer).toBeNull();
  });

  it("only seeded personas can be signed into without credentials", async () => {
    const g = await t.guest("participant");
    expect((await t.call("POST", "/api/auth/demo", { body: { profileId: g.id } })).status).toBe(404);
  });

  it("enforces roles: participants cannot submit recommendations or create pools", async () => {
    const g = await t.guest("participant");
    expect((await t.call("POST", "/api/recommendations", { token: g.token, body: {} })).status).toBe(403);
    expect((await t.call("POST", "/api/pools", { token: g.token, body: {} })).status).toBe(403);
  });

  it("validates guest sign-up", async () => {
    expect((await t.call("POST", "/api/auth/guest", { body: { displayName: "x", role: "curator" } })).status).toBe(422);
    expect((await t.call("POST", "/api/auth/guest", { body: { displayName: "Valid Name", role: "admin" } })).status).toBe(422);
  });
});

describe("wallet linking", () => {
  it("accepts a valid signature and rejects a forged one", async () => {
    const u = await t.guest("curator");
    const ok = await t.linkWallet(u);
    expect(ok.status).toBe(200);
    expect(ok.json.walletAddress).toBe(lower(ok.account.address));

    const v = await t.guest("curator");
    const n = await t.call("POST", "/api/me/wallet/nonce", { token: v.token });
    const attacker = privateKeyToAccount(generatePrivateKey());
    const victim = privateKeyToAccount(generatePrivateKey());
    const sig = await attacker.signMessage({ message: n.json.message });
    const r = await t.call("POST", "/api/me/wallet", { token: v.token, body: { address: victim.address, signature: sig } });
    expect(r.status).toBe(422);
  });

  it("does not let two profiles claim the same wallet", async () => {
    const pk = generatePrivateKey();
    const a = await t.guest("curator");
    const b = await t.guest("curator");
    expect((await t.linkWallet(a, pk)).status).toBe(200);
    expect((await t.linkWallet(b, pk)).status).toBe(409);
  });
});

describe("recommendations", () => {
  it("returns a seeded, labelled, scored feed", async () => {
    const r = await t.call("GET", "/api/feed");
    expect(r.status).toBe(200);
    expect(r.json.items.length).toBeGreaterThanOrEqual(8);
    expect(r.json.items.every((i: { isDemo: boolean }) => i.isDemo)).toBe(true);
    const top = r.json.items.find((i: { slug: string }) => i.slug === "four-strings-one-tide-table");
    expect(top.score.formulaVersion).toBe("offbeat-proto-v1");
    expect(top.stats.verifiedCheckins).toBe(5);
    expect(top.score.quality.status).toBe("measured");
  });

  it("filters by category and searches text", async () => {
    expect((await t.call("GET", "/api/feed?category=music")).json.items.every((i: { creator: { category: string } }) => i.creator.category === "music")).toBe(true);
    expect((await t.call("GET", "/api/feed?q=laundromat")).json.items).toHaveLength(1);
    expect((await t.call("GET", "/api/feed?category=nope")).status).toBe(422);
  });

  it("persists a submission with a unique referral code and rejects duplicates", async () => {
    const c = await t.guest("curator", "Test Curator");
    const { event } = await eventAndRec();
    const events = (await t.call("GET", "/api/events")).json as { id: string; creator: { id: string } }[];
    const ev = events.find((e) => e.id === event.id)!;
    const body = { title: "A test recommendation", reason: "x".repeat(60), eventId: ev.id, creator: { existingId: ev.creator.id } };
    const r = await t.call("POST", "/api/recommendations", { token: c.token, body });
    expect(r.status).toBe(201);
    expect(r.json.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(r.json.score.quality.status).toBe("provisional");
    expect((await t.call("GET", `/api/recommendations/${r.json.slug}`)).status).toBe(200);
    expect((await t.call("POST", "/api/recommendations", { token: c.token, body })).status).toBe(409);
  });

  it("returns field-level validation errors", async () => {
    const c = await t.guest("curator");
    const r = await t.call("POST", "/api/recommendations", { token: c.token, body: { title: "x", reason: "short", creator: { existingId: "nope" } } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("validation");
  });

  it("creates a new creator inline and rejects a name clash", async () => {
    const c = await t.guest("curator");
    const body = { title: "A brand new find", reason: "y".repeat(60), creator: { name: "Wren & Salt", category: "craft", bio: "Hand-forged spoons and cutlery." } };
    const r = await t.call("POST", "/api/recommendations", { token: c.token, body });
    expect(r.status).toBe(201);
    expect(r.json.creator.isDemo).toBe(false);
    const c2 = await t.guest("curator");
    expect((await t.call("POST", "/api/recommendations", { token: c2.token, body })).status).toBe(409);
  });

  it("refuses to attach an event that belongs to another creator", async () => {
    const c = await t.guest("curator");
    const events = (await t.call("GET", "/api/events")).json as { id: string; creator: { id: string } }[];
    const other = (await t.call("GET", "/api/creators")).json.find((x: { id: string }) => x.id !== events[0]!.creator.id);
    const r = await t.call("POST", "/api/recommendations", { token: c.token, body: { title: "Mismatched event", reason: "z".repeat(60), eventId: events[0]!.id, creator: { existingId: other.id } } });
    expect(r.status).toBe(422);
  });
});

describe("proof of discovery: check-ins", () => {
  it("verifies a valid check-in, attributes it, and raises the recommendation's evidence", async () => {
    const { event, recs } = await eventAndRec();
    const rec = recs.find((r) => r.slug === "the-quartet-that-listens-to-the-docks")!;
    const before = (await t.call("GET", `/api/recommendations/${rec.slug}`)).json.stats.verifiedCheckins;
    const u = await t.guest("participant");
    const token = await doorToken(event.id);
    const r = await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token, referralCode: rec.referralCode } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("verified");
    expect(r.json.attribution.recommendationId).toBe(rec.id);
    expect(r.json.note).toMatch(/not proof/i);
    expect((await t.call("GET", `/api/recommendations/${rec.slug}`)).json.stats.verifiedCheckins).toBe(before + 1);
  });

  it("rejects a replayed token, even from a different user", async () => {
    const { event } = await eventAndRec();
    const token = await doorToken(event.id);
    const a = await t.guest("participant");
    const b = await t.guest("participant");
    expect((await t.call("POST", "/api/checkins", { token: a.token, body: { eventId: event.id, token } })).status).toBe(201);
    const replay = await t.call("POST", "/api/checkins", { token: b.token, body: { eventId: event.id, token } });
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe("token_used");
  });

  it("rejects a duplicate check-in by the same user without burning the new token", async () => {
    const { event } = await eventAndRec();
    const u = await t.guest("participant");
    expect((await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token: await doorToken(event.id) } })).status).toBe(201);
    const second = await doorToken(event.id);
    const dup = await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token: second } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate_checkin");
    const other = await t.guest("participant");
    expect((await t.call("POST", "/api/checkins", { token: other.token, body: { eventId: event.id, token: second } })).status).toBe(201);
  });

  it("rejects an expired token", async () => {
    const { event } = await eventAndRec();
    const token = await doorToken(event.id);
    await t.db.query("UPDATE checkin_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL");
    const u = await t.guest("participant");
    const r = await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token } });
    expect(r.status).toBe(410);
    expect(r.json.error.code).toBe("token_expired");
  });

  it("rejects invalid tokens and tokens for a different event", async () => {
    const { event } = await eventAndRec();
    const u = await t.guest("participant");
    expect((await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token: "not-a-real-token-1234567" } })).json.error.code).toBe("invalid_token");
    const other = (await t.call("GET", "/api/events")).json.find((e: { id: string }) => e.id !== event.id);
    const token = await doorToken(event.id);
    expect((await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: other.id, token } })).json.error.code).toBe("invalid_token");
  });

  it("only the organiser can issue door tokens", async () => {
    const { event } = await eventAndRec();
    const g = await t.guest("sponsor");
    expect((await t.call("POST", `/api/events/${event.id}/tokens`, { token: g.token })).status).toBe(403);
  });

  it("does not credit a self-referral", async () => {
    const { event, recs } = await eventAndRec();
    const rec = recs.find((r) => r.slug === "four-strings-one-tide-table")!;
    const noor = await t.persona("Noor");
    const r = await t.call("POST", "/api/checkins", { token: noor.token, body: { eventId: event.id, token: await doorToken(event.id), referralCode: rec.referralCode } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("excluded_self_referral");
    const row = await t.db.query<{ status: string }>("SELECT status FROM checkins WHERE user_id = $1 AND event_id = $2", [noor.id, event.id]);
    expect(row[0]!.status).toBe("excluded_self_referral");
  });

  it("checks in without credit when the referral code belongs to another event", async () => {
    const { event } = await eventAndRec();
    const lantern = (await t.call("GET", "/api/events/lantern-nights")).json.recommendations[0];
    const u = await t.guest("participant");
    const r = await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token: await doorToken(event.id), referralCode: lantern.referralCode } });
    expect(r.status).toBe(201);
    expect(r.json.attribution).toBeNull();
  });

  it("rate-limits check-in attempts per user", async () => {
    const { event } = await eventAndRec();
    const u = await t.guest("participant");
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await t.call("POST", "/api/checkins", { token: u.token, body: { eventId: event.id, token: `bad-token-${i}-xxxxxxxxxx` } })).status);
    expect(codes).toContain(429);
  });

  it("the organiser cannot check in to their own event", async () => {
    const { event } = await eventAndRec();
    const org = await t.persona("Harbourlight");
    const r = await t.call("POST", "/api/checkins", { token: org.token, body: { eventId: event.id, token: await doorToken(event.id) } });
    expect(r.status).toBe(403);
  });

  it("records rejected attempts in the public impact stats", async () => {
    const impact = (await t.call("GET", "/api/impact")).json;
    const reasons = impact.stats.rejectedAttempts.map((x: { reason: string }) => x.reason);
    expect(reasons).toEqual(expect.arrayContaining(["token_used", "token_expired", "duplicate_checkin", "invalid_token"]));
  });
});

describe("ratings", () => {
  it("only attendees can rate, never the curator", async () => {
    const { event, recs } = await eventAndRec();
    const rec = recs[0]!;
    const stranger = await t.guest("participant");
    expect((await t.call("POST", `/api/recommendations/${rec.id}/ratings`, { token: stranger.token, body: { stars: 5 } })).json.error.code).toBe("not_attendee");
    expect((await t.call("POST", `/api/recommendations/${rec.id}/ratings`, { token: stranger.token, body: { stars: 9 } })).status).toBe(422);
    await t.call("POST", "/api/checkins", { token: stranger.token, body: { eventId: event.id, token: await doorToken(event.id) } });
    const ok = await t.call("POST", `/api/recommendations/${rec.id}/ratings`, { token: stranger.token, body: { stars: 4 } });
    expect(ok.status).toBe(200);
    const curator = (await t.persona("Noor"));
    const own = (await t.call("GET", "/api/feed")).json.items.find((i: { curator: { id: string } }) => i.curator.id === curator.id);
    expect((await t.call("POST", `/api/recommendations/${own.id}/ratings`, { token: curator.token, body: { stars: 5 } })).status).toBe(403);
  });
});

describe("rewards: preview, approval and on-chain verification", () => {
  let sponsor: { id: string; token: string };
  let sponsorWallet: ReturnType<typeof privateKeyToAccount>;
  let poolId: string;
  let eventId: string;
  const curators: Record<string, { id: string; token: string; account: ReturnType<typeof privateKeyToAccount> }> = {};

  beforeAll(async () => {
    eventId = (await eventAndRec()).event.id;
    sponsor = await t.guest("sponsor", "Test Sponsor");
    sponsorWallet = (await t.linkWallet(sponsor)).account;
    for (const n of ["Noor", "Teo"]) {
      const p = await t.persona(n);
      const w = await t.linkWallet(p);
      curators[n] = { ...p, account: w.account };
    }
  });

  it("validates pool creation", async () => {
    expect((await t.call("POST", "/api/pools", { token: sponsor.token, body: { title: "Bad budget pool", eventId, budgetMon: "abc" } })).status).toBe(422);
    expect((await t.call("POST", "/api/pools", { token: sponsor.token, body: { title: "Bad budget pool", eventId, budgetMon: "0" } })).status).toBe(422);
    expect((await t.call("POST", "/api/pools", { token: sponsor.token, body: { title: "Bad budget pool", eventId, budgetMon: "1000" } })).status).toBe(422);
    const r = await t.call("POST", "/api/pools", { token: sponsor.token, body: { title: "Round one pool", eventId, budgetMon: "1.5" } });
    expect(r.status).toBe(201);
    expect(r.json.budget_wei).toBe((15n * 10n ** 17n).toString());
    poolId = r.json.id;
  });

  it("refuses approval before the pool exists on-chain and is funded", async () => {
    const r = await t.call("POST", `/api/pools/${poolId}/approve`, { token: sponsor.token });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/not yet created on-chain/);
  });

  it("does not record a create_pool that was sent by a different wallet", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const hash = nextHash();
    t.chain.receipts.set(hash, receipt(stranger.address, [makeLog("PoolCreated", { poolId: 1n, manager: stranger.address, title: "x" })]));
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: hash, poolId } });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("manager_mismatch");
  });

  it("rejects reverted, unknown and wrong-contract transactions", async () => {
    const reverted = nextHash();
    t.chain.receipts.set(reverted, receipt(sponsorWallet.address, [], { status: "reverted" }));
    expect((await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: reverted, poolId } })).json.error.code).toBe("tx_reverted");
    expect((await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: nextHash(), poolId } })).json.error.code).toBe("receipt_pending");
    const wrong = nextHash();
    t.chain.receipts.set(wrong, receipt(sponsorWallet.address, [], { to: "0x000000000000000000000000000000000000dead" }));
    expect((await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: wrong, poolId } })).json.error.code).toBe("wrong_contract");
  });

  it("ignores events emitted by a different contract (spoofed logs)", async () => {
    const hash = nextHash();
    t.chain.receipts.set(hash, receipt(sponsorWallet.address, [makeLog("PoolCreated", { poolId: 7n, manager: sponsorWallet.address, title: "spoof" }, "0x00000000000000000000000000000000000bad01")]));
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: hash, poolId } });
    expect(r.json.error.code).toBe("no_event");
  });

  it("links the pool only after a verified PoolCreated receipt from the sponsor's wallet", async () => {
    const hash = nextHash();
    t.chain.receipts.set(hash, receipt(sponsorWallet.address, [makeLog("PoolCreated", { poolId: 1n, manager: sponsorWallet.address, title: "Round one pool" })]));
    t.chain.pools.set("1", { manager: lower(sponsorWallet.address), funded: 0n, allocated: 0n, claimed: 0n, closed: false });
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "create_pool", txHash: hash, poolId } });
    expect(r.status).toBe(200);
    expect(r.json.result.contract_pool_id).toBe(1);
    expect(r.json.result.status).toBe("open");
  });

  it("takes pool balance from the chain, not from the client", async () => {
    const hash = nextHash();
    t.chain.receipts.set(hash, receipt(sponsorWallet.address, [makeLog("PoolFunded", { poolId: 1n, funder: sponsorWallet.address, amount: 10n ** 18n })]));
    t.chain.pools.set("1", { manager: lower(sponsorWallet.address), funded: 10n ** 18n, allocated: 0n, claimed: 0n, closed: false });
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "fund_pool", txHash: hash, poolId } });
    expect(r.status).toBe(200);
    expect(r.json.result.funded_wei).toBe((10n ** 18n).toString());
    // recording the same hash twice does not double count
    const again = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "fund_pool", txHash: hash, poolId } });
    expect(again.json.result.funded_wei).toBe((10n ** 18n).toString());
  });

  it("previews a deterministic, bounded distribution that excludes self-referrals and ineligible recs", async () => {
    const a = (await t.call("GET", `/api/pools/${poolId}`)).json.preview;
    const b = (await t.call("GET", `/api/pools/${poolId}`)).json.preview;
    expect(a).toEqual(b);
    expect(BigInt(a.distributableWei)).toBe(10n ** 18n); // min(1.5 budget, 1.0 funded)
    expect(BigInt(a.totalAllocatedWei) + BigInt(a.unallocatedWei)).toBe(BigInt(a.distributableWei));
    const maxCap = (BigInt(a.distributableWei) * BigInt(a.rules.maxShareBps)) / 10000n;
    for (const c of a.byCurator) expect(BigInt(c.amountWei) <= maxCap).toBe(true);
    const payable = a.rows.filter((r: { status: string }) => r.status === "payable");
    expect(payable.length).toBe(2);
    expect(a.rows.every((r: { score: { evidence: { verifiedCheckins: number } }; status: string }) => r.status !== "payable" || r.score.evidence.verifiedCheckins >= a.rules.minVerifiedCheckins)).toBe(true);
  });

  it("blocks a curator without a wallet instead of silently dropping them", async () => {
    const ines = await t.persona("Ines");
    const { event } = await eventAndRec();
    expect(ines.id).toBeTruthy();
    const lantern = (await t.call("GET", "/api/events/lantern-nights")).json;
    const p = await t.call("POST", "/api/pools", { token: sponsor.token, body: { title: "Lantern pool test", eventId: lantern.event.id, budgetMon: "0.5" } });
    const preview = (await t.call("GET", `/api/pools/${p.json.id}`)).json.preview;
    expect(preview.rows.some((r: { status: string }) => r.status === "blocked_no_wallet")).toBe(true);
    expect(event.id).toBeTruthy();
  });

  it("only the sponsor can approve, and approval freezes the allocation", async () => {
    const other = await t.guest("sponsor");
    expect((await t.call("POST", `/api/pools/${poolId}/approve`, { token: other.token })).status).toBe(403);
    const r = await t.call("POST", `/api/pools/${poolId}/approve`, { token: sponsor.token });
    expect(r.status).toBe(201);
    expect(r.json.onchain.recipients).toHaveLength(2);
    const total = r.json.onchain.amounts.reduce((s: bigint, a: string) => s + BigInt(a), 0n);
    expect(total <= 10n ** 18n).toBe(true);
    expect(total.toString()).toBe(r.json.totalWei);
    expect((await t.call("POST", `/api/pools/${poolId}/approve`, { token: sponsor.token })).json.error.code).toBe("distribution_exists");
    (globalThis as Record<string, unknown>).__dist = r.json;
  });

  it("rejects an allocation transaction that differs from the approved distribution", async () => {
    const d = (globalThis as Record<string, any>).__dist;
    const tampered = nextHash();
    const logs = d.onchain.recipients.map((w: string, i: number) => makeLog("RewardAllocated", { poolId: 1n, recipient: w, amount: BigInt(d.onchain.amounts[i]) + (i === 0 ? 1n : 0n) }));
    t.chain.receipts.set(tampered, receipt(sponsorWallet.address, logs));
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "allocate", txHash: tampered, poolId, distributionId: d.id } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("allocation_mismatch");
  });

  it("confirms a matching allocation, then records a claim by the allocated wallet", async () => {
    const d = (globalThis as Record<string, any>).__dist;
    const alloc = nextHash();
    t.chain.receipts.set(alloc, receipt(sponsorWallet.address, d.onchain.recipients.map((w: string, i: number) => makeLog("RewardAllocated", { poolId: 1n, recipient: w, amount: BigInt(d.onchain.amounts[i]) }))));
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "allocate", txHash: alloc, poolId, distributionId: d.id } });
    expect(r.status).toBe(200);
    expect(r.json.result.status).toBe("allocated");

    const recipient = d.onchain.recipients[0] as string;
    const who = Object.values(curators).find((c) => lower(c.account.address) === recipient)!;
    const dash = (await t.call("GET", "/api/me/curator", { token: who.token })).json;
    const reward = dash.rewards.find((x: { distributionId: string }) => x.distributionId === d.id);
    expect(reward.claimable).toBe(true);

    const claim = nextHash();
    t.chain.receipts.set(claim, receipt(who.account.address, [makeLog("RewardClaimed", { poolId: 1n, recipient: who.account.address, amount: BigInt(reward.amountWei) })]));
    const cr = await t.call("POST", "/api/chain/record", { token: who.token, body: { kind: "claim", txHash: claim } });
    expect(cr.status).toBe(200);
    const after = (await t.call("GET", "/api/me/curator", { token: who.token })).json.rewards.find((x: { distributionId: string }) => x.distributionId === d.id);
    expect(after.claimable).toBe(false);
    expect(after.claimTx).toBe(claim);

    const impact = (await t.call("GET", "/api/impact")).json;
    expect(impact.transactions.some((x: { txHash: string; url: string }) => x.txHash === claim && x.url.endsWith(`/tx/${claim}`))).toBe(true);
    expect(impact.stats.confirmedTransactions).toBeGreaterThanOrEqual(4);
  });

  it("does not record claims for pools OFFBEAT does not know", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const u = await t.guest("curator");
    const hash = nextHash();
    t.chain.receipts.set(hash, receipt(stranger.address, [makeLog("RewardClaimed", { poolId: 99n, recipient: stranger.address, amount: 5n })]));
    expect((await t.call("POST", "/api/chain/record", { token: u.token, body: { kind: "claim", txHash: hash } })).json.error.code).toBe("unknown_claim");
  });

  it("reports chain-disabled honestly", async () => {
    t.chain.enabled = false;
    const r = await t.call("POST", "/api/chain/record", { token: sponsor.token, body: { kind: "fund_pool", txHash: nextHash(), poolId } });
    t.chain.enabled = true;
    expect(r.status).toBe(503);
    expect(CONTRACT).toBeTruthy();
  });
});

describe("public surface", () => {
  it("exposes config and never leaks secrets or wallet nonces", async () => {
    const cfg = (await t.call("GET", "/api/config")).json;
    expect(cfg.chainId).toBe(10143);
    expect(JSON.stringify(cfg)).not.toMatch(/secret|private/i);
    const personas = JSON.stringify((await t.call("GET", "/api/auth/personas")).json);
    expect(personas).not.toMatch(/nonce|wallet/);
  });

  it("returns 404 JSON for unknown API routes and disables admin reset by default", async () => {
    expect((await t.call("GET", "/api/nope")).status).toBe(404);
    expect((await t.call("POST", "/api/admin/reset", { headers: { "x-admin-token": "guess" } })).status).toBe(404);
  });
});
