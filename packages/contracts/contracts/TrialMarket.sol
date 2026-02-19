// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TrialMarket
 * @notice A subjective prediction market resolved by adversarial AI debate.
 *
 * Lifecycle:
 *   1. createMarket()      - Post a subjective question with rubric + deadline
 *   2. takePosition()      - Stake ETH on YES or NO
 *   3. requestSettlement() - After deadline, emit event to trigger CRE workflow
 *   4. settle()/escalate() - Engine writes verdict or escalates for human review
 *   5. claimWinnings()     - Winners withdraw proportional payouts
 *
 * Settlement is owner-gated (deployer = authorized settler for the hackathon).
 * In production, the owner would be the CRE Forwarder contract address,
 * ensuring only the decentralized oracle network can settle markets.
 */
contract TrialMarket is Ownable, ReentrancyGuard {

    enum MarketStatus { Open, SettlementRequested, Resolved, Escalated }
    enum Verdict { None, Yes, No }

    struct Market {
        string question;
        string rubricHash;
        uint256 deadline;
        MarketStatus status;
        Verdict outcome;
        uint256 yesPool;
        uint256 noPool;
        bytes32 transcriptHash;
    }

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesPositions;
    mapping(uint256 => mapping(address => uint256)) public noPositions;

    event MarketCreated(uint256 indexed marketId, string question, uint256 deadline);
    event PositionTaken(uint256 indexed marketId, address indexed participant, Verdict side, uint256 amount);
    event SettlementRequested(uint256 indexed marketId, uint256 timestamp);
    event MarketResolved(uint256 indexed marketId, Verdict outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash);
    event MarketEscalated(uint256 indexed marketId, bytes32 transcriptHash);

    constructor() Ownable(msg.sender) {}

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

    function takePosition(uint256 marketId, Verdict side) external payable {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Market not open");
        require(block.timestamp < m.deadline, "Past deadline");
        require(side == Verdict.Yes || side == Verdict.No, "Invalid side");
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

    function requestSettlement(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Market not open");
        require(block.timestamp >= m.deadline, "Deadline not reached");
        m.status = MarketStatus.SettlementRequested;
        emit SettlementRequested(marketId, block.timestamp);
    }

    function settle(
        uint256 marketId,
        Verdict outcome,
        uint256 scoreYes,
        uint256 scoreNo,
        bytes32 transcriptHash
    ) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.SettlementRequested, "Settlement not requested");
        require(outcome == Verdict.Yes || outcome == Verdict.No, "Invalid verdict");
        m.status = MarketStatus.Resolved;
        m.outcome = outcome;
        m.transcriptHash = transcriptHash;
        emit MarketResolved(marketId, outcome, scoreYes, scoreNo, transcriptHash);
    }

    function escalate(
        uint256 marketId,
        bytes32 transcriptHash
    ) external onlyOwner {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.SettlementRequested, "Settlement not requested");
        m.status = MarketStatus.Escalated;
        m.transcriptHash = transcriptHash;
        emit MarketEscalated(marketId, transcriptHash);
    }

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Resolved, "Market not resolved");

        uint256 userPosition;
        uint256 totalWinnerPool;
        uint256 totalPool = m.yesPool + m.noPool;

        if (m.outcome == Verdict.Yes) {
            userPosition = yesPositions[marketId][msg.sender];
            totalWinnerPool = m.yesPool;
            yesPositions[marketId][msg.sender] = 0;
        } else {
            userPosition = noPositions[marketId][msg.sender];
            totalWinnerPool = m.noPool;
            noPositions[marketId][msg.sender] = 0;
        }

        require(userPosition > 0, "No winning position");
        require(totalWinnerPool > 0, "No winner pool");

        uint256 payout = (userPosition * totalPool) / totalWinnerPool;
        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "Transfer failed");
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }
}
