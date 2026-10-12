import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../server/db";
import { seedDemo } from "../server/seed";

let db: Db;
beforeAll(async () => {
  db = await openDb("");
  await seedDemo(db);
});
afterAll(() => db.close());

const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p))[0]!;

describe("database constraints", () => {
  it("rejects a second check-in for the same (event, user)", async () => {
    const c = await one<{ event_id: string; user_id: string; issued_by: string }>("SELECT c.event_id, c.user_id, e.organizer_id AS issued_by FROM checkins c JOIN events e ON e.id = c.event_id LIMIT 1");
    const tok = await one<{ id: string }>("INSERT INTO checkin_tokens (event_id, token_hash, issued_by, expires_at) VALUES ($1, repeat('a',64), $2, now() + interval '1 minute') RETURNING id", [c.event_id, c.issued_by]);
    await expect(db.query("INSERT INTO checkins (event_id, user_id, token_id, status) VALUES ($1,$2,$3,'verified')", [c.event_id, c.user_id, tok.id])).rejects.toThrow(/duplicate key/);
  });

  it("rejects reusing one token for two check-ins", async () => {
    const c = await one<{ token_id: string; event_id: string }>("SELECT token_id, event_id FROM checkins LIMIT 1");
    const u = await one<{ id: string }>("SELECT id FROM profiles WHERE display_name = 'Sam Okafor (demo attendee)'");
    await expect(db.query("INSERT INTO checkins (event_id, user_id, token_id, status) VALUES ($1,$2,$3,'verified')", [c.event_id, u.id, c.token_id])).rejects.toThrow(/duplicate key/);
  });

  it("forbids a verified self-referral at the database level", async () => {
    const r = await one<{ id: string; curator_id: string; event_id: string }>("SELECT id, curator_id, event_id FROM recommendations WHERE event_id IS NOT NULL LIMIT 1");
    const org = await one<{ organizer_id: string }>("SELECT organizer_id FROM events WHERE id = $1", [r.event_id]);
    const tok = await one<{ id: string }>("INSERT INTO checkin_tokens (event_id, token_hash, issued_by, expires_at) VALUES ($1, repeat('b',64), $2, now() + interval '1 minute') RETURNING id", [r.event_id, org.organizer_id]);
    await expect(db.query("INSERT INTO checkins (event_id, user_id, recommendation_id, token_id, status) VALUES ($1,$2,$3,$4,'verified')", [r.event_id, r.curator_id, r.id, tok.id])).rejects.toThrow(/self-referral/);
  });

  it("forbids self-rating at the database level", async () => {
    const r = await one<{ id: string; curator_id: string }>("SELECT id, curator_id FROM recommendations LIMIT 1");
    await expect(db.query("INSERT INTO ratings (recommendation_id, rater_id, stars) VALUES ($1,$2,5)", [r.id, r.curator_id])).rejects.toThrow(/own recommendation/);
  });

  it("prevents a curator recommending the same creator+event twice", async () => {
    const r = await one<{ curator_id: string; creator_id: string; event_id: string }>("SELECT curator_id, creator_id, event_id FROM recommendations WHERE event_id IS NOT NULL LIMIT 1");
    await expect(
      db.query("INSERT INTO recommendations (slug, curator_id, creator_id, event_id, title, reason, referral_code) VALUES ('dupe-x',$1,$2,$3,'Duplicate title',repeat('reason ',10),'ABCDEFGH')", [r.curator_id, r.creator_id, r.event_id]),
    ).rejects.toThrow(/recommendations_no_dupes/);
  });

  it("makes the audit log append-only", async () => {
    await db.query("INSERT INTO audit_events (action, entity_type) VALUES ('test','test')");
    await expect(db.query("UPDATE audit_events SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
  });

  it("validates wallet formats", async () => {
    await expect(db.query("INSERT INTO profiles (display_name, role, wallet_address) VALUES ('Bad Wallet','curator','0xABC')")).rejects.toThrow(/check/i);
  });

  it("caps total distribution at its budget", async () => {
    const p = await one<{ id: string; sponsor_id: string }>("SELECT id, sponsor_id FROM reward_pools LIMIT 1");
    await expect(db.query("INSERT INTO distributions (pool_id, status, budget_wei, total_wei, formula_version, snapshot, approved_by) VALUES ($1,'approved',10,11,'v','{}',$2)", [p.id, p.sponsor_id])).rejects.toThrow(/check/i);
  });
});

describe("row-level security (anon / authenticated API roles)", () => {
  const asRole = async <T>(role: string, fn: () => Promise<T>) => {
    await db.exec(`SET ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("RESET ROLE");
    }
  };

  it("anon cannot write anything", async () => {
    for (const sql of [
      "INSERT INTO creators (slug,name,category,bio,art_seed) VALUES ('hack','Hack','music','1234567890','x')",
      "UPDATE reward_pools SET funded_wei = 999999",
      "UPDATE checkins SET status = 'verified'",
      "INSERT INTO chain_transactions (kind,tx_hash,chain_id,actor_address,block_number,status) VALUES ('claim','0x' || repeat('1',64),10143,'0x' || repeat('2',40),1,'confirmed')",
    ])
      await expect(asRole("anon", () => db.query(sql))).rejects.toThrow(/permission denied/);
  });

  it("anon cannot read private tables", async () => {
    for (const t of ["profiles", "checkins", "checkin_tokens", "ratings", "audit_events"]) await expect(asRole("anon", () => db.query(`SELECT * FROM ${t}`))).rejects.toThrow(/permission denied/);
  });

  it("anon cannot write through the public_profiles view", async () => {
    for (const sql of ["INSERT INTO public_profiles (display_name, role) VALUES ('Hacker','curator')", "UPDATE public_profiles SET display_name = 'x'", "DELETE FROM public_profiles"])
      await expect(asRole("anon", () => db.query(sql))).rejects.toThrow(/permission denied/);
  });

  it("anon can read public data, never unpublished recommendations, and profiles only via the safe view", async () => {
    await db.query("UPDATE recommendations SET status = 'pending_review' WHERE id = (SELECT id FROM recommendations LIMIT 1)");
    const all = await db.query<{ n: number }>("SELECT count(*)::int n FROM recommendations");
    const vis = await asRole("anon", () => db.query<{ n: number }>("SELECT count(*)::int n FROM recommendations"));
    const profs = await asRole("anon", () => db.query<Record<string, unknown>>("SELECT * FROM public_profiles LIMIT 1"));
    expect(vis[0]!.n).toBe(all[0]!.n - 1);
    expect(Object.keys(profs[0]!)).not.toContain("wallet_nonce");
  });
});
