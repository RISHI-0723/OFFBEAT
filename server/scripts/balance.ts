import { createPublicClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../../shared/chain";
import { config } from "../config";

const pub = createPublicClient({ chain: monadTestnet, transport: http(config.rpcUrl) });
console.log("chain id reported by RPC:", await pub.getChainId());
for (const k of ["DEPLOYER_PRIVATE_KEY", "DEMO_CURATOR_A_PRIVATE_KEY", "DEMO_CURATOR_B_PRIVATE_KEY"]) {
  const pk = process.env[k] as `0x${string}` | undefined;
  if (!pk) continue;
  const a = privateKeyToAccount(pk).address;
  console.log(k.replace("_PRIVATE_KEY", ""), a, formatEther(await pub.getBalance({ address: a })), "MON");
}
