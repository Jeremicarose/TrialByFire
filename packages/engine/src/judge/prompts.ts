import type {
  MarketQuestion,
  EvidenceBundle,
  AdvocateArgument,
} from "../types.js";

/**
 * Builds the system prompt for the judge.
 *
 * The judge's prompt includes explicit anti-bias instructions:
 * - Score based on evidence quality, not personal beliefs
 * - Flag citations not present in the evidence bundle
 * - Evaluate each criterion independently
 *
 * The hallucination detection instruction is key — it makes the
 * judge cross-reference every advocate citation against the actual
 * evidence bundle, catching fabricated references.
 */
export function buildJudgeSystemPrompt(): string {
  return `You are a neutral adjudicator in a structured adversarial debate protocol. Two advocates have argued opposing positions on a question, citing evidence from a shared evidence bundle.

YOUR TASK:
1. Score each advocate's arguments against every rubric criterion (0-100 per side per criterion).
2. Determine which advocate's overall case is stronger based on evidence quality and logical coherence.
3. HALLUCINATION CHECK: For each evidence citation made by either advocate, verify it exists in the evidence bundle. List any citations that reference evidence NOT present in the bundle.
4. Write a concise ruling explaining your verdict.

SCORING GUIDELINES:
- Score arguments SOLELY on evidence quality and rubric alignment, not on your own beliefs about the question.
- A higher score means the argument is better supported by evidence from the bundle.
- Weighted aggregate: multiply each criterion score by its weight, sum, and divide by total weight.
- If hallucinations are detected, note them but still score the valid portions of the argument.

OUTPUT FORMAT:
Respond with a single JSON object matching this exact schema:
{
  "finalVerdict": "YES" | "NO",
  "scoreYes": <weighted aggregate 0-100>,
  "scoreNo": <weighted aggregate 0-100>,
  "criterionScores": [
    {
      "criterion": "<criterion name>",
      "scoreYes": <0-100>,
      "scoreNo": <0-100>,
      "reasoning": "<why these scores>"
    }
  ],
  "rulingText": "<2-4 sentence explanation of the verdict>",
  "hallucinationsDetected": ["<citation not found in evidence bundle>", ...]
}

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, no preamble.`;
}

/**
 * Builds the user prompt for the judge, containing all trial materials:
 * - The market question and rubric
 * - The full evidence bundle (for cross-referencing citations)
 * - Both advocate arguments in full
 *
 * The evidence bundle is included so the judge can verify citations.
 * Both arguments are labeled clearly so the judge can distinguish them.
 */
export function buildJudgeUserPrompt(
  question: MarketQuestion,
  evidence: EvidenceBundle,
  advocateYes: AdvocateArgument,
  advocateNo: AdvocateArgument
): string {
  const rubricSection = question.rubric.criteria
    .map(
      (c) =>
        `- ${c.name} (weight: ${c.weight}/100): ${c.description}`
    )
    .join("\n");

  const evidenceTitles = evidence.items
    .map((item, i) => `  ${i + 1}. [${item.source}] ${item.title}`)
    .join("\n");

  const evidenceDetails = evidence.items
    .map(
      (item, i) =>
        `--- Evidence Item ${i + 1} ---
Title: ${item.title}
Source: ${item.source}
Content: ${item.content}`
    )
    .join("\n\n");

  const formatArgument = (arg: AdvocateArgument) => {
    const args = arg.arguments
      .map(
        (a) =>
          `  Criterion: ${a.criterion}
  Claim: ${a.claim}
  Citations: ${a.evidenceCitations.join(", ")}
  Self-assessed strength: ${a.strength}/100`
      )
      .join("\n\n");

    const weaknesses = arg.weaknessesInOpposingCase
      .map((w) => `  - ${w}`)
      .join("\n");

    return `Side: ${arg.side}
Confidence: ${arg.confidence}/100
Arguments:
${args}
Identified weaknesses in opposing case:
${weaknesses}`;
  };

  return `MARKET QUESTION:
${question.question}

RESOLUTION RUBRIC:
${rubricSection}

EVIDENCE BUNDLE — TITLES (use for hallucination checking):
${evidenceTitles}

EVIDENCE BUNDLE — FULL CONTENT:
${evidenceDetails}

========================================
ADVOCATE YES ARGUMENT:
${formatArgument(advocateYes)}

========================================
ADVOCATE NO ARGUMENT:
${formatArgument(advocateNo)}

========================================
Score both arguments against every rubric criterion. Flag any citations not found in the evidence bundle titles above. Return your verdict as JSON.`;
}
