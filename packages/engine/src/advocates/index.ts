import type {
  MarketQuestion,
  EvidenceBundle,
  AdvocateArgument,
  Verdict,
} from "../types.js";
import { AdvocateArgumentSchema } from "../types.js";
import type { LLMClient } from "../llm/index.js";
import {
  buildAdvocateSystemPrompt,
  buildAdvocateUserPrompt,
} from "./prompts.js";

/**
 * Runs a single advocate — sends the evidence bundle to an LLM with
 * instructions to argue for one side, then validates the response.
 *
 * The flow:
 * 1. Build system prompt (sets the advocate's assigned side)
 * 2. Build user prompt (serializes question + rubric + evidence)
 * 3. Call the LLM
 * 4. Parse the JSON response
 * 5. Validate with Zod to ensure it matches our schema
 * 6. Attach the model name for audit trail
 *
 * If the LLM returns invalid JSON or fails Zod validation, the error
 * propagates up — the pipeline doesn't silently accept bad data.
 */
export async function runAdvocate(
  side: Verdict,
  question: MarketQuestion,
  evidence: EvidenceBundle,
  llmClient: LLMClient
): Promise<AdvocateArgument> {
  const systemPrompt = buildAdvocateSystemPrompt(side);
  const userPrompt = buildAdvocateUserPrompt(question, evidence);

  const response = await llmClient.call({
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
    temperature: 0.3,
  });

  // Parse the raw JSON string from the LLM
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    throw new Error(
      `Advocate ${side} returned invalid JSON: ${response.content.slice(0, 200)}`
    );
  }

  // Validate against our schema — catches missing fields, wrong types, etc.
  const validated = AdvocateArgumentSchema.parse(parsed);

  return {
    ...validated,
    model: response.model,
  };
}

/**
 * Runs both advocates in parallel.
 *
 * This is the core of the adversarial structure: two different LLM clients
 * (typically Claude for YES, OpenAI for NO) receive the SAME evidence but
 * opposite mandates. Running in parallel halves the wall-clock time.
 *
 * Using different models ensures genuine diversity — if both models had
 * the same training biases, the "adversarial" structure would be theater.
 * Different model families have demonstrably different biases on subjective
 * questions, making the debate more meaningful.
 */
export async function runAdvocatesPairInParallel(
  question: MarketQuestion,
  evidence: EvidenceBundle,
  yesClient: LLMClient,
  noClient: LLMClient
): Promise<{ yes: AdvocateArgument; no: AdvocateArgument }> {
  const [yes, no] = await Promise.all([
    runAdvocate("YES", question, evidence, yesClient),
    runAdvocate("NO", question, evidence, noClient),
  ]);

  return { yes, no };
}
