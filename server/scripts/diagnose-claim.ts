/** Read-only diagnosis of a failing claim. Sends nothing. Prints public addresses/values only.
 *  EXPECTED_A=0x... npx tsx server/scripts/diagnose-claim.ts */
import { createPublicClient, formatEther, formatGwei, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardPoolAbi } from "../../shared/abi";
import { monadTestnet } from "../../shared/chain";
import { config } from "../config";

const EXPECTED_A = (process.env.EXPECTED_A ?? "0x10F1516B14EB83903889714d26087Cf38e35D6CC").toLowerCase();
const B_TX = (process.env.B_TX ?? "0x912869ad8c2de7621d3643651ea363c5eea8aaaa1ebde719092338baf0ae5d0b") as `0x${string}`;
const contract = config.contractAddress as `0x${string}`;
const pub = createPublicClient({ chain: { ...monadTestnet, id: config.chainId }, transport: http(config.rpcUrl) });
const errText = (e: unknown) => ((e as Error).message ?? String(e)).split("\n").slice(0, 3).join(" | ");

console.log("rpc host:", new URL(config.rpcUrl).host, "· rpc chainId:", await pub.getChainId(), "· configured:", config.chainId);
const poolId = 1n;
for (const [label, key] of [["A", "DEMO_CURATOR_A_PRIVATE_KEY"], ["B", "DEMO_CURATOR_B_PRIVATE_KEY"]] as const) {
  const raw = process.env[key];
  if (!raw) { console.log(label, key, "MISSING"); continue; }
  const acct = privateKeyToAccount(raw as `0x${string}`);
  console.log(`\n[${label}] derived ${acct.address}`);
  if (label === "A") console.log(`[A] expected ${EXPECTED_A} → ${acct.address.toLowerCase() === EXPECTED_A ? "MATCH" : "MISMATCH"}`);
  const bal = await pub.getBalance({ address: acct.address });
  const claimable = await pub.readContract({ address: contract, abi: rewardPoolAbi, functionName: "claimable", args: [poolId, acct.address] });
  console.log(`[${label}] balance ${formatEther(bal)} MON · claimable ${formatEther(claimable)} MON · nonce ${await pub.getTransactionCount({ address: acct.address })}`);
  try {
    const gas = await pub.estimateContractGas({ address: contract, abi: rewardPoolAbi, functionName: "claimReward", args: [poolId], account: acct.address });
    const fees = await pub.estimateFeesPerGas();
    console.log(`[${label}] estimateGas ${gas} · maxFee ${formatGwei(fees.maxFeePerGas ?? 0n)} gwei · prio ${formatGwei(fees.maxPriorityFeePerGas ?? 0n)} gwei · worst-case cost ${formatEther(gas * (fees.maxFeePerGas ?? 0n))} MON`);
  } catch (e) { console.log(`[${label}] estimateGas FAILED: ${errText(e)}`); }
}
console.log("\nGas price:", formatGwei(await pub.getGasPrice()), "gwei");
try {
  const tx = await pub.getTransaction({ hash: B_TX });
  const rc = await pub.getTransactionReceipt({ hash: B_TX });
  console.log(`B tx: type ${tx.type} · gas limit ${tx.gas} · used ${rc.gasUsed} · gasPrice ${tx.gasPrice ? formatGwei(tx.gasPrice) : "-"} · maxFee ${tx.maxFeePerGas ? formatGwei(tx.maxFeePerGas) : "-"} · status ${rc.status} · to ${tx.to}`);
} catch (e) { console.log("B tx lookup failed:", errText(e)); }
