import type { Participant } from "../hooks/useContract";
import "./ParticipantList.css";

interface ParticipantListProps {
  participants: Participant[];
  account: string | null;
  ethUsdPrice: string | null;
  marketOutcome: "None" | "Yes" | "No";
  marketStatus: "Open" | "SettlementRequested" | "Resolved" | "Escalated";
}

/*
 * ParticipantList — Shows all stakers in a market with potential payouts.
 *
 * Displays a table with:
 *   - Truncated address (with "You" label for connected user)
 *   - YES and NO stake amounts
 *   - Potential payout under each outcome (green = profit, red = loss)
 *   - After resolution: highlights the actual outcome column
 */
export function ParticipantList({
  participants,
  account,
  ethUsdPrice,
  marketOutcome,
  marketStatus,
}: ParticipantListProps) {
  const priceNum = ethUsdPrice ? parseFloat(ethUsdPrice) : 0;
  const isResolved = marketStatus === "Resolved";

  if (participants.length === 0) return null;

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatPayout = (value: number) => {
    if (Math.abs(value) < 0.000001) return "—";
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(4)}`;
  };

  const formatUsd = (eth: number) => {
    if (!priceNum || Math.abs(eth) < 0.000001) return "";
    return `$${Math.abs(eth * priceNum).toFixed(2)}`;
  };

  return (
    <section className="participants reveal">
      <div className="section-label">
        Market Participants ({participants.length})
      </div>

      <div className="participants__table-wrap">
        <table className="participants__table">
          <thead>
            <tr>
              <th className="participants__th">Address</th>
              <th className="participants__th participants__th--yes">YES Stake</th>
              <th className="participants__th participants__th--no">NO Stake</th>
              <th className={`participants__th participants__th--payout ${isResolved && marketOutcome === "Yes" ? "participants__th--active" : ""}`}>
                If YES Wins
              </th>
              <th className={`participants__th participants__th--payout ${isResolved && marketOutcome === "No" ? "participants__th--active" : ""}`}>
                If NO Wins
              </th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const isYou = account?.toLowerCase() === p.address.toLowerCase();
              const yesStake = parseFloat(p.yesStake);
              const noStake = parseFloat(p.noStake);

              return (
                <tr
                  key={p.address}
                  className={`participants__row ${isYou ? "participants__row--you" : ""}`}
                >
                  <td className="participants__td participants__td--addr mono">
                    {truncate(p.address)}
                    {isYou && <span className="participants__you-badge">You</span>}
                  </td>
                  <td className="participants__td participants__td--yes mono">
                    {yesStake > 0 ? `${p.yesStake} ETH` : "—"}
                  </td>
                  <td className="participants__td participants__td--no mono">
                    {noStake > 0 ? `${p.noStake} ETH` : "—"}
                  </td>
                  <td className={`participants__td mono ${p.payoutIfYes >= 0 ? "participants__td--profit" : "participants__td--loss"} ${isResolved && marketOutcome === "Yes" ? "participants__td--actual" : ""}`}>
                    <span>{formatPayout(p.payoutIfYes)} ETH</span>
                    {formatUsd(p.payoutIfYes) && (
                      <span className="participants__usd">{formatUsd(p.payoutIfYes)}</span>
                    )}
                  </td>
                  <td className={`participants__td mono ${p.payoutIfNo >= 0 ? "participants__td--profit" : "participants__td--loss"} ${isResolved && marketOutcome === "No" ? "participants__td--actual" : ""}`}>
                    <span>{formatPayout(p.payoutIfNo)} ETH</span>
                    {formatUsd(p.payoutIfNo) && (
                      <span className="participants__usd">{formatUsd(p.payoutIfNo)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
