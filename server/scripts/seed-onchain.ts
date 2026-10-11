/**
 * Drives the REAL OFFBEAT flow against a running server and the configured chain, using testnet-only keys from .env:
 *   link wallets → create pool → fund → approve distribution → allocate → curators claim.
 * Every step goes through the public API, so the server verifies each receipt exactly as it would for a judge.
 * Nothing is faked: if a step fails, the script stops and prints why.
 *
 *   npm run chain:seed            (server must be running with REWARD_POOL_ADDRESS set)
 *   FUND_MON=0.05 API_URL=http://localhost:8787 npm run chain:seed
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { rewardPoolAbi } from "../../shared/abi";
import { explorerTx, monadTestnet, MONAD_TESTNET_ID } from "../../shared/chain";
import { config } from "../config";
import { walletMessage } from "../app";

const API = process.env.API_URL ?? "http://localhost:8787";
const FUND_MON = process.env.FUND_MON ?? "0.05";
const POOL_TITLE = process.env.POOL_TITLE ?? "Harbour Listening Night: Discovery Fund (demo)";

if (config.chainId !== MONAD_TESTNET_ID) throw new Error(`CHAIN_ID must be ${MONAD_TESTNET_ID}`);
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing. Run \`npm run chain:wallet\`.`);
  return v as `0x${string}`;
};
const contract = (config.contractAddress ?? (() => { throw new Error("REWARD_POOL_ADDRESS missing. Run `npm run chain:deploy` first."); })()) as `0x${string}`;

const chain = { ...monadTestnet, id: config.chainId };
const pub = createPublicClient({ chain, transport: http(config.rpcUrl) });
const walletFor = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport: http(config.rpcUrl) });

async function call<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json?.error?.message ?? "error"}`);
  return json as T;
}
const step = (s: string) => console.log(`\n▸ ${s}`);
const tx = (h: string) => console.log(`  tx ${explorerTx(config.explorerUrl, h)}`);

async function signInPersona(prefix: string) {
  const personas = await call<{ id: string; displayName: string }[]>(null, "GET", "/api/auth/personas");
  const p = personas.find((x) => x.displayName.startsWith(prefix));
  if (!p) throw new Error(`persona ${prefix} not found (is the database seeded?)`);
  const { token } = await call<{ token: string }>(null, "POST", "/api/auth/demo", { profileId: p.id });
  return { id: p.id, token };
}
async function linkWallet(user: { id: string; token: string }, account: PrivateKeyAccount) {
  const me = await call<{ viewer: { wallet_address: string | null } }>(user.token, "GET", "/api/me");
  if (me.viewer.wallet_address === account.address.toLowerCase()) return;
  const { message } = await call<{ message: string }>(user.token, "POST", "/api/me/wallet/nonce");
  void walletMessage; // message format is owned by the server; we sign exactly what it returns
  const signature = await account.signMessage({ message });
  await call(user.token, "POST", "/api/me/wallet", { address: account.address, signature });
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

const deployer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY"));
const curatorA = privateKeyToAccount(need("DEMO_CURATOR_A_PRIVATE_KEY"));
const curatorB = privateKeyToAccount(need("DEMO_CURATOR_B_PRIVATE_KEY"));

console.log(`API ${API} · chain ${config.chainId} · contract ${contract}`);
const bal = await pub.getBalance({ address: deployer.address });
console.log(`deployer ${deployer.address} balance ${formatEther(bal)} MON`);
const fund = parseEther(FUND_MON);
if (bal < fund + parseEther("0.03")) throw new Error(`Deployer needs at least ${FUND_MON} MON plus gas and a little to top up curator wallets. Use https://faucet.monad.xyz`);

step("Sign in demo personas and link wallets (signature-verified by the server)");
const sponsor = await signInPersona("Harbourlight");
const noor = await signInPersona("Noor");
const teo = await signInPersona("Teo");
await linkWallet(sponsor, deployer);
await linkWallet(noor, curatorA);
await linkWallet(teo, curatorB);

const pools = await call<{ id: string; title: string; contract_pool_id: number | null; status: string }[]>(null, "GET", "/api/pools");
const pool = pools.find((p) => p.title === POOL_TITLE);
if (!pool) throw new Error(`Pool "${POOL_TITLE}" not found`);
if (pool.status !== "draft") throw new Error(`Pool is already ${pool.status}; run \`npm run db:reset\` for a clean run.`);

step("Create the pool on-chain (manager = sponsor wallet)");
const createHash = await walletFor(deployer).writeContract({ address: contract, abi: rewardPoolAbi, functionName: "createPool", args: [pool.title] });
tx(createHash);
await pub.waitForTransactionReceipt({ hash: createHash });
await record(sponsor.token, { kind: "create_pool", txHash: createHash, poolId: pool.id });

step(`Fund the pool with ${FUND_MON} testnet MON`);
const fundHash = await walletFor(deployer).writeContract({ address: contract, abi: rewardPoolAbi, functionName: "fundPool", args: [BigInt((await call<{ pool: { contract_pool_id: number } }>(null, "GET", `/api/pools/${pool.id}`)).pool.contract_pool_id)], value: fund });
tx(fundHash);
await pub.waitForTransactionReceipt({ hash: fundHash });
await record(sponsor.token, { kind: "fund_pool", txHash: fundHash, poolId: pool.id });

step("Approve the server-computed distribution");
const dist = await call<{ id: string; totalWei: string }>(sponsor.token, "POST", `/api/pools/${pool.id}/approve`);
console.log(`  approved distribution ${dist.id}, total ${formatEther(BigInt(dist.totalWei))} MON`);
const args = await call<{ contractPoolId: number; recipients: `0x${string}`[]; amounts: string[] }>(sponsor.token, "GET", `/api/distributions/${dist.id}/onchain-args`);
args.recipients.forEach((r, i) => console.log(`  ${r} <- ${formatEther(BigInt(args.amounts[i]!))} MON`));

step("Allocate on-chain");
const allocHash = await walletFor(deployer).writeContract({ address: contract, abi: rewardPoolAbi, functionName: "allocateRewards", args: [BigInt(args.contractPoolId), args.recipients, args.amounts.map((a) => BigInt(a))] });
tx(allocHash);
await pub.waitForTransactionReceipt({ hash: allocHash });
await record(sponsor.token, { kind: "allocate", txHash: allocHash, poolId: pool.id, distributionId: dist.id });

step("Curators claim their own rewards");
for (const [account, user] of [[curatorA, noor], [curatorB, teo]] as const) {
  if (!args.recipients.map((r) => r.toLowerCase()).includes(account.address.toLowerCase())) {
    console.log(`  ${account.address} was not allocated anything; skipping`);
    continue;
  }
  if ((await pub.getBalance({ address: account.address })) < parseEther("0.005")) {
    const top = await walletFor(deployer).sendTransaction({ to: account.address, value: parseEther("0.01") });
    await pub.waitForTransactionReceipt({ hash: top });
    console.log(`  topped up gas for ${account.address}`);
  }
  const claimHash = await walletFor(account).writeContract({ address: contract, abi: rewardPoolAbi, functionName: "claimReward", args: [BigInt(args.contractPoolId)] });
  tx(claimHash);
  await pub.waitForTransactionReceipt({ hash: claimHash });
  await record(user.token, { kind: "claim", txHash: claimHash });
}

const impact = await call<{ transactions: { kind: string; url: string }[] }>(null, "GET", "/api/impact");
console.log(`\n✓ Done. ${impact.transactions.length} receipt-verified transactions are now on the public impact ledger:`);
for (const t of impact.transactions) console.log(`  ${t.kind.padEnd(12)} ${t.url}`);
