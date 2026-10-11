import { useCallback, useState } from "react";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useConfig } from "wagmi";
import { MONAD_TESTNET_ID } from "../../shared/chain";
import { rewardPoolAbi } from "../../shared/abi";
import { ApiError } from "./api";
import { useChainConfig } from "./useChainConfig";

export type TxPhase = "idle" | "wallet" | "confirming" | "verifying" | "done" | "error";
export interface TxState {
  phase: TxPhase;
  label?: string;
  hash?: `0x${string}`;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const err = e as { name?: string; shortMessage?: string; message?: string };
  const text = `${err.name ?? ""} ${err.shortMessage ?? ""} ${err.message ?? ""}`;
  if (/UserRejected|User rejected|User denied|rejected the request/i.test(text)) return "You rejected the request in your wallet. Nothing was sent.";
  if (/insufficient funds/i.test(text)) return "Your wallet does not have enough testnet MON for this transaction plus gas. Use the faucet at https://faucet.monad.xyz.";
  if (/NotManager/.test(text)) return "Only the wallet that created this pool can do that.";
  if (/InsufficientPoolBalance/.test(text)) return "The pool does not hold enough funds for that allocation.";
  if (/AlreadyAllocated/.test(text)) return "One of those wallets has already been allocated a reward in this pool.";
  if (/NothingToClaim/.test(text)) return "There is nothing for this wallet to claim (already claimed, or not allocated).";
  if (/ChainMismatch|chain mismatch/i.test(text)) return "Your wallet is on the wrong network. Switch to Monad Testnet and retry.";
  return err.shortMessage ?? err.message ?? "The transaction failed.";
}

/**
 * Send a contract transaction, wait for the receipt, then ask the OFFBEAT server to verify it by reading the
 * receipt itself. UI only says "done" after the server has independently verified the transaction.
 */
export function useTxRunner() {
  const wagmi = useConfig();
  const cfg = useChainConfig();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const run = useCallback(
    async (opts: { label: string; functionName: "createPool" | "fundPool" | "allocateRewards" | "claimReward" | "closePool"; args: readonly unknown[]; value?: bigint; record: (hash: `0x${string}`) => Promise<unknown> }) => {
      const address = cfg.data?.contractAddress as `0x${string}` | null | undefined;
      if (!address) {
        setState({ phase: "error", label: opts.label, message: "No contract is configured on this deployment." });
        return false;
      }
      setState({ phase: "wallet", label: opts.label });
      let hash: `0x${string}` | undefined;
      try {
        hash = await writeContract(wagmi, { abi: rewardPoolAbi, address, functionName: opts.functionName, args: opts.args as never, value: opts.value, chainId: MONAD_TESTNET_ID } as never);
        setState({ phase: "confirming", label: opts.label, hash });
        const receipt = await waitForTransactionReceipt(wagmi, { hash, chainId: MONAD_TESTNET_ID });
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain. No funds moved.");
        setState({ phase: "verifying", label: opts.label, hash });
        for (let attempt = 0; ; attempt++) {
          try {
            await opts.record(hash);
            break;
          } catch (e) {
            if (e instanceof ApiError && e.code === "receipt_pending" && attempt < 8) {
              await sleep(1500);
              continue;
            }
            throw e;
          }
        }
        setState({ phase: "done", label: opts.label, hash });
        return true;
      } catch (e) {
        setState({ phase: "error", label: opts.label, hash, message: friendlyError(e) });
        return false;
      }
    },
    [wagmi, cfg.data?.contractAddress],
  );

  return { state, run, reset: () => setState({ phase: "idle" }), busy: state.phase === "wallet" || state.phase === "confirming" || state.phase === "verifying" };
}
