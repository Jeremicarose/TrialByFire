// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TrialMarket
 * @notice A subjective prediction market resolved by adversarial AI debate.
 * 
 * Lifecycle:
 *  1. createMarket()       - Post a subjective question with rubric + deadline
 *  2. takePosition()       - Stake ETH on YES or NO
 *  3. requestSettlement()  - After deadline, emit event to trigger CRE workflow
 *  4. settle() /escalate() - Engine writes verdict or escalates for human review 
 *  5. claimWinnings
 */