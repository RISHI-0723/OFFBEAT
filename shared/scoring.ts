/**
 * OFFBEAT prototype scoring — pure, deterministic, no I/O.
 *
 *   total = 0.30 * quality + 0.25 * novelty + 0.45 * verifiedImpact     (each 0–100)
 *
 * These are PROTOTYPE PROXIES, not objective measures of cultural value. They are illustrative
 * until validated with real users. The server is the only authority; the client only displays.
 */

export const FORMULA_VERSION = "offbeat-proto-v1";

export const WEIGHTS = { quality: 0.3, novelty: 0.25, impact: 0.45 } as const;

export const SCORING_CONFIG = {
  /** Distinct non-self raters needed before quality is considered measured. */
  minRaters: 3,
  /** Quality used (and flagged provisional) when raters < minRaters. */
  neutralQuality: 50,
  /** Verified unique check-ins at/above this count give impact = 100 (diminishing farming incentive). */
  impactCap: 10,
  /** Minimum verified, eligible check-ins for a recommendation to receive any reward. */
  minVerifiedCheckins: 2,
  /** Novelty blend: freshness of creator vs rarity of category. */
  noveltyCreatorWeight: 0.7,
  noveltyCategoryWeight: 0.3,
} as const;

export type ComponentStatus = "measured" | "provisional" | "prototype-proxy";

export interface ScoreInput {
  /** Star ratings 1–5 from DISTINCT raters, already excluding the curator themselves. */
  ratings: number[];
  /** Unique, verified, non-self check-ins attributed to this recommendation. */
  verifiedCheckins: number;
  /** Recommendations of the same creator published strictly before this one. */
  priorRecommendationsForCreator: number;
  /** Recommendations in this category (including this one) and total on platform. */
  categoryRecommendationCount: number;
  totalRecommendationCount: number;
  /** Moderation state. Only 'published' can be eligible. */
  status: "published" | "pending_review" | "rejected";
}

export interface ComponentScore {
  value: number;
  status: ComponentStatus;
  explanation: string;
}

export interface ScoreResult {
  formulaVersion: string;
  quality: ComponentScore;
  novelty: ComponentScore;
  impact: ComponentScore;
  total: number;
  eligible: boolean;
  ineligibleReason: string | null;
  evidence: {
    raters: number;
    verifiedCheckins: number;
    priorRecommendationsForCreator: number;
    categoryRecommendationCount: number;
    totalRecommendationCount: number;
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeQuality(ratings: number[]): ComponentScore {
  const valid = ratings.filter((r) => Number.isFinite(r) && r >= 1 && r <= 5);
  if (valid.length < SCORING_CONFIG.minRaters) {
    return {
      value: SCORING_CONFIG.neutralQuality,
      status: "provisional",
      explanation: `Only ${valid.length} of ${SCORING_CONFIG.minRaters} ratings needed. A neutral ${SCORING_CONFIG.neutralQuality} is used until more people rate it.`,
    };
  }
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return {
    value: round2(((mean - 1) / 4) * 100),
    status: "measured",
    explanation: `Average ${mean.toFixed(2)}/5 from ${valid.length} distinct raters (self-ratings excluded), mapped to 0–100.`,
  };
}

export function computeNovelty(input: Pick<ScoreInput, "priorRecommendationsForCreator" | "categoryRecommendationCount" | "totalRecommendationCount">): ComponentScore {
  const prior = Math.max(0, input.priorRecommendationsForCreator);
  const freshness = 1 / (1 + prior);
  const total = Math.max(1, input.totalRecommendationCount);
  const share = clamp(input.categoryRecommendationCount / total, 0, 1);
  const rarity = 1 - share;
  const value = round2(
    100 * (SCORING_CONFIG.noveltyCreatorWeight * freshness + SCORING_CONFIG.noveltyCategoryWeight * rarity),
  );
  return {
    value,
    status: "prototype-proxy",
    explanation:
      prior === 0
        ? `First recommendation of this creator on OFFBEAT, in a category with ${Math.round(share * 100)}% of all recommendations. A prototype proxy, not a measure of cultural novelty.`
        : `${prior} earlier recommendation(s) of this creator; category holds ${Math.round(share * 100)}% of all recommendations. A prototype proxy, not a measure of cultural novelty.`,
  };
}

export function computeImpact(verifiedCheckins: number): ComponentScore {
  const n = Math.max(0, Math.floor(verifiedCheckins));
  const value = round2((Math.min(n, SCORING_CONFIG.impactCap) / SCORING_CONFIG.impactCap) * 100);
  return {
    value,
    status: "measured",
    explanation: `${n} unique verified check-in(s) attributed to this recommendation, capped at ${SCORING_CONFIG.impactCap}. Attribution is evidence of a recorded referral, not proof of causation.`,
  };
}

export function scoreRecommendation(input: ScoreInput): ScoreResult {
  const quality = computeQuality(input.ratings);
  const novelty = computeNovelty(input);
  const impact = computeImpact(input.verifiedCheckins);
  const total = round2(WEIGHTS.quality * quality.value + WEIGHTS.novelty * novelty.value + WEIGHTS.impact * impact.value);

  let ineligibleReason: string | null = null;
  if (input.status !== "published") ineligibleReason = `Recommendation is ${input.status.replace("_", " ")}.`;
  else if (input.verifiedCheckins < SCORING_CONFIG.minVerifiedCheckins)
    ineligibleReason = `Needs at least ${SCORING_CONFIG.minVerifiedCheckins} verified check-ins (has ${input.verifiedCheckins}).`;

  return {
    formulaVersion: FORMULA_VERSION,
    quality,
    novelty,
    impact,
    total,
    eligible: ineligibleReason === null,
    ineligibleReason,
    evidence: {
      raters: input.ratings.length,
      verifiedCheckins: input.verifiedCheckins,
      priorRecommendationsForCreator: input.priorRecommendationsForCreator,
      categoryRecommendationCount: input.categoryRecommendationCount,
      totalRecommendationCount: input.totalRecommendationCount,
    },
  };
}
