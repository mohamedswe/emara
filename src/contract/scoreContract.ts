import type {
  ContractRequirement,
  SoftwareContract,
} from "./types.js";

/**
 * Functionality scoring engine.
 *
 * Turns a software contract into a 0-100 Functionality score with evidence-backed
 * deductions and actionable suggestions. This is the readout layer: the acceptance
 * gate stays a binary gate (authoritative or not), while the score is the honest
 * gradient that tells a developer how far from trustworthy the code is and why.
 *
 * Design rule: coverage outranks verification. The most common failure mode is not
 * a provably-wrong claim — it is code the contract cannot explain. Unexplained
 * code is where the bodies are buried, so coverage carries the most weight.
 *
 * Deterministic. No LLM. Every point is traceable to contract evidence.
 */

export interface ScoreDeduction {
  /** Stable machine-readable reason code. */
  code:
    | "unexplained_coverage"
    | "unaccounted_nodes"
    | "unresolved_uncertainty"
    | "partially_verified_claim"
    | "contradicted_claim"
    | "unconfirmed_review"
    | "correction_not_converged"
    | "promise_not_kept";
  /** Human-readable explanation of what cost the points. */
  detail: string;
  /** Points deducted (positive number). */
  points: number;
  /** Evidence pointers (file + node) where available. */
  evidence: Array<{ file?: string; nodeId?: string }>;
}

export interface ScoreSuggestion {
  /** What to do to raise the score. */
  action: string;
  /** Approximate points recovered by doing it. */
  pointsRecovered: number;
  /** The deduction codes this suggestion addresses. */
  addresses: string[];
}

export interface FunctionalityScore {
  /** 0-100. */
  score: number;
  /** Letter grade for quick reading. */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Sub-scores that blend into the total. */
  subscores: {
    /** Fraction of meaningful code accounted for (explained or support). 0-1. */
    coverage: number;
    /** Fraction of claims fully verified. 0-1. */
    verification: number;
    /** 1 minus the unresolved-uncertainty drag. 0-1. */
    certainty: number;
    /** 1 minus the contradiction drag. 0-1. */
    trust: number;
  };
  deductions: ScoreDeduction[];
  suggestions: ScoreSuggestion[];
  /** Raw counts the score was computed from, for transparency. */
  basis: {
    meaningfulNodes: number;
    accountedNodes: number;
    coveragePercent: number;
    totalClaims: number;
    verifiedClaims: number;
    partiallyVerifiedClaims: number;
    contradictedClaims: number;
    uncertainties: number;
    unconfirmedReviews: number;
    correctionConverged: boolean;
  };
}

/** Weights. Coverage leads — unexplained code is the trap. */
const WEIGHTS = {
  coverage: 0.4,
  verification: 0.3,
  certainty: 0.15,
  trust: 0.15,
} as const;

/** Points each unresolved uncertainty costs (capped). */
const UNCERTAINTY_PENALTY_EACH = 2;
const UNCERTAINTY_PENALTY_CAP = 15;
/** Points each partially verified claim costs (capped). */
const PARTIAL_PENALTY_EACH = 1.5;
const PARTIAL_PENALTY_CAP = 10;
/** Points each contradicted claim costs — worse than unanswered. */
const CONTRADICTED_PENALTY_EACH = 4;
const CONTRADICTED_PENALTY_CAP = 20;
/** Points each unconfirmed contradiction review costs. */
const UNCONFIRMED_REVIEW_PENALTY_EACH = 2;
const UNCONFIRMED_REVIEW_PENALTY_CAP = 10;
/** Flat penalty when the correction loop did not converge. */
const NON_CONVERGENCE_PENALTY = 5;

export function scoreContract(contract: SoftwareContract): FunctionalityScore {
  const cov = contract.coverageReview;
  const capabilities = contract.capabilities ?? [];
  const requirements = contract.requirements ?? [];
  const uncertainties = contract.uncertainties ?? [];
  const reviews = contract.contradictionReviews ?? [];

  // --- Verification sub-score -------------------------------------------------
  const allClaims: Array<{ verification: { status: string } }> = [
    ...capabilities,
    ...requirements,
  ];
  const totalClaims = allClaims.length;
  const verified = allClaims.filter(
    (c) =>
      c.verification.status === "STATIC_VERIFIED" ||
      c.verification.status === "RUNTIME_VERIFIED",
  ).length;
  const partial = allClaims.filter(
    (c) => c.verification.status === "PARTIALLY_VERIFIED",
  ).length;
  const contradicted = allClaims.filter(
    (c) => c.verification.status === "CONTRADICTED",
  ).length;
  const verification = totalClaims === 0 ? 0 : verified / totalClaims;

  // --- Coverage sub-score -----------------------------------------------------
  const coverage = cov.meaningfulNodes === 0
    ? 1
    : cov.accountedMeaningfulNodes / cov.meaningfulNodes;

  // --- Certainty sub-score (uncertainties drag) --------------------------------
  const uncertaintyPenalty = Math.min(
    uncertainties.length * UNCERTAINTY_PENALTY_EACH,
    UNCERTAINTY_PENALTY_CAP,
  );
  const certainty = 1 - uncertaintyPenalty / 100;

  // --- Trust sub-score (contradictions + unconfirmed reviews drag) -------------
  const unconfirmedReviews = reviews.filter(
    (r) => r.status !== "CONFIRMED",
  ).length;
  const contradictedPenalty = Math.min(
    contradicted * CONTRADICTED_PENALTY_EACH,
    CONTRADICTED_PENALTY_CAP,
  );
  const reviewPenalty = Math.min(
    unconfirmedReviews * UNCONFIRMED_REVIEW_PENALTY_EACH,
    UNCONFIRMED_REVIEW_PENALTY_CAP,
  );
  const trust = Math.max(0, 1 - (contradictedPenalty + reviewPenalty) / 100);

  // --- Blend -------------------------------------------------------------------
  let score =
    100 *
    (WEIGHTS.coverage * coverage +
      WEIGHTS.verification * verification +
      WEIGHTS.certainty * certainty +
      WEIGHTS.trust * trust);

  // --- Deductions (itemized, evidence-backed) ----------------------------------
  const deductions: ScoreDeduction[] = [];

  const coverageGapPoints = 100 * WEIGHTS.coverage * (1 - coverage);
  if (coverageGapPoints > 0.5) {
    deductions.push({
      code: "unexplained_coverage",
      detail: `${cov.unexplainedMeaningfulNodes} of ${cov.meaningfulNodes} meaningful nodes are not explained by any contract claim.`,
      points: round(coverageGapPoints),
      evidence: cov.unexplained.slice(0, 10).map((f) => ({ file: f.file, nodeId: f.nodeId })),
    });
  }

  if (cov.unaccountedMeaningfulNodes > 0) {
    deductions.push({
      code: "unaccounted_nodes",
      detail: `${cov.unaccountedMeaningfulNodes} meaningful nodes are neither explained nor conclusively classified as support code.`,
      points: 0, // already counted in coverage gap; surfaced for actionability
      evidence: cov.unaccounted.slice(0, 10).map((f) => ({ file: f.file, nodeId: f.nodeId })),
    });
  }

  if (partial > 0) {
    deductions.push({
      code: "partially_verified_claim",
      detail: `${partial} claim(s) are only partially verified.`,
      points: round(Math.min(partial * PARTIAL_PENALTY_EACH, PARTIAL_PENALTY_CAP)),
      evidence: allClaims
        .filter((c) => c.verification.status === "PARTIALLY_VERIFIED")
        .slice(0, 10)
        .map((c) => ({})),
    });
  }

  if (contradicted > 0) {
    deductions.push({
      code: "contradicted_claim",
      detail: `${contradicted} claim(s) are contradicted by the code — the software promises something it does not do.`,
      points: round(contradictedPenalty),
      evidence: [],
    });
  }

  for (const u of uncertainties.slice(0, 20)) {
    deductions.push({
      code: "unresolved_uncertainty",
      detail: u.statement,
      points: 0, // counted in aggregate via certainty sub-score
      evidence: u.evidence.slice(0, 3).map((e) => ({ file: e.file, nodeId: e.nodeId })),
    });
  }
  if (uncertaintyPenalty > 0) {
    deductions.push({
      code: "unresolved_uncertainty",
      detail: `${uncertainties.length} unresolved uncertainty item(s) drag the score.`,
      points: round(uncertaintyPenalty),
      evidence: [],
    });
  }

  if (unconfirmedReviews > 0) {
    deductions.push({
      code: "unconfirmed_review",
      detail: `${unconfirmedReviews} contradiction review(s) are not confirmed.`,
      points: round(reviewPenalty),
      evidence: [],
    });
  }

  const correctionConverged = contract.discovery?.correctionConverged ?? false;
  if (!correctionConverged) {
    deductions.push({
      code: "correction_not_converged",
      detail: "The correction loop did not converge within its budget.",
      points: NON_CONVERGENCE_PENALTY,
      evidence: [],
    });
    score -= NON_CONVERGENCE_PENALTY;
  }

  score = clamp(Math.round(score * 10) / 10, 0, 100);

  // --- Suggestions (turn deductions into quests) --------------------------------
  const suggestions = buildSuggestions(contract, deductions, {
    coverage,
    coverageGapPoints,
    partial,
    contradicted,
    uncertainties: uncertainties.length,
    unconfirmedReviews,
    correctionConverged,
  });

  return {
    score,
    grade: toGrade(score),
    subscores: {
      coverage: round3(coverage),
      verification: round3(verification),
      certainty: round3(certainty),
      trust: round3(trust),
    },
    deductions,
    suggestions,
    basis: {
      meaningfulNodes: cov.meaningfulNodes,
      accountedNodes: cov.accountedMeaningfulNodes,
      coveragePercent: cov.coveragePercent,
      totalClaims,
      verifiedClaims: verified,
      partiallyVerifiedClaims: partial,
      contradictedClaims: contradicted,
      uncertainties: uncertainties.length,
      unconfirmedReviews,
      correctionConverged,
    },
  };
}

function buildSuggestions(
  contract: SoftwareContract,
  deductions: ScoreDeduction[],
  ctx: {
    coverage: number;
    coverageGapPoints: number;
    partial: number;
    contradicted: number;
    uncertainties: number;
    unconfirmedReviews: number;
    correctionConverged: boolean;
  },
): ScoreSuggestion[] {
  const suggestions: ScoreSuggestion[] = [];

  // Promise-not-kept uncertainties are the highest-value fixes.
  const promiseGaps = contract.uncertainties.filter((u) =>
    /documented|promise|spec|but no|not implemented|missing/i.test(
      `${u.statement} ${u.reason}`,
    ),
  );
  if (promiseGaps.length > 0) {
    suggestions.push({
      action: `Resolve ${promiseGaps.length} documented-but-unimplemented promise(s): either implement the missing behavior or correct the docs. ${promiseGaps[0]?.statement ?? ""}`,
      pointsRecovered: round(Math.min(promiseGaps.length * UNCERTAINTY_PENALTY_EACH, UNCERTAINTY_PENALTY_CAP)),
      addresses: ["unresolved_uncertainty", "promise_not_kept"],
    });
  }

  if (ctx.coverageGapPoints > 0.5) {
    suggestions.push({
      action: `Close the coverage gap: account for the ${contract.coverageReview.unaccountedMeaningfulNodes} unaccounted nodes (link them to a feature dossier or classify them as support/dead code).`,
      pointsRecovered: round(ctx.coverageGapPoints),
      addresses: ["unexplained_coverage", "unaccounted_nodes"],
    });
  }

  if (ctx.partial > 0) {
    suggestions.push({
      action: `Fully verify the ${ctx.partial} partially-verified claim(s) by adding the missing evidence (implementation or test).`,
      pointsRecovered: round(Math.min(ctx.partial * PARTIAL_PENALTY_EACH, PARTIAL_PENALTY_CAP)),
      addresses: ["partially_verified_claim"],
    });
  }

  if (ctx.contradicted > 0) {
    suggestions.push({
      action: `Fix the ${ctx.contradicted} contradicted claim(s) — the code contradicts what the software promises. These are the most urgent.`,
      pointsRecovered: round(Math.min(ctx.contradicted * CONTRADICTED_PENALTY_EACH, CONTRADICTED_PENALTY_CAP)),
      addresses: ["contradicted_claim"],
    });
  }

  if (!ctx.correctionConverged) {
    suggestions.push({
      action: "Re-run with a larger correction budget (--max-correction-rounds) so the audit can converge.",
      pointsRecovered: NON_CONVERGENCE_PENALTY,
      addresses: ["correction_not_converged"],
    });
  }

  // Highest point-recovery first.
  return suggestions.sort((a, b) => b.pointsRecovered - a.pointsRecovered);
}

function toGrade(score: number): FunctionalityScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
