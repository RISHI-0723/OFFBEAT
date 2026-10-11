/** Deploys contracts/src/RewardPool.sol to Monad TESTNET using DEPLOYER_PRIVATE_KEY from .env. Refuses any other chain. */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { explorerAddress, explorerTx, monadTestnet, MONAD_TESTNET_ID } from "../../shared/chain";
import { config } from "../config";
import { setEnv } from "./envfile";

if (config.chainId !== MONAD_TESTNET_ID) throw new Error(`Refusing to deploy: CHAIN_ID must be ${MONAD_TESTNET_ID} (Monad Testnet). Mainnet deployment is out of scope.`);
const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY missing. Run `npm run chain:wallet` first.");

const artifact = JSON.parse(readFileSync("contracts/out/RewardPool.sol/RewardPool.json", "utf8")) as { abi: unknown[]; bytecode: { object: `0x${string}` } };
const account = privateKeyToAccount(pk);
const transport = http(config.rpcUrl);
const pub = createPublicClient({ chain: monadTestnet, transport });
const wallet = createWalletClient({ account, chain: monadTestnet, transport });

const chainId = await pub.getChainId();
if (chainId !== MONAD_TESTNET_ID) throw new Error(`RPC reports chain ${chainId}, expected ${MONAD_TESTNET_ID}`);
const balance = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address} balance ${formatEther(balance)} MON`);
if (balance === 0n) throw new Error("Deployer has 0 MON. Fund it at https://faucet.monad.xyz and retry.");

const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode.object });
console.log(`deploy tx: ${explorerTx(config.explorerUrl, hash)}`);
const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment failed");
setEnv("REWARD_POOL_ADDRESS", receipt.contractAddress);
console.log(`RewardPool deployed at ${receipt.contractAddress}`);
console.log(`explorer: ${explorerAddress(config.explorerUrl, receipt.contractAddress)}`);
console.log(`REWARD_POOL_ADDRESS written to ${process.env.ENV_FILE ?? ".env"}`);
