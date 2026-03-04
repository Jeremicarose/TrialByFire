import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./hooks/useWallet";
import { useContract } from "./hooks/useContract";
import { HowItWorks } from "./components/HowItWorks";
import { CreateMarket } from "./components/CreateMarket";
import { MarketList } from "./components/MarketList";
import { MarketView } from "./components/MarketView";
import { ParticipantList } from "./components/ParticipantList";
import { TrialTranscript } from "./components/TrialTranscript";
import { JudgeScorecard } from "./components/JudgeScorecard";
import { SettlementStatus } from "./components/SettlementStatus";
import type { Participant } from "./hooks/useContract";
import type { TrialTranscript as TrialTranscriptType } from "./types";
import "./App.css";

/*
 * App — Root component that wires wallet, contract, and UI together.
 *
 * Layout:
 *   Header (branding + wallet button)
 *   HowItWorks (hero explainer)
 *   CreateMarket form (anyone with a wallet — 0.01 ETH deposit)
 *   MarketList (card grid of all filed cases)
 *   MarketView (detail panel for selected case + staking)
 *   TrialTranscript (adversarial debate — appears after trial runs)
 *   JudgeScorecard (per-criterion scores — appears after trial runs)
 *   SettlementStatus (final verdict — appears after trial runs)
 *   ParticipantList (all stakers + potential payouts)
 */
export default function App() {
  const { account, isOwner, isConnected, connect, provider, signer, error: walletError } = useWallet();
  const {
    markets,
    loading,
    ethUsdPrice,
    createMarket,
    takePosition,
    claimWinnings,
    claimRefund,
    getUserPosition,
    getMarketParticipants,
  } = useContract(provider, signer);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [userPosition, setUserPosition] = useState<{ yes: string; no: string } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [transcript, setTranscript] = useState<TrialTranscriptType | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  /* Auto-select the first market when data loads */
  useEffect(() => {
    if (markets.length > 0 && selectedId === null) {
      setSelectedId(markets[0].id);
    }
  }, [markets, selectedId]);

  /*
   * Load user's position and all participants when:
   *   - Selected market changes
   *   - Account changes (wallet switch)
   *   - Markets refresh (after staking, settlement, etc.)
   *   - Provider changes (new wallet connection creates fresh provider)
   */
  useEffect(() => {
    if (selectedId !== null && account) {
      getUserPosition(selectedId, account).then(setUserPosition);
    } else {
      setUserPosition(null);
    }
    if (selectedId !== null) {
      getMarketParticipants(selectedId).then(setParticipants);
    } else {
      setParticipants([]);
    }
  }, [selectedId, account, provider, getUserPosition, getMarketParticipants, markets]);

  /*
   * Fetch trial transcript from the API server when a settled market is selected.
   * The transcript persists on the server after auto-settlement, so users
   * can always see the full debate, judge scores, and verdict reasoning.
   */
  useEffect(() => {
    if (selectedId === null) {
      setTranscript(null);
      return;
    }

    const market = markets.find((m) => m.id === selectedId);
    if (!market || (market.status !== "Resolved" && market.status !== "Escalated")) {
      setTranscript(null);
      return;
    }

    setTranscriptLoading(true);
    fetch(`/api/transcript/${selectedId}`)
      .then((res) => {
        if (!res.ok) throw new Error("No transcript");
        return res.json();
      })
      .then((data) => setTranscript(data.transcript))
      .catch(() => setTranscript(null))
      .finally(() => setTranscriptLoading(false));
  }, [selectedId, markets]);

  /* Handle market creation with loading state */
  const handleCreateMarket = useCallback(
    async (question: string, rubricHash: string, deadline: number) => {
      setCreateLoading(true);
      try {
        await createMarket(question, rubricHash, deadline);
      } finally {
        setCreateLoading(false);
      }
    },
    [createMarket]
  );

  /* Find the currently selected market object */
  const selectedMarket = markets.find((m) => m.id === selectedId) || null;

  /* Truncated wallet address for display */
  const truncatedAddress = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : null;

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header__row">
          <div>
            <p className="app-header__eyebrow">Adversarial Resolution Protocol</p>
            <h1 className="app-header__title">TrialByFire</h1>
          </div>

          <div className="app-header__wallet">
            {ethUsdPrice && (
              <span className="app-header__price mono">
                ETH ${ethUsdPrice}
              </span>
            )}
            {isConnected ? (
              <div className="app-header__account">
                {isOwner && <span className="app-header__owner-badge mono">Admin</span>}
                <span className="app-header__address mono">{truncatedAddress}</span>
              </div>
            ) : (
              <button className="app-header__connect-btn" onClick={connect}>
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        <p className="app-header__subtitle">
          Subjective prediction markets resolved by adversarial AI debate,
          scored against transparent rubrics, settled onchain.
        </p>

        {walletError && (
          <div className="app-header__error mono">{walletError}</div>
        )}
      </header>

      {/* ── How It Works (hero explainer for new visitors) ── */}
      <HowItWorks />

      {/* ── Create Market Form ── */}
      {isConnected && (
        <CreateMarket onSubmit={handleCreateMarket} isLoading={createLoading} />
      )}

      {/* ── Market List (Case Docket) ── */}
      <MarketList
        markets={markets}
        selectedId={selectedId}
        onSelect={setSelectedId}
        loading={loading}
        ethUsdPrice={ethUsdPrice}
      />

      {/* ── Selected Market Detail ── */}
      {selectedMarket && (
        <MarketView
          market={selectedMarket}
          account={account}
          userPosition={userPosition}
          ethUsdPrice={ethUsdPrice}
          onStakeYes={(id, amount) => takePosition(id, 1, amount)}
          onStakeNo={(id, amount) => takePosition(id, 2, amount)}
          onClaimWinnings={claimWinnings}
          onClaimRefund={claimRefund}
        />
      )}

      {/* ── Trial Results (appears after trial completes) ── */}
      {selectedMarket && (selectedMarket.status === "Resolved" || selectedMarket.status === "Escalated") && (
        <>
          {transcriptLoading && (
            <div className="trial-loading mono">
              <span className="run-trial-btn__spinner" />
              Loading trial results...
            </div>
          )}

          {transcript && (
            <>
              {/* Adversarial Debate — YES vs NO side by side */}
              <TrialTranscript
                advocateYes={transcript.advocateYes}
                advocateNo={transcript.advocateNo}
              />

              {/* Judge Scorecard — per-criterion scores + ruling */}
              <JudgeScorecard ruling={transcript.judgeRuling} />

              {/* Settlement Decision — RESOLVE or ESCALATE with reasoning */}
              <SettlementStatus
                decision={transcript.decision}
                threshold={transcript.question.rubric.confidenceThreshold}
                durationMs={transcript.durationMs}
                txHash={(transcript as unknown as Record<string, unknown>).txHash as string | undefined}
              />
            </>
          )}

          {!transcriptLoading && !transcript && (
            <div className="trial-loading mono">
              Trial results not available (server may have restarted).
            </div>
          )}
        </>
      )}

      {/* ── Participant List ── */}
      {selectedMarket && participants.length > 0 && (
        <ParticipantList
          participants={participants}
          account={account}
          ethUsdPrice={ethUsdPrice}
          marketOutcome={selectedMarket.outcome}
          marketStatus={selectedMarket.status}
        />
      )}
    </div>
  );
}
