import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { openPostgres } from "../server/db-postgres";
import { migrate, type Db } from "../server/db";
import { seedDemo } from "../server/seed";
import { createApp } from "../server/app";
import { DbRateLimiter } from "../server/ratelimit";
import { FakeChain, testConfig } from "./helpers";

// Exercises the REAL `postgres` driver (prepare:false, max:1, bind parameters) against a PGlite wire-protocol server.
// This validates the adapter, transactions and migrations locally; it does NOT prove Supabase itself works.
let pg: PGlite, server: PGLiteSocketServer, db: Db;
const PORT = 54329;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  db = openPostgres(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, { ssl: false });
  await migrate(db);
});
afterAll(async () => {
  await db.close();
  await server.stop();
  await pg.close();
});

describe("postgres adapter", () => {
  it("applies migrations once and is idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
    const names = (await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")).map((r) => r.name);
    expect(names).toEqual(["001_init.sql", "002_rate_limits.sql", "003_lock_public_profiles.sql"]);
  });

  it("binds parameters instead of interpolating them", async () => {
    const evil = "x'); DROP TABLE profiles; --";
    await db.query("INSERT INTO profiles (display_name, role) VALUES ($1,'participant')", [evil]).catch(() => undefined); // may fail the length check; must never execute the payload
    expect((await db.query("SELECT 1 FROM profiles WHERE display_name = $1", [evil])).length).toBeLessThanOrEqual(1);
    expect(await db.query("SELECT count(*)::int AS n FROM profiles")).toBeTruthy();
  });

  it("commits a transaction and rolls back on error", async () => {
    await db.tx((t) => t.query("INSERT INTO profiles (display_name, role) VALUES ('Committed One','curator')"));
    await expect(
      db.tx(async (t) => {
        await t.query("INSERT INTO profiles (display_name, role) VALUES ('Rolled Back','curator')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const names = (await db.query<{ display_name: string }>("SELECT display_name FROM profiles")).map((r) => r.display_name);
    expect(names).toContain("Committed One");
    expect(names).not.toContain("Rolled Back");
  });

  it("returns int8 as numbers and numeric as strings, like PGlite", async () => {
    const r = (await db.query<{ a: number; b: string }>("SELECT 41::bigint + 1 AS a, 100000000000000000::numeric(78,0) AS b"))[0]!;
    expect(r.a).toBe(42);
    expect(r.b).toBe("100000000000000000");
  });

  it("shares rate-limit state through the database", async () => {
    const a = new DbRateLimiter(db, "t", 2, 60_000);
    const b = new DbRateLimiter(db, "t", 2, 60_000); // a second "instance"
    expect([await a.take("k"), await b.take("k"), await a.take("k")]).toEqual([true, true, false]);
    expect(await b.take("other")).toBe(true);
  });

  it("serves the app end-to-end and persists across independent requests", async () => {
    await db.exec("TRUNCATE profiles RESTART IDENTITY CASCADE");
    expect(await seedDemo(db)).toBe(true);
    expect(await seedDemo(db)).toBe(false); // seeding twice never duplicates
    const app = createApp({ db, config: testConfig, chain: new FakeChain() });
    const post = (path: string, body: unknown, token?: string) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

    const personas = (await (await app.request("/api/auth/personas")).json()) as { id: string; role: string }[];
    const curator = personas.find((p) => p.role === "curator")!;
    const { token } = (await (await post("/api/auth/demo", { profileId: curator.id })).json()) as { token: string };
    const me = (await (await app.request("/api/me", { headers: { authorization: `Bearer ${token}` } })).json()) as { viewer: { id: string } };
    expect(me.viewer.id).toBe(curator.id);

    const guest = await post("/api/auth/guest", { displayName: "Persistence Check", role: "participant" });
    expect(guest.status).toBe(201);
    const feed = (await (await app.request("/api/feed")).json()) as { items: unknown[] };
    expect(feed.items.length).toBeGreaterThan(0);
    expect(((await (await app.request("/api/events")).json()) as unknown[]).length).toBe(3);
    // A fresh request sees the guest created by the previous one.
    expect((await db.query("SELECT 1 FROM profiles WHERE display_name = 'Persistence Check'")).length).toBe(1);
  });
});
