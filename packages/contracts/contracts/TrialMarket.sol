// SPDX-License-Identifier: MIT
program solidity ^0.8.19;

/**
 * ========================================================================
 * IMPORTS
 * ========================================================================
 * 
 * OpenZeppelin:
 *  - Ownable: Admin functions (manual settle fallback, emergency)
 *  - ReentrancyGuard: Prevents re-entrancy on ETH transfers (claimWinnings/claimRefund)
 * 
 * Chainlink Functions (v1.3.0):
 *  - FunctionsClient: Base contract for sending requests to Chainlink DON
 *  - FunctionsRequest: Library for building CBOR-encoded request payloads
 * we extend FunctionsClient so the Chainlink router can call our
 * _fulfillRequest() callback with the trial results.
 * 
 * Chainlink Data Feeds:
 *  - AutomationCompatibleInterface: Enables Chainlink keepers to auto-trigger
 *  settlement when a market's deadline passes. checkUpkeep() scans for
 *  market past deadline; performUpkeep() calls requestSettlement().
 * 
 * Chainlink Data Feeds:
 *  - AggregatorV3Interface: Reads ETH/USD price from Chainlink's oracle network.
 *  Used as trusted evidence source - the current ETH price is passed as an
 *  argument to the Functions request so the trial has verified oracle data.
 */
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_3_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title TrialMarket
 * @notice A subjective prediction market resolved by adversarial AI debate,
 *          powered by Chainlink Functions, Automation, and Data Feeds.
 * 
 * Architecture:
 *      This contract integrates THree Chainlink technologies:
 * 
 *      1. Chainlink Functions - Executes the adversarial trial off-chain on
 *          Chainlink's Decentralized Orcle Network (DON). The trial JavaScript
 *          source code calls LLM APIs (OpenAI, Anthropic), gathers evidence,
 *          runs a judge, and returns the verdict. Multiple DON nodes execute
 *          the same code independently, reaching consensus on the result.
 *          This removes the single-point-of-failure of owner-gated settlement.
 * 
 *      2. Chainlink Automation - Keepers monitor all markets and automatically
 *          trigger settlement when deadlines pass. No human needs to call
 *          requestSettlement() - it happens autonomously.
 * 
 *      3. Chainlink Data Feeds - The ETH/USD price feed provides verified
 *          oracle data as evidence for the trial. This trusted data source
 *          supplements the API-fetched evidence (DeFiLlam, Treasury rates).
 * 
 * Lifecycle:
 *  1. createMarket()               - Anyone posts a question + 0.01 ETH deposit
 *  2. takePosition()               - Stake ETH on YES or NO
 *  3. requestSettlement()          - After deadline(manual or via Automation)
 *  4. semdTrialRequest()           - Triggers Chainlink Functions to run the trial
 *  5. _fulfillRequst()             - DON returns verdict -> auto-settle or escalate
 *  6. claimWinnings()              - Winners withdraw proportional payouts
 *      claimRefund()               - On escalation, everyone get their stake back
 * 
 * Economics:
 *  - Market creator deposists 0.01 ETH (refunded after settlement)
 *  - Stakers bet ETH on YES or NO
 *  - Winners split the total pool proportional to their stake
 *  - Escaleted markets refund all stakers (no one loses money)
 */
contract TrialMarket is Ownable, ReentracyGuard, FunctionsClient, AutomationCompatibleInterface {

    /**
     *  Using the FunctionsRequest library lets us build CBOR-encoded
     *  payloads with a clean API: initializeRequestForInlineJavaScript(),
     *  setArgs(), addSecretsReference(), etc,
     */
    using FunctionsRequest for FunctionsRequest.Request;

    // =====================================================================
    // ENUMS
    // ====================================================================== 

    /**
     * MarketStatus tracks the lifecycle state machine:
     *  Open -> SettlementRequested -> Resolved | Escalated
     * Each transaction is one-way. Once resolved or escalated, a market
     *  Cannot return to an earlier state.
     */
    enum ManarketStatus { Open, SettlementRequested, Resolved, Escalated}

    /**
     * Verdict represents the trial outcome.
     * None is the default (unresolved). Yes/No map to the two sides
     * of the prediction market question.
     */
    enum Verdict { None, Yes, No}

    // =========================================================================
    // STRUCTS
    // =========================================================================

    struct Market {
        string question;            // THe subjective question being debated
        string rubricHash;          // IPFS hash or identifier for  the scoring rubric
        uint256 deadline;           // Unix timestamp - no positions after this
        MarketStatus status;        // Current lifecycle state
        Verdict outcome;            // Final verdict (set on resolution)
        uint256 yesPool;            // Total ETH staked on YES
        uint256 noPool;             // Total ETH staked on NO
        bytes32 transcriptHash;     // Keccak256 of the full trial transcript
        address creator;            // Address that created the market
        uint256 creationDeposit;    // ETH deposited by creator (refundable)
    }

    // =============================================================================
    // STATW VARIABLES
    // ==============================================================================

    /**
     * Market storage: sequential IDs starting at 0.
     * nextMarketId acts as both a counter and the ID for the next market.
     */
    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;

    /**
     * Position tracking: nested mapping of marketId -> user -> stake amount.
     * Separate mappings for YES and NO positions because a user could
     * theoretically stake on both sides (hedging).
     */
    mapping(uint256 => mapping(address => uint256)) public yesPositions;
    mapping(uint256 => mapping(address => uint256)) public noPositions;

    /**
     *  Chainlink Fuctions configuration.
     * 
     * s_donId: Identifies which DON (Decentralized Oracle Network) processes
     *   our requests. On Sepolia this is "fun-ethereum-sepolia-1".
     * 
     * s_subscriptionId: The Chainlink Functions subscritption that pays for
     *   DON execution. Must be funded with LINK tokens.
     * 
     * s_functionsSource: The JavaScript source code that runs on DON
     *   This contains the entire adversarial trial logic: evidence gathering,
     *   advocate arguments, judge scoring, and confidence evaluation.
     *   Stored on-chain so its immutable and auditable.
     * 
     * s_encryptedSecretsRefence: Encrypted reference to API keys (OpenAI,
     *   Anthropic) stored off-chain. Only DON nodes can decrypt these.
     * 
     * s_callbackGasLimit: Gas budget for the _fulfillRequest() callback.
     *   Must be enough to decode the result and update market state.
     * 
     * s_requestIdToMarketId: Maps Chainlink request IDs to our market IDs
     *   so we know which market to settle when the callback arrives.
     */
    bytes32 public s_donId;
    uint64 public s_subscriptionId;
    string public s_functionsSource;
    bytes public s_encryptedSecretsReference;
    uint32 public s_ecallbackGasLimit = 300_000;
    mapping(bytes32 => uint256) public s_requestIdToMarketId;

    /**
     * Chainlink Data Feed for ETH/USD price.
     * We read the latest price and pass it as evidence to the trial.
     * This gives the adversarial debate verified oracle data alongside
     * the API-fetched evidence (DeFiLlama, Treasury, etc.).
     */
    AggregatorV3Interface public s_priceFeed;

    /**
     * Market creation requires a minimum deposit to prevent spam. 
     * 0.01 ETH is lowenough to not be a barrier but high enough
     * to discourage frivolous market creation.
     */
    uint256 public constant CREATION_DEPOSIT = 0.01 ether;

    // ==================================================================================
    // EVENTS
    // =====================================================================================

    /**
     * Events serve two purposes:
     *      1. Frontend listens for these to update the UI in real-time
     *      2. Chainlink Automation's Log Trigger can watch for
     *          SettlementRequested to automatically start trials
     */
    event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 deadline);
    event PositionTaken(uint256 indexed marketId, address indexed participant, Verdict side, uint256 amount);
    event SettlementRequested(uint256 indexed marketId, uint256 timestamp);
    event TrialRequested(uint256 indexed marketId, bytes32 indexed requestId);
    event MarketResolved(uint256 indexed marketId, Verdict outcome, uint256 scoreYes, uint256 scorteNo, bytes32 transcriptHash);
    event MarketEscalated(uint256 indexed marketId, bytes32 transcriptHash);
    event RefundClaimed(uint256 indexed marketId, address indexed participant, uint256 amount);
    event DepositRefunded(uint256 indexed marketId, address indexed creator, uint256 amount);

    // =======================================================================================================================
    // CONSTRUCTOR
    // =================================================================================

    /**
     * The constructor takes the Chainlink Functions router address and
     *  the ETH/USD price feed address. Both are network-specific:
     * 
     * Sepolia:
     *      router:         0x
     *      priceFeed:
     * 
     * FunctionsClient(router) registers us with the Chainlink router
     * so it knows to call our handleOracleFulfillment() with results.
     * 
     * Ownable(msg.sender) makes the deployer the admin, who can:
     *      - Update Chainlink configuration (DON ID, subscription, source)
     *      - Manually settle markets as a fallback
     *      - Emergency functions if needed
     */
    constructor(
        address router,
        address priceFeed
    ) Ownable(msg.sender) FunctionsClient(router) {
        s_priceFeed = AggeratorV3Interface(priceFeed);
    }

    // ===========================================================================================
    // ADMIN CONFIGURATION
    // ===========================================================================================

    /**
     * These setters let the owner configure Chainlink Functions after
     * deployment. This is necessary because:
     *      - The subscription ID is created on the Chainlink UI after deployment
     *      - The functions source code may need updates without redeploying
     *      - Encrypted secrets references
     */
}