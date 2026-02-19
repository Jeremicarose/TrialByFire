#!/usr/bin/env node

/**
 * TrialByFire End-to-End Demo Script
 *
 * Runs two complete scenarios against a local Hardhat node or Sepolia:
 *
 * Scenario A: "Clear Resolution" (with hallucination → ESCALATE)
 *   - Creates a market with the ETH staking vs Treasury question
 *   - Alice bets 1 ETH YES, Bob bets 0.5 ETH NO
 *   - Runs the adversarial trial (mock data)
 *   - Judge scores YES 78 vs NO 45 (margin 33 > threshold 20)
 *   - BUT hallucination detected → ESCALATE instead of RESOLVE
 *   - Demonstrates: safety mechanism works even with clear winner
 *
 * Scenario B: "Close Call" → ESCALATE
 *   - Same setup but with the "close" mock scenario
 *   - Judge scores YES 52 vs NO 48 (margin 4 < threshold 20)
 *   - ESCALATE because margin too thin
 *   - Demonstrates: system refuses to auto-resolve uncertain outcomes
 *
 * Usage:
 *   USE_MOCKS=true \
 *   RPC_URL=http://127.0.0.1:8545 \
 *   CONTRACT_ADDRESS=0x5FbDB... \
 *   DEPLOYER_PRIVATE_KEY=0xac0974... \
 *   npx tsx src/demo.ts
 */

import "dotenv/config";
import { ethers } from "ethers";
import { runTrial } from "./pipeline/index.js";
import type { PipelineConfig } from "./pipeline/index.js";
import { MockLLMClient } from "./llm/mock.js";
import { MockEvidenceSource } from "./evidence/mock.js";
import { createOnchainSettler } from "./settlement/onchain.js";
import type { MarketQuestion } from "./types.js";

// ── Configuration ────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

/*
 * Hardhat's default first account private key.
 * Used as fallback for local development. NEVER use in production.
 * This is the default account[0] that Hardhat generates for its
 * local node — it's public knowledge and only holds test ETH.
 */
const HARDHAT_DEFAULT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const privateKey = PRIVATE_KEY || HARDHAT_DEFAULT_KEY;

/*
 * ABI subset for market setup functions.
 * We need createMarket, takePosition, and requestSettlement
 * to set up each demo scenario before running the trial.
 */
const SETUP_ABI = [
  "function createMarket(string question, string rubricHash, uint256 deadline) external returns (uint256)",
  "function takePosition(uint256 marketId, uint8 side) external payable",
  "function requestSettlement(uint256 marketId) external",
  "function getMarket(uint256 marketId) external view returns (tuple(string question, string rubricHash, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, bytes32 transcriptHash))",
  "event MarketCreated(uint256 indexed marketId, string question, uint256 deadline)",
];

// ── Demo Question ────────────────────────────────────────────────

const DEMO_QUESTION: MarketQuestion = {
  id: "demo-001",
  question: "Did ETH staking yields consistently outperform US Treasury rates in January 2026?",
  rubric: {
    criteria: [
      { name: "Data accuracy", description: "Are the cited yield/rate numbers verifiable?", weight: 30 },
      { name: "Time period coverage", description: "Does evidence cover the full period?", weight: 25 },
      { name: "Source diversity", description: "Are multiple independent sources used?", weight: 20 },
      { name: "Logical coherence", description: "Is the argument internally consistent?", weight: 25 },
    ],
    evidenceSources: ["defilama", "treasury", "newsapi"],
    confidenceThreshold: 20,
  },
  settlementDeadline: new Date(),
};

// ── Helper Functions ─────────────────────────────────────────────

function log(msg: string) {
  console.log(`\n${"=".repeat(70)}\n  ${msg}\n${"=".repeat(70)}`);
}

function step(msg: string) {
  console.log(`\n  >> ${msg}`);
}

// ── Main Demo ────────────────────────────────────────────────────

async function runDemo() {
  if (!CONTRACT_ADDRESS) {
    console.error("ERROR: CONTRACT_ADDRESS environment variable is required.");
    console.error("Deploy the contract first:");
    console.error("  npx hardhat run packages/contracts/scripts/deploy.ts --network localhost");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(privateKey, provider);

  /*
   * Get additional signers from Hardhat's default accounts.
   * account[0] = deployer/owner, account[1] = Alice, account[2] = Bob.
   * These are deterministic test accounts that Hardhat always generates.
   */
  const alice = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  );
  const bob = new ethers.Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    provider
  );

  const contract = new ethers.Contract(CONTRACT_ADDRESS, SETUP_ABI, signer);
  /*
   * Create separate contract instances for Alice and Bob.
   * In ethers v6, contract.connect() returns BaseContract which
   * loses method type info. Creating new instances avoids this.
   */
  const aliceContract = new ethers.Contract(CONTRACT_ADDRESS, SETUP_ABI, alice);
  const bobContract = new ethers.Contract(CONTRACT_ADDRESS, SETUP_ABI, bob);
  const settler = createOnchainSettler(RPC_URL, CONTRACT_ADDRESS, privateKey);

  // ════════════════════════════════════════════════════════════════
  // SCENARIO A: Clear win + hallucination → ESCALATE
  // ════════════════════════════════════════════════════════════════

  log("SCENARIO A: Clear Margin with Hallucination Detection");

  // Step 1: Create market with deadline 5 seconds from now
  step("Creating market...");
  const deadline = Math.floor(Date.now() / 1000) + 5;
  const createTx = await contract.createMarket(
    DEMO_QUESTION.question,
    "QmDemoRubricHash",
    deadline
  );
  const createReceipt = await createTx.wait();

  /*
   * Extract marketId from the MarketCreated event.
   * We parse the receipt logs to find our event and read the first
   * indexed parameter (marketId). This is more reliable than
   * assuming marketId = 0.
   */
  const iface = new ethers.Interface(SETUP_ABI);
  const createdLog = createReceipt.logs
    .map((l: ethers.Log) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((p: ethers.LogDescription | null) => p?.name === "MarketCreated");
  const marketIdA = createdLog ? Number(createdLog.args[0]) : 0;
  console.log(`  Market created: ID=${marketIdA}`);

  // Step 2: Take positions — Alice bets YES, Bob bets NO
  step("Alice bets 1 ETH on YES...");
  await (await contract.connect(alice).takePosition(marketIdA, 1, {
    value: ethers.parseEther("1.0"),
  })).wait();

  step("Bob bets 0.5 ETH on NO...");
  await (await contract.connect(bob).takePosition(marketIdA, 2, {
    value: ethers.parseEther("0.5"),
  })).wait();

  // Step 3: Wait for deadline, then request settlement
  step("Waiting for deadline...");
  await new Promise((r) => setTimeout(r, 6000));

  step("Requesting settlement...");
  await (await contract.requestSettlement(marketIdA)).wait();

  // Step 4: Run the adversarial trial
  step("Running adversarial trial (clear-win scenario)...");
  const configA: PipelineConfig = {
    evidenceSources: [new MockEvidenceSource()],
    advocateYesClient: new MockLLMClient("clear"),
    advocateNoClient: new MockLLMClient("clear"),
    judgeClient: new MockLLMClient("clear"),
    onProgress: (_stage, detail) => console.log(`    ${detail}`),
  };

  const transcriptA = await runTrial(DEMO_QUESTION, configA);

  // Step 5: Execute settlement based on the trial decision
  step(`Trial result: ${transcriptA.decision.action}`);
  console.log(`  Reason: ${transcriptA.decision.reason}`);

  if (transcriptA.decision.action === "RESOLVE" && transcriptA.decision.verdict) {
    step("Settling onchain...");
    const txHash = await settler.settle(marketIdA, transcriptA);
    console.log(`  Settlement TX: ${txHash}`);
  } else {
    step("Escalating onchain...");
    const txHash = await settler.escalate(marketIdA, transcriptA);
    console.log(`  Escalation TX: ${txHash}`);
  }

  // Verify onchain state
  const marketA = await contract.getMarket(marketIdA);
  console.log(`  Onchain status: ${["Open", "SettlementRequested", "Resolved", "Escalated"][Number(marketA.status)]}`);

  // ════════════════════════════════════════════════════════════════
  // SCENARIO B: Close call → ESCALATE
  // ════════════════════════════════════════════════════════════════

  log("SCENARIO B: Close Margin → Escalation");

  // Same setup flow: create market, take positions, request settlement
  step("Creating market...");
  const deadlineB = Math.floor(Date.now() / 1000) + 5;
  const createTxB = await contract.createMarket(
    "Did the EU AI Act implementation improve industry compliance by Q1 2026?",
    "QmDemoRubricHash2",
    deadlineB
  );
  const createReceiptB = await createTxB.wait();
  const createdLogB = createReceiptB.logs
    .map((l: ethers.Log) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((p: ethers.LogDescription | null) => p?.name === "MarketCreated");
  const marketIdB = createdLogB ? Number(createdLogB.args[0]) : 1;
  console.log(`  Market created: ID=${marketIdB}`);

  step("Alice bets 0.8 ETH on YES...");
  await (await contract.connect(alice).takePosition(marketIdB, 1, {
    value: ethers.parseEther("0.8"),
  })).wait();

  step("Bob bets 0.7 ETH on NO...");
  await (await contract.connect(bob).takePosition(marketIdB, 2, {
    value: ethers.parseEther("0.7"),
  })).wait();

  step("Waiting for deadline...");
  await new Promise((r) => setTimeout(r, 6000));

  step("Requesting settlement...");
  await (await contract.requestSettlement(marketIdB)).wait();

  // Run trial with "close" scenario — produces narrow margin
  step("Running adversarial trial (close-call scenario)...");
  const configB: PipelineConfig = {
    evidenceSources: [new MockEvidenceSource()],
    advocateYesClient: new MockLLMClient("close"),
    advocateNoClient: new MockLLMClient("close"),
    judgeClient: new MockLLMClient("close"),
    onProgress: (_stage, detail) => console.log(`    ${detail}`),
  };

  const questionB: MarketQuestion = {
    ...DEMO_QUESTION,
    id: "demo-002",
    question: "Did the EU AI Act implementation improve industry compliance by Q1 2026?",
  };

  const transcriptB = await runTrial(questionB, configB);

  step(`Trial result: ${transcriptB.decision.action}`);
  console.log(`  Reason: ${transcriptB.decision.reason}`);

  if (transcriptB.decision.action === "RESOLVE" && transcriptB.decision.verdict) {
    step("Settling onchain...");
    const txHash = await settler.settle(marketIdB, transcriptB);
    console.log(`  Settlement TX: ${txHash}`);
  } else {
    step("Escalating onchain...");
    const txHash = await settler.escalate(marketIdB, transcriptB);
    console.log(`  Escalation TX: ${txHash}`);
  }

  const marketB = await contract.getMarket(marketIdB);
  console.log(`  Onchain status: ${["Open", "SettlementRequested", "Resolved", "Escalated"][Number(marketB.status)]}`);

  // ════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════

  log("DEMO COMPLETE");
  console.log(`
  Scenario A: ${transcriptA.decision.action}
    Question: ${DEMO_QUESTION.question}
    Score: YES ${transcriptA.judgeRuling.scoreYes} vs NO ${transcriptA.judgeRuling.scoreNo}
    Margin: ${transcriptA.decision.margin} (threshold: ${DEMO_QUESTION.rubric.confidenceThreshold})
    Reason: ${transcriptA.decision.reason}

  Scenario B: ${transcriptB.decision.action}
    Question: ${questionB.question}
    Score: YES ${transcriptB.judgeRuling.scoreYes} vs NO ${transcriptB.judgeRuling.scoreNo}
    Margin: ${transcriptB.decision.margin} (threshold: ${DEMO_QUESTION.rubric.confidenceThreshold})
    Reason: ${transcriptB.decision.reason}

  Both markets escalated — demonstrating:
    A) Hallucination detection catches fabricated evidence citations
    B) Confidence threshold prevents auto-resolution of close calls
  `);
}

runDemo().catch((error) => {
  console.error("\nDemo failed:", error);
  process.exit(1);
});
