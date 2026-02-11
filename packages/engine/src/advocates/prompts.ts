import type { Verdict, MarketQuestion, EvidenceBundle } from "../types.js";

/**
 * Builds the system prompt for an advocate.
 *
 * This is the core of the adversarial structure. Each advocate receives:
 * 1. A mandatory side (YES or NO) they MUST argue for
 * 2. Instructions to ONLY cite evidence from the provided bundle
 * 3. A strict JSON output format matching our AdvocateArgumentSchema
 *
 * The "only cite provided evidence" constraint is critical — it prevents
 * hallucinated citations and makes the judge's hallucination detection
 * meaningful (any citation not in the bundle is verifiably fake).
 */
export function buildAdvocateSystemPrompt(side: Verdict): string {
  return `You are an expert advocate in a structured adversarial debate protocol. Your assigned position is: ${side}.

ROLE:
You MUST argue that the answer to the question is ${side}. Build the strongest possible case for your position, regardless of your personal assessment.

RULES:
1. You may ONLY cite evidence from the evidence bundle provided in the user message. Do not reference external sources or prior knowledge.
2. Every claim must be backed by at least one citation from the evidence bundle (reference items by their exact title).
3. You must address EVERY criterion in the resolution rubric.
4. Assess the strength of each argument honestly (0-100) — overstating weakens your credibility with the judge.
5. Identify weaknesses in what the opposing side is likely to argue.

OUTPUT FORMAT:
Respond with a single JSON object matching this exact schema:
{
  "side": "${side}",
  "confidence": <number 0-100>,
  "arguments": [
    {
      "criterion": "<rubric criterion name>",
      "claim": "<your argument for this criterion>",
      "evidenceCitations": ["<exact title of evidence item>", ...],
      "strength": <number 0-100>
    }
  ],
  "weaknessesInOpposingCase": ["<weakness 1>", "<weakness 2>", ...]
}

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no preamble.`;
}

/**
 * Builds the user prompt containing the question, rubric, and evidence.
 *
 * The evidence bundle is serialized with clear item boundaries and titles
 * so the advocate can cite them accurately. The rubric criteria are listed
 * with their weights so the advocate knows what the judge prioritizes.
 */
export function buildAdvocateUserPrompt(
  question: MarketQuestion,
  evidence: EvidenceBundle
): string {
  const rubricSection = question.rubric.criteria
    .map(
      (c) =>
        `- ${c.name} (weight: ${c.weight}/100): ${c.description}`
    )
    .join("\n");

  const evidenceSection = evidence.items
    .map(
      (item, i) =>
        `--- Evidence Item ${i + 1} ---
Title: ${item.title}
Source: ${item.source}
Content: ${item.content}
${item.url ? `URL: ${item.url}` : ""}`
    )
    .join("\n\n");

  return `MARKET QUESTION:
${question.question}

RESOLUTION RUBRIC:
${rubricSection}

EVIDENCE BUNDLE (${evidence.items.length} items):
${evidenceSection}

Build your case now. Address every rubric criterion. Cite evidence by exact title.`;
}
