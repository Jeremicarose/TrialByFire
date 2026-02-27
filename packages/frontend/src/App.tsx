import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./hooks/useWallet";
import { useContract } from "./hooks/useContract";
import { CreateMarket } from "./components/CreateMarket";
import { MarketList } from "./components/MarketList";
import { MarketView } from "./components/MarketView";
import { TrialTranscript } from "./components/TrialTranscript";
import { JudgeScorecard } from "./components/JudgeScorecard";
import { SettlementStatus } from "./components/SettlementStatus";
import "./App.css";

/*
 * App — Root component that wires wallet, contract, and UI together.
 *
 * Architecture:
 *   useWallet()   → MetaMask connection, account, signer, isOwner
 *   useContract() → All contract reads/writes, market data, trial results
 *
 * Layout:
 *   Header (branding + wallet button)
 *   CreateMarket form (anyone with a wallet — 0.01 ETH deposit)
 *   MarketList (card grid of all filed cases)
 *   MarketView (detail panel for selected case + staking)
 *   TrialTranscript (adversarial debate — appears after trial runs)
 *   JudgeScorecard (per-criterion scores — appears after trial runs)
 *   SettlementStatus (final verdict — appears after trial runs)
 */
export default function App() {
  const { account, isOwner, isConnected, connect, provider, signer, error: walletError } = useWallet();
  const {
    markets,
    loading,
    ethUsdPrice,
    trialResult,
    trialLoading,
    createMarket,
    takePosition,
    requestSettlement,
    sendTrialRequest,
    runLocalTrial,
    claimWinnings,
    claimRefund,
    getUserPosition,
  } = useContract(provider, signer);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [userPosition, setUserPosition] = useState<{ yes: string; no: string } | null>(null);

  /* Auto-select the first market when data loads */
  useEffect(() => {
    if (markets.length > 0 && selectedId === null) {
      setSelectedId(markets[0].id);
    }
  }, [markets, selectedId]);

  /* Load user's position when selected market or account changes */
  useEffect(() => {
    if (selectedId !== null && account) {
      getUserPosition(selectedId, account).then(setUserPosition);
    } else {
      setUserPosition(null);
    }
  }, [selectedId, account, getUserPosition, markets]);

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

  /*
   * Handle "Run Trial" — two paths depending on environment:
   *
   * 1. LOCAL (Hardhat): Calls the engine API server which runs the
   *    full pipeline server-side, then settles via the deployer key.
   *    This is because Chainlink DON doesn't exist on local Hardhat.
   *
   * 2. SEPOLIA: Calls sendTrialRequest() on the contract, which
   *    sends a Chainlink Functions request to the DON. The DON runs
   *    the trial and calls fulfillRequest() to settle onchain.
   *
   * We detect the environment by trying the API first. If /api/health
   * isn't reachable, fall back to the onchain path.
   */
  const handleRunTrial = useCallback(
    async (marketId: number) => {
      const market = markets.find((m) => m.id === marketId);
      if (!market) return;

      try {
        /* Try local API first (works on Hardhat) */
        const health = await fetch("/api/health").catch(() => null);
        if (health?.ok) {
          await runLocalTrial(marketId, market.question);
        } else {
          /* Fallback: Chainlink Functions on Sepolia */
          await sendTrialRequest(marketId);
        }
      } catch (err) {
        console.error("Trial failed:", err);
      }
    },
    [markets, runLocalTrial, sendTrialRequest]
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

      {/* ── Create Market Form ── */}
      {isConnected && (
        <CreateMarket onSubmit={handleCreateMarket} isLoading={createLoading} />
      )}

      {/* ── Trial Progress Indicator ── */}
      {trialLoading && (
        <div className="stage-indicator stage-indicator--evidence">
          <span className="stage-indicator__dot" />
          <span>Running adversarial trial — advocates debating, judge scoring...</span>
        </div>
      )}

      {/* ── Market List (Case Docket) ── */}
      <MarketList
        markets={markets}
        selectedId={selectedId}
        onSelect={setSelectedId}
        loading={loading}
      />

      {/* ── Selected Market Detail ── */}
      {selectedMarket && (
        <MarketView
          market={selectedMarket}
          account={account}
          userPosition={userPosition}
          isOwner={isOwner}
          onStakeYes={(id, amount) => takePosition(id, 1, amount)}
          onStakeNo={(id, amount) => takePosition(id, 2, amount)}
          onRequestSettlement={requestSettlement}
          onRunTrial={handleRunTrial}
          onClaimWinnings={claimWinnings}
          onClaimRefund={claimRefund}
        />
      )}

      {/*
       * ── Trial Results Section ──
       * These three components only render after a trial completes.
       * They display the full adversarial debate, judge scorecard,
       * and final settlement decision — the core of TrialByFire.
       *
       * The trialResult comes from the local API server (on Hardhat)
       * or would be fetched from IPFS after Chainlink Functions
       * fulfillment (on Sepolia).
       */}
      {trialResult && trialResult.advocateYes && trialResult.advocateNo && (
        <TrialTranscript
          advocateYes={trialResult.advocateYes}
          advocateNo={trialResult.advocateNo}
        />
      )}

      {trialResult && trialResult.judgeRuling && (
        <JudgeScorecard ruling={trialResult.judgeRuling} />
      )}

      {trialResult && trialResult.decision && (
        <SettlementStatus
          decision={trialResult.decision}
          threshold={20}
          durationMs={trialResult.durationMs || 0}
          txHash={trialResult.txHash}
        />
      )}
    </div>
  );
}
