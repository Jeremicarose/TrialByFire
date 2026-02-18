import { MarketView } from "./components/MarketView";
import { TrialTranscript } from "./components/TrialTranscript";
import { JudgeScorecard } from "./components/JudgeScorecard";
import { SettlementStatus } from "./components/SettlementStatus";
import { useTrialEngine } from "./hooks/useTrialEngine";
import type { MarketQuestion } from "./types";

/*
 * Demo market question — matches the engine CLI's default.
 * In production, this would come from the smart contract via
 * an onchain read, but for the hackathon demo we hardcode it.
 */
const DEMO_QUESTION: MarketQuestion = {
  id: "demo-001",
  question:
    "Did ETH staking yields consistently outperform US Treasury rates in January 2026?",
  rubric: {
    criteria: [
      { name: "Data accuracy", description: "Are the cited yield/rate numbers verifiable from the evidence?", weight: 30 },
      { name: "Time period coverage", description: "Does the evidence cover the full period in question?", weight: 25 },
      { name: "Source diversity", description: "Are multiple independent sources used to support claims?", weight: 20 },
      { name: "Logical coherence", description: "Is the argument internally consistent and logically sound?", weight: 25 },
    ],
    evidenceSources: ["defilama", "treasury", "newsapi"],
    confidenceThreshold: 20,
  },
  settlementDeadline: new Date(),
};

export default function App() {
  /*
   * useTrialEngine manages the full pipeline lifecycle:
   * - stage: which step is currently running (evidence/advocates/judge/decision)
   * - stageMessage: human-readable description of what's happening
   * - isRunning: boolean for disabling the button during execution
   * - transcript: null until trial completes, then the full TrialTranscript
   * - runTrial: function to kick off the pipeline
   */
  const { transcript, stage, stageMessage, isRunning, runTrial } =
    useTrialEngine(DEMO_QUESTION);

  return (
    <div className="app">
      {/* Header — project branding */}
      <header className="app-header">
        <p className="app-header__eyebrow">Adversarial Resolution Protocol</p>
        <h1 className="app-header__title">TrialByFire</h1>
        <p className="app-header__subtitle">
          Subjective prediction markets resolved by adversarial AI debate,
          scored against transparent rubrics, settled onchain.
        </p>
      </header>

      {/* Stage indicator — shows pipeline progress while running */}
      {stage !== "idle" && (
        <div className={`stage-indicator stage-indicator--${stage}`}>
          <span className="stage-indicator__dot" />
          <span>{stageMessage}</span>
        </div>
      )}

      {/* MarketView — always visible. Shows question, rubric, pools, Run button */}
      <MarketView
        question={DEMO_QUESTION}
        yesPool="1.00"
        noPool="0.50"
        status={transcript ? (transcript.decision.action === "RESOLVE" ? "Resolved" : "Escalated") : isRunning ? "SettlementRequested" : "Open"}
        isRunning={isRunning}
        onRunTrial={runTrial}
      />

      {/* Below components only render after the trial completes */}
      {transcript && (
        <>
          <TrialTranscript
            advocateYes={transcript.advocateYes}
            advocateNo={transcript.advocateNo}
          />
          <JudgeScorecard ruling={transcript.judgeRuling} />
          <SettlementStatus
            decision={transcript.decision}
            threshold={DEMO_QUESTION.rubric.confidenceThreshold}
            durationMs={transcript.durationMs}
          />
        </>
      )}
    </div>
  );
}
