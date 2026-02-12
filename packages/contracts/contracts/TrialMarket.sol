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
 *  
 */