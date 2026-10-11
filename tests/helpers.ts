import { encodeAbiParameters, encodeEventTopics } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { rewardPoolAbi } from "../shared/abi";
import { createApp, walletMessage } from "../server/app";
import { openDb, type Db } from "../server/db";
import { seedDemo } from "../server/seed";
import type { ChainReader, ChainReceipt, OnchainPool } from "../server/chain";
import type { Config } from "../server/config";

export const CONTRACT = "0x00000000000000000000000000000000000c0de1";

export const testConfig: Config = {
  isProd: false,
  port: 0,
  sessionSecret: "x".repeat(40),
  dbDriver: "pglite",
  databaseUrl: null,
  dataDir: "",
  rpcUrl: "http://localhost:0",
  chainId: 10143,
  explorerUrl: "https://testnet.monadvision.com",
  contractAddress: CONTRACT,
  adminToken: "",
  allowProdReset: false,
};

export class FakeChain implements ChainReader {
  enabled = true;
  chainId = 10143;
  contractAddress: string | null = CONTRACT;
  receipts = new Map<string, ChainReceipt>();
  pools = new Map<string, OnchainPool>();
  async getReceipt(hash: `0x${string}`) {
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async readPool(id: bigint) {
    const p = this.pools.get(id.toString());
    if (!p) throw new Error("no pool");
    return p;
  }
}

type EvName = "PoolCreated" | "PoolFunded" | "RewardAllocated" | "RewardClaimed" | "PoolClosed";
export function makeLog(name: EvName, args: Record<string, unknown>, address = CONTRACT) {
  const abiItem = rewardPoolAbi.find((i) => i.type === "event" && i.name === name)!;
  const topics = encodeEventTopics({ abi: [abiItem], eventName: name, args } as never);
  const nonIndexed = (abiItem as unknown as { inputs: { name: string; type: string; indexed?: boolean }[] }).inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
  return { address, topics, data };
}

let hashCounter = 1;
export const nextHash = () => `0x${(hashCounter++).toString(16).padStart(64, "0")}` as `0x${string}`;

export function receipt(from: string, logs: ReturnType<typeof makeLog>[], over: Partial<ChainReceipt> = {}): ChainReceipt {
  return { status: "success", blockNumber: 123n, from, to: CONTRACT, logs: logs as ChainReceipt["logs"], ...over };
}

export async function setup() {
  const db: Db = await openDb("");
  await seedDemo(db);
  const chain = new FakeChain();
  const app = createApp({ db, config: testConfig, chain });
  let ipN = 0;
  const tokenIp = new Map<string, string>();
  const newIp = () => `10.1.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": (opts.token && tokenIp.get(opts.token)) || "10.0.0.1", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { status: res.status, json };
  };
  const personas = (await call("GET", "/api/auth/personas")).json as { id: string; displayName: string; role: string }[];
  const persona = async (name: string) => {
    const p = personas.find((x) => x.displayName.startsWith(name))!;
    const r = await call("POST", "/api/auth/demo", { body: { profileId: p.id }, headers: { "x-forwarded-for": newIp() } });
    tokenIp.set(r.json.token, newIp());
    return { id: p.id, token: r.json.token as string };
  };
  let guestN = 0;
  const guest = async (role: "curator" | "participant" | "sponsor", name = `Guest ${++guestN}`) => {
    const r = await call("POST", "/api/auth/guest", { body: { displayName: name, role }, headers: { "x-forwarded-for": newIp() } });
    tokenIp.set(r.json.token, newIp());
    const me = await call("GET", "/api/me", { token: r.json.token });
    return { id: me.json.viewer.id as string, token: r.json.token as string };
  };
  const linkWallet = async (u: { token: string }, pk = generatePrivateKey()) => {
    const account = privateKeyToAccount(pk);
    const n = await call("POST", "/api/me/wallet/nonce", { token: u.token });
    const signature = await account.signMessage({ message: n.json.message });
    const r = await call("POST", "/api/me/wallet", { token: u.token, body: { address: account.address, signature } });
    return { account, status: r.status, json: r.json };
  };
  return { db, app, chain, call, persona, guest, linkWallet };
}

export { walletMessage };
