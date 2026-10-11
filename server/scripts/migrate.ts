import { migrate } from "../db";
import { openRemote } from "./remote";

// Additive migrations only (CREATE TABLE/INDEX/...). Tracked in schema_migrations, so re-running is a no-op.
const { db, host } = await openRemote();
console.log(`[migrate] target: ${host}`);
const pending = await db.query<{ name: string }>("SELECT name FROM schema_migrations").catch(() => []);
console.log(`[migrate] already applied: ${pending.map((p) => p.name).join(", ") || "(none)"}`);
const ran = await migrate(db);
console.log(ran.length ? `[migrate] applied: ${ran.join(", ")}` : "[migrate] nothing to apply");
await db.close();
