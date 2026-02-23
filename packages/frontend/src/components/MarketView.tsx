import { useState } from "react";
import type { MarketData } from "../hooks/useContract";
import "./MarketView.css";

interface MarketViewProps {
  market: MarketData;
  account: string | null;
  userPosition: { yes: string; no: string } | null;
  isOwner: boolean;
  onStakeYes: (marketId: number, amount: string) => Promise<unknown>;
  onStakeNo: (marketId: number, amount: string) => Promise<unknown>;
  onRequestSettlement: (marketId: number) => Promise<unknown>;
  onRunTrial: (marketId: number) => Promise<unknown>;
  onClaimWinnings: (marketId: number) => Promise<unknown>;
  onClaimRefund: (marketId: number) => Promise<unknown>;
}

/*
 * MarketView — Full detail view for a selected market.
 *
 * This is the "case file" that opens when you click a card
 * in the docket. Shows everything: question, pools, staking
 * form, and context-sensitive action buttons that change
 * based on market status and deadline.
 *
 * Status → Available Actions:
 *   Open (before deadline)  → Stake YES / Stake NO
 *   Open (past deadline)    → Request Settlement
 *   SettlementRequested     → Run Trial (owner/admin)
 *   Resolved                → Claim Winnings
 *   Escalated               → Claim Refund
 */
export function MarketView({
  market,
  account,
  userPosition,
  isOwner,
  onStakeYes,
  onStakeNo,
  onRequestSettlement,
  onRunTrial,
  onClaimWinnings,
  onClaimRefund,
}: MarketViewProps) {
  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [actionLoading, setActionLoading] = useState(false);

  /* Pool percentage calculation for the split bar */
  const yesNum = parseFloat(market.yesPool);
  const noNum = parseFloat(market.noPool);
  const total = yesNum + noNum;
  const yesPct = total > 0 ? (yesNum / total) * 100 : 50;

  /* Deadline check — determines which action buttons appear */
  const isPastDeadline = market.deadline.getTime() < Date.now();

  /* Format the deadline into a readable string */
  const deadlineStr = market.deadline.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  /* Status display configuration */
  const statusConfig: Record<string, { label: string; className: string }> = {
    Open: { label: "Open", className: "status--open" },
    SettlementRequested: { label: "Settlement In Progress", className: "status--pending" },
    Resolved: { label: "Resolved", className: "status--resolved" },
    Escalated: { label: "Escalated", className: "status--escalated" },
  };
  const { label: statusLabel, className: statusClass } = statusConfig[market.status];

  /*
   * Wrap async action calls with loading state.
   * Prevents double-clicks and gives visual feedback.
   */
  const handleAction = async (action: () => Promise<unknown>) => {
    setActionLoading(true);
    try {
      await action();
    } catch (err) {
      console.error("Action failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  /* Check if the user has any position in this market */
  const hasYesPosition = userPosition && parseFloat(userPosition.yes) > 0;
  const hasNoPosition = userPosition && parseFloat(userPosition.no) > 0;

  return (
    <section className="market-view reveal">
      <div className="section-label">Case Detail</div>

      {/* Header: question + status badge */}
      <div className="market-view__header">
        <h2 className="market-view__question serif">{market.question}</h2>
        <span className={`market-view__status ${statusClass}`}>{statusLabel}</span>
      </div>

      {/* Pool split bar — visual YES vs NO representation */}
      <div className="market-view__pools">
        <div className="pool-labels">
          <span className="pool-label pool-label--yes mono">YES {market.yesPool} ETH</span>
          <span className="pool-label pool-label--no mono">NO {market.noPool} ETH</span>
        </div>
        <div className="pool-bar">
          <div className="pool-bar__yes" style={{ width: `${yesPct}%` }} />
          <div className="pool-bar__no" style={{ width: `${100 - yesPct}%` }} />
        </div>
        <div className="pool-total mono">Total Pool: {total.toFixed(4)} ETH</div>
      </div>

      {/* User's position — only shown if they have a stake */}
      {account && userPosition && (hasYesPosition || hasNoPosition) && (
        <div className="market-view__position">
          <div className="section-label">Your Position</div>
          <div className="market-view__position-row">
            {hasYesPosition && (
              <span className="market-view__position-badge market-view__position-badge--yes mono">
                YES: {userPosition.yes} ETH
              </span>
            )}
            {hasNoPosition && (
              <span className="market-view__position-badge market-view__position-badge--no mono">
                NO: {userPosition.no} ETH
              </span>
            )}
          </div>
        </div>
      )}

      {/* Meta info row */}
      <div className="market-view__meta-row">
        <span className="meta-item mono">Deadline: {deadlineStr}</span>
        <span className="meta-item mono">Outcome: {market.outcome}</span>
        <span className="meta-item mono">Creator: {market.creator.slice(0, 6)}...{market.creator.slice(-4)}</span>
      </div>

      {/* ── Action Zone: changes based on market status ── */}
      <div className="market-view__actions">
        {/*
         * OPEN + BEFORE DEADLINE → Show staking form.
         * Users pick an amount and stake on YES or NO.
         */}
        {market.status === "Open" && !isPastDeadline && account && (
          <div className="market-view__stake-form">
            <label className="market-view__stake-label mono">Stake Amount (ETH)</label>
            <div className="market-view__stake-row">
              <input
                type="number"
                className="market-view__stake-input"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                min="0.001"
                step="0.01"
                placeholder="0.01"
              />
              <button
                className="market-view__stake-btn market-view__stake-btn--yes"
                disabled={actionLoading || !stakeAmount}
                onClick={() => handleAction(() => onStakeYes(market.id, stakeAmount))}
              >
                {actionLoading ? "..." : "Stake YES"}
              </button>
              <button
                className="market-view__stake-btn market-view__stake-btn--no"
                disabled={actionLoading || !stakeAmount}
                onClick={() => handleAction(() => onStakeNo(market.id, stakeAmount))}
              >
                {actionLoading ? "..." : "Stake NO"}
              </button>
            </div>
          </div>
        )}

        {/*
         * OPEN + PAST DEADLINE → "Request Settlement" button.
         * Anyone can call this — it's permissionless on the contract.
         * Transitions the market to SettlementRequested status.
         */}
        {market.status === "Open" && isPastDeadline && account && (
          <button
            className="run-trial-btn"
            disabled={actionLoading}
            onClick={() => handleAction(() => onRequestSettlement(market.id))}
          >
            {actionLoading ? (
              <>
                <span className="run-trial-btn__spinner" />
                Requesting...
              </>
            ) : (
              "Request Settlement"
            )}
          </button>
        )}

        {/*
         * SETTLEMENT REQUESTED → "Run Trial" button.
         * Triggers Chainlink Functions to execute the adversarial
         * trial on the DON. Owner-only for now (hackathon safety).
         */}
        {market.status === "SettlementRequested" && account && (
          <button
            className="run-trial-btn"
            disabled={actionLoading || (!isOwner)}
            onClick={() => handleAction(() => onRunTrial(market.id))}
            title={!isOwner ? "Only contract owner can trigger trials" : ""}
          >
            {actionLoading ? (
              <>
                <span className="run-trial-btn__spinner" />
                Trial in Progress...
              </>
            ) : (
              "Run Trial (Chainlink Functions)"
            )}
          </button>
        )}

        {/*
         * RESOLVED → "Claim Winnings" button.
         * Only shown if the user has a position on the winning side.
         */}
        {market.status === "Resolved" && account && (hasYesPosition || hasNoPosition) && (
          <button
            className="run-trial-btn market-view__claim-btn"
            disabled={actionLoading}
            onClick={() => handleAction(() => onClaimWinnings(market.id))}
          >
            {actionLoading ? "Claiming..." : "Claim Winnings"}
          </button>
        )}

        {/*
         * ESCALATED → "Claim Refund" button.
         * All stakers get their money back on escalation.
         */}
        {market.status === "Escalated" && account && (hasYesPosition || hasNoPosition) && (
          <button
            className="run-trial-btn market-view__refund-btn"
            disabled={actionLoading}
            onClick={() => handleAction(() => onClaimRefund(market.id))}
          >
            {actionLoading ? "Claiming..." : "Claim Refund"}
          </button>
        )}

        {/* Not connected prompt */}
        {!account && (
          <div className="market-view__connect-prompt mono">
            Connect wallet to interact with this market
          </div>
        )}
      </div>
    </section>
  );
}
