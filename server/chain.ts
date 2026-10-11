import { createPublicClient, http, parseEventLogs, type Log } from "viem";
import { rewardPoolAbi } from "../shared/abi";
import { monadTestnet } from "../shared/chain";
import type { Config } from "./config";

export interface ChainReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  from: string;
  to: string | null;
  logs: Pick<Log, "address" | "topics" | "data">[];
}
export interface OnchainPool {
  manager: string;
  funded: bigint;
  allocated: bigint;
  claimed: bigint;
  closed: boolean;
}
/** Everything the server needs from the chain. Faked in tests; real implementation below. */
export interface ChainReader {
  readonly enabled: boolean;
  readonly chainId: number;
  readonly contractAddress: string | null;
  getReceipt(hash: `0x${string}`): Promise<ChainReceipt | null>;
  readPool(poolId: bigint): Promise<OnchainPool>;
}

export type PoolEvent =
  | { name: "PoolCreated"; poolId: bigint; manager: string; title: string }
  | { name: "PoolFunded"; poolId: bigint; funder: string; amount: bigint }
  | { name: "RewardAllocated"; poolId: bigint; recipient: string; amount: bigint }
  | { name: "RewardClaimed"; poolId: bigint; recipient: string; amount: bigint }
  | { name: "PoolClosed"; poolId: bigint; manager: string; refunded: bigint };

/** Decode only logs emitted by OUR contract address. Logs from other contracts are ignored. */
export function decodePoolEvents(contract: string, logs: ChainReceipt["logs"]): PoolEvent[] {
  const mine = logs.filter((l) => l.address.toLowerCase() === contract.toLowerCase());
  const parsed = parseEventLogs({ abi: rewardPoolAbi, logs: mine as Log[], strict: true });
  const out: PoolEvent[] = [];
  for (const p of parsed) {
    const a = p.args as Record<string, unknown>;
    switch (p.eventName) {
      case "PoolCreated":
        out.push({ name: "PoolCreated", poolId: a.poolId as bigint, manager: (a.manager as string).toLowerCase(), title: a.title as string });
        break;
      case "PoolFunded":
        out.push({ name: "PoolFunded", poolId: a.poolId as bigint, funder: (a.funder as string).toLowerCase(), amount: a.amount as bigint });
        break;
      case "RewardAllocated":
        out.push({ name: "RewardAllocated", poolId: a.poolId as bigint, recipient: (a.recipient as string).toLowerCase(), amount: a.amount as bigint });
        break;
      case "RewardClaimed":
        out.push({ name: "RewardClaimed", poolId: a.poolId as bigint, recipient: (a.recipient as string).toLowerCase(), amount: a.amount as bigint });
        break;
      case "PoolClosed":
        out.push({ name: "PoolClosed", poolId: a.poolId as bigint, manager: (a.manager as string).toLowerCase(), refunded: a.refunded as bigint });
        break;
    }
  }
  return out;
}

export function createChainReader(cfg: Config): ChainReader {
  const contract = cfg.contractAddress;
  const client = createPublicClient({ chain: { ...monadTestnet, id: cfg.chainId }, transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
  return {
    enabled: Boolean(contract),
    chainId: cfg.chainId,
    contractAddress: contract,
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber, from: r.from, to: r.to ?? null, logs: r.logs };
      } catch (e) {
        if (e instanceof Error && /could not be found|not be found|TransactionReceiptNotFound/i.test(e.name + e.message)) return null;
        throw e;
      }
    },
    async readPool(poolId) {
      if (!contract) throw new Error("contract not configured");
      const [manager, funded, allocated, claimed, closed] = await client.readContract({
        address: contract as `0x${string}`,
        abi: rewardPoolAbi,
        functionName: "getPool",
        args: [poolId],
      });
      return { manager: manager.toLowerCase(), funded, allocated, claimed, closed };
    },
  };
}
