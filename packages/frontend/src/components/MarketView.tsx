import { useState } from "react";
import type { MarketData } from "../hooks/useContract";
import "./MarketView.css";

interface MarketViewProps {
  market: MarketData;
  account: string | null;
  userPosition: { yes: string; no: string } | null;
  isOwner: boolean;
  ethUsdPrice: string | null;
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
 * Status → Available Actions:
 *   Open (before deadline)  → Stake YES / Stake NO
 *   Open (past deadline)    → Request Settlement
 *   SettlementRequested     → Run Trial (owner/admin)
 *   Resolved (winner)       → Claim Winnings
 *   Resolved (loser)        → "Market resolved against your position"
 *   Escalated               → Claim Refund
 */
export function MarketView({
  market,
  account,
  userPosition,
  isOwner,
  ethUsdPrice,
  onStakeYes,
  onStakeNo,
  onRequestSettlement,
  onRunTrial,
  onClaimWinnings,
  onClaimRefund,
}: MarketViewProps) {
  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /* Pool percentage calculation for the split bar */
  const yesNum = parseFloat(market.yesPool);
  const noNum = parseFloat(market.noPool);
  const total = yesNum + noNum;
  const yesPct = total > 0 ? (yesNum / total) * 100 : 0;

  /* Convert ETH to USD for display */
  const priceNum = ethUsdPrice ? parseFloat(ethUsdPrice) : 0;
  const toUsd = (eth: string) => {
    if (!priceNum) return "";
    const val = parseFloat(eth) * priceNum;
    return val > 0 ? ` (~$${val.toFixed(2)})` : "";
  };

  /* Deadline check */
  const isPastDeadline = market.deadline.getTime() < Date.now();

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
   * Wrap async action calls with loading state + error display.
   * Extracts revert reasons from contract errors and shows them to users.
   */
  const handleAction = async (action: () => Promise<unknown>) => {
    setActionLoading(true);
    setActionError(null);
    setTxHash(null);
    try {
      const result = await action();
      /* Extract tx hash if the result is a transaction */
      if (result && typeof result === "object" && "hash" in result) {
        setTxHash((result as { hash: string }).hash);
      }
    } catch (err: unknown) {
      let message = "Transaction failed";
      if (err instanceof Error) {
        /* Extract revert reason from contract errors */
        const revertMatch = err.message.match(/reason="([^"]+)"/);
        if (revertMatch) {
          message = revertMatch[1];
        } else if (err.message.includes("user rejected")) {
          message = "Transaction rejected by wallet";
        } else if (err.message.includes("insufficient funds")) {
          message = "Insufficient ETH balance";
        } else {
          message = err.message.length > 120 ? err.message.slice(0, 120) + "..." : err.message;
        }
      }
      setActionError(message);
      console.error("Action failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  /* Check if the user has any position */
  const hasYesPosition = userPosition && parseFloat(userPosition.yes) > 0;
  const hasNoPosition = userPosition && parseFloat(userPosition.no) > 0;

  /* Determine if user won or lost */
  const userWon =
    market.status === "Resolved" &&
    ((market.outcome === "Yes" && hasYesPosition) ||
     (market.outcome === "No" && hasNoPosition));

  const userLost =
    market.status === "Resolved" &&
    (hasYesPosition || hasNoPosition) &&
    !userWon;

  /* Calculate expected payout for winners */
  const getExpectedPayout = () => {
    if (!userWon || !userPosition) return null;
    const userStake = market.outcome === "Yes"
      ? parseFloat(userPosition.yes)
      : parseFloat(userPosition.no);
    const winnerPool = market.outcome === "Yes" ? yesNum : noNum;
    if (winnerPool <= 0) return null;
    const payout = (userStake / winnerPool) * total;
    const profit = payout - userStake;
    return { payout, profit };
  };

  const payoutInfo = getExpectedPayout();

  return (
    <section className="market-view reveal">
      <div className="section-label">Case Detail</div>

      {/* Header: question + status badge */}
      <div className="market-view__header">
        <h2 className="market-view__question serif">{market.question}</h2>
        <span className={`market-view__status ${statusClass}`}>{statusLabel}</span>
      </div>

      {/* Pool split bar */}
      <div className="market-view__pools">
        <div className="pool-labels">
          <span className="pool-label pool-label--yes mono">
            YES {market.yesPool} ETH{toUsd(market.yesPool)} {total > 0 && `(${yesPct.toFixed(0)}%)`}
          </span>
          <span className="pool-label pool-label--no mono">
            NO {market.noPool} ETH{toUsd(market.noPool)} {total > 0 && `(${(100 - yesPct).toFixed(0)}%)`}
          </span>
        </div>
        <div className="pool-bar">
          <div className="pool-bar__yes" style={{ width: `${yesPct}%` }} />
          <div className="pool-bar__no" style={{ width: `${100 - yesPct}%` }} />
        </div>
        <div className="pool-total mono">
          Total Pool: {total.toFixed(4)} ETH{toUsd(total.toString())}
        </div>
      </div>

      {/* User's position */}
      {account && userPosition && (hasYesPosition || hasNoPosition) && (
        <div className="market-view__position">
          <div className="section-label">Your Position</div>
          <div className="market-view__position-row">
            {hasYesPosition && (
              <span className="market-view__position-badge market-view__position-badge--yes mono">
                YES: {userPosition.yes} ETH{toUsd(userPosition.yes)}
              </span>
            )}
            {hasNoPosition && (
              <span className="market-view__position-badge market-view__position-badge--no mono">
                NO: {userPosition.no} ETH{toUsd(userPosition.no)}
              </span>
            )}
          </div>

          {/* Payout info for winners */}
          {userWon && payoutInfo && (
            <div className="market-view__payout market-view__payout--win">
              <span className="market-view__payout-icon">&#10003;</span>
              <div>
                <strong>You won!</strong> Claimable: {payoutInfo.payout.toFixed(4)} ETH{toUsd(payoutInfo.payout.toString())}
                <span className="market-view__payout-profit mono">
                  +{payoutInfo.profit.toFixed(4)} ETH profit
                </span>
              </div>
            </div>
          )}

          {/* Loss message */}
          {userLost && (
            <div className="market-view__payout market-view__payout--loss">
              <span className="market-view__payout-icon">&#10007;</span>
              <div>
                Market resolved as <strong>{market.outcome}</strong> — your stake was on the losing side.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Meta info row */}
      <div className="market-view__meta-row">
        <span className="meta-item mono">Deadline: {deadlineStr}</span>
        <span className="meta-item mono">
          Outcome: {market.outcome === "None" ? "Pending" : market.outcome}
        </span>
        <span className="meta-item mono">Creator: {market.creator.slice(0, 6)}...{market.creator.slice(-4)}</span>
      </div>

      {/* ── Error Display ── */}
      {actionError && (
        <div className="market-view__error mono">
          <span className="market-view__error-icon">&#9888;</span>
          {actionError}
          <button className="market-view__error-dismiss" onClick={() => setActionError(null)}>&#10005;</button>
        </div>
      )}

      {/* ── TX Hash Link ── */}
      {txHash && (
        <div className="market-view__tx-success mono">
          <span className="market-view__tx-icon">&#10003;</span>
          Transaction confirmed —{" "}
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="market-view__tx-link"
          >
            View on Etherscan: {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        </div>
      )}

      {/* ── Action Zone ── */}
      <div className="market-view__actions">
        {/* OPEN + BEFORE DEADLINE → Staking form */}
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

        {/* OPEN + PAST DEADLINE → auto-settlement in progress */}
        {market.status === "Open" && isPastDeadline && (
          <div className="market-view__auto-status mono">
            <span className="run-trial-btn__spinner" />
            Deadline passed — settlement will trigger automatically...
          </div>
        )}

        {/* SETTLEMENT REQUESTED → trial running automatically */}
        {market.status === "SettlementRequested" && (
          <div className="market-view__auto-status mono">
            <span className="run-trial-btn__spinner" />
            Adversarial trial running — advocates debating, judge scoring...
          </div>
        )}

        {/* RESOLVED + WINNER → Claim Winnings */}
        {market.status === "Resolved" && account && userWon && (
          <button
            className="run-trial-btn market-view__claim-btn"
            disabled={actionLoading}
            onClick={() => handleAction(() => onClaimWinnings(market.id))}
          >
            {actionLoading ? "Claiming..." : `Claim ${payoutInfo ? payoutInfo.payout.toFixed(4) + " ETH" : "Winnings"}`}
          </button>
        )}

        {/* ESCALATED → Claim Refund */}
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
