import type {
  JudgeRuling,
  ResolutionRubric,
  SettlementDecision,
} from "../types.js";

/**
 * Evaluates the judge's ruling against the rubric's confidence threshold
 * and returns a settlement decision.
 *
 * This is a pure function — no side effects, no API calls, fully testable.
 *
 * Decision logic (checked in priority order):
 *
 * 1. HALLUCINATIONS DETECTED → ESCALATE
 *    If either advocate fabricated citations, the debate integrity is
 *    compromised. Escalate for human review regardless of margin.
 *
 * 2. MARGIN BELOW THRESHOLD → ESCALATE
 *    If |scoreYes - scoreNo| < threshold, the result is too close for
 *    confident automated resolution. The full transcript is available
 *    for human review.
 *
 * 3. CLEAR WINNER → RESOLVE
 *    If margin exceeds threshold and no hallucinations, auto-settle
 *    the market with the winning verdict.
 *
 * The threshold is set per-market in the rubric (typically 20 points).
 * This is a tunable parameter — higher threshold = more conservative
 * (more escalations), lower = more aggressive (more auto-resolves).
 */
export function evaluateConfidence(
  ruling: JudgeRuling,
  rubric: ResolutionRubric
): SettlementDecision {
  const margin = Math.abs(ruling.scoreYes - ruling.scoreNo);
  const hasHallucinations = ruling.hallucinationsDetected.length > 0;

  // Priority 1: Hallucinations compromise debate integrity
  if (hasHallucinations) {
    return {
      action: "ESCALATE",
      verdict: null,
      margin,
      reason: `Hallucinations detected: ${ruling.hallucinationsDetected.join("; ")}. Escalating for human review.`,
    };
  }

  // Priority 2: Margin too narrow for confident auto-resolution
  if (margin < rubric.confidenceThreshold) {
    return {
      action: "ESCALATE",
      verdict: null,
      margin,
      reason: `Margin ${margin} is below threshold ${rubric.confidenceThreshold}. Too close to auto-resolve.`,
    };
  }

  // Clear winner — auto-resolve
  return {
    action: "RESOLVE",
    verdict: ruling.finalVerdict,
    margin,
    reason: `Margin ${margin} exceeds threshold ${rubric.confidenceThreshold}. Resolving as ${ruling.finalVerdict}.`,
  };
}
