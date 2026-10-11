import { seedDemo } from "../seed";
import { openRemote } from "./remote";

// One-time, safe: does nothing if ANY profile already exists, and re-checks under an advisory lock.
const { db, host } = await openRemote();
console.log(`[seed] target: ${host}`);
console.log((await seedDemo(db)) ? "[seed] fictional demo content inserted (all rows flagged is_demo)" : "[seed] database already has data; nothing changed");
await db.close();
