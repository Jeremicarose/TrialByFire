import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

/*
 * Load environment variables from the root .env file.
 * Path is relative to packages/contracts/ where Hardhat runs.
 */
dotenv.config({ path: "../../.env" });

const config: HardhatUserConfig = {
  /*
   * Solidity 0.8.19 — required by Chainlink Functions contracts.
   * FunctionsClient.sol and FunctionsRequest.sol use pragma ^0.8.19.
   * Our original 0.8.24 would work too, but 0.8.19 is the minimum
   * compatible version across all our dependencies.
   *
   * Optimizer enabled with 200 runs to stay under the 24KB contract
   * size limit (EIP-170). Without the optimizer, TrialMarket exceeds
   * the limit due to the inline string conversion helpers and
   * Chainlink library code. 200 runs balances deployment gas savings
   * with runtime gas efficiency.
   */
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    /*
     * Sepolia testnet configuration.
     * Chainlink Functions, Automation, and Data Feeds are all
     * available on Sepolia. The contract addresses below are
     * the official Chainlink deployments:
     *
     *   Functions Router: 0xb83E47C2bC239B3bf370bc41e1459A34b41238D0
     *   ETH/USD Feed:     0x694AA1769357215DE4FAC081bf1f309aDC325306
     *   DON ID:           fun-ethereum-sepolia-1
     */
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    /*
     * Local Hardhat node.
     * For local development, we deploy mock versions of the Chainlink
     * contracts (router, price feed) so the contract can be tested
     * without a real DON.
     */
    hardhat: {},
  },
};

export default config;
