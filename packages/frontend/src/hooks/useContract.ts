import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";

/**
 * useContract — Reads and writes TrialMarket contract state.
 *
 * This hook provides all contract interactions the frontend needs:
 *
 * READ operations (free, no gas):
 *   - getAllMarkets()      — Fetch all markets from the contract
 *   - getMarket(id)       — Fetch a single market
 *   - getEthUsdPrice()    — Read Chainlink Data Feed price
 *
 * WRITE operations (require gas + wallet signature):
 *   - createMarket()      — Create a new prediction market (0.01 ETH deposit)
 *   - takePosition()      — Stake ETH on YES or NO
 *   - requestSettlement() — Trigger settlement after deadline
 *   - sendTrialRequest()  — Trigger Chainlink Functions trial
 *   - claimWinnings()     — Withdraw winnings from resolved market
 *   - claimRefund()       — Withdraw refund from escalated market
 *
 * EVENT listeners:
 *   - Listens for MarketCreated, MarketResolved, MarketEscalated events
 *   - Auto-refreshes market list when events fire
 *
 * Architecture:
 *   We create TWO contract instances:
 *     1. readContract — connected to provider (read-only, no wallet needed)
 *     2. writeContract — connected to signer (can send transactions)
 *   This separation ensures we can display data even when no wallet is connected.
 */

/*
 * Contract address from Vite environment variables.
 * Set via VITE_CONTRACT_ADDRESS in .env or at build time.
 */
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

/*
 * ABI for all functions we call from the frontend.
 * This is a minimal "human-readable ABI" — ethers.js parses these
 * strings into full ABI objects. Much cleaner than importing the
 * entire compiled artifact.
 *
 * We include:
 *   - All view functions (getMarket, nextMarketId, positions, price)
 *   - All write functions (createMarket, takePosition, etc.)
 *   - All events we listen for
 */
const CONTRACT_ABI = [
  // View functions
  "function getMarket(uint256 marketId) view returns (tuple(string question, string rubricHash, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, bytes32 transcriptHash, address creator, uint256 creationDeposit))",
  "function nextMarketId() view returns (uint256)",
  "function yesPositions(uint256 marketId, address user) view returns (uint256)",
  "function noPositions(uint256 marketId, address user) view returns (uint256)",
  "function getLatestEthUsdPrice() view returns (int256 price, uint256 updatedAt)",
  "function owner() view returns (address)",

  // Write functions
  "function createMarket(string question, string rubricHash, uint256 deadline) payable returns (uint256)",
  "function takePosition(uint256 marketId, uint8 side) payable",
  "function requestSettlement(uint256 marketId)",
  "function sendTrialRequest(uint256 marketId) returns (bytes32)",
  "function settle(uint256 marketId, uint8 outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash)",
  "function escalate(uint256 marketId, bytes32 transcriptHash)",
  "function claimWinnings(uint256 marketId)",
  "function claimRefund(uint256 marketId)",
  "function claimCreationDeposit(uint256 marketId)",

  // Events
  "event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 deadline)",
  "event PositionTaken(uint256 indexed marketId, address indexed participant, uint8 side, uint256 amount)",
  "event SettlementRequested(uint256 indexed marketId, uint256 timestamp)",
  "event TrialRequested(uint256 indexed marketId, bytes32 indexed requestId)",
  "event MarketResolved(uint256 indexed marketId, uint8 outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash)",
  "event MarketEscalated(uint256 indexed marketId, bytes32 transcriptHash)",
];

/**
 * Market data as returned from the contract, with parsed fields.
 * The raw contract returns numeric enums; we convert to strings
 * for easier use in React components.
 */
export interface MarketData {
  id: number;
  question: string;
  rubricHash: string;
  deadline: Date;
  status: "Open" | "SettlementRequested" | "Resolved" | "Escalated";
  outcome: "None" | "Yes" | "No";
  yesPool: string; // ETH as string (e.g. "1.5")
  noPool: string;
  transcriptHash: string;
  creator: string;
  creationDeposit: string;
}

/*
 * Map numeric enum values to human-readable strings.
 * These match the Solidity enum ordering in TrialMarket.sol.
 */
const STATUS_MAP: Record<number, MarketData["status"]> = {
  0: "Open",
  1: "SettlementRequested",
  2: "Resolved",
  3: "Escalated",
};

const VERDICT_MAP: Record<number, MarketData["outcome"]> = {
  0: "None",
  1: "Yes",
  2: "No",
};

/**
 * Parse raw contract market data into our frontend MarketData type.
 * The contract returns a tuple with numeric types; we convert
 * timestamps to Dates, wei to ETH strings, and enums to labels.
 */
function parseMarket(id: number, raw: ethers.Result): MarketData {
  return {
    id,
    question: raw.question,
    rubricHash: raw.rubricHash,
    deadline: new Date(Number(raw.deadline) * 1000),
    status: STATUS_MAP[Number(raw.status)] || "Open",
    outcome: VERDICT_MAP[Number(raw.outcome)] || "None",
    yesPool: ethers.formatEther(raw.yesPool),
    noPool: ethers.formatEther(raw.noPool),
    transcriptHash: raw.transcriptHash,
    creator: raw.creator,
    creationDeposit: ethers.formatEther(raw.creationDeposit),
  };
}

export function useContract(
  provider: ethers.BrowserProvider | null,
  signer: ethers.JsonRpcSigner | null
) {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(false);
  const [ethUsdPrice, setEthUsdPrice] = useState<string | null>(null);

  /**
   * Fetch all markets from the contract.
   *
   * Reads nextMarketId to know how many markets exist, then
   * loops through 0..nextMarketId-1 calling getMarket() on each.
   *
   * For a hackathon with <100 markets, this loop is fine.
   * In production, you'd use event indexing (The Graph) or
   * pagination to avoid O(n) RPC calls.
   */
  const loadMarkets = useCallback(async () => {
    if (!provider || !CONTRACT_ADDRESS) return;

    setLoading(true);
    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const count = await contract.nextMarketId();
      const total = Number(count);

      const loaded: MarketData[] = [];
      for (let i = 0; i < total; i++) {
        const raw = await contract.getMarket(i);
        loaded.push(parseMarket(i, raw));
      }

      setMarkets(loaded);
    } catch (err) {
      console.error("Failed to load markets:", err);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  /**
   * Fetch the ETH/USD price from Chainlink Data Feeds via the contract.
   * The contract calls the AggregatorV3Interface.latestRoundData()
   * and returns the price with 8 decimals.
   */
  const loadEthPrice = useCallback(async () => {
    if (!provider || !CONTRACT_ADDRESS) return;
    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const [price] = await contract.getLatestEthUsdPrice();
      const formatted = (Number(price) / 1e8).toFixed(2);
      setEthUsdPrice(formatted);
    } catch {
      // Price feed not available (e.g., local Hardhat without mock)
    }
  }, [provider]);

  // ── Write Operations ──────────────────────────────────────────

  /**
   * Create a new prediction market.
   * Sends 0.01 ETH as creation deposit (anti-spam).
   */
  const createMarket = useCallback(
    async (question: string, rubricHash: string, deadline: number) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createMarket(question, rubricHash, deadline, {
        value: ethers.parseEther("0.01"),
      });
      await tx.wait();
      await loadMarkets(); // Refresh market list
      return tx;
    },
    [signer, loadMarkets]
  );

  /**
   * Stake ETH on YES (side=1) or NO (side=2).
   * amount is in ETH (e.g. "0.5").
   */
  const takePosition = useCallback(
    async (marketId: number, side: 1 | 2, amount: string) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.takePosition(marketId, side, {
        value: ethers.parseEther(amount),
      });
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /** Request settlement after deadline (permissionless). */
  const requestSettlement = useCallback(
    async (marketId: number) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.requestSettlement(marketId);
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /** Trigger Chainlink Functions to run the adversarial trial. */
  const sendTrialRequest = useCallback(
    async (marketId: number) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.sendTrialRequest(marketId);
      await tx.wait();
      return tx;
    },
    [signer]
  );

  /** Owner-only: manually settle a market (fallback for local dev). */
  const settle = useCallback(
    async (
      marketId: number,
      outcome: 1 | 2,
      scoreYes: number,
      scoreNo: number,
      transcriptHash: string
    ) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.settle(marketId, outcome, scoreYes, scoreNo, transcriptHash);
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /** Owner-only: manually escalate a market. */
  const escalate = useCallback(
    async (marketId: number, transcriptHash: string) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.escalate(marketId, transcriptHash);
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /** Claim proportional winnings from a resolved market. */
  const claimWinnings = useCallback(
    async (marketId: number) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.claimWinnings(marketId);
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /** Claim full refund from an escalated market. */
  const claimRefund = useCallback(
    async (marketId: number) => {
      if (!signer) throw new Error("Wallet not connected");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.claimRefund(marketId);
      await tx.wait();
      await loadMarkets();
      return tx;
    },
    [signer, loadMarkets]
  );

  /**
   * Get the user's position in a market.
   * Returns { yes: "0.5", no: "0.0" } in ETH.
   */
  const getUserPosition = useCallback(
    async (marketId: number, userAddress: string) => {
      if (!provider || !CONTRACT_ADDRESS) return { yes: "0", no: "0" };
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const [yesPos, noPos] = await Promise.all([
        contract.yesPositions(marketId, userAddress),
        contract.noPositions(marketId, userAddress),
      ]);
      return {
        yes: ethers.formatEther(yesPos),
        no: ethers.formatEther(noPos),
      };
    },
    [provider]
  );

  // ── Event Listeners ───────────────────────────────────────────

  /*
   * Listen for contract events to auto-refresh the market list.
   * When a new market is created, a position is taken, or a market
   * is resolved/escalated, we reload all markets.
   *
   * This gives the UI a "live" feel without polling.
   */
  useEffect(() => {
    if (!provider || !CONTRACT_ADDRESS) return;

    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const refresh = () => {
      loadMarkets();
      loadEthPrice();
    };

    contract.on("MarketCreated", refresh);
    contract.on("MarketResolved", refresh);
    contract.on("MarketEscalated", refresh);
    contract.on("PositionTaken", refresh);

    // Initial load
    refresh();

    return () => {
      contract.removeAllListeners();
    };
  }, [provider, loadMarkets, loadEthPrice]);

  return {
    markets,
    loading,
    ethUsdPrice,
    loadMarkets,
    createMarket,
    takePosition,
    requestSettlement,
    sendTrialRequest,
    settle,
    escalate,
    claimWinnings,
    claimRefund,
    getUserPosition,
  };
}
