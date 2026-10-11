import { config } from "./config";
import { openDatabase } from "./database";
import { createChainReader } from "./chain";
import { createApp } from "./app";

/**
 * Builds the Hono app once per process / serverless instance. Never migrates or seeds:
 * schema changes and demo content are explicit operator actions (npm run db:migrate / db:seed).
 */
let cached: ReturnType<typeof build> | undefined;
function build() {
  return openDatabase(config).then((db) => {
    const chain = createChainReader(config);
    return { app: createApp({ db, config, chain }), db, chain };
  });
}
export function getRuntime() {
  cached ??= build().catch((e) => {
    cached = undefined; // allow a retry on the next request instead of caching a failed start
    throw e;
  });
  return cached;
}
