/**
 * Activate Chainlink Functions + Update Source on TrialMarket
 *
 * This script:
 *   1. Encrypts API secrets (Anthropic + OpenAI keys) for DON nodes
 *   2. Uploads encrypted secrets to the DON gateway
 *   3. Calls setEncryptedSecretsReference() on the contract
 *   4. Updates the Functions source code (trial-source.js) on-chain
 *
 * After this, calling sendTrialRequest() on any SettlementRequested market
 * will trigger the adversarial trial on the Chainlink DON — fully decentralized.
 *
 * Usage:
 *   npx hardhat run scripts/activate-chainlink.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import {
  SecretsManager,
  createGist,
} from "@chainlink/functions-toolkit";

/* Chainlink Sepolia addresses */
const FUNCTIONS_ROUTER = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
const DON_ID = "fun-ethereum-sepolia-1";

/* Contract ABI subset */
const CONTRACT_ABI = [
  "function setEncryptedSecretsReference(bytes calldata ref) external",
  "function setFunctionsSource(string calldata source) external",
  "function s_functionsSource() view returns (string)",
  "function s_encryptedSecretsReference() view returns (bytes)",
  "function s_subscriptionId() view returns (uint64)",
];

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!contractAddress) {
    console.error("  ERROR: CONTRACT_ADDRESS not set in .env");
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error("  ERROR: ANTHROPIC_API_KEY not set in .env");
    process.exit(1);
  }
  if (!privateKey) {
    console.error("  ERROR: DEPLOYER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, deployer);

  console.log("\n" + "=".repeat(60));
  console.log("  TRIALBYFIRE — Activate Chainlink Functions");
  console.log("=".repeat(60));
  console.log(`  Contract:  ${contractAddress}`);
  console.log(`  Deployer:  ${deployer.address}`);

  // ── Step 1: Encrypt Secrets ─────────────────────────────────────

  console.log("\n  [1/3] Encrypting API secrets for DON...");

  const pinataJwt = process.env.PINATA_JWT || "";
  if (!pinataJwt) {
    console.log("  WARNING: PINATA_JWT not set — transcripts won't be uploaded to IPFS");
  }

  const secrets = {
    anthropicKey: anthropicKey,
    openaiKey: openaiKey || "",
    pinataJwt: pinataJwt,
  };

  /*
   * The SecretsManager handles encryption of secrets so that
   * only DON nodes can decrypt them. The secrets never appear
   * in plaintext on-chain.
   */
  /*
   * The Chainlink Functions toolkit uses ethers v5 internally.
   * Hardhat uses ethers v6. We need to create an ethers v5 signer
   * for the SecretsManager. The @ethersproject packages (v5) are
   * installed as transitive dependencies of the toolkit.
   */
  const ethersV5providers = require("@ethersproject/providers");
  const ethersV5wallet = require("@ethersproject/wallet");

  const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "";
  const v5Provider = new ethersV5providers.JsonRpcProvider(rpcUrl);
  const v5Wallet = new ethersV5wallet.Wallet(privateKey, v5Provider);

  const secretsManager = new SecretsManager({
    signer: v5Wallet,
    functionsRouterAddress: FUNCTIONS_ROUTER,
    donId: DON_ID,
  });

  await secretsManager.initialize();

  /*
   * Upload encrypted secrets to the DON gateway.
   * The DON stores them and returns a reference (version number)
   * that we set on the contract. When Functions executes, it
   * fetches and decrypts the secrets using this reference.
   *
   * slotId 0 = default slot for our subscription.
   * minutesUntilExpiration = 4320 (3 days for hackathon demo)
   */
  const encryptedSecrets = await secretsManager.encryptSecrets(secrets);

  const subId = Number(await contract.s_subscriptionId());
  console.log(`  Subscription ID: ${subId}`);

  const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
    encryptedSecretsHexstring: encryptedSecrets.encryptedSecrets,
    gatewayUrls: [
      "https://01.functions-gateway.testnet.chain.link/",
      "https://02.functions-gateway.testnet.chain.link/",
    ],
    slotId: 0,
    minutesUntilExpiration: 4320, // 3 days
  });

  if (!uploadResult.success) {
    console.error("  ERROR: Failed to upload secrets to DON");
    console.error(uploadResult);
    process.exit(1);
  }

  console.log(`  Secrets uploaded! Version: ${uploadResult.version}`);

  // ── Step 2: Set Encrypted Secrets Reference ─────────────────────

  console.log("\n  [2/3] Setting encrypted secrets reference on contract...");

  /*
   * Build the secrets reference bytes.
   * This encodes the slotId and version so the contract can pass
   * them to the Functions request. The DON uses these to look up
   * and decrypt the correct secrets.
   */
  const secretsRef = secretsManager.buildDONHostedEncryptedSecretsReference({
    slotId: 0,
    version: uploadResult.version,
  });

  const tx1 = await contract.setEncryptedSecretsReference(secretsRef);
  await tx1.wait();
  console.log(`  TX: ${tx1.hash}`);

  // ── Step 3: Update Functions Source Code ─────────────────────────

  console.log("\n  [3/3] Updating Functions source code on-chain...");

  const sourcePath = path.join(__dirname, "../functions/trial-source.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const currentSource = await contract.s_functionsSource();

  if (currentSource.length === source.length) {
    console.log(`  Source already up-to-date (${source.length} bytes). Skipping.`);
  } else {
    const tx2 = await contract.setFunctionsSource(source, { gasLimit: 30_000_000 });
    await tx2.wait();
    console.log(`  Uploaded ${source.length} bytes (was ${currentSource.length})`);
    console.log(`  TX: ${tx2.hash}`);
  }

  // ── Summary ─────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60));
  console.log("  CHAINLINK FUNCTIONS ACTIVATED!");
  console.log("=".repeat(60));
  console.log(`\n  Contract: ${contractAddress}`);
  console.log(`  Subscription: #${subId}`);
  console.log(`  Secrets: Uploaded (slot 0, version ${uploadResult.version})`);
  console.log(`  Source: ${source.length} bytes (dynamic evidence routing)`);
  console.log(`\n  Next steps:`);
  console.log(`  1. Make sure ${contractAddress} is a consumer on subscription #${subId}`);
  console.log(`     → https://functions.chain.link`);
  console.log(`  2. Register Chainlink Automation upkeep:`);
  console.log(`     → https://automation.chain.link`);
  console.log(`     → Type: Custom logic`);
  console.log(`     → Contract: ${contractAddress}`);
  console.log(`     → Gas limit: 500,000`);
  console.log(`     → Fund with 5-10 LINK`);
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("\nActivation failed:", error);
  process.exitCode = 1;
});
