import postgres, { type Sql, type TransactionSql } from "postgres";
import type { Db } from "./db";

type Runner = Sql | TransactionSql;

function wrap(sql: Runner, root: Sql | null): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      // unsafe() still sends values as bind parameters ($1..); it only skips template-literal parsing.
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text); // no params => simple protocol, allows multi-statement migration files
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (!root) return fn(this);
      return (await root.begin(async (t) => fn(wrap(t, null)))) as T;
    },
    async close() {
      if (root) await root.end({ timeout: 5 });
    },
  };
}

/**
 * Postgres over a pooled connection string (Supabase transaction pooler, port 6543).
 * - prepare:false  — transaction-mode poolers do not support named prepared statements.
 * - max:1          — one connection per serverless instance; the pooler does the real pooling.
 * - No startup parameters are sent (poolers can reject them); timeouts are connect_timeout here and the function's maxDuration.
 * - int8 is returned as a JS number when safe (matches PGlite) so rows look identical on both drivers.
 */
export function openPostgres(url: string, opts: { max?: number; ssl?: boolean } = {}): Db {
  const sql = postgres(url, {
    prepare: false,
    max: opts.max ?? 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    ssl: opts.ssl === false || /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname) ? false : "require",
    types: {
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => (Number.isSafeInteger(Number(x)) ? Number(x) : BigInt(x)) },
    },
    onnotice: () => {},
  });
  return wrap(sql, sql);
}
