import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Queryable = Pick<PGlite, "query" | "exec">;

function wrap(q: Queryable, root: PGlite | null): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query<T>(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (!root) return fn(this); // already inside a transaction
      return root.transaction(async (t) => fn(wrap(t as unknown as Queryable, null)));
    },
    async close() {
      if (root) await root.close();
    },
  };
}

const here = dirname(fileURLToPath(import.meta.url));

/** Open an embedded Postgres (PGlite). dataDir "" => in-memory. */
export async function openDb(dataDir: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const db = wrap(pg, pg);
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = join(here, "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    await db.tx(async (t) => {
      await t.exec(readFileSync(join(dir, f), "utf8"));
      await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
  }
}
