import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface PublicConfig {
  chainId: number;
  networkName: string;
  explorerUrl: string;
  rpcUrl: string;
  contractAddress: string | null;
  chainEnabled: boolean;
  currency: string;
}

export function useChainConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api.get<PublicConfig>("/api/config"), staleTime: 5 * 60_000 });
}

export const txUrl = (cfg: Pick<PublicConfig, "explorerUrl"> | undefined, hash: string) => `${(cfg?.explorerUrl ?? "https://testnet.monadvision.com").replace(/\/$/, "")}/tx/${hash}`;
export const addrUrl = (cfg: Pick<PublicConfig, "explorerUrl"> | undefined, a: string) => `${(cfg?.explorerUrl ?? "https://testnet.monadvision.com").replace(/\/$/, "")}/address/${a}`;
