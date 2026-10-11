import { config } from "../config";
import { openDatabase } from "../database";
import type { Db } from "../db";

/** Shared guard for scripts that touch the Supabase database. Prints only the host, never credentials. */
export async function openRemote(): Promise<{ db: Db; host: string }> {
  if (config.dbDriver !== "postgres" || !config.databaseUrl) {
    console.error("DATABASE_URL is not set. Put it in a git-ignored env file and run with ENV_FILE=.env.supabase (see docs/DEPLOYMENT.md).");
    process.exit(1);
  }
  const host = new URL(config.databaseUrl).host.replace(/^[^@]*@/, "");
  return { db: await openDatabase(config), host };
}
