// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TrialMarket
 * @notice A subjective prediction market resolved by adversarial AI debate.
 *
 * Lifecycle:
 *   1. createMarket()      — Post a subjective question with rubric + deadline
 *   2. takePosition()      — Stake ETH on YES or NO
 *   3. requestSettlement() — After deadline, emit event to trigger CRE workflow
 *   4. settle() / escalate() — Engine writes verdict or escalates for human review
 *   5. claimWinnings()     — Winners withdraw proportional payouts
 *
 * Settlement is owner-gated (deployer = authorized settler for the hackathon).
 * In production, the owner would be the CRE Forwarder contract address,
 * ensuring only the decentralized oracle network can settle markets.
 *
 * The full trial transcript hash is stored onchain for auditability.
 */
contract TrialMarket is Ownable, ReentrancyGuard {

    // ── Types ────────────────────────────────────────────────────

    enum MarketStatus {
        Open,                // Accepting positions
        SettlementRequested, // Deadline passed, awaiting CRE workflow
        Resolved,            // Verdict delivered, winners can claim
        Escalated            // Too close / hallucinations — needs human review
    }

    enum Verdict {
        None,  // Default — no verdict yet
        Yes,
        No
    }

    struct Market {
        string question;        // The subjective question
        string rubricHash;      // IPFS hash or keccak of rubric JSON
        uint256 deadline;       // Unix timestamp — settlement available after this
        MarketStatus status;
        Verdict outcome;
        uint256 yesPool;        // Total ETH staked on YES
        uint256 noPool;         // Total ETH staked on NO
        bytes32 transcriptHash; // keccak256 of the full trial transcript JSON
    }

    // ── State ────────────────────────────────────────────────────

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;

    // marketId => user => amount staked
    mapping(uint256 => mapping(address => uint256)) public yesPositions;
    mapping(uint256 => mapping(address => uint256)) public noPositions;

    // ── Events ───────────────────────────────────────────────────
    // These events serve dual purpose:
    //   1. Frontend listens for UI updates
    //   2. CRE EVM Log Trigger can fire on SettlementRequested

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        uint256 deadline
    );

    event PositionTaken(
        uint256 indexed marketId,
        address indexed participant,
        Verdict side,
        uint256 amount
    );

    event SettlementRequested(
        uint256 indexed marketId,
        uint256 timestamp
    );

    event MarketResolved(
        uint256 indexed marketId,
        Verdict outcome,
        uint256 scoreYes,
        uint256 scoreNo,
        bytes32 transcriptHash
    );

    event MarketEscalated(
        uint256 indexed marketId,
        bytes32 transcriptHash
    );

    // ── Constructor ──────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Market Creation ──────────────────────────────────────────

    /**
     * @notice Create a new subjective prediction market.
     * @param question The subjective question to resolve
     * @param rubricHash IPFS hash or identifier for the resolution rubric
     * @param deadline Unix timestamp after which settlement can be requested
     * @return marketId The ID of the newly created market
     */
    function createMarket(
        string calldata question,
        string calldata rubricHash,
        uint256 deadline
    ) external returns (uint256 marketId) {
        require(deadline > block.timestamp, "Deadline must be in the future");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            question: question,
            rubricHash: rubricHash,
            deadline: deadline,
            status: MarketStatus.Open,
            outcome: Verdict.None,
            yesPool: 0,
            noPool: 0,
            transcriptHash: bytes32(0)
        });

        emit MarketCreated(marketId, question, deadline);
    }

    // ── Position Taking ──────────────────────────────────────────

    /**
     * @notice Stake ETH on a position (YES or NO).
     * @param marketId The market to bet on
     * @param side Verdict.Yes or Verdict.No
     */
    function takePosition(uint256 marketId, Verdict side) external payable {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Market not open");
        require(block.timestamp < m.deadline, "Past deadline");
        require(
            side == Verdict.Yes || side == Verdict.No,
            "Invalid side"
        );
        require(msg.value > 0, "Must send ETH");

        if (side == Verdict.Yes) {
            yesPositions[marketId][msg.sender] += msg.value;
            m.yesPool += msg.value;
        } else {
            noPositions[marketId][msg.sender] += msg.value;
            m.noPool += msg.value;
        }

        emit PositionTaken(marketId, msg.sender, side, msg.value);
    }

    // ── Settlement Request ───────────────────────────────────────

    /**
     * @notice Request settlement after the deadline has passed.
     * Emits SettlementRequested which the CRE EVM Log Trigger listens for.
     * @param marketId The market to settle
     */
    function requestSettlement(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Market not open");
        require(block.timestamp >= m.deadline, "Deadline not reached");

        m.status = MarketStatus.SettlementRequested;
        emit SettlementRequested(marketId, block.timestamp);
    }

    // ── Settlement (Owner Only) ──────────────────────────────────

    /**
     * @notice Resolve the market with a verdict from the adversarial trial.
     * Only callable by the owner (CRE Forwarder in production).
     * @param marketId The market to resolve
     * @param outcome The winning verdict (Yes or No)
     * @param scoreYes The YES advocate's aggregate score (0-100)
     * @param scoreNo The NO advocate's aggregate score (0-100)
     * @param transcriptHash keccak256 of the full trial transcript JSON
     */
    function settle(
        uint256 marketId,
        Verdict outcome,
        uint256 scoreYes,
        uint256 scoreNo,
        bytes32 transcriptHash
    ) external onlyOwner {
        Market storage m = markets[marketId];
        require(
            m.status == MarketStatus.SettlementRequested,
            "Settlement not requested"
        );
        require(
            outcome == Verdict.Yes || outcome == Verdict.No,
            "Invalid verdict"
        );

        m.status = MarketStatus.Resolved;
        m.outcome = outcome;
        m.transcriptHash = transcriptHash;

        emit MarketResolved(
            marketId,
            outcome,
            scoreYes,
            scoreNo,
            transcriptHash
        );
    }

    /**
     * @notice Escalate the market when the trial result is inconclusive.
     * Triggered when margin is below threshold or hallucinations are detected.
     * @param marketId The market to escalate
     * @param transcriptHash keccak256 of the trial transcript for human review
     */
    function escalate(
        uint256 marketId,
        bytes32 transcriptHash
    ) external onlyOwner {
        Market storage m = markets[marketId];
        require(
            m.status == MarketStatus.SettlementRequested,
            "Settlement not requested"
        );

        m.status = MarketStatus.Escalated;
        m.transcriptHash = transcriptHash;

        emit MarketEscalated(marketId, transcriptHash);
    }

    // ── Claiming Winnings ────────────────────────────────────────

    /**
     * @notice Claim proportional winnings after market resolution.
     *
     * Payout math:
     *   payout = (userPosition / totalWinnerPool) * (yesPool + noPool)
     *
     * Example: Alice bets 1 ETH YES, Bob bets 0.5 ETH NO. YES wins.
     *   Alice's payout = (1 / 1) * (1 + 0.5) = 1.5 ETH
     *
     * Uses ReentrancyGuard to prevent re-entrancy attacks on the
     * ETH transfer. Position is zeroed BEFORE the transfer (CEI pattern).
     */
    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Resolved, "Market not resolved");

        uint256 userPosition;
        uint256 totalWinnerPool;
        uint256 totalPool = m.yesPool + m.noPool;

        if (m.outcome == Verdict.Yes) {
            userPosition = yesPositions[marketId][msg.sender];
            totalWinnerPool = m.yesPool;
            // Zero position BEFORE transfer (checks-effects-interactions)
            yesPositions[marketId][msg.sender] = 0;
        } else {
            userPosition = noPositions[marketId][msg.sender];
            totalWinnerPool = m.noPool;
            noPositions[marketId][msg.sender] = 0;
        }

        require(userPosition > 0, "No winning position");
        require(totalWinnerPool > 0, "No winner pool");

        // Proportional payout: user's share of the total pool
        uint256 payout = (userPosition * totalPool) / totalWinnerPool;

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "Transfer failed");
    }

    // ── View Helpers ─────────────────────────────────────────────

    /**
     * @notice Get the full market struct for a given ID.
     */
    function getMarket(uint256 marketId)
        external
        view
        returns (Market memory)
    {
        return markets[marketId];
    }
}
