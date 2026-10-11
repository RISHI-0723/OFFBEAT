/**
 * Safely (re)tries curator reward claims for the EXISTING pool created by `chain:seed`.
 * It never creates, funds, approves or allocates anything: it only reads on-chain state and, for wallets with a
 * non-zero claimable amount and enough gas, submits `claimReward(poolId)` from that curator's own testnet key.
 * Each confirmed claim is then recorded through the authenticated API, where the server re-verifies the receipt.
 * Safe to run repeatedly: zero-claimable wallets are skipped and the server ledger insert is idempotent.
 *
 *   npm run chain:claim            (server must be running with REWARD_POOL_ADDRESS set)
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardPoolAbi } from "../../shared/abi";
import { explorerTx, monadTestnet, MONAD_TESTNET_ID } from "../../shared/chain";
import { config } from "../config";

const API = process.env.API_URL ?? "http://localhost:8787";
const POOL_TITLE = process.env.POOL_TITLE ?? "Harbour Listening Night: Discovery Fund (demo)";
const MIN_GAS = parseEther(process.env.MIN_GAS_MON ?? "0.005");

if (config.chainId !== MONAD_TESTNET_ID) throw new Error(`CHAIN_ID must be ${MONAD_TESTNET_ID}`);
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from .env (value is never printed).`);
  return v as `0x${string}`;
};
if (!config.contractAddress) throw new Error("REWARD_POOL_ADDRESS missing.");
const contract = config.contractAddress as `0x${string}`;

const chain = { ...monadTestnet, id: config.chainId };
const pub = createPublicClient({ chain, transport: http(config.rpcUrl) });

async function call<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.error?.message ?? "error"}`);
  return json as T;
}
async function signInPersona(prefix: string) {
  const personas = await call<{ id: string; displayName: string }[]>(null, "GET", "/api/auth/personas");
  const p = personas.find((x) => x.displayName.startsWith(prefix));
  if (!p) throw new Error(`persona ${prefix} not found (is the database seeded?)`);
  const { token } = await call<{ token: string }>(null, "POST", "/api/auth/demo", { profileId: p.id });
  return token;
}
async function record(token: string, body: Record<string, unknown>) {
  for (let i = 0; i < 10; i++) {
    try {
      return await call(token, "POST", "/api/chain/record", body);
    } catch (e) {
      if (/not found on the network yet/.test((e as Error).message) && i < 9) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
}

console.log(`API ${API} · chain ${config.chainId} · contract ${contract}`);

// 1. Identify the existing pool from application data, then verify it against on-chain state.
const pools = await call<{ id: string; title: string }[]>(null, "GET", "/api/pools");
const listed = pools.find((p) => p.title === POOL_TITLE);
if (!listed) throw new Error(`Pool "${POOL_TITLE}" not found in application data.`);
const { pool } = await call<{ pool: { id: string; contract_pool_id: number | null; status: string } }>(null, "GET", `/api/pools/${listed.id}`);
if (pool.contract_pool_id == null) throw new Error("Pool is not linked to an on-chain pool; nothing to claim. (This script will not create one.)");
const poolId = BigInt(pool.contract_pool_id);
const [manager, funded, allocated, claimed, closed] = await pub.readContract({ address: contract, abi: rewardPoolAbi, functionName: "getPool", args: [poolId] });
console.log(`pool ${pool.id} → on-chain #${poolId} · manager ${manager} · funded ${formatEther(funded)} · allocated ${formatEther(allocated)} · claimed ${formatEther(claimed)} MON${closed ? " · CLOSED" : ""}`);
if (allocated === 0n) throw new Error("Nothing has been allocated on-chain for this pool; refusing to continue.");

// 2. Check each demo curator.
const curators = [
  { prefix: "Noor", label: "Curator A", account: privateKeyToAccount(need("DEMO_CURATOR_A_PRIVATE_KEY")) },
  { prefix: "Teo", label: "Curator B", account: privateKeyToAccount(need("DEMO_CURATOR_B_PRIVATE_KEY")) },
];
const results: string[] = [];
let failed = false;

for (const c of curators) {
  const addr = c.account.address;
  console.log(`\n▸ ${c.label} ${addr}`);
  const before = await pub.readContract({ address: contract, abi: rewardPoolAbi, functionName: "claimable", args: [poolId, addr] });
  const gas = await pub.getBalance({ address: addr });
  console.log(`  claimable ${formatEther(before)} MON · wallet ${formatEther(gas)} MON`);
  if (before === 0n) {
    console.log("  nothing claimable (never allocated, or already claimed); skipping");
    results.push(`${c.label}: skipped (zero claimable)`);
    continue;
  }
  if (gas < MIN_GAS) {
    console.error(`  INSUFFICIENT GAS: needs at least ${formatEther(MIN_GAS)} MON, has ${formatEther(gas)}. Fund ${addr} from https://faucet.monad.xyz and rerun.`);
    results.push(`${c.label}: NOT claimed (insufficient gas)`);
    failed = true;
    continue;
  }
  try {
    const hash = await createWalletClient({ account: c.account, chain, transport: http(config.rpcUrl) }).writeContract({ address: contract, abi: rewardPoolAbi, functionName: "claimReward", args: [poolId] });
    console.log(`  submitted ${explorerTx(config.explorerUrl, hash)}`);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("claim transaction reverted");
    const after = await pub.readContract({ address: contract, abi: rewardPoolAbi, functionName: "claimable", args: [poolId, addr] });
    if (after !== 0n) throw new Error(`claimable still ${formatEther(after)} MON after a successful receipt`);
    const token = await signInPersona(c.prefix);
    await record(token, { kind: "claim", txHash: hash });
    console.log(`  ✓ confirmed in block ${receipt.blockNumber}; claimed ${formatEther(before)} MON; recorded on the ledger`);
    results.push(`${c.label}: claimed ${formatEther(before)} MON (${explorerTx(config.explorerUrl, hash)})`);
  } catch (e) {
    failed = true;
    console.error(`  ✗ ${(e as Error).message}`);
    results.push(`${c.label}: FAILED (${(e as Error).message})`);
  }
}

const [, , allocatedNow, claimedNow] = await pub.readContract({ address: contract, abi: rewardPoolAbi, functionName: "getPool", args: [poolId] });
console.log(`\nOn-chain pool #${poolId}: allocated ${formatEther(allocatedNow)} · claimed ${formatEther(claimedNow)} MON`);
console.log(results.map((r) => `  ${r}`).join("\n"));
if (failed) process.exitCode = 1;
