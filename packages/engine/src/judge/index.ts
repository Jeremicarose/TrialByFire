import type {
  MarketQuestion,
  EvidenceBundle,
  AdvocateArgument,
  JudgeRuling,
} from "../types.js";
import { JudgeRulingSchema } from "../types.js";
import type { LLMClient } from "../llm/index.js";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompts.js";

/**
 * Runs the judge — the third and final LLM call in the trial.
 *
 * This is the only sequential call (it needs both advocate arguments
 * as input). The flow:
 *
 * 1. Build system prompt (neutral adjudicator instructions)
 * 2. Build user prompt (question + rubric + evidence + both arguments)
 * 3. Call the LLM (ideally a different model than either advocate)
 * 4. Parse and validate the JSON response with Zod
 * 5. Attach the model name for the audit trail
 *
 * The judge's response includes:
 * - Per-criterion scores for both sides
 * - Aggregate scores (weighted by rubric)
 * - A prose ruling explaining the decision
 * - A list of hallucinated citations (evidence not in the bundle)
 *
 * The hallucination list is consumed by the confidence checker —
 * if any hallucinations are detected, the market gets escalated
 * rather than auto-resolved, adding a safety layer.
 */
export async function runJudge(
  question: MarketQuestion,
  evidence: EvidenceBundle,
  advocateYes: AdvocateArgument,
  advocateNo: AdvocateArgument,
  llmClient: LLMClient
): Promise<JudgeRuling> {
  const systemPrompt = buildJudgeSystemPrompt();
  const userPrompt = buildJudgeUserPrompt(
    question,
    evidence,
    advocateYes,
    advocateNo
  );

  const response = await llmClient.call({
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
    temperature: 0.2, // Lower temp for the judge = more deterministic scoring
  });

  // Parse the raw JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    throw new Error(
      `Judge returned invalid JSON: ${response.content.slice(0, 200)}`
    );
  }

  // Validate against our schema
  const validated = JudgeRulingSchema.parse(parsed);

  return {
    ...validated,
    model: response.model,
  };
}
