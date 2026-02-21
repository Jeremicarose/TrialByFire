// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockAggregator
 * @notice Mock Chainlink ETH/USD Price Feed for local testing.
 *
 * The real AggregatorV3Interface on Sepolia returns live ETH/USD prices
 * aggregated from multiple oracle nodes. On local Hardhat, we need a
 * mock that returns a static price.
 *
 * Default price: $3,500.00 (stored as 350000000000 with 8 decimals).
 * Chainlink price feeds use 8 decimal places, so:
 *   $3,500.00 = 3500 * 10^8 = 350000000000
 *
 * The owner can update the price via setPrice() for testing
 * different market scenarios (e.g., price crash, price surge).
 */
contract MockAggregator {
    /*
     * Price with 8 decimals, matching Chainlink's standard format.
     * int256 because Chainlink's interface uses signed integers
     * (theoretically prices could be negative, like oil futures).
     */
    int256 private _price = 350000000000; // $3,500.00

    /**
     * @notice Returns the number of decimals in the price.
     * Chainlink ETH/USD feeds always use 8 decimals.
     */
    function decimals() external pure returns (uint8) {
        return 8;
    }

    /**
     * @notice Human-readable description of what this feed provides.
     */
    function description() external pure returns (string memory) {
        return "ETH / USD (Mock)";
    }

    /**
     * @notice Feed version number.
     */
    function version() external pure returns (uint256) {
        return 1;
    }

    /**
     * @notice Returns the latest price data.
     *
     * Matches the AggregatorV3Interface.latestRoundData() signature.
     * The real implementation returns data from the latest oracle round:
     *   - roundId: Sequential ID for this price update
     *   - answer: The actual price (with 8 decimals)
     *   - startedAt: When this round started
     *   - updatedAt: When the price was last updated
     *   - answeredInRound: Which round the answer came from
     *
     * Our mock returns the stored price with the current timestamp.
     * roundId is always 1 since we don't simulate multiple rounds.
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    /**
     * @notice Test helper — update the mock price.
     * @param newPrice New ETH/USD price with 8 decimals
     *
     * Example: setPrice(400000000000) sets price to $4,000.00
     */
    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }
}
