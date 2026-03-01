import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * TrialByFire — Sepolia Full Setup Script
 *
 * This script performs ALL post-deployment configuration in one shot:
 *
 *   1. Deploy TrialMarket to Sepolia (with official Chainlink addresses)
 *   2. Set DON ID (fun-ethereum-sepolia-1)
 *   3. Set Chainlink Functions subscription ID
 *   4. Upload the trial-source.js to the contract
 *   5. Write the contract address to .env for the frontend
 *
 * What you still need to do MANUALLY before running this:
 *   a) Get Sepolia ETH from https://faucets.chain.link
 *   b) Get testnet LINK from https://faucets.chain.link
 *   c) Create a Functions subscription at https://functions.chain.link
 *   d) Fund the subscription with 2-5 LINK
 *   e) Put your subscription ID in CHAINLINK_SUBSCRIPTION_ID in .env
 *
 * What you still need to do MANUALLY after running this:
 *   a) Add the printed contract address as a consumer at functions.chain.link
 *   b) Register a Chainlink Automation upkeep at automation.chain.link
 *   c) (Optional) Encrypt secrets and call setEncryptedSecretsReference
 *
 * Usage:
 *   npx hardhat run scripts/setup-sepolia.ts --network sepolia
 *
 * Required .env variables:
 *   SEPOLIA_RPC_URL           — Alchemy/Infura Sepolia RPC endpoint
 *   DEPLOYER_PRIVATE_KEY      — Wallet private key with Sepolia ETH
 *   CHAINLINK_SUBSCRIPTION_ID — Functions subscription ID (number)
 */

// ── Chainlink Official Addresses on Sepolia ──────────────────────

/*
 * These addresses are deployed and maintained by Chainlink Labs.
 * They're the canonical entry points for each Chainlink service
 * on Sepolia testnet. Do NOT change these unless Chainlink
 * publishes new addresses.
 *
 * Source: https://docs.chain.link/chainlink-functions/supported-networks
 * Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
 */
const FUNCTIONS_ROUTER = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
const ETH_USD_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
const DON_ID = "fun-ethereum-sepolia-1";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("\n" + "=".repeat(65));
  console.log("  TRIALBYFIRE — Sepolia Setup");
  console.log("=".repeat(65));
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log(`  Network:   Sepolia (chainId ${network.chainId})`);

  /*
   * Safety check: abort if we're on local Hardhat by accident.
   * This script calls setDonId/setSubscriptionId which only make
   * sense on a real testnet with actual Chainlink infrastructure.
   */
  if (network.chainId === 31337n) {
    console.error("\n  ERROR: This script is for Sepolia, not local Hardhat.");
    console.error("  Use: npx hardhat run scripts/setup-sepolia.ts --network sepolia");
    process.exit(1);
  }

  /*
   * Check that the deployer has enough ETH for deployment + config.
   * The contract deploy costs ~0.03 ETH and each config tx ~0.001 ETH.
   * We require at least 0.05 ETH as a safety margin.
   */
  if (balance < ethers.parseEther("0.05")) {
    console.error(`\n  ERROR: Insufficient balance. Need at least 0.05 ETH.`);
    console.error("  Get Sepolia ETH from https://faucets.chain.link");
    process.exit(1);
  }

  // ── Step 1: Deploy Contract ────────────────────────────────────

  console.log("\n  [1/5] Deploying TrialMarket...");
  console.log(`         Functions Router: ${FUNCTIONS_ROUTER}`);
  console.log(`         ETH/USD Feed:     ${ETH_USD_FEED}`);

  const TrialMarket = await ethers.getContractFactory("TrialMarket");
  const market = await TrialMarket.deploy(FUNCTIONS_ROUTER, ETH_USD_FEED);
  await market.waitForDeployment();

  const contractAddress = await market.getAddress();
  console.log(`         Deployed to: ${contractAddress}`);

  // ── Step 2: Set DON ID ─────────────────────────────────────────

  /*
   * The DON ID tells the Functions Router which cluster of oracle
   * nodes should execute our JavaScript. "fun-ethereum-sepolia-1"
   * is the primary DON on Sepolia.
   *
   * The contract stores this as bytes32, so we encode the string.
   */
  console.log("\n  [2/5] Setting DON ID...");
  const donIdBytes32 = ethers.encodeBytes32String(DON_ID);
  const tx1 = await market.setDonId(donIdBytes32);
  await tx1.wait();
  console.log(`         DON ID: ${DON_ID}`);
  console.log(`         TX: ${tx1.hash}`);

  // ── Step 3: Set Subscription ID ────────────────────────────────

  /*
   * The subscription ID links our contract to a funded LINK balance
   * on the Functions Router. Each Functions call costs LINK, which
   * is deducted from this subscription.
   *
   * The subscription must be created and funded BEFORE running this
   * script. See the checklist at the top of this file.
   */
  const subId = process.env.CHAINLINK_SUBSCRIPTION_ID;
  if (subId) {
    console.log("\n  [3/5] Setting subscription ID...");
    const tx2 = await market.setSubscriptionId(parseInt(subId));
    await tx2.wait();
    console.log(`         Subscription ID: ${subId}`);
    console.log(`         TX: ${tx2.hash}`);
  } else {
    console.log("\n  [3/5] SKIPPED — CHAINLINK_SUBSCRIPTION_ID not set in .env");
    console.log("         You'll need to set this manually after creating a subscription:");
    console.log("         1. Go to https://functions.chain.link");
    console.log("         2. Create a subscription and fund with LINK");
    console.log(`         3. Add ${contractAddress} as a consumer`);
    console.log("         4. Run: cast send <contract> 'setSubscriptionId(uint64)' <id>");
  }

  // ── Step 4: Upload Functions Source Code ────────────────────────

  /*
   * The Functions source is the JavaScript that runs on the DON.
   * It's stored onchain in the contract so that:
   *   a) It can be verified by anyone
   *   b) sendTrialRequest() has access to it
   *
   * The source file is ~400 lines of JavaScript that runs the
   * full adversarial trial (evidence + advocates + judge).
   */
  console.log("\n  [4/5] Uploading Functions source code...");
  const sourcePath = path.join(__dirname, "../functions/trial-source.js");

  if (fs.existsSync(sourcePath)) {
    const source = fs.readFileSync(sourcePath, "utf8");
    const tx3 = await market.setFunctionsSource(source);
    await tx3.wait();
    console.log(`         Source: ${source.length} bytes uploaded`);
    console.log(`         TX: ${tx3.hash}`);
  } else {
    console.log(`         SKIPPED — ${sourcePath} not found`);
  }

  // ── Step 5: Write Contract Address to .env ──────────────────────

  /*
   * Write the contract address to the root .env file so the
   * frontend can pick it up via VITE_CONTRACT_ADDRESS.
   * We append/replace rather than overwrite to preserve other vars.
   */
  console.log("\n  [5/5] Updating .env with contract address...");
  const envPath = path.join(__dirname, "../../../.env");
  let envContent = "";

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  }

  /* Replace existing VITE_CONTRACT_ADDRESS or append it */
  if (envContent.includes("VITE_CONTRACT_ADDRESS=")) {
    envContent = envContent.replace(
      /VITE_CONTRACT_ADDRESS=.*/,
      `VITE_CONTRACT_ADDRESS=${contractAddress}`
    );
  } else {
    envContent += `\nVITE_CONTRACT_ADDRESS=${contractAddress}\n`;
  }

  /* Also set CONTRACT_ADDRESS for the engine API server */
  if (envContent.includes("CONTRACT_ADDRESS=") && !envContent.includes("VITE_CONTRACT_ADDRESS")) {
    envContent = envContent.replace(
      /CONTRACT_ADDRESS=.*/,
      `CONTRACT_ADDRESS=${contractAddress}`
    );
  } else if (!envContent.includes("CONTRACT_ADDRESS=")) {
    envContent += `CONTRACT_ADDRESS=${contractAddress}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`         Written to ${envPath}`);

  // ── Summary ────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(65));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(65));
  console.log(`\n  Contract: ${contractAddress}`);
  console.log(`  Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);

  console.log("\n  Remaining manual steps:");
  console.log("  ───────────────────────");

  if (!subId) {
    console.log("  1. Create Functions subscription at https://functions.chain.link");
    console.log("     - Fund with 2-5 LINK");
    console.log(`     - Add ${contractAddress} as consumer`);
    console.log("     - Call setSubscriptionId(<id>) on the contract");
  } else {
    console.log(`  1. Add ${contractAddress} as consumer at https://functions.chain.link`);
    console.log(`     (Subscription #${subId})`);
  }

  console.log("\n  2. Register Automation upkeep at https://automation.chain.link");
  console.log("     - Type: Custom logic");
  console.log(`     - Contract: ${contractAddress}`);
  console.log("     - Gas limit: 500,000");
  console.log("     - Fund with 5-10 LINK");

  console.log("\n  3. (Optional) Encrypt API secrets for Chainlink Functions:");
  console.log("     npx @chainlink/functions-toolkit encrypt-secrets \\");
  console.log("       --network sepolia \\");
  console.log('       --secrets \'{"anthropicKey":"sk-ant-...","openaiKey":"sk-..."}\'');
  console.log("     Then call setEncryptedSecretsReference(0x<output>) on the contract");

  console.log("\n  4. Start the frontend:");
  console.log(`     VITE_CONTRACT_ADDRESS=${contractAddress} npx vite --host`);
  console.log("=".repeat(65) + "\n");
}

main().catch((error) => {
  console.error("\nSetup failed:", error);
  process.exitCode = 1;
});
