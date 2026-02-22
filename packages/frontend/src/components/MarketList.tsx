import { useState, useEffect } from "react";
import type { MarketData } from "../hooks/useContract";
import "./MarketList.css";

interface MarketListProps {
  markets: MarketData[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}

/*
 * Status string → CSS modifier class mapping.
 * Each status gets a distinct color treatment so the
 * docket reads at a glance — green for open, amber for
 * pending settlement, blue for resolved, red for escalated.
 */
const STATUS_CLASS: Record<string, string> = {
  Open: "market-card__status--open",
  SettlementRequested: "market-card__status--settlement",
  Resolved: "market-card__status--resolved",
  Escalated: "market-card__status--escalated",
};

const STATUS_LABEL: Record<string, string> = {
  Open: "Open",
  SettlementRequested: "In Trial",
  Resolved: "Resolved",
  Escalated: "Escalated",
};

/**
 * Format a deadline Date into a human-readable countdown string.
 * Returns "Expired" if past, otherwise "Xd Xh" or "Xh Xm" etc.
 */
function formatCountdown(deadline: Date): { text: string; expired: boolean } {
  const now = Date.now();
  const diff = deadline.getTime() - now;

  if (diff <= 0) return { text: "Expired", expired: true };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return { text: `${days}d ${hours}h`, expired: false };
  if (hours > 0) return { text: `${hours}h ${minutes}m`, expired: false };
  return { text: `${minutes}m`, expired: false };
}

export function MarketList({ markets, selectedId, onSelect, loading }: MarketListProps) {
  /*
   * Force re-render every 60 seconds to update countdown timers.
   * Without this, "2h 15m" would stay frozen until the component
   * re-renders for another reason (like a new market being created).
   */
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading && markets.length === 0) {
    return (
      <div className="market-list">
        <div className="market-list__loading">
          <div className="market-list__loading-spinner" />
          Loading docket...
        </div>
      </div>
    );
  }

  return (
    <div className="market-list">
      <div className="market-list__header">
        <h2 className="market-list__title">Case Docket</h2>
        <span className="market-list__count">
          {markets.length} {markets.length === 1 ? "case" : "cases"} filed
        </span>
      </div>

      <div className="market-list__grid">
        {markets.length === 0 ? (
          <div className="market-list__empty">
            No markets filed yet. Create the first case above.
          </div>
        ) : (
          markets.map((m) => {
            const yesNum = parseFloat(m.yesPool);
            const noNum = parseFloat(m.noPool);
            const total = yesNum + noNum;
            const yesPct = total > 0 ? (yesNum / total) * 100 : 50;
            const countdown = formatCountdown(m.deadline);

            return (
              <div
                key={m.id}
                className={`market-card${selectedId === m.id ? " market-card--selected" : ""}`}
                onClick={() => onSelect(m.id)}
              >
                {/* Top row: case number + status badge */}
                <div className="market-card__top">
                  <span className="market-card__id">Case #{m.id}</span>
                  <span className={`market-card__status ${STATUS_CLASS[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>

                {/* Question text — clamped to 3 lines */}
                <div className="market-card__question">{m.question}</div>

                {/* Miniature pool bar */}
                <div className="market-card__pools">
                  <div className="market-card__pool-labels">
                    <span className="market-card__pool-label market-card__pool-label--yes">
                      YES {m.yesPool} ETH
                    </span>
                    <span className="market-card__pool-label market-card__pool-label--no">
                      NO {m.noPool} ETH
                    </span>
                  </div>
                  <div className="market-card__pool-bar">
                    <div className="market-card__pool-yes" style={{ width: `${yesPct}%` }} />
                    <div className="market-card__pool-no" style={{ width: `${100 - yesPct}%` }} />
                  </div>
                  {total > 0 && (
                    <div className="market-card__pool-total">
                      {total.toFixed(4)} ETH total
                    </div>
                  )}
                </div>

                {/* Deadline countdown */}
                <div className={`market-card__deadline${countdown.expired ? " market-card__deadline--expired" : ""}`}>
                  <span className="market-card__deadline-icon">&#9719;</span>
                  {countdown.expired ? "Deadline passed" : `${countdown.text} remaining`}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
