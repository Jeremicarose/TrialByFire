import { useState, useCallback } from "react";
import type { TrialTranscript, MarketQuestion, AdvocateArgument, JudgeRuling, EvidenceBundle, SettlementDecision } from "../types";

export type TrialStage = "idle" | "evidence" | "advocates" | "judge" | "decision" | "complete";

interface UseTrialEngineReturn {
  transcript: TrialTranscript | null;
  stage: TrialStage;
  stageMessage: string;
  isRunning: boolean;
  runTrial: () => Promise<void>;
}

// Mock data matching the engine's mock fixtures
const MOCK_EVIDENCE: EvidenceBundle = {
  questionId: "demo-001",
  items: [
    { source: "defilama", title: "DeFiLlama: ETH Staking APR January 2026", content: "Ethereum staking yields averaged 4.2% APR across January 2026.", retrievedAt: new Date() },
    { source: "treasury", title: "US Treasury: Average Interest Rates January 2026", content: "The 10-year Treasury note yield averaged 3.9% in January 2026.", retrievedAt: new Date() },
    { source: "treasury", title: "US Treasury: Daily Yield Curve Rates", content: "Daily yield curve data shows 10-year rates at 3.88-3.92%.", retrievedAt: new Date() },
    { source: "newsapi", title: "CoinDesk: ETH Staking vs Treasury Yields Analysis", content: "ETH staking yields outperformed 10-year Treasuries for 26 of 31 days.", retrievedAt: new Date() },
    { source: "newsapi", title: "The Block: Institutional Demand for ETH Staking Grows", content: "Institutional staking deposits grew 18% in January 2026.", retrievedAt: new Date() },
    { source: "defilama", title: "DeFiLlama: Validator Penalty Data January 2026", content: "Validator penalties totaled approximately 0.05% drag on returns.", retrievedAt: new Date() },
    { source: "newsapi", title: "Reuters: Federal Reserve Holds Rates Steady", content: "The Federal Reserve maintained its benchmark interest rate at 4.25%.", retrievedAt: new Date() },
  ],
  gatheredAt: new Date(),
};

const MOCK_YES: AdvocateArgument = {
  side: "YES", confidence: 78, model: "claude-sonnet-4-20250514",
  arguments: [
    { criterion: "Data accuracy", claim: "ETH staking yields averaged 4.2% APR in January 2026 according to DeFiLlama data, while 10-year US Treasury rates held at 3.9% for the same period.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "US Treasury: Average Interest Rates January 2026"], strength: 85 },
    { criterion: "Time period coverage", claim: "Data spans the full month of January 2026 with daily granularity from both DeFiLlama and Treasury.gov, covering all 31 days without gaps.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "US Treasury: Daily Yield Curve Rates"], strength: 90 },
    { criterion: "Source diversity", claim: "Multiple independent sources confirm the yield differential: DeFiLlama, Treasury.gov, CoinDesk, and The Block all report consistent data.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "CoinDesk: ETH Staking vs Treasury Yields Analysis", "US Treasury: Average Interest Rates January 2026"], strength: 82 },
    { criterion: "Logical coherence", claim: "The 0.3% yield advantage held for 26 of 31 days, qualifying as 'consistently outperforming' under any reasonable interpretation.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "US Treasury: Daily Yield Curve Rates"], strength: 75 },
  ],
  weaknessesInOpposingCase: ["The NO side may argue 0.3% spread is noise, but 26/31 days makes it sustained.", "Risk-adjusted comparisons are irrelevant — the question asks about raw yield."],
};

const MOCK_NO: AdvocateArgument = {
  side: "NO", confidence: 45, model: "gpt-4o",
  arguments: [
    { criterion: "Data accuracy", claim: "When accounting for validator penalties and MEV variability, the effective ETH staking yield drops to approximately 3.8%, below the Treasury rate of 3.9%.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "Beacon Chain: Validator Penalty Statistics"], strength: 55 },
    { criterion: "Time period coverage", claim: "ETH staking yields dipped below Treasury rates during the first week of January due to low network activity during the holiday period.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "US Treasury: Daily Yield Curve Rates"], strength: 50 },
    { criterion: "Source diversity", claim: "The YES case over-relies on DeFiLlama which aggregates self-reported validator data. Independent audited sources are limited.", evidenceCitations: ["CoinDesk: ETH Staking vs Treasury Yields Analysis"], strength: 40 },
    { criterion: "Logical coherence", claim: "The word 'consistently' implies sustained outperformance without significant exceptions. Five days of underperformance (16%) represents meaningful inconsistency.", evidenceCitations: ["DeFiLlama: ETH Staking APR January 2026", "US Treasury: Daily Yield Curve Rates"], strength: 60 },
  ],
  weaknessesInOpposingCase: ["YES side uses gross yields without deducting penalties.", "Aggregate data masks variance between providers."],
};

const MOCK_RULING: JudgeRuling = {
  finalVerdict: "YES", scoreYes: 78, scoreNo: 45, model: "claude-sonnet-4-20250514",
  criterionScores: [
    { criterion: "Data accuracy", scoreYes: 82, scoreNo: 50, reasoning: "YES provides verifiable aggregate APR data. NO's penalty adjustment lacks cited methodology." },
    { criterion: "Time period coverage", scoreYes: 85, scoreNo: 55, reasoning: "Both reference full-month data. YES demonstrates 26/31 days of outperformance." },
    { criterion: "Source diversity", scoreYes: 75, scoreNo: 35, reasoning: "YES cites four independent sources. NO cites 'Beacon Chain: Validator Penalty Statistics' not in evidence bundle." },
    { criterion: "Logical coherence", scoreYes: 70, scoreNo: 55, reasoning: "YES argues 26/31 days = consistent. NO raises valid semantic point but from minority position." },
  ],
  rulingText: "The YES advocate presents a stronger case supported by diverse, verifiable evidence. ETH staking yields averaged 4.2% versus Treasury rates of 3.9% — well-documented across multiple sources. The NO advocate's penalty adjustment lacks cited methodology. YES prevails on three of four criteria.",
  hallucinationsDetected: ["NO advocate cited 'Beacon Chain: Validator Penalty Statistics' which is not present in the evidence bundle."],
};

const MOCK_DECISION: SettlementDecision = {
  action: "ESCALATE", verdict: null, margin: 33,
  reason: "Hallucinations detected: NO advocate cited 'Beacon Chain: Validator Penalty Statistics' not in evidence bundle. Escalating for human review.",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useTrialEngine(question: MarketQuestion): UseTrialEngineReturn {
  const [transcript, setTranscript] = useState<TrialTranscript | null>(null);
  const [stage, setStage] = useState<TrialStage>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const runTrial = useCallback(async () => {
    setIsRunning(true);
    setTranscript(null);
    const start = Date.now();

    setStage("evidence");
    setStageMessage("Gathering evidence from 3 sources...");
    await delay(1200);
    setStageMessage(`Gathered ${MOCK_EVIDENCE.items.length} evidence items.`);
    await delay(400);

    setStage("advocates");
    setStageMessage("Running adversarial debate \u2014 YES vs NO in parallel...");
    await delay(2000);
    setStageMessage(`Advocates done. YES: ${MOCK_YES.confidence}%, NO: ${MOCK_NO.confidence}%`);
    await delay(400);

    setStage("judge");
    setStageMessage("Judge is scoring both arguments against the rubric...");
    await delay(1800);
    setStageMessage(`Verdict: ${MOCK_RULING.finalVerdict} (YES: ${MOCK_RULING.scoreYes}, NO: ${MOCK_RULING.scoreNo})`);
    await delay(400);

    setStage("decision");
    setStageMessage("Evaluating confidence threshold...");
    await delay(800);

    const finalTranscript: TrialTranscript = {
      question,
      evidence: MOCK_EVIDENCE,
      advocateYes: MOCK_YES,
      advocateNo: MOCK_NO,
      judgeRuling: MOCK_RULING,
      decision: MOCK_DECISION,
      executedAt: new Date(),
      durationMs: Date.now() - start,
    };

    setTranscript(finalTranscript);
    setStage("complete");
    setStageMessage(`Trial complete in ${finalTranscript.durationMs}ms \u2014 ${MOCK_DECISION.action}`);
    setIsRunning(false);
  }, [question]);

  return { transcript, stage, stageMessage, isRunning, runTrial };
}
