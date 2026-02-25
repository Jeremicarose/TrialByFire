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
import ""