import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { config } from "./config";
import { openDatabase } from "./database";
import { createChainReader } from "./chain";
import { createApp } from "./app";
import { seedDemo } from "./seed";

// Long-running server for LOCAL development and single-container hosting. Vercel uses api/index.ts instead.
const db = await openDatabase(config);
if (config.dbDriver === "pglite" && (await seedDemo(db))) console.log("[offbeat] seeded fictional demo content");
const chain = createChainReader(config);
const api = createApp({ db, config, chain });

const root = new Hono();
root.route("/", api);

// In production one process serves the built SPA + API.
if (existsSync("dist/index.html")) {
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${config.rpcUrl} https://*.monad.xyz https://rpc.ankr.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
  root.use("*", async (c, next) => {
    await next();
    if (!c.req.path.startsWith("/api")) c.header("Content-Security-Policy", csp);
  });
  root.use("/*", serveStatic({ root: "./dist" }));
  const index = readFileSync("dist/index.html", "utf8");
  root.get("*", (c) => c.html(index)); // SPA fallback: direct URLs and refresh work
}

serve({ fetch: root.fetch, port: config.port }, (info) => {
  console.log(`[offbeat] listening on http://localhost:${info.port}  db=${config.dbDriver} chain=${config.chainId} contract=${chain.contractAddress ?? "(not configured)"}`);
});
