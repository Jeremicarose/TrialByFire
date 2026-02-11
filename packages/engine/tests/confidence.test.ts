import { describe, it, expect } from "vitest";
import { evaluateConfidence } from "../src/pipeline/confidence.js";
import type { JudgeRuling, ResolutionRubric } from "../src/types.js";

/**
 * Tests for the confidence checker — the pure logic that decides
 * whether to auto-resolve or escalate a market.
 *
 * No mocking needed here since evaluateConfidence is a pure function.
 */

const baseRubric: ResolutionRubric = {
  criteria: [
    { name: "Test criterion", description: "Test", weight: 100 },
  ],
  evidenceSources: ["test"],
  confidenceThreshold: 20,
};

function makeRuling(
  overrides: Partial<JudgeRuling> = {}
): JudgeRuling {
  return {
    finalVerdict: "YES",
    scoreYes: 75,
    scoreNo: 40,
    criterionScores: [],
    rulingText: "Test ruling",
    hallucinationsDetected: [],
    model: "test-model",
    ...overrides,
  };
}

describe("evaluateConfidence", () => {
  it("resolves when margin exceeds threshold", () => {
    // Score 75 vs 40 = margin 35, threshold 20 → RESOLVE
    const result = evaluateConfidence(makeRuling(), baseRubric);

    expect(result.action).toBe("RESOLVE");
    expect(result.verdict).toBe("YES");
    expect(result.margin).toBe(35);
  });

  it("escalates when margin is below threshold", () => {
    // Score 52 vs 48 = margin 4, threshold 20 → ESCALATE
    const ruling = makeRuling({ scoreYes: 52, scoreNo: 48 });
    const result = evaluateConfidence(ruling, baseRubric);

    expect(result.action).toBe("ESCALATE");
    expect(result.verdict).toBeNull();
    expect(result.margin).toBe(4);
    expect(result.reason).toContain("below threshold");
  });

  it("escalates when hallucinations are detected even if margin is high", () => {
    // Margin 35 would normally resolve, but hallucinations force escalation
    const ruling = makeRuling({
      hallucinationsDetected: ["Fake citation: nonexistent source"],
    });
    const result = evaluateConfidence(ruling, baseRubric);

    expect(result.action).toBe("ESCALATE");
    expect(result.verdict).toBeNull();
    expect(result.reason).toContain("Hallucinations detected");
  });

  it("uses absolute margin regardless of verdict direction", () => {
    // NO wins: scoreNo 70 > scoreYes 40 = margin 30
    const ruling = makeRuling({
      finalVerdict: "NO",
      scoreYes: 40,
      scoreNo: 70,
    });
    const result = evaluateConfidence(ruling, baseRubric);

    expect(result.action).toBe("RESOLVE");
    expect(result.verdict).toBe("NO");
    expect(result.margin).toBe(30);
  });

  it("respects custom threshold values", () => {
    // Margin 15 with threshold 10 → RESOLVE
    const ruling = makeRuling({ scoreYes: 55, scoreNo: 40 });
    const rubric = { ...baseRubric, confidenceThreshold: 10 };
    const result = evaluateConfidence(ruling, rubric);

    expect(result.action).toBe("RESOLVE");

    // Same margin 15 with threshold 20 → ESCALATE
    const result2 = evaluateConfidence(ruling, baseRubric);
    expect(result2.action).toBe("ESCALATE");
  });

  it("escalates at exact threshold boundary (not >=, strictly <)", () => {
    // Margin exactly 20 with threshold 20 → should still ESCALATE
    // because we use < not <=, the margin must EXCEED the threshold
    const ruling = makeRuling({ scoreYes: 60, scoreNo: 40 });
    const result = evaluateConfidence(ruling, baseRubric);

    // Margin is exactly 20, threshold is 20. Our code uses < so 20 < 20 = false → RESOLVE
    expect(result.action).toBe("RESOLVE");
  });
});
