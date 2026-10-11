import type { Db } from "../db";
import type { Viewer } from "../auth";
import { decodePoolEvents, type ChainReader, type PoolEvent } from "../chain";
import { HttpError, big } from "../util";
import { audit } from "./data";
import { getPoolRow, syncPoolFromChain, type PoolRow } from "./rewards";

export type RecordKind = "create_pool" | "fund_pool" | "allocate" | "claim" | "close_pool";

/**
 * The client may only *report* a transaction hash. Nothing is trusted from the client:
 * the server reads the receipt itself, checks it succeeded, was sent to OUR contract, and that the
 * decoded events match what the database expects. Only then is a `chain_transactions` row written.
 */
export async function recordTransaction(
  db: Db,
  chain: ChainReader,
  viewer: Viewer,
  input: { kind: RecordKind; txHash: `0x${string}`; poolId?: string; distributionId?: string },
) {
  if (!chain.enabled || !chain.contractAddress) throw new HttpError(503, "On-chain features are not configured on this deployment.", "chain_disabled");
  const contract = chain.contractAddress;
  const receipt = await chain.getReceipt(input.txHash);
  if (!receipt) throw new HttpError(409, "Transaction not found on the network yet. Try again in a few seconds.", "receipt_pending");
  if (receipt.status !== "success") throw new HttpError(422, "That transaction reverted on-chain; nothing was recorded as successful.", "tx_reverted");
  if (!receipt.to || receipt.to.toLowerCase() !== contract) throw new HttpError(422, "That transaction was not sent to the OFFBEAT RewardPool contract.", "wrong_contract");
  const events = decodePoolEvents(contract, receipt.logs);
  const sender = receipt.from.toLowerCase();
  const hash = input.txHash.toLowerCase();

  const insertTx = (q: Db, kind: RecordKind, poolId: string | null, distributionId: string | null, actor: string, amount: bigint) =>
    q.query(
      `INSERT INTO chain_transactions (kind, tx_hash, chain_id, pool_id, distribution_id, actor_address, amount_wei, block_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed') ON CONFLICT (tx_hash, kind, actor_address) DO NOTHING`,
      [kind, hash, chain.chainId, poolId, distributionId, actor, amount.toString(), receipt.blockNumber.toString()],
    );

  switch (input.kind) {
    case "create_pool": {
      const pool = await ownPool(db, viewer, input.poolId);
      if (pool.contract_pool_id != null) throw new HttpError(409, "This pool is already linked to a contract pool.");
      const ev = events.find((e): e is Extract<PoolEvent, { name: "PoolCreated" }> => e.name === "PoolCreated");
      if (!ev) throw new HttpError(422, "No PoolCreated event from the OFFBEAT contract in that transaction.", "no_event");
      if (!viewer.wallet_address || ev.manager !== viewer.wallet_address) throw new HttpError(403, "The pool manager on-chain is not your linked wallet. Link the wallet you used to create the pool.", "manager_mismatch");
      const taken = await db.query("SELECT 1 FROM reward_pools WHERE contract_address = $1 AND contract_pool_id = $2", [contract, Number(ev.poolId)]);
      if (taken.length) throw new HttpError(409, "That on-chain pool is already linked to another OFFBEAT pool.");
      await db.tx(async (t) => {
        await t.query("UPDATE reward_pools SET contract_address = $2, contract_pool_id = $3, status = 'open' WHERE id = $1", [pool.id, contract, Number(ev.poolId)]);
        await insertTx(t, "create_pool", pool.id, null, ev.manager, 0n);
      });
      await audit(db, viewer.id, "chain.create_pool", "reward_pool", pool.id, { txHash: hash });
      return syncPoolFromChain(db, chain, await getPoolRow(db, pool.id));
    }
    case "fund_pool": {
      const pool = await linkedPool(db, input.poolId);
      const funded = events.filter((e): e is Extract<PoolEvent, { name: "PoolFunded" }> => e.name === "PoolFunded" && Number(e.poolId) === pool.contract_pool_id);
      if (!funded.length) throw new HttpError(422, "No PoolFunded event for this pool in that transaction.", "no_event");
      const amount = funded.reduce((s, e) => s + e.amount, 0n);
      await insertTx(db, "fund_pool", pool.id, null, funded[0]!.funder, amount);
      await audit(db, viewer.id, "chain.fund_pool", "reward_pool", pool.id, { txHash: hash });
      return syncPoolFromChain(db, chain, pool); // balance comes from the contract, not from the client
    }
    case "allocate": {
      const pool = await ownPool(db, viewer, input.poolId);
      if (pool.contract_pool_id == null) throw new HttpError(409, "Pool is not linked on-chain.");
      const dist = (await db.query<{ id: string; status: string }>("SELECT id, status FROM distributions WHERE id = $1 AND pool_id = $2", [input.distributionId ?? "", pool.id]))[0];
      if (!dist) throw new HttpError(404, "Distribution not found for this pool.");
      if (dist.status === "failed") throw new HttpError(409, "That distribution was cancelled.");
      const expected = new Map<string, bigint>();
      for (const r of await db.query<{ w: string; a: string }>("SELECT wallet_address AS w, sum(amount_wei)::text AS a FROM distribution_items WHERE distribution_id = $1 GROUP BY wallet_address", [dist.id])) expected.set(r.w, big(r.a));
      const got = new Map<string, bigint>();
      for (const e of events) if (e.name === "RewardAllocated" && Number(e.poolId) === pool.contract_pool_id) got.set(e.recipient, (got.get(e.recipient) ?? 0n) + e.amount);
      const same = expected.size === got.size && [...expected].every(([w, a]) => got.get(w) === a);
      if (!same) throw new HttpError(422, "On-chain allocations do not match the approved distribution; nothing was recorded.", "allocation_mismatch");
      const total = [...got.values()].reduce((s, a) => s + a, 0n);
      await db.tx(async (t) => {
        await t.query("UPDATE distributions SET status = 'confirmed', tx_hash = $2 WHERE id = $1", [dist.id, hash]);
        await t.query("UPDATE reward_pools SET status = 'allocated' WHERE id = $1", [pool.id]);
        await t.query(
          `INSERT INTO chain_transactions (kind, tx_hash, chain_id, pool_id, distribution_id, actor_address, amount_wei, block_number, status)
           VALUES ('allocate',$1,$2,$3,$4,$5,$6,$7,'confirmed') ON CONFLICT (tx_hash, kind, actor_address) DO NOTHING`,
          [hash, chain.chainId, pool.id, dist.id, sender, total.toString(), receipt.blockNumber.toString()],
        );
      });
      await audit(db, viewer.id, "chain.allocate", "distribution", dist.id, { txHash: hash });
      return getPoolRow(db, pool.id);
    }
    case "claim": {
      const claims = events.filter((e): e is Extract<PoolEvent, { name: "RewardClaimed" }> => e.name === "RewardClaimed");
      if (!claims.length) throw new HttpError(422, "No RewardClaimed event in that transaction.", "no_event");
      let recorded = 0;
      for (const c of claims) {
        const row = (
          await db.query<{ pool_id: string; distribution_id: string }>(
            `SELECT p.id AS pool_id, d.id AS distribution_id FROM reward_pools p JOIN distributions d ON d.pool_id = p.id AND d.status = 'confirmed'
             JOIN distribution_items i ON i.distribution_id = d.id
             WHERE p.contract_address = $1 AND p.contract_pool_id = $2 AND i.wallet_address = $3 LIMIT 1`,
            [contract, Number(c.poolId), c.recipient],
          )
        )[0];
        if (!row) continue; // claim for a pool/recipient OFFBEAT does not know about
        await insertTx(db, "claim", row.pool_id, row.distribution_id, c.recipient, c.amount);
        recorded++;
      }
      if (!recorded) throw new HttpError(422, "That claim does not match any confirmed OFFBEAT distribution.", "unknown_claim");
      await audit(db, viewer.id, "chain.claim", "chain_transaction", null, { txHash: hash });
      return { recorded };
    }
    case "close_pool": {
      const pool = await ownPool(db, viewer, input.poolId);
      const ev = events.find((e): e is Extract<PoolEvent, { name: "PoolClosed" }> => e.name === "PoolClosed" && Number(e.poolId) === pool.contract_pool_id);
      if (!ev) throw new HttpError(422, "No PoolClosed event for this pool in that transaction.", "no_event");
      await insertTx(db, "close_pool", pool.id, null, ev.manager, ev.refunded);
      await db.query("UPDATE reward_pools SET status = 'closed' WHERE id = $1", [pool.id]);
      await audit(db, viewer.id, "chain.close_pool", "reward_pool", pool.id, { txHash: hash });
      return syncPoolFromChain(db, chain, await getPoolRow(db, pool.id));
    }
  }
}

async function ownPool(db: Db, viewer: Viewer, poolId?: string): Promise<PoolRow> {
  if (!poolId) throw new HttpError(422, "poolId is required.");
  const pool = await getPoolRow(db, poolId);
  if (pool.sponsor_id !== viewer.id) throw new HttpError(403, "Only the pool's sponsor can do this.", "forbidden");
  return pool;
}
async function linkedPool(db: Db, poolId?: string): Promise<PoolRow & { contract_pool_id: number }> {
  if (!poolId) throw new HttpError(422, "poolId is required.");
  const pool = await getPoolRow(db, poolId);
  if (pool.contract_pool_id == null) throw new HttpError(409, "Pool is not linked on-chain yet.");
  return pool as PoolRow & { contract_pool_id: number };
}
