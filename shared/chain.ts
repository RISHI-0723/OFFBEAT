import { defineChain } from "viem";

/** Monad Testnet — verified against https://docs.monad.xyz/developer-essentials/testnet */
export const MONAD_TESTNET_ID = 10143;
export const monadTestnet = defineChain({
  id: MONAD_TESTNET_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  testnet: true,
});

export const explorerTx = (base: string, hash: string) => `${base.replace(/\/$/, "")}/tx/${hash}`;
export const explorerAddress = (base: string, addr: string) => `${base.replace(/\/$/, "")}/address/${addr}`;

/** Format wei as a MON string with up to `dp` decimals, trimming trailing zeros. */
export function formatMon(wei: bigint | string | number, dp = 4): string {
  const w = BigInt(wei);
  const base = 10n ** 18n;
  const whole = w / base;
  const frac = (w % base).toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a decimal MON string to wei without floating point. Returns null if invalid. */
export function parseMon(s: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(s.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
}
