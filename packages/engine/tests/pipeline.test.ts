import { describe, it, expect } from "vitest";
import { runTrial } from "../src/pipeline/index.js";
import type { PipelineConfig } from "../src/pipeline/index.js";
import { MockLLMClient } from "../src/llm/mock.js";
import { MockEvidenceSource } from "../src/evidence/mock.js";
import type { MarketQuestion } from "../src/types.js";

/**
 * Integration tests for the full trial pipeline.
 *
 * These tests use mock LLM clients and mock evidence sources,
 * so they run fast and require no API keys. They verify that
 * the pipeline correctly wires all stages together and produces
 * valid transcripts.
 */

const demoQuestion: MarketQuestion = {
  id: "test-001",
  question:
    "Did ETH staking yields consistently outperform US Treasury rates in January 2026?",
  rubric: {
    criteria: [
      {
        name: "Data accuracy",
        description: "Are the cited numbers verifiable?",
        weight: 30,
      },
      {
        name: "Time period coverage",
        description: "Does evidence cover the full period?",
        weight: 25,
      },
      {
        name: "Source diversity",
        description: "Are multiple sources used?",
        weight: 20,
      },
      {
        name: "Logical coherence",
        description: "Is the argument consistent?",
        weight: 25,
      },
    ],
    evidenceSources: ["mock"],
    confidenceThreshold: 20,
  },
  settlementDeadline: new Date(),
};

function buildMockConfig(
  scenario: "clear" | "close" = "clear"
): PipelineConfig {
  return {
    evidenceSources: [new MockEvidenceSource()],
    advocateYesClient: new MockLLMClient(scenario),
    advocateNoClient: new MockLLMClient(scenario),
    judgeClient: new MockLLMClient(scenario),
  };
}

describe("runTrial", () => {
  it("runs full pipeline with mocks and returns a valid transcript", async () => {
    const transcript = await runTrial(demoQuestion, buildMockConfig());

    // Verify all transcript fields are populated
    expect(transcript.question.id).toBe("test-001");
    expect(transcript.evidence.items.length).toBeGreaterThan(0);
    expect(transcript.advocateYes.side).toBe("YES");
    expect(transcript.advocateNo.side).toBe("NO");
    expect(transcript.judgeRuling.finalVerdict).toBeDefined();
    expect(transcript.decision.action).toBeDefined();
    expect(transcript.durationMs).toBeGreaterThan(0);
    expect(transcript.executedAt).toBeInstanceOf(Date);
  });

  it("resolves with clear-win scenario", async () => {
    const transcript = await runTrial(
      demoQuestion,
      buildMockConfig("clear")
    );

    // Clear scenario: YES 78 vs NO 45, margin 33 > threshold 20 → RESOLVE
    // But hallucination detected → ESCALATE
    // The mock data has a hallucination in the NO advocate's response
    expect(transcript.judgeRuling.scoreYes).toBe(78);
    expect(transcript.judgeRuling.scoreNo).toBe(45);
    // Despite high margin, hallucination triggers escalation
    expect(transcript.decision.action).toBe("ESCALATE");
  });

  it("escalates with close-call scenario", async () => {
    const transcript = await runTrial(
      demoQuestion,
      buildMockConfig("close")
    );

    // Close scenario: YES 52 vs NO 48, margin 4 < threshold 20 → ESCALATE
    expect(transcript.judgeRuling.scoreYes).toBe(52);
    expect(transcript.judgeRuling.scoreNo).toBe(48);
    expect(transcript.decision.action).toBe("ESCALATE");
    expect(transcript.decision.verdict).toBeNull();
  });

  it("calls onProgress for each stage", async () => {
    const stages: string[] = [];
    const config = {
      ...buildMockConfig(),
      onProgress: (stage: string, _detail: string) => {
        stages.push(stage);
      },
    };

    await runTrial(demoQuestion, config);

    // Should have progress calls for all stages
    expect(stages).toContain("evidence");
    expect(stages).toContain("advocates");
    expect(stages).toContain("judge");
    expect(stages).toContain("decision");
    expect(stages).toContain("complete");
  });

  it("includes evidence in the transcript", async () => {
    const transcript = await runTrial(demoQuestion, buildMockConfig());

    // Mock evidence source returns 7 items
    expect(transcript.evidence.items.length).toBe(7);
    expect(transcript.evidence.questionId).toBe("test-001");

    // Verify evidence items have required fields
    for (const item of transcript.evidence.items) {
      expect(item.source).toBeDefined();
      expect(item.title).toBeDefined();
      expect(item.content).toBeDefined();
    }
  });
});
