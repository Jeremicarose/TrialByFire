#!/usr/bin/env node

/**
 * CLI entry point for TrialByFire.
 *
 * Usage:
 *   USE_MOCKS=true npx tsx src/cli.ts
 *   USE_MOCKS=true npx tsx src/cli.ts "Your custom question here"
 *
 * Runs the full adversarial trial pipeline and prints the transcript.
 * With USE_MOCKS=true, no API keys are needed — all LLM calls and
 * evidence fetches return realistic fixture data.
 */

import "dotenv/config";
import { runTrial } from "./pipeline/index.js";
import type { PipelineConfig } from "./pipeline/index.js";
import { createLLMClient } from "./llm/index.js";
import { MockEvidenceSource } from "./evidence/mock.js";
import { DeFiLlamaSource } from "./evidence/sources/defilama.js";
import { NewsAPISource } from "./evidence/sources/news.js";
import { TreasurySource } from "./evidence/sources/treasury.js";
import type { MarketQuestion } from "./types.js";
import type { EvidenceSource } from "./evidence/index.js";

// ── Parse CLI arguments ──────────────────────────────────────────

const questionText =
  process.argv[2] ||
  "Did ETH staking yields consistently outperform US Treasury rates in January 2026?";

const useMocks = process.env.USE_MOCKS === "true";

// ── Build the market question with a demo rubric ─────────────────

const question: MarketQuestion = {
  id: "demo-001",
  question: questionText,
  rubric: {
    criteria: [
      {
        name: "Data accuracy",
        description:
          "Are the cited yield/rate numbers verifiable from the evidence?",
        weight: 30,
      },
      {
        name: "Time period coverage",
        description:
          "Does the evidence cover the full period in question?",
        weight: 25,
      },
      {
        name: "Source diversity",
        description:
          "Are multiple independent sources used to support claims?",
        weight: 20,
      },
      {
        name: "Logical coherence",
        description:
          "Is the argument internally consistent and logically sound?",
        weight: 25,
      },
    ],
    evidenceSources: ["defilama", "treasury", "newsapi"],
    confidenceThreshold: 20,
  },
  settlementDeadline: new Date(),
};

// ── Configure the pipeline ───────────────────────────────────────

const evidenceSources: EvidenceSource[] = useMocks
  ? [new MockEvidenceSource()]
  : [new DeFiLlamaSource(), new TreasurySource(), new NewsAPISource()];

const config: PipelineConfig = {
  evidenceSources,
  // YES advocate uses Claude, NO advocate uses OpenAI (different models = genuine diversity)
  advocateYesClient: createLLMClient(useMocks ? "mock" : "anthropic"),
  advocateNoClient: createLLMClient(useMocks ? "mock" : "openai"),
  // Judge uses Claude (different model version ideally)
  judgeClient: createLLMClient(useMocks ? "mock" : "anthropic"),

  // Progress callback — prints stage updates to terminal
  onProgress: (stage, detail) => {
    const icons: Record<string, string> = {
      evidence: "[EVIDENCE]",
      advocates: "[DEBATE]",
      judge: "[JUDGE]",
      decision: "[DECISION]",
      complete: "[COMPLETE]",
    };
    const icon = icons[stage] ?? "[...]";
    console.log(`\n${icon} ${detail}`);
  },
};

// ── Run the trial ────────────────────────────────────────────────

console.log("=".repeat(70));
console.log("  TRIALBYFIRE — Adversarial AI Debate Protocol");
console.log("=".repeat(70));
console.log(`\nQuestion: ${question.question}`);
console.log(`Mode: ${useMocks ? "MOCK (no API keys)" : "LIVE (using real APIs)"}`);
console.log(`Confidence threshold: ${question.rubric.confidenceThreshold}`);

runTrial(question, config)
  .then((transcript) => {
    // ── Print the full trial transcript ──────────────────────────

    console.log("\n" + "=".repeat(70));
    console.log("  TRIAL TRANSCRIPT");
    console.log("=".repeat(70));

    // Evidence summary
    console.log(
      `\n--- EVIDENCE (${transcript.evidence.items.length} items) ---`
    );
    for (const item of transcript.evidence.items) {
      console.log(`  [${item.source}] ${item.title}`);
    }

    // Advocate YES
    console.log(
      `\n--- ADVOCATE YES (${transcript.advocateYes.model}) ---`
    );
    console.log(`Confidence: ${transcript.advocateYes.confidence}/100`);
    for (const arg of transcript.advocateYes.arguments) {
      console.log(
        `  [${arg.criterion}] ${arg.claim}`
      );
      console.log(
        `    Citations: ${arg.evidenceCitations.join(", ")}`
      );
      console.log(`    Strength: ${arg.strength}/100`);
    }

    // Advocate NO
    console.log(
      `\n--- ADVOCATE NO (${transcript.advocateNo.model}) ---`
    );
    console.log(`Confidence: ${transcript.advocateNo.confidence}/100`);
    for (const arg of transcript.advocateNo.arguments) {
      console.log(
        `  [${arg.criterion}] ${arg.claim}`
      );
      console.log(
        `    Citations: ${arg.evidenceCitations.join(", ")}`
      );
      console.log(`    Strength: ${arg.strength}/100`);
    }

    // Judge ruling
    console.log(
      `\n--- JUDGE RULING (${transcript.judgeRuling.model}) ---`
    );
    console.log(
      `Verdict: ${transcript.judgeRuling.finalVerdict}`
    );
    console.log(
      `Score YES: ${transcript.judgeRuling.scoreYes} | Score NO: ${transcript.judgeRuling.scoreNo} | Margin: ${Math.abs(transcript.judgeRuling.scoreYes - transcript.judgeRuling.scoreNo)}`
    );
    console.log(`\nPer-criterion scores:`);
    for (const cs of transcript.judgeRuling.criterionScores) {
      console.log(
        `  ${cs.criterion}: YES ${cs.scoreYes} / NO ${cs.scoreNo} — ${cs.reasoning}`
      );
    }
    console.log(`\nRuling: ${transcript.judgeRuling.rulingText}`);

    if (transcript.judgeRuling.hallucinationsDetected.length > 0) {
      console.log(
        `\nHallucinations detected: ${transcript.judgeRuling.hallucinationsDetected.join("; ")}`
      );
    }

    // Settlement decision
    console.log("\n--- SETTLEMENT DECISION ---");
    console.log(`Action: ${transcript.decision.action}`);
    if (transcript.decision.verdict) {
      console.log(`Verdict: ${transcript.decision.verdict}`);
    }
    console.log(`Reason: ${transcript.decision.reason}`);
    console.log(`\nTrial duration: ${transcript.durationMs}ms`);
    console.log("=".repeat(70));
  })
  .catch((error) => {
    console.error("\nTrial failed:", error);
    process.exit(1);
  });
