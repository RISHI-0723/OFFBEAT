import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile(process.env.ENV_FILE ?? ".env");
} catch {
  /* no .env file: rely on the real environment */
}

const isProd = process.env.NODE_ENV === "production";

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd) throw new Error("SESSION_SECRET (>= 32 chars) is required in production");
  // Dev only: ephemeral secret, sessions reset on restart.
  return randomBytes(32).toString("hex");
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8787),
  sessionSecret: sessionSecret(),
  dataDir: process.env.DATA_DIR === undefined ? "./data/pg" : process.env.DATA_DIR, // "" => in-memory
  rpcUrl: process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
  chainId: Number(process.env.CHAIN_ID ?? 10143),
  explorerUrl: (process.env.EXPLORER_URL ?? "https://testnet.monadvision.com").replace(/\/$/, ""),
  contractAddress: (process.env.REWARD_POOL_ADDRESS ?? "").trim().toLowerCase() || null,
  adminToken: process.env.DEMO_ADMIN_TOKEN ?? "",
};

export type Config = typeof config;
