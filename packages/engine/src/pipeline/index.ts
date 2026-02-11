import type { MarketQuestion, TrialTranscript } from "../types.js";
import type { LLMClient } from "../llm/index.js";
import type { EvidenceSource } from "../evidence/index.js";
import { gatherEvidence } from "../evidence/index.js";
import { runAdvocatesPairInParallel } from "../advocates/index.js";
import { runJudge } from "../judge/index.js";
import { evaluateConfidence } from "./confidence.js";

/**
 * Configuration for the trial pipeline.
 *
 * The pipeline is designed for dependency injection — every external
 * dependency (LLM clients, evidence sources) is passed in, not hardcoded.
 * This makes it:
 * - Testable (inject mocks)
 * - Configurable (swap models, add sources)
 * - CRE-portable (swap LLM clients for CRE HTTP Client wrappers)
 */
export interface PipelineConfig {
  /** Evidence sources to fetch from (run in parallel) */
  evidenceSources: EvidenceSource[];

  /** LLM client for the YES advocate (typically Claude) */
  advocateYesClient: LLMClient;

  /** LLM client for the NO advocate (typically OpenAI) */
  advocateNoClient: LLMClient;

  /** LLM client for the judge (ideally a different model than advocates) */
  judgeClient: LLMClient;

  /**
   * Optional progress callback — called at each stage so the CLI
   * or frontend can show real-time updates. The pipeline itself
   * is UI-agnostic; all display logic lives in the callback.
   */
  onProgress?: (stage: string, detail: string) => void;
}

/**
 * Runs a complete adversarial trial for a market question.
 *
 * This is the main entry point — the function that chains the entire
 * pipeline together:
 *
 * Stage 1: EVIDENCE GATHERING
 *   Fetch data from all configured sources in parallel.
 *   If some sources fail, the trial continues with partial evidence.
 *
 * Stage 2: ADVERSARIAL DEBATE
 *   Two LLM advocates argue YES and NO simultaneously (Promise.all).
 *   Each receives the same evidence but opposite mandates.
 *   Using different models ensures genuine diversity of perspective.
 *
 * Stage 3: ADJUDICATION
 *   A third LLM (the judge) receives both arguments and scores them
 *   against the rubric. This is sequential — it needs both arguments.
 *
 * Stage 4: CONFIDENCE CHECK
 *   Pure logic: margin > threshold → RESOLVE, otherwise → ESCALATE.
 *   Hallucinations also trigger escalation.
 *
 * Returns a complete TrialTranscript containing all inputs, outputs,
 * and the final decision — suitable for onchain storage or display.
 */
export async function runTrial(
  question: MarketQuestion,
  config: PipelineConfig
): Promise<TrialTranscript> {
  const start = Date.now();

  // Stage 1: Evidence Gathering
  config.onProgress?.(
    "evidence",
    `Gathering evidence from ${config.evidenceSources.length} source(s)...`
  );
  const evidence = await gatherEvidence(question, config.evidenceSources);
  config.onProgress?.(
    "evidence",
    `Gathered ${evidence.items.length} evidence items.`
  );

  // Stage 2: Adversarial Debate (parallel)
  config.onProgress?.(
    "advocates",
    "Running adversarial debate — YES vs NO in parallel..."
  );
  const { yes, no } = await runAdvocatesPairInParallel(
    question,
    evidence,
    config.advocateYesClient,
    config.advocateNoClient
  );
  config.onProgress?.(
    "advocates",
    `Advocates done. YES confidence: ${yes.confidence}, NO confidence: ${no.confidence}`
  );

  // Stage 3: Adjudication (sequential — needs both arguments)
  config.onProgress?.(
    "judge",
    "Judge is scoring both arguments against the rubric..."
  );
  const ruling = await runJudge(
    question,
    evidence,
    yes,
    no,
    config.judgeClient
  );
  config.onProgress?.(
    "judge",
    `Judge verdict: ${ruling.finalVerdict} (YES: ${ruling.scoreYes}, NO: ${ruling.scoreNo})`
  );

  // Stage 4: Confidence Check
  config.onProgress?.(
    "decision",
    "Evaluating confidence threshold..."
  );
  const decision = evaluateConfidence(ruling, question.rubric);
  config.onProgress?.(
    "decision",
    `Decision: ${decision.action}${decision.verdict ? ` — ${decision.verdict}` : ""} | ${decision.reason}`
  );

  // Assemble the complete trial transcript
  const transcript: TrialTranscript = {
    question,
    evidence,
    advocateYes: yes,
    advocateNo: no,
    judgeRuling: ruling,
    decision,
    executedAt: new Date(),
    durationMs: Date.now() - start,
  };

  config.onProgress?.(
    "complete",
    `Trial complete in ${transcript.durationMs}ms — ${decision.action}`
  );

  return transcript;
}
