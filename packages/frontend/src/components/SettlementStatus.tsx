import type { SettlementDecision } from "../types";
import "./SettlementStatus.css";

interface SettlementStatusProps {
  decision: SettlementDecision;
  threshold: number;      // From rubric, for comparison display
  durationMs: number;     // Trial execution time
  txHash?: string;        // Optional Etherscan link
}

/*
 * SettlementStatus is the final card — the conclusion of the trial.
 *
 * Two visual states:
 *   RESOLVE — Green gradient, shows winning verdict prominently
 *   ESCALATE — Amber/orange gradient, shows the reason for escalation
 *
 * The margin vs threshold comparison is displayed numerically
 * so viewers understand the decision logic:
 *   "Margin 33 > Threshold 20 → auto-resolve eligible"
 *   "But hallucinations detected → escalate anyway"
 *
 * This transparency is a core selling point of TrialByFire:
 * the AI explains exactly why it made (or didn't make) a decision.
 */
export function SettlementStatus({ decision, threshold, durationMs, txHash }: SettlementStatusProps) {
  const isResolved = decision.action === "RESOLVE";

  return (
    <section
      className={`settlement reveal ${isResolved ? "settlement--resolve" : "settlement--escalate"}`}
      style={{ animationDelay: "0.25s" }}
    >
      <div className="section-label">Settlement Decision</div>

      {/* ── Main Status Card ── */}
      <div className="settlement__card">
        {/* Action badge: RESOLVE or ESCALATE */}
        <div className="settlement__action mono">
          <span className="settlement__action-dot" />
          {decision.action}
        </div>

        {/*
         * If resolved: show the winning verdict in large text.
         * If escalated: show "Escalated for Human Review" instead.
         */}
        {isResolved && decision.verdict ? (
          <div className="settlement__verdict serif">
            {decision.verdict}
          </div>
        ) : (
          <div className="settlement__escalated-text serif">
            Escalated for Human Review
          </div>
        )}

        {/* Reason text — explains the decision logic */}
        <p className="settlement__reason">{decision.reason}</p>

        {/* ── Metrics Row: margin, threshold, duration ── */}
        <div className="settlement__metrics">
          {/*
           * Margin: the absolute score difference between YES and NO.
           * This is the key number the confidence checker uses.
           */}
          <div className="settlement__metric">
            <span className="settlement__metric-label mono">Margin</span>
            <span className="settlement__metric-value mono">{decision.margin}</span>
          </div>

          {/*
           * Threshold: from the rubric. If margin > threshold and
           * no hallucinations, the market auto-resolves.
           */}
          <div className="settlement__metric">
            <span className="settlement__metric-label mono">Threshold</span>
            <span className="settlement__metric-value mono">{threshold}</span>
          </div>

          {/*
           * Margin vs threshold comparison.
           * Shows whether the margin alone would have been sufficient.
           */}
          <div className="settlement__metric">
            <span className="settlement__metric-label mono">Margin Check</span>
            <span className={`settlement__metric-value mono ${decision.margin >= threshold ? "metric--pass" : "metric--fail"}`}>
              {decision.margin >= threshold ? "PASS" : "FAIL"}
            </span>
          </div>

          {/* Trial execution time */}
          <div className="settlement__metric">
            <span className="settlement__metric-label mono">Duration</span>
            <span className="settlement__metric-value mono">{(durationMs / 1000).toFixed(1)}s</span>
          </div>
        </div>

        {/*
         * Etherscan link: optional. In production, this links to the
         * settle() or escalate() transaction on Sepolia. For the
         * hackathon demo, it shows where the link would appear.
         */}
        {txHash && (
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="settlement__tx-link mono"
          >
            View on Etherscan: {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        )}
      </div>
    </section>
  );
}
