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
 */