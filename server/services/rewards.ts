import { ALLOCATION_CONFIG, allocateRewards, type AllocationResult } from "../../shared/allocation";
import { FORMULA_VERSION, SCORING_CONFIG, WEIGHTS, type ScoreResult } from "../../shared/scoring";
import type { Db } from "../db";
import type { Viewer } from "../auth";
import type { ChainReader } from "../chain";
import { HttpError, big } from "../util";
import { audit, getEvidence, scoreFor } from "./data";

export interface PoolRow {
  id: string;
  sponsor_id: string;
  event_id: string;
  title: string;
  description: string;
  budget_wei: string;
  funded_wei: string;
  chain_id: number;
  contract_address: string | null;
  contract_pool_id: number | null;
  status: "draft" | "open" | "allocated" | "closed";
  is_demo: boolean;
  created_at: Date;
}

export async function getPoolRow(db: Db, id: string): Promise<PoolRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Pool not found.");
  const row = (await db.query<PoolRow>("SELECT * FROM reward_pools WHERE id = $1", [id]))[0];
  if (!row) throw new HttpError(404, "Pool not found.");
  return row;
}

export async function createPool(db: Db, viewer: Viewer, chainId: number, input: { title: string; description: string; eventId: string; budgetWei: bigint }): Promise<PoolRow> {
  const ev = await db.query("SELECT 1 FROM events WHERE id = $1", [input.eventId]);
  if (!ev.length) throw new HttpError(422, "Choose an existing event for this pool.");
  const row = (
    await db.query<PoolRow>("INSERT INTO reward_pools (sponsor_id, event_id, title, description, budget_wei, chain_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [viewer.id, input.eventId, input.title, input.description, input.budgetWei.toString(), chainId])
  )[0]!;
  await audit(db, viewer.id, "pool.created", "reward_pool", row.id, { budgetWei: input.budgetWei.toString() });
  return row;
}

export interface PreviewRow {
  recommendationId: string;
  recommendationSlug: string;
  title: string;
  curatorId: string;
  curatorName: string;
  curatorHasWallet: boolean;
  score: ScoreResult;
  payoutWei: string;
  status: "payable" | "blocked_no_wallet" | "ineligible" | "no_payout";
  note: string;
}
export interface DistributionPreview {
  poolId: string;
  /** What the allocation is bounded by: min(budget target, on-chain funded). */
  distributableWei: string;
  budgetWei: string;
  fundedWei: string;
  formulaVersion: string;
  weights: typeof WEIGHTS;
  rules: { minVerifiedCheckins: number; impactCap: number; minRaters: number; maxShareBps: number };
  rows: PreviewRow[];
  totalAllocatedWei: string;
  unallocatedWei: string;
  byCurator: { curatorId: string; wallet: string; amountWei: string; capped: boolean }[];
  canApprove: boolean;
  blockers: string[];
}

/** Server-side, deterministic preview. The client cannot influence any number in it. */
export async function previewDistribution(db: Db, pool: PoolRow): Promise<DistributionPreview> {
  const ev = await getEvidence(db);
  const recs = await db.query<{ id: string; slug: string; title: string; curator_id: string; curator_name: string; wallet: string | null }>(
    `SELECT r.id, r.slug, r.title, r.curator_id, p.display_name AS curator_name, p.wallet_address AS wallet
     FROM recommendations r JOIN profiles p ON p.id = r.curator_id
     WHERE r.event_id = $1 AND r.status = 'published' ORDER BY r.id`,
    [pool.event_id],
  );
  const budget = big(pool.budget_wei);
  const funded = big(pool.funded_wei);
  const distributable = budget < funded ? budget : funded;

  const scores = new Map(recs.map((r) => [r.id, scoreFor(ev, r.id)]));
  const alloc: AllocationResult = allocateRewards(
    distributable,
    recs.map((r) => ({ recommendationId: r.id, curatorId: r.curator_id, wallet: r.wallet, score: scores.get(r.id)!.total, eligible: scores.get(r.id)!.eligible })),
  );
  const payout = new Map(alloc.items.map((i) => [i.recommendationId, i.amountWei]));
  const blockedIds = new Set(alloc.blocked.map((b) => b.recommendationId));

  const rows: PreviewRow[] = recs
    .map((r): PreviewRow => {
      const score = scores.get(r.id)!;
      const amt = payout.get(r.id) ?? 0n;
      let status: PreviewRow["status"] = "payable";
      let note = "Eligible. Share of the pool is proportional to total score, subject to the per-curator cap.";
      if (!score.eligible) {
        status = "ineligible";
        note = score.ineligibleReason ?? "Not eligible.";
      } else if (blockedIds.has(r.id)) {
        status = "blocked_no_wallet";
        note = "Eligible, but the curator has not linked a wallet, so nothing can be paid on-chain.";
      } else if (amt === 0n) {
        status = "no_payout";
        note = distributable === 0n ? "Pool has no verified on-chain funds yet." : "Rounded to zero or withheld by the per-curator cap.";
      }
      return { recommendationId: r.id, recommendationSlug: r.slug, title: r.title, curatorId: r.curator_id, curatorName: r.curator_name, curatorHasWallet: Boolean(r.wallet), score, payoutWei: amt.toString(), status, note };
    })
    .sort((a, b) => b.score.total - a.score.total || a.recommendationId.localeCompare(b.recommendationId));

  const blockers: string[] = [];
  if (!pool.contract_address) blockers.push("Pool is not yet created on-chain.");
  if (funded === 0n) blockers.push("Pool has no verified on-chain funding.");
  if (alloc.items.length === 0) blockers.push("No eligible, payable recommendations yet.");
  if (pool.status === "allocated" || pool.status === "closed") blockers.push(`Pool is ${pool.status}.`);

  return {
    poolId: pool.id,
    distributableWei: distributable.toString(),
    budgetWei: budget.toString(),
    fundedWei: funded.toString(),
    formulaVersion: FORMULA_VERSION,
    weights: WEIGHTS,
    rules: { minVerifiedCheckins: SCORING_CONFIG.minVerifiedCheckins, impactCap: SCORING_CONFIG.impactCap, minRaters: SCORING_CONFIG.minRaters, maxShareBps: Number(ALLOCATION_CONFIG.maxShareBps) },
    rows,
    totalAllocatedWei: alloc.totalAllocatedWei.toString(),
    unallocatedWei: alloc.unallocatedWei.toString(),
    byCurator: alloc.byCurator.map((c) => ({ curatorId: c.curatorId, wallet: c.wallet, amountWei: c.amountWei.toString(), capped: c.capped })),
    canApprove: blockers.length === 0,
    blockers,
  };
}

/** Pull authoritative funding/closed state from the contract. Chain is the source of truth for balances. */
export async function syncPoolFromChain(db: Db, chain: ChainReader, pool: PoolRow): Promise<PoolRow> {
  if (!chain.enabled || pool.contract_pool_id == null) return pool;
  const on = await chain.readPool(BigInt(pool.contract_pool_id));
  const status = on.closed ? "closed" : pool.status;
  return (await db.query<PoolRow>("UPDATE reward_pools SET funded_wei = $2, status = $3 WHERE id = $1 RETURNING *", [pool.id, on.funded.toString(), status]))[0]!;
}

export interface ApprovedDistribution {
  id: string;
  poolId: string;
  status: string;
  totalWei: string;
  onchain: { contractPoolId: number; recipients: string[]; amounts: string[] };
}

/** Freeze the current preview into an approved distribution. This is what the sponsor wallet will submit on-chain. */
export async function approveDistribution(db: Db, viewer: Viewer, pool: PoolRow, chain: ChainReader): Promise<ApprovedDistribution> {
  if (pool.sponsor_id !== viewer.id) throw new HttpError(403, "Only the pool's sponsor can approve a distribution.", "forbidden");
  const synced = await syncPoolFromChain(db, chain, pool);
  return db.tx(async (t) => {
    const live = await t.query("SELECT 1 FROM distributions WHERE pool_id = $1 AND status IN ('approved','submitted','confirmed')", [pool.id]);
    if (live.length) throw new HttpError(409, "This pool already has a live distribution.", "distribution_exists");
    const preview = await previewDistribution(t, synced);
    if (!preview.canApprove) throw new HttpError(409, `Cannot approve yet: ${preview.blockers.join(" ")}`, "not_approvable");
    const d = (
      await t.query<{ id: string }>(
        "INSERT INTO distributions (pool_id, status, budget_wei, total_wei, formula_version, snapshot, approved_by, is_demo) VALUES ($1,'approved',$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
        [pool.id, preview.distributableWei, preview.totalAllocatedWei, preview.formulaVersion, JSON.stringify(preview), viewer.id, pool.is_demo],
      )
    )[0]!;
    for (const row of preview.rows.filter((r) => r.status === "payable")) {
      const curator = preview.byCurator.find((c) => c.curatorId === row.curatorId)!;
      await t.query("INSERT INTO distribution_items (distribution_id, recommendation_id, curator_id, wallet_address, amount_wei, score_total, breakdown) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)", [
        d.id,
        row.recommendationId,
        row.curatorId,
        curator.wallet,
        row.payoutWei,
        row.score.total,
        JSON.stringify({ quality: row.score.quality, novelty: row.score.novelty, impact: row.score.impact, evidence: row.score.evidence }),
      ]);
    }
    await audit(t, viewer.id, "distribution.approved", "distribution", d.id, { totalWei: preview.totalAllocatedWei, formula: preview.formulaVersion });
    return {
      id: d.id,
      poolId: pool.id,
      status: "approved",
      totalWei: preview.totalAllocatedWei,
      onchain: { contractPoolId: synced.contract_pool_id!, recipients: preview.byCurator.map((c) => c.wallet), amounts: preview.byCurator.map((c) => c.amountWei) },
    };
  });
}

export async function getDistributionOnchainArgs(db: Db, distributionId: string) {
  const items = await db.query<{ wallet_address: string; amount: string }>("SELECT wallet_address, sum(amount_wei)::text AS amount FROM distribution_items WHERE distribution_id = $1 GROUP BY wallet_address ORDER BY wallet_address", [distributionId]);
  return { recipients: items.map((i) => i.wallet_address), amounts: items.map((i) => i.amount) };
}

export async function cancelDistribution(db: Db, viewer: Viewer, distributionId: string) {
  const d = (await db.query<{ id: string; status: string; sponsor_id: string }>("SELECT d.id, d.status, p.sponsor_id FROM distributions d JOIN reward_pools p ON p.id = d.pool_id WHERE d.id = $1", [distributionId]))[0];
  if (!d) throw new HttpError(404, "Distribution not found.");
  if (d.sponsor_id !== viewer.id) throw new HttpError(403, "Only the sponsor can cancel.", "forbidden");
  if (d.status === "confirmed") throw new HttpError(409, "A confirmed on-chain distribution cannot be cancelled.");
  await db.query("UPDATE distributions SET status = 'failed' WHERE id = $1", [distributionId]);
  await audit(db, viewer.id, "distribution.cancelled", "distribution", distributionId);
}
