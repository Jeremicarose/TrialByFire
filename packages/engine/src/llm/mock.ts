import type { LLMClient, LLMRequest, LLMResponse } from "./index.js";

/**
 * Mock LLM client that returns pre-built responses for development and demos.
 *
 * Detects what type of call is being made (advocate YES, advocate NO, or judge)
 * by inspecting keywords in the system prompt, then returns the appropriate
 * fixture data. Supports two scenarios:
 *
 *   "clear" — Strong YES verdict (78 vs 45), triggers RESOLVE
 *   "close" — Narrow margin (52 vs 48), triggers ESCALATE
 *
 * All fixture data matches the Zod schemas in types.ts exactly, so pipeline
 * validation passes without modification.
 */

// ── Clear-win scenario fixtures ──────────────────────────────────

const MOCK_ADVOCATE_YES = JSON.stringify({
  side: "YES",
  confidence: 78,
  arguments: [
    {
      criterion: "Data accuracy",
      claim:
        "ETH staking yields averaged 4.2% APR in January 2026 according to DeFiLlama data, while 10-year US Treasury rates held at 3.9% for the same period.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "US Treasury: Average Interest Rates January 2026",
      ],
      strength: 85,
    },
    {
      criterion: "Time period coverage",
      claim:
        "Data spans the full month of January 2026 with daily granularity from both DeFiLlama and Treasury.gov, covering all 31 days without gaps.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "US Treasury: Daily Yield Curve Rates",
      ],
      strength: 90,
    },
    {
      criterion: "Source diversity",
      claim:
        "Multiple independent sources confirm the yield differential: DeFiLlama aggregates validator data from Lido, Rocket Pool, and Coinbase; Treasury.gov provides official government rates; CoinDesk and The Block report the spread.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "CoinDesk: ETH Staking vs Treasury Yields Analysis",
        "US Treasury: Average Interest Rates January 2026",
      ],
      strength: 82,
    },
    {
      criterion: "Logical coherence",
      claim:
        "The 0.3% yield advantage for ETH staking is consistent across all sources and time periods examined. The advantage held for 26 of 31 days, qualifying as 'consistently outperforming' under any reasonable interpretation.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "US Treasury: Daily Yield Curve Rates",
      ],
      strength: 75,
    },
  ],
  weaknessesInOpposingCase: [
    "The NO side may argue that a 0.3% spread is within noise, but the consistency across 26/31 days makes this a sustained pattern, not noise.",
    "Risk-adjusted comparisons are irrelevant to the question as stated — the question asks about raw yield, not risk-adjusted returns.",
    "Any argument about specific validator downtime affecting averages is countered by the use of aggregate staking data across all major providers.",
  ],
});

const MOCK_ADVOCATE_NO = JSON.stringify({
  side: "NO",
  confidence: 45,
  arguments: [
    {
      criterion: "Data accuracy",
      claim:
        "When accounting for validator penalties and MEV variability, the effective ETH staking yield drops to approximately 3.8%, which is below the Treasury rate of 3.9%.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "Beacon Chain: Validator Penalty Statistics",
      ],
      strength: 55,
    },
    {
      criterion: "Time period coverage",
      claim:
        "ETH staking yields dipped below Treasury rates during the first week of January (Jan 1-7) due to low network activity during the holiday period, meaning yields did not 'consistently' outperform.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "US Treasury: Daily Yield Curve Rates",
      ],
      strength: 50,
    },
    {
      criterion: "Source diversity",
      claim:
        "The YES case over-relies on DeFiLlama which aggregates self-reported validator data. Independent audited sources for staking yields are limited.",
      evidenceCitations: [
        "CoinDesk: ETH Staking vs Treasury Yields Analysis",
      ],
      strength: 40,
    },
    {
      criterion: "Logical coherence",
      claim:
        "The word 'consistently' implies sustained outperformance without significant exceptions. Five days of underperformance out of 31 (16%) represents meaningful inconsistency.",
      evidenceCitations: [
        "DeFiLlama: ETH Staking APR January 2026",
        "US Treasury: Daily Yield Curve Rates",
      ],
      strength: 60,
    },
  ],
  weaknessesInOpposingCase: [
    "The YES side uses gross staking yields without deducting validator operating costs and penalties.",
    "Aggregate data masks significant variance between individual staking providers.",
    "The definition of 'consistently' is subjective and the YES side assumes a lenient interpretation.",
  ],
});

const MOCK_JUDGE_RULING = JSON.stringify({
  finalVerdict: "YES",
  scoreYes: 78,
  scoreNo: 45,
  criterionScores: [
    {
      criterion: "Data accuracy",
      scoreYes: 82,
      scoreNo: 50,
      reasoning:
        "The YES advocate provides verifiable aggregate APR data from DeFiLlama (4.2%) and official Treasury rates (3.9%). The NO advocate's claim about effective yields dropping to 3.8% after penalties lacks specific citation for the penalty adjustment methodology.",
    },
    {
      criterion: "Time period coverage",
      scoreYes: 85,
      scoreNo: 55,
      reasoning:
        "Both sides reference full-month data. The YES advocate demonstrates 26/31 days of outperformance. The NO advocate correctly identifies the early-January dip but this supports the YES case's transparency about the data.",
    },
    {
      criterion: "Source diversity",
      scoreYes: 75,
      scoreNo: 35,
      reasoning:
        "The YES advocate cites four independent sources. The NO advocate cites 'Beacon Chain: Validator Penalty Statistics' which is not present in the evidence bundle — a potential hallucinated citation.",
    },
    {
      criterion: "Logical coherence",
      scoreYes: 70,
      scoreNo: 55,
      reasoning:
        "The YES advocate builds a consistent argument: 26/31 days qualifies as consistent outperformance. The NO advocate raises a valid semantic point about 'consistently' but argues from a minority of days (5/31).",
    },
  ],
  rulingText:
    "The YES advocate presents a stronger case supported by diverse, verifiable evidence sources. The core claim — ETH staking yields averaged 4.2% versus Treasury rates of 3.9% in January 2026 — is well-documented. While the NO advocate raises valid points about penalties and semantics, the penalty adjustment lacks cited methodology and the semantic argument about 5/31 days is less persuasive than the YES side's 84% consistency rate. YES prevails on three of four criteria.",
  hallucinationsDetected: [
    "NO advocate cited 'Beacon Chain: Validator Penalty Statistics' which is not present in the evidence bundle.",
  ],
});

// ── Close-call scenario fixtures (triggers ESCALATE) ─────────────

const MOCK_ADVOCATE_YES_CLOSE = JSON.stringify({
  side: "YES",
  confidence: 52,
  arguments: [
    {
      criterion: "Policy effectiveness",
      claim:
        "Industry compliance surveys show a 12% increase in AI governance frameworks adopted by EU companies since the Act's implementation.",
      evidenceCitations: ["EU AI Act Compliance Survey Q1 2026"],
      strength: 55,
    },
    {
      criterion: "Measurable outcomes",
      claim:
        "The number of registered high-risk AI systems increased by 34%, suggesting companies are engaging with the regulatory framework.",
      evidenceCitations: ["EU AI Office: Registration Statistics"],
      strength: 50,
    },
  ],
  weaknessesInOpposingCase: [
    "Registration increases may reflect compliance rather than meaningful improvement.",
  ],
});

const MOCK_ADVOCATE_NO_CLOSE = JSON.stringify({
  side: "NO",
  confidence: 48,
  arguments: [
    {
      criterion: "Policy effectiveness",
      claim:
        "Many companies report the Act has created confusion rather than clarity, with 60% of surveyed firms saying guidelines are insufficient.",
      evidenceCitations: [
        "Industry Survey: AI Act Implementation Challenges",
      ],
      strength: 52,
    },
    {
      criterion: "Measurable outcomes",
      claim:
        "Enforcement actions remain at zero, suggesting the Act has had no practical compliance impact yet.",
      evidenceCitations: ["EU AI Office: Enforcement Report Q1 2026"],
      strength: 55,
    },
  ],
  weaknessesInOpposingCase: [
    "Registration numbers alone don't prove improved compliance quality.",
  ],
});

const MOCK_JUDGE_RULING_CLOSE = JSON.stringify({
  finalVerdict: "NO",
  scoreYes: 52,
  scoreNo: 48,
  criterionScores: [
    {
      criterion: "Policy effectiveness",
      scoreYes: 50,
      scoreNo: 52,
      reasoning:
        "Both sides present survey data with conflicting interpretations. Neither is clearly stronger.",
    },
    {
      criterion: "Measurable outcomes",
      scoreYes: 54,
      scoreNo: 44,
      reasoning:
        "Registration numbers favor YES, but lack of enforcement favors NO. Close call.",
    },
  ],
  rulingText:
    "This is an exceptionally close case. Both advocates present valid evidence that partially supports their position. The margin is too narrow for confident automated resolution.",
  hallucinationsDetected: [],
});

// ── Mock client implementation ───────────────────────────────────

export class MockLLMClient implements LLMClient {
  private scenario: "clear" | "close";

  /**
   * @param scenario - "clear" returns a strong YES win (78 vs 45),
   *                   "close" returns a narrow margin (52 vs 48)
   */
  constructor(scenario: "clear" | "close" = "clear") {
    this.scenario = scenario;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    // Simulate realistic API latency (200ms)
    await new Promise((r) => setTimeout(r, 200));

    // Detect what type of call this is by inspecting the system prompt.
    // IMPORTANT: Check for "advocate" FIRST because advocate prompts
    // mention "judge" in passing ("credibility with the judge"), but
    // judge prompts never contain "advocate". Order matters here.
    const prompt = request.systemPrompt.toLowerCase();
    const isAdvocate = prompt.includes("advocate");
    const isYes = prompt.includes("position is: yes");

    let content: string;

    if (isAdvocate && isYes) {
      content =
        this.scenario === "close"
          ? MOCK_ADVOCATE_YES_CLOSE
          : MOCK_ADVOCATE_YES;
    } else if (isAdvocate) {
      content =
        this.scenario === "close"
          ? MOCK_ADVOCATE_NO_CLOSE
          : MOCK_ADVOCATE_NO;
    } else {
      // Judge or any other call type
      content =
        this.scenario === "close"
          ? MOCK_JUDGE_RULING_CLOSE
          : MOCK_JUDGE_RULING;
    }

    return {
      content,
      model: "mock-model",
      tokensUsed: 0,
    };
  }
}
