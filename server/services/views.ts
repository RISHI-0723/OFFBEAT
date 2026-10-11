import type { Db } from "../db";
import type { Viewer } from "../auth";
import type { ChainReader } from "../chain";
import { explorerAddress, explorerTx } from "../../shared/chain";
import { FORMULA_VERSION, SCORING_CONFIG, WEIGHTS } from "../../shared/scoring";
import { ALLOCATION_CONFIG } from "../../shared/allocation";
import { listRecommendations } from "./data";

interface RewardItemRow {
  item_id: string;
  amount_wei: string;
  score_total: string;
  breakdown: unknown;
  wallet_address: string;
  dist_id: string;
  dist_status: string;
  dist_tx: string | null;
  pool_id: string;
  pool_title: string;
  contract_pool_id: number | null;
  rec_slug: string;
  rec_title: string;
  claim_tx: string | null;
}

export async function curatorDashboard(db: Db, chain: ChainReader, viewer: Viewer) {
  const recs = await listRecommendations(db, { curatorId: viewer.id, includeUnpublished: true });
  const rewards = await db.query<RewardItemRow>(
    `SELECT i.id AS item_id, i.amount_wei::text, i.score_total::text, i.breakdown, i.wallet_address,
            d.id AS dist_id, d.status AS dist_status, d.tx_hash AS dist_tx,
            p.id AS pool_id, p.title AS pool_title, p.contract_pool_id,
            r.slug AS rec_slug, r.title AS rec_title,
            (SELECT tx_hash FROM chain_transactions t WHERE t.kind = 'claim' AND t.pool_id = p.id AND t.actor_address = i.wallet_address LIMIT 1) AS claim_tx
     FROM distribution_items i
     JOIN distributions d ON d.id = i.distribution_id AND d.status <> 'failed'
     JOIN reward_pools p ON p.id = d.pool_id
     JOIN recommendations r ON r.id = i.recommendation_id
     WHERE i.curator_id = $1 ORDER BY d.created_at DESC, i.amount_wei DESC`,
    [viewer.id],
  );
  const totalVerified = recs.reduce((s, r) => s + r.stats.verifiedCheckins, 0);
  return {
    wallet: viewer.wallet_address,
    chainEnabled: chain.enabled,
    contractAddress: chain.contractAddress,
    chainId: chain.chainId,
    recommendations: recs,
    summary: {
      recommendations: recs.length,
      verifiedCheckins: totalVerified,
      eligible: recs.filter((r) => r.score.eligible).length,
      bestScore: recs.length ? Math.max(...recs.map((r) => r.score.total)) : null,
    },
    rewards: rewards.map((r) => ({
      itemId: r.item_id,
      amountWei: r.amount_wei,
      scoreTotal: Number(r.score_total),
      breakdown: r.breakdown,
      wallet: r.wallet_address,
      distributionId: r.dist_id,
      distributionStatus: r.dist_status,
      allocationTx: r.dist_tx,
      poolId: r.pool_id,
      poolTitle: r.pool_title,
      contractPoolId: r.contract_pool_id,
      recommendation: { slug: r.rec_slug, title: r.rec_title },
      claimTx: r.claim_tx,
      claimable: r.dist_status === "confirmed" && !r.claim_tx,
      // The contract lets only the allocated wallet claim, once. The UI also checks the connected wallet.
    })),
    formula: { version: FORMULA_VERSION, weights: WEIGHTS, minVerifiedCheckins: SCORING_CONFIG.minVerifiedCheckins, impactCap: SCORING_CONFIG.impactCap, minRaters: SCORING_CONFIG.minRaters },
  };
}

export async function participantHistory(db: Db, userId: string) {
  return db.query(
    `SELECT c.id, c.status, c.created_at AS "createdAt", e.id AS "eventId", e.slug AS "eventSlug", e.title AS "eventTitle",
            r.slug AS "recommendationSlug", r.title AS "recommendationTitle"
     FROM checkins c JOIN events e ON e.id = c.event_id LEFT JOIN recommendations r ON r.id = c.recommendation_id
     WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
    [userId],
  );
}

export async function buildImpact(db: Db, explorerUrl: string) {
  const [counts] = await db.query<{ recs: number; curators: number; seed_checkins: number; live_checkins: number; excluded: number; unattributed: number; seed_ratings: number; live_ratings: number }>(
    `SELECT (SELECT count(*)::int FROM recommendations WHERE status = 'published') AS recs,
            (SELECT count(DISTINCT curator_id)::int FROM recommendations WHERE status = 'published') AS curators,
            (SELECT count(*)::int FROM checkins WHERE status = 'verified' AND recommendation_id IS NOT NULL AND is_seed) AS seed_checkins,
            (SELECT count(*)::int FROM checkins WHERE status = 'verified' AND recommendation_id IS NOT NULL AND NOT is_seed) AS live_checkins,
            (SELECT count(*)::int FROM checkins WHERE status = 'excluded_self_referral') AS excluded,
            (SELECT count(*)::int FROM checkins WHERE recommendation_id IS NULL) AS unattributed,
            (SELECT count(*)::int FROM ratings WHERE is_seed) AS seed_ratings,
            (SELECT count(*)::int FROM ratings WHERE NOT is_seed) AS live_ratings`,
  );
  const rejected = await db.query<{ reason: string; n: number }>("SELECT metadata->>'reason' AS reason, count(*)::int AS n FROM audit_events WHERE action = 'checkin.rejected' GROUP BY 1 ORDER BY 2 DESC");
  const recs = await listRecommendations(db);
  const pools = await db.query<{ id: string; title: string; event_title: string; sponsor_name: string; budget_wei: string; funded_wei: string; status: string; contract_address: string | null; contract_pool_id: number | null; is_demo: boolean }>(
    `SELECT p.id, p.title, e.title AS event_title, s.display_name AS sponsor_name, p.budget_wei::text, p.funded_wei::text, p.status, p.contract_address, p.contract_pool_id, p.is_demo
     FROM reward_pools p JOIN events e ON e.id = p.event_id JOIN profiles s ON s.id = p.sponsor_id ORDER BY p.created_at DESC`,
  );
  const items = await db.query<{ pool_id: string; dist_id: string; dist_status: string; amount_wei: string; score_total: string; breakdown: unknown; curator_name: string; wallet_address: string; rec_slug: string; rec_title: string; claim_tx: string | null }>(
    `SELECT d.pool_id, d.id AS dist_id, d.status AS dist_status, i.amount_wei::text, i.score_total::text, i.breakdown, pr.display_name AS curator_name, i.wallet_address,
            r.slug AS rec_slug, r.title AS rec_title,
            (SELECT tx_hash FROM chain_transactions t WHERE t.kind = 'claim' AND t.pool_id = d.pool_id AND t.actor_address = i.wallet_address LIMIT 1) AS claim_tx
     FROM distribution_items i JOIN distributions d ON d.id = i.distribution_id AND d.status <> 'failed'
     JOIN profiles pr ON pr.id = i.curator_id JOIN recommendations r ON r.id = i.recommendation_id
     ORDER BY i.amount_wei DESC`,
  );
  const txs = await db.query<{ kind: string; tx_hash: string; actor_address: string; amount_wei: string; block_number: string; pool_id: string | null; created_at: Date; pool_title: string | null }>(
    `SELECT t.kind, t.tx_hash, t.actor_address, t.amount_wei::text, t.block_number::text, t.pool_id, t.created_at, p.title AS pool_title
     FROM chain_transactions t LEFT JOIN reward_pools p ON p.id = t.pool_id WHERE t.status = 'confirmed' ORDER BY t.created_at DESC`,
  );
  return {
    stats: {
      recommendations: counts!.recs,
      curators: counts!.curators,
      verifiedCheckins: { seeded: counts!.seed_checkins, live: counts!.live_checkins },
      ratings: { seeded: counts!.seed_ratings, live: counts!.live_ratings },
      excludedSelfReferrals: counts!.excluded,
      unattributedCheckins: counts!.unattributed,
      rejectedAttempts: rejected.map((r) => ({ reason: r.reason, count: r.n })),
      confirmedTransactions: txs.length,
    },
    leaderboard: recs
      .slice()
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 8)
      .map((r) => ({ slug: r.slug, title: r.title, curator: r.curator.displayName, category: r.creator.category, score: r.score, verifiedCheckins: r.stats.verifiedCheckins, isDemo: r.isDemo })),
    pools: pools.map((p) => ({
      id: p.id,
      title: p.title,
      eventTitle: p.event_title,
      sponsorName: p.sponsor_name,
      budgetWei: p.budget_wei,
      fundedWei: p.funded_wei,
      status: p.status,
      contractAddress: p.contract_address,
      contractPoolId: p.contract_pool_id,
      isDemo: p.is_demo,
      allocations: items
        .filter((i) => i.pool_id === p.id)
        .map((i) => ({ distributionId: i.dist_id, distributionStatus: i.dist_status, amountWei: i.amount_wei, scoreTotal: Number(i.score_total), breakdown: i.breakdown, curatorName: i.curator_name, wallet: i.wallet_address, recommendation: { slug: i.rec_slug, title: i.rec_title }, claimTx: i.claim_tx, claimTxUrl: i.claim_tx ? explorerTx(explorerUrl, i.claim_tx) : null })),
    })),
    transactions: txs.map((t) => ({ kind: t.kind, txHash: t.tx_hash, url: explorerTx(explorerUrl, t.tx_hash), actor: t.actor_address, actorUrl: explorerAddress(explorerUrl, t.actor_address), amountWei: t.amount_wei, blockNumber: t.block_number, poolTitle: t.pool_title, createdAt: t.created_at.toISOString() })),
    method: { formulaVersion: FORMULA_VERSION, weights: WEIGHTS, impactCap: SCORING_CONFIG.impactCap, minVerifiedCheckins: SCORING_CONFIG.minVerifiedCheckins, minRaters: SCORING_CONFIG.minRaters, maxCuratorShareBps: Number(ALLOCATION_CONFIG.maxShareBps) },
  };
}
