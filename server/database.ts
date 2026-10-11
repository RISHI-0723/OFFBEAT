import type { Config } from "./config";
import type { Db } from "./db";
import { openDb } from "./db";
import { openPostgres } from "./db-postgres";

/** Explicit driver choice. Production never silently falls back to an embedded database. */
export async function openDatabase(config: Config): Promise<Db> {
  if (config.dbDriver === "postgres") {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is required (Supabase transaction pooler connection string).");
    return openPostgres(config.databaseUrl);
  }
  if (process.env.VERCEL) throw new Error("Embedded PGlite cannot be used on Vercel. Set DATABASE_URL.");
  return openDb(config.dataDir);
}
