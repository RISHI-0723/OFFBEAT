import { describe, expect, it } from "vitest";
import { allocateRewards, type AllocationCandidate } from "../shared/allocation";

const E = 10n ** 18n;
const c = (id: string, curator: string, score: number, over: Partial<AllocationCandidate> = {}): AllocationCandidate => ({
  recommendationId: id,
  curatorId: curator,
  wallet: "0x" + curator.padStart(40, "0"),
  score,
  eligible: true,
  ...over,
});

describe("allocateRewards", () => {
  it("never exceeds the budget and splits proportionally", () => {
    const r = allocateRewards(10n * E, [c("r1", "a", 60), c("r2", "b", 40)], 10000n);
    expect(r.totalAllocatedWei).toBe(10n * E);
    expect(r.byCurator.find((x) => x.curatorId === "a")!.amountWei).toBe(6n * E);
    expect(r.byCurator.find((x) => x.curatorId === "b")!.amountWei).toBe(4n * E);
  });

  it("applies the per-curator cap and redistributes the excess", () => {
    const r = allocateRewards(100n, [c("r1", "a", 90), c("r2", "b", 5), c("r3", "d", 5)], 5000n);
    const a = r.byCurator.find((x) => x.curatorId === "a")!;
    expect(a.amountWei).toBe(50n);
    expect(a.capped).toBe(true);
    expect(r.byCurator.find((x) => x.curatorId === "b")!.amountWei).toBe(25n);
    expect(r.totalAllocatedWei).toBe(100n);
  });

  it("withholds (leaves unallocated) what the cap cannot place", () => {
    const r = allocateRewards(100n, [c("r1", "a", 80)], 5000n);
    expect(r.totalAllocatedWei).toBe(50n);
    expect(r.unallocatedWei).toBe(50n);
  });

  it("keeps rounding dust in the pool, never over-allocates", () => {
    const r = allocateRewards(10n, [c("r1", "a", 33.33), c("r2", "b", 33.33), c("r3", "d", 33.34)], 10000n);
    expect(r.totalAllocatedWei <= 10n).toBe(true);
    expect(r.totalAllocatedWei + r.unallocatedWei).toBe(10n);
  });

  it("is deterministic and order-independent", () => {
    const list = [c("r1", "a", 70), c("r2", "b", 20), c("r3", "d", 10), c("r4", "a", 15)];
    const x = allocateRewards(12345678901234567n, list);
    const y = allocateRewards(12345678901234567n, [...list].reverse());
    expect(x).toEqual(y);
  });

  it("ignores duplicate recommendation entries", () => {
    const r = allocateRewards(100n, [c("r1", "a", 50), c("r1", "a", 50), c("r2", "b", 50)], 10000n);
    expect(r.excluded.some((e) => e.reason.includes("Duplicate"))).toBe(true);
    expect(r.totalAllocatedWei).toBe(100n);
  });

  it("aggregates a curator's multiple recommendations into one payout with exact item sums", () => {
    const r = allocateRewards(1000n, [c("r1", "a", 30), c("r2", "a", 20), c("r3", "b", 50)], 10000n);
    expect(r.byCurator).toHaveLength(2);
    const aSum = r.items.filter((i) => i.curatorId === "a").reduce((s, i) => s + i.amountWei, 0n);
    expect(aSum).toBe(r.byCurator.find((x) => x.curatorId === "a")!.amountWei);
  });

  it("blocks eligible curators without a wallet and excludes ineligible/invalid entries", () => {
    const r = allocateRewards(100n, [c("r1", "a", 50, { wallet: null }), c("r2", "b", 50, { eligible: false }), c("r3", "d", NaN), c("r4", "e", 50)], 10000n);
    expect(r.blocked.map((b) => b.recommendationId)).toEqual(["r1"]);
    expect(r.excluded.map((b) => b.recommendationId).sort()).toEqual(["r2", "r3"]);
    expect(r.totalAllocatedWei).toBe(100n);
  });

  it("handles empty / zero budgets and rejects invalid input", () => {
    expect(allocateRewards(100n, []).totalAllocatedWei).toBe(0n);
    expect(allocateRewards(0n, [c("r1", "a", 50)]).items).toEqual([]);
    expect(() => allocateRewards(-1n, [])).toThrow();
    expect(() => allocateRewards(1n, [], 0n)).toThrow();
  });

  it("property: invariants hold across pseudo-random inputs", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rnd() * 8);
      const list = Array.from({ length: n }, (_, i) => c(`r${i}`, `c${Math.floor(rnd() * 4)}`, Math.round(rnd() * 10000) / 100));
      const budget = BigInt(Math.floor(rnd() * 1e12));
      const r = allocateRewards(budget, list);
      const cap = (budget * 5000n) / 10000n;
      expect(r.totalAllocatedWei <= budget).toBe(true);
      expect(r.totalAllocatedWei + r.unallocatedWei).toBe(budget);
      for (const b of r.byCurator) expect(b.amountWei <= cap).toBe(true);
      expect(r.items.reduce((s, i) => s + i.amountWei, 0n)).toBe(r.totalAllocatedWei);
    }
  });
});
