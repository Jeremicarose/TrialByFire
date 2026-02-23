import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./hooks/useWallet";
import { useContract } from "./hooks/useContract";
import { CreateMarket } from "./components/CreateMarket";
import { MarketList } from "./components/MarketList";
import { MarketView } from "./components/MarketView";
import "./App.css";

/*
 * App — Root component that wires wallet, contract, and UI together.
 *
 * Architecture:
 *   useWallet()   → MetaMask connection, account, signer, isOwner
 *   useContract() → All contract reads/writes, market data, events
 *
 * Layout:
 *   Header (branding + wallet button)
 *   CreateMarket form (visible to anyone — 0.01 ETH deposit required)
 *   MarketList (card grid of all filed cases)
 *   MarketView (detail panel for selected case)
 *
 * The app listens for contract events (MarketCreated, MarketResolved,
 * etc.) via useContract's event listeners, so the UI updates
 * automatically when other users interact with the contract.
 */
export default function App() {
  const { account, isOwner, isConnected, connect, provider, signer, error: walletError } = useWallet();
  const {
    markets,
    loading,
    ethUsdPrice,
    createMarket,
    takePosition,
    requestSettlement,
    sendTrialRequest,
    claimWinnings,
    claimRefund,
    getUserPosition,
  } = useContract(provider, signer);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [userPosition, setUserPosition] = useState<{ yes: string; no: string } | null>(null);

  /*
   * Auto-select the first market when data loads.
   * Only fires once (when markets go from empty to populated).
   */
  useEffect(() => {
    if (markets.length > 0 && selectedId === null) {
      setSelectedId(markets[0].id);
    }
  }, [markets, selectedId]);

  /*
   * Load the user's position whenever the selected market
   * or account changes. This shows "Your Position: YES 0.5 ETH"
   * inside the MarketView component.
   */
  useEffect(() => {
    if (selectedId !== null && account) {
      getUserPosition(selectedId, account).then(setUserPosition);
    } else {
      setUserPosition(null);
    }
  }, [selectedId, account, getUserPosition, markets]);

  /*
   * Handle market creation.
   * Wraps the contract call with loading state so the
   * CreateMarket component can show a spinner.
   */
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

  /*
   * Truncate wallet address for display.
   * 0x1234...abcd format — enough to identify, not enough to confuse.
   */
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
          onRunTrial={sendTrialRequest}
          onClaimWinnings={claimWinnings}
          onClaimRefund={claimRefund}
        />
      )}
    </div>
  );
}
