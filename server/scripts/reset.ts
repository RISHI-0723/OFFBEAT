import { config } from "../config";
import { openDb } from "../db";
import { resetAndSeed } from "../app";

const db = await openDb(config.dataDir);
await resetAndSeed(db);
console.log("[offbeat] database reset and reseeded with fictional demo content");
await db.close();
