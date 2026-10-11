import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadTestnet } from "../../shared/chain";

/** Browser wallets only (MetaMask, Rabby, …). No keys ever touch this app. */
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http() },
  ssr: false,
});
