import type { MarketQuestion } from "../types";
import "./MarketView.css";

interface MarketViewProps {
  question: MarketQuestion;
  yesPool: string;    // ETH amount as string (e.g. "1.00")
  noPool: string;
  status: "Open" | "SettlementRequested" | "Resolved" | "Escalated";
  isRunning: boolean;
  onRunTrial: () => void;
}

/*
 * MarketView is the top card in the dashboard.
 * It shows everything about the market BEFORE the trial runs:
 * the question, the scoring rubric, the pool sizes, and the trigger button.
 *
 * This component is always visible — it's the context panel that helps
 * judges understand what they're about to see in the trial transcript.
 */
export function MarketView({ question, yesPool, noPool, status, isRunning, onRunTrial }: MarketViewProps) {
  // Calculate pool percentages for the split bar visualization
  const yesNum = parseFloat(yesPool);
  const noNum = parseFloat(noPool);
  const total = yesNum + noNum;
  const yesPct = total > 0 ? (yesNum / total) * 100 : 50;

  // Map status to display properties
  const statusConfig: Record<string, { label: string; className: string }> = {
    Open: { label: "Open", className: "status--open" },
    SettlementRequested: { label: "Settlement In Progress", className: "status--pending" },
    Resolved: { label: "Resolved", className: "status--resolved" },
    Escalated: { label: "Escalated", className: "status--escalated" },
  };

  const { label: statusLabel, className: statusClass } = statusConfig[status];

  return (
    <section className="market-view reveal">
      <div className="section-label">Market</div>

      {/* Header row: question + status badge */}
      <div className="market-view__header">
        <h2 className="market-view__question serif">{question.question}</h2>
        <span className={`market-view__status ${statusClass}`}>{statusLabel}</span>
      </div>

      {/* Rubric — the scoring criteria advocates will be judged against */}
      <div className="market-view__rubric">
        <div className="market-view__rubric-title mono">Resolution Rubric</div>
        <div className="market-view__criteria">
          {question.rubric.criteria.map((c) => (
            <div key={c.name} className="criterion">
              <div className="criterion__header">
                <span className="criterion__name">{c.name}</span>
                {/* Weight shown as monospace number — communicates this is data */}
                <span className="criterion__weight mono">{c.weight}%</span>
              </div>
              <div className="criterion__desc">{c.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pool split bar — visual representation of YES vs NO stakes */}
      <div className="market-view__pools">
        <div className="pool-labels">
          <span className="pool-label pool-label--yes mono">
            YES {yesPool} ETH
          </span>
          <span className="pool-label pool-label--no mono">
            NO {noPool} ETH
          </span>
        </div>
        {/*
         * The split bar uses a CSS gradient to show the ratio.
         * yesPct determines where blue ends and red begins.
         * A 2px gap in the middle separates the two sides visually.
         */}
        <div className="pool-bar">
          <div className="pool-bar__yes" style={{ width: `${yesPct}%` }} />
          <div className="pool-bar__no" style={{ width: `${100 - yesPct}%` }} />
        </div>
        <div className="pool-total mono">
          Total Pool: {total.toFixed(2)} ETH
        </div>
      </div>

      {/* Meta row: threshold + evidence sources + Run button */}
      <div className="market-view__footer">
        <div className="market-view__meta">
          <span className="meta-item mono">
            Threshold: {question.rubric.confidenceThreshold} pts
          </span>
          <span className="meta-item mono">
            Sources: {question.rubric.evidenceSources.join(", ")}
          </span>
        </div>
        <button
          className="run-trial-btn"
          onClick={onRunTrial}
          disabled={isRunning || status === "Resolved" || status === "Escalated"}
        >
          {isRunning ? (
            <>
              <span className="run-trial-btn__spinner" />
              Trial in Progress...
            </>
          ) : (
            "Run Trial"
          )}
        </button>
      </div>
    </section>
  );
}
