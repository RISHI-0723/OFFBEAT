/**
 * Deterministic reward allocation. Pure integer (bigint) arithmetic: no floats touch money.
 *
 * Guarantees (covered by tests/allocation.test.ts):
 *  - sum(allocated) <= budget, always. Rounding dust stays in the pool (unallocated).
 *  - No curator receives more than `maxShareBps` of the budget (water-filling redistribution).
 *  - Same inputs in any order => identical output.
 *  - Duplicate recommendation entries are ignored; invalid input throws.
 */

export const ALLOCATION_CONFIG = {
  /** Max share of the pool one curator may receive, in basis points (5000 = 50%). */
  maxShareBps: 5000n,
} as const;

export interface AllocationCandidate {
  recommendationId: string;
  curatorId: string;
  /** null = curator has not linked a wallet; cannot be paid on-chain. */
  wallet: string | null;
  /** Server-computed total score (0–100, 2 decimals). */
  score: number;
  eligible: boolean;
}

export interface AllocationItem {
  recommendationId: string;
  curatorId: string;
  wallet: string;
  amountWei: bigint;
}

export interface CuratorAllocation {
  curatorId: string;
  wallet: string;
  amountWei: bigint;
  capped: boolean;
}

export interface AllocationResult {
  items: AllocationItem[];
  byCurator: CuratorAllocation[];
  totalAllocatedWei: bigint;
  /** budget - totalAllocated: rounding dust + share withheld by the per-curator cap. */
  unallocatedWei: bigint;
  /** Eligible recommendations that could not be paid. */
  blocked: { recommendationId: string; curatorId: string; reason: string }[];
  excluded: { recommendationId: string; reason: string }[];
}

const toWeight = (score: number): bigint => BigInt(Math.round(score * 100));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function allocateRewards(
  budgetWei: bigint,
  candidates: AllocationCandidate[],
  maxShareBps: bigint = ALLOCATION_CONFIG.maxShareBps,
): AllocationResult {
  if (budgetWei < 0n) throw new Error("budget must be >= 0");
  if (maxShareBps <= 0n || maxShareBps > 10000n) throw new Error("maxShareBps must be in (0, 10000]");

  const seen = new Set<string>();
  const excluded: AllocationResult["excluded"] = [];
  const blocked: AllocationResult["blocked"] = [];
  const usable: (AllocationCandidate & { wallet: string; weight: bigint })[] = [];

  for (const c of [...candidates].sort((a, b) => cmp(a.recommendationId, b.recommendationId))) {
    if (seen.has(c.recommendationId)) {
      excluded.push({ recommendationId: c.recommendationId, reason: "Duplicate entry ignored." });
      continue;
    }
    seen.add(c.recommendationId);
    if (!Number.isFinite(c.score) || c.score < 0) {
      excluded.push({ recommendationId: c.recommendationId, reason: "Invalid score." });
      continue;
    }
    if (!c.eligible) {
      excluded.push({ recommendationId: c.recommendationId, reason: "Not eligible." });
      continue;
    }
    const weight = toWeight(c.score);
    if (weight <= 0n) {
      excluded.push({ recommendationId: c.recommendationId, reason: "Zero score." });
      continue;
    }
    if (!c.wallet) {
      blocked.push({ recommendationId: c.recommendationId, curatorId: c.curatorId, reason: "Curator has not linked a wallet." });
      continue;
    }
    usable.push({ ...c, wallet: c.wallet.toLowerCase(), weight });
  }

  // Aggregate by curator (one on-chain allocation per wallet per pool).
  const curators = new Map<string, { curatorId: string; wallet: string; weight: bigint }>();
  for (const u of usable) {
    const cur = curators.get(u.curatorId);
    if (cur) cur.weight += u.weight;
    else curators.set(u.curatorId, { curatorId: u.curatorId, wallet: u.wallet, weight: u.weight });
  }
  const curatorList = [...curators.values()].sort((a, b) => cmp(a.curatorId, b.curatorId));

  // Water-filling with a per-curator cap.
  const cap = (budgetWei * maxShareBps) / 10000n;
  const amounts = new Map<string, bigint>();
  const capped = new Set<string>();
  let remaining = budgetWei;
  let active = curatorList.slice();

  while (active.length > 0 && remaining > 0n) {
    const sumW = active.reduce((s, c) => s + c.weight, 0n);
    const over = active.filter((c) => (remaining * c.weight) / sumW > cap);
    if (over.length === 0) {
      for (const c of active) amounts.set(c.curatorId, (remaining * c.weight) / sumW);
      break;
    }
    for (const c of over) {
      amounts.set(c.curatorId, cap);
      capped.add(c.curatorId);
      remaining -= cap;
    }
    active = active.filter((c) => !capped.has(c.curatorId));
  }

  const byCurator: CuratorAllocation[] = curatorList
    .map((c) => ({ curatorId: c.curatorId, wallet: c.wallet, amountWei: amounts.get(c.curatorId) ?? 0n, capped: capped.has(c.curatorId) }))
    .filter((c) => c.amountWei > 0n);

  // Split each curator's amount across their recommendations by score weight.
  const items: AllocationItem[] = [];
  for (const cur of byCurator) {
    const recs = usable.filter((u) => u.curatorId === cur.curatorId);
    const sumW = recs.reduce((s, r) => s + r.weight, 0n);
    const parts = recs.map((r) => ({ r, amt: (cur.amountWei * r.weight) / sumW }));
    const dust = cur.amountWei - parts.reduce((s, p) => s + p.amt, 0n);
    const top = parts.reduce((best, p) => (p.r.weight > best.r.weight || (p.r.weight === best.r.weight && cmp(p.r.recommendationId, best.r.recommendationId) < 0) ? p : best));
    top.amt += dust;
    for (const p of parts) {
      if (p.amt > 0n) items.push({ recommendationId: p.r.recommendationId, curatorId: cur.curatorId, wallet: cur.wallet, amountWei: p.amt });
    }
  }

  const totalAllocatedWei = byCurator.reduce((s, c) => s + c.amountWei, 0n);
  if (totalAllocatedWei > budgetWei) throw new Error("invariant violated: allocation exceeds budget");

  return { items, byCurator, totalAllocatedWei, unallocatedWei: budgetWei - totalAllocatedWei, blocked, excluded };
}
