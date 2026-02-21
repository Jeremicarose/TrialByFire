import { ethers } from "hardhat";

/**
 * Deploy TrialMarket to the configured network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network hardhat   (local)
 *   npx hardhat run scripts/deploy.ts --network sepolia   (testnet)
 *
 * The contract constructor requires two addresses:
 *   1. Chainlink Functions Router — processes Functions requests
 *   2. Chainlink ETH/USD Price Feed — provides oracle price data
 *
 * For local development (Hardhat), we deploy mock versions of both.
 * For Sepolia, we use the official Chainlink-deployed contract addresses.
 *
 * After deployment, the script outputs the contract address and
 * configuration commands for setting up Chainlink Functions
 * (DON ID, subscription ID, source code, etc.).
 */

/*
 * Official Chainlink contract addresses on Sepolia testnet.
 * These are deployed and maintained by Chainlink. We don't deploy them —
 * we just reference them when deploying our contract.
 *
 * Functions Router: The entry point for sending Functions requests.
 *   It routes our request to the DON and handles callbacks.
 *
 * ETH/USD Price Feed: Chainlink's aggregated ETH price oracle.
 *   Updated by multiple independent node operators.
 */
const SEPOLIA_FUNCTIONS_ROUTER = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
const SEPOLIA_ETH_USD_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

/*
 * Chainlink DON ID for Sepolia Functions.
 * "fun-ethereum-sepolia-1" identifies the specific DON cluster
 * that will execute our JavaScript source code. We convert it to
 * bytes32 for the contract's setDonId() call.
 */
const SEPOLIA_DON_ID = "fun-ethereum-sepolia-1";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  console.log("Deploying TrialMarket with account:", deployer.address);
  console.log("Network:", isLocal ? "hardhat (local)" : `chainId ${network.chainId}`);

  let routerAddress: string;
  let priceFeedAddress: string;

  if (isLocal) {
    /*
     * Local deployment: deploy mock Chainlink contracts.
     *
     * MockRouter: A minimal contract that satisfies the FunctionsClient
     * constructor. It doesn't actually process requests — for local dev,
     * we use the owner's manual settle() function instead.
     *
     * MockPriceFeed: Returns a static ETH/USD price ($3,500).
     * Implements latestRoundData() with hardcoded values.
     *
     * Why mocks? Chainlink's DON only runs on public testnets.
     * Local Hardhat nodes can't connect to the DON, so we mock
     * the interfaces to allow the contract to deploy and function.
     */
    console.log("\nDeploying mock Chainlink contracts for local development...");

    const MockRouter = await ethers.getContractFactory("MockFunctionsRouter");
    const mockRouter = await MockRouter.deploy();
    await mockRouter.waitForDeployment();
    routerAddress = await mockRouter.getAddress();
    console.log("  MockFunctionsRouter:", routerAddress);

    const MockFeed = await ethers.getContractFactory("MockAggregator");
    const mockFeed = await MockFeed.deploy();
    await mockFeed.waitForDeployment();
    priceFeedAddress = await mockFeed.getAddress();
    console.log("  MockAggregator:", priceFeedAddress);
  } else {
    /*
     * Sepolia deployment: use official Chainlink addresses.
     * No need to deploy anything — these contracts already exist.
     */
    routerAddress = SEPOLIA_FUNCTIONS_ROUTER;
    priceFeedAddress = SEPOLIA_ETH_USD_FEED;
    console.log("\nUsing Chainlink Sepolia addresses:");
    console.log("  Functions Router:", routerAddress);
    console.log("  ETH/USD Feed:", priceFeedAddress);
  }

  /*
   * Deploy TrialMarket with the router and price feed addresses.
   * The constructor passes routerAddress to FunctionsClient(router)
   * and stores priceFeedAddress for Data Feed reads.
   */
  const TrialMarket = await ethers.getContractFactory("TrialMarket");
  const market = await TrialMarket.deploy(routerAddress, priceFeedAddress);
  await market.waitForDeployment();

  const address = await market.getAddress();
  console.log("\nTrialMarket deployed to:", address);

  /*
   * Post-deployment configuration for Sepolia.
   * These steps must be done manually or via a separate script:
   *   1. Create a Functions subscription on functions.chain.link
   *   2. Fund the subscription with LINK tokens
   *   3. Add the TrialMarket contract as a consumer
   *   4. Set the DON ID, subscription ID, and source code
   */
  if (!isLocal) {
    const donIdBytes32 = ethers.encodeBytes32String(SEPOLIA_DON_ID);
    console.log("\n--- Post-deployment configuration ---");
    console.log("Run these transactions on the deployed contract:");
    console.log(`  setDonId("${donIdBytes32}")`);
    console.log("  setSubscriptionId(<your-subscription-id>)");
    console.log("  setFunctionsSource(<trial-source.js content>)");
    console.log("\nAlso:");
    console.log("  1. Create a Functions subscription at https://functions.chain.link");
    console.log("  2. Fund it with LINK tokens");
    console.log(`  3. Add ${address} as a consumer`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
