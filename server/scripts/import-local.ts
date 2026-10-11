import { PGlite } from "@electric-sql/pglite";
import { existsSync } from "node:fs";
import { openRemote } from "./remote";

/**
 * One-time copy of an existing LOCAL PGlite database into an EMPTY Supabase database, preserving ids,
 * wallet links, pools, distributions and receipt-verified chain transactions. Never updates or deletes.
 *   dry run (default): prints what would be copied
 *   --apply          : performs the copy in a single transaction
 * Refuses if the target already contains any profile.
 */
const src = process.env.SOURCE_DATA_DIR ?? "./data/pg";
const apply = process.argv.includes("--apply");
if (!existsSync(src)) throw new Error(`Source data dir not found: ${src}`);

const TABLES = ["profiles", "creators", "events", "recommendations", "ratings", "checkin_tokens", "checkins", "reward_pools", "distributions", "distribution_items", "chain_transactions", "audit_events"];

const local = new PGlite(src);
await local.waitReady;
const { db, host } = await openRemote();
console.log(`[import] source: ${src}\n[import] target: ${host}\n[import] mode: ${apply ? "APPLY" : "dry run"}`);

const target = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM profiles"))[0]!.n;
if (target > 0) {
  console.error(`[import] target already has ${target} profiles. Refusing to import into a non-empty database.`);
  process.exit(1);
}

const data = new Map<string, Record<string, unknown>[]>();
for (const t of TABLES) {
  const rows = (await local.query<Record<string, unknown>>(`SELECT * FROM ${t}${t === "audit_events" ? " ORDER BY id" : ""}`)).rows;
  data.set(t, rows);
  console.log(`[import] ${t}: ${rows.length} rows`);
}
await local.close();
if (!apply) {
  console.log("[import] dry run only. Re-run with --apply to copy.");
  await db.close();
  process.exit(0);
}

await db.tx(async (t) => {
  await t.query("SELECT pg_advisory_xact_lock(7243002)"); // same lock as the seeder
  if ((await t.query<{ n: number }>("SELECT count(*)::int AS n FROM profiles"))[0]!.n > 0) throw new Error("target no longer empty");
  for (const table of TABLES) {
    const rows = data.get(table)!;
    if (!rows.length) continue;
    const types = new Map((await t.query<{ column_name: string; udt_name: string }>("SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).map((c) => [c.column_name, c.udt_name]));
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v.toISOString();
        if (types.get(c) === "jsonb" || types.get(c) === "json") return JSON.stringify(v);
        return typeof v === "bigint" ? v.toString() : v;
      });
      const ph = cols.map((c, i) => `$${i + 1}::${types.get(c) ?? "text"}`);
      await t.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${ph.join(",")})`, vals);
    }
  }
  await t.exec("SELECT setval(pg_get_serial_sequence('audit_events','id'), COALESCE((SELECT max(id) FROM audit_events), 1), (SELECT count(*) > 0 FROM audit_events))");
});
for (const t of TABLES) console.log(`[import] target ${t}: ${(await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0]!.n}`);
console.log("[import] done");
await db.close();
