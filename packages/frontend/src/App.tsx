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
   * Fetch trial transcript when a settled market is selected.
   *
   * Priority:
   *   1. IPFS (via Pinata/public gateways) — decentralized, permanent
   *   2. Local API server fallback — for dev or if IPFS upload failed
   *
   * The DON uploads the full transcript to IPFS during trial execution.
   * The CID is stored onchain in transcriptCidA/CidB fields.
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

    const fetchTranscript = async () => {
      /* Try IPFS first if CID is available */
      if (market.transcriptCid) {
        const gateways = [
          `https://gateway.pinata.cloud/ipfs/${market.transcriptCid}`,
          `https://ipfs.io/ipfs/${market.transcriptCid}`,
          `https://cloudflare-ipfs.com/ipfs/${market.transcriptCid}`,
        ];

        for (const url of gateways) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              const donData = await res.json();
              /* Transform DON transcript format to frontend TrialTranscript type */
              setTranscript({
                question: {
                  id: `market-${market.id}`,
                  question: market.question,
                  rubric: {
                    criteria: [
                      { name: "Data accuracy", description: "Are the cited numbers verifiable?", weight: 30 },
                      { name: "Time period coverage", description: "Does evidence cover the full period?", weight: 25 },
                      { name: "Source diversity", description: "Are multiple independent sources used?", weight: 20 },
                      { name: "Logical coherence", description: "Is the argument internally consistent?", weight: 25 },
                    ],
                    evidenceSources: [donData.category || "dynamic"],
                    confidenceThreshold: 20,
                  },
                  settlementDeadline: market.deadline,
                },
                evidence: {
                  questionId: `market-${market.id}`,
                  items: [{ source: "don", title: "DON Evidence", content: donData.evidence || "", retrievedAt: new Date(donData.executedAt) }],
                  gatheredAt: new Date(donData.executedAt),
                },
                advocateYes: { ...donData.advocateYes, model: "claude-sonnet-4-20250514" },
                advocateNo: { ...donData.advocateNo, model: "gpt-4o" },
                judgeRuling: { ...donData.judgeRuling, model: "claude-sonnet-4-20250514" },
                decision: donData.decision,
                executedAt: new Date(donData.executedAt),
                durationMs: 0,
              } as TrialTranscriptType);
              return;
            }
          } catch {
            /* Try next gateway */
          }
        }
      }

      /* Fallback: local API server */
      try {
        const res = await fetch(`/api/transcript/${selectedId}`);
        if (res.ok) {
          const data = await res.json();
          setTranscript(data.transcript);
          return;
        }
      } catch {
        /* No transcript available */
      }

      setTranscript(null);
    };

    fetchTranscript().finally(() => setTranscriptLoading(false));
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
