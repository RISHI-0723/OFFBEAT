/**
 * Creates dedicated TESTNET-ONLY wallets for the deployer and two demo curators, stored in the git-ignored .env.
 * Only addresses are printed. Fund the deployer address from https://faucet.monad.xyz.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { setEnv } from "./envfile";

const keys = ["DEPLOYER_PRIVATE_KEY", "DEMO_CURATOR_A_PRIVATE_KEY", "DEMO_CURATOR_B_PRIVATE_KEY"] as const;
for (const k of keys) {
  let pk = process.env[k];
  if (!pk) {
    pk = generatePrivateKey();
    setEnv(k, pk);
    console.log(`created ${k} (stored in .env, not printed)`);
  }
  console.log(`${k.replace("_PRIVATE_KEY", "")} address: ${privateKeyToAccount(pk as `0x${string}`).address}`);
}
console.log(`\nFund the DEPLOYER address with testnet MON at https://faucet.monad.xyz (chain ${config.chainId}).`);
