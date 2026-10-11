import { describe, expect, it } from "vitest";
import { FORMULA_VERSION, SCORING_CONFIG, computeImpact, computeNovelty, computeQuality, scoreRecommendation, type ScoreInput } from "../shared/scoring";

const base: ScoreInput = {
  ratings: [5, 4, 5],
  verifiedCheckins: 5,
  priorRecommendationsForCreator: 0,
  categoryRecommendationCount: 2,
  totalRecommendationCount: 10,
  status: "published",
};

describe("scoring", () => {
  it("quality is provisional (neutral) below the minimum rater count", () => {
    const q = computeQuality([5, 5]);
    expect(q.status).toBe("provisional");
    expect(q.value).toBe(SCORING_CONFIG.neutralQuality);
  });

  it("quality maps mean stars to 0–100 once measured", () => {
    expect(computeQuality([1, 1, 1]).value).toBe(0);
    expect(computeQuality([5, 5, 5]).value).toBe(100);
    expect(computeQuality([3, 3, 3]).value).toBe(50);
    expect(computeQuality([5, 4, 5]).status).toBe("measured");
  });

  it("quality ignores out-of-range ratings", () => {
    expect(computeQuality([5, 5, 5, 99, -1, NaN]).value).toBe(100);
  });

  it("impact is capped and linear", () => {
    expect(computeImpact(0).value).toBe(0);
    expect(computeImpact(5).value).toBe(50);
    expect(computeImpact(10).value).toBe(100);
    expect(computeImpact(500).value).toBe(100);
    expect(computeImpact(-3).value).toBe(0);
  });

  it("novelty rewards the first recommender of a creator and rare categories", () => {
    const first = computeNovelty({ priorRecommendationsForCreator: 0, categoryRecommendationCount: 1, totalRecommendationCount: 10 });
    const later = computeNovelty({ priorRecommendationsForCreator: 3, categoryRecommendationCount: 1, totalRecommendationCount: 10 });
    expect(first.value).toBeGreaterThan(later.value);
    expect(first.status).toBe("prototype-proxy");
    const crowded = computeNovelty({ priorRecommendationsForCreator: 0, categoryRecommendationCount: 10, totalRecommendationCount: 10 });
    expect(first.value).toBeGreaterThan(crowded.value);
  });

  it("total follows 0.30*q + 0.25*n + 0.45*i exactly", () => {
    const r = scoreRecommendation(base);
    const expected = Math.round((0.3 * r.quality.value + 0.25 * r.novelty.value + 0.45 * r.impact.value) * 100) / 100;
    expect(r.total).toBe(expected);
    expect(r.formulaVersion).toBe(FORMULA_VERSION);
  });

  it("is deterministic", () => {
    expect(scoreRecommendation(base)).toEqual(scoreRecommendation({ ...base, ratings: [...base.ratings] }));
  });

  it("is ineligible below the minimum verified check-ins", () => {
    const r = scoreRecommendation({ ...base, verifiedCheckins: 1 });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toMatch(/at least/);
  });

  it("pending-review or rejected recommendations are never eligible", () => {
    expect(scoreRecommendation({ ...base, status: "pending_review" }).eligible).toBe(false);
    expect(scoreRecommendation({ ...base, status: "rejected" }).eligible).toBe(false);
  });

  it("records evidence counts", () => {
    expect(scoreRecommendation(base).evidence).toMatchObject({ raters: 3, verifiedCheckins: 5 });
  });
});
