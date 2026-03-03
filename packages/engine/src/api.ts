#!/usr/bin/env node

/**
 * TrialByFire — API Server with Auto-Settlement
 *
 * This server does TWO things:
 *
 * 1. HTTP API — Exposes endpoints for the frontend to trigger trials manually
 * 2. Automation Loop — Polls the contract every 30s, automatically:
 *    - Detects markets past deadline with status Open → calls requestSettlement
 *    - Detects markets with status SettlementRequested → runs trial → settles onchain
 *
 * The automation loop is the local equivalent of Chainlink Automation + Functions.
 * On the DON, Chainlink keepers call checkUpkeep/performUpkeep automatically.
 * Here, we do the same thing from this server using the deployer key.
 *
 * Endpoints:
 *   GET  /api/health  — Server health check
 *   POST /api/trial   — Run adversarial trial (manual trigger)
 *   POST /api/settle  — Settle market onchain (manual trigger)
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import http from "node:http";
import { ethers } from "ethers";
import { runTrial } from "./pipeline/index.js";
import type { PipelineConfig } from "./pipeline/index.js";
import { createLLMClient } from "./llm/index.js";
import { MockEvidenceSource } from "./evidence/mock.js";
import { DeFiLlamaSource } from "./evidence/sources/defilama.js";
import { TreasurySource } from "./evidence/sources/treasury.js";
import { DynamicEvidenceSource } from "./evidence/sources/dynamic.js";
import { createOnchainSettler } from "./settlement/onchain.js";
import type { MarketQuestion, TrialTranscript } from "./types.js";
import type { EvidenceSource } from "./evidence/index.js";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const useMocks = process.env.USE_MOCKS === "true";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/* Automation polling interval (30 seconds) */
const POLL_INTERVAL = 30_000;

/* ── Contract ABI (for reading market state + requestSettlement) ── */
const CONTRACT_ABI = [
  "function getMarket(uint256 marketId) view returns (tuple(string question, string rubricHash, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, bytes32 transcriptHash, address creator, uint256 creationDeposit))",
  "function nextMarketId() view returns (uint256)",
  "function requestSettlement(uint256 marketId)",
  "function settle(uint256 marketId, uint8 outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash)",
  "function escalate(uint256 marketId, bytes32 transcriptHash)",
];

/* Market status enum matching the contract */
const STATUS = { Open: 0, SettlementRequested: 1, Resolved: 2, Escalated: 3 };

/* ── Helpers ── */

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

/* ── Pipeline Config ── */

/*
 * Evidence sources: Dynamic routing replaces hardcoded sources.
 *
 * DynamicEvidenceSource uses an LLM to analyze the question and
 * determine which free public APIs to call — CoinGecko for crypto
 * prices, DeFiLlama for DeFi yields, Treasury for economics,
 * Wikipedia for general knowledge, sports APIs, etc.
 *
 * We keep DeFiLlama and Treasury as fallbacks in case the dynamic
 * source fails or returns no data (defense in depth).
 *
 * This is the local equivalent of what trial-source.js does on
 * the Chainlink DON — both dynamically select APIs based on the question.
 */
const dynamicLLMClient = createLLMClient(useMocks ? "mock" : "anthropic");
const evidenceSources: EvidenceSource[] = useMocks
  ? [new MockEvidenceSource()]
  : [new DynamicEvidenceSource(dynamicLLMClient), new DeFiLlamaSource(), new TreasurySource()];

function buildPipelineConfig(): PipelineConfig {
  return {
    evidenceSources,
    advocateYesClient: createLLMClient(useMocks ? "mock" : "anthropic"),
    advocateNoClient: createLLMClient(useMocks ? "mock" : "anthropic"),
    judgeClient: createLLMClient(useMocks ? "mock" : "anthropic"),
    onProgress: (stage, detail) => {
      console.log(`  [${stage.toUpperCase()}] ${detail}`);
    },
  };
}

/* Transcript store (in-memory) */
const transcriptStore = new Map<number, TrialTranscript>();

/* Track which markets are currently being processed to prevent double-runs */
const processingMarkets = new Set<number>();

/* ── Core: Run trial + settle for a market ── */

async function runTrialAndSettle(marketId: number, questionText: string): Promise<void> {
  if (processingMarkets.has(marketId)) {
    console.log(`  [AUTO] Market #${marketId} already being processed, skipping.`);
    return;
  }

  processingMarkets.add(marketId);

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Running trial for market #${marketId}`);
    console.log(`  Question: ${questionText}`);
    console.log(`${"=".repeat(60)}`);

    const question: MarketQuestion = {
      id: `market-${marketId}`,
      question: questionText,
      rubric: {
        criteria: [
          { name: "Data accuracy", description: "Are the cited numbers verifiable?", weight: 30 },
          { name: "Time period coverage", description: "Does evidence cover the full period?", weight: 25 },
          { name: "Source diversity", description: "Are multiple independent sources used?", weight: 20 },
          { name: "Logical coherence", description: "Is the argument internally consistent?", weight: 25 },
        ],
        evidenceSources: ["defilama", "treasury"],
        confidenceThreshold: 20,
      },
      settlementDeadline: new Date(),
    };

    const config = buildPipelineConfig();
    const transcript = await runTrial(question, config);

    transcriptStore.set(marketId, transcript);

    console.log(`\n  Trial complete: ${transcript.decision.action}`);
    if (transcript.decision.verdict) {
      console.log(`  Verdict: ${transcript.decision.verdict}`);
    }

    /* Auto-settle onchain */
    if (CONTRACT_ADDRESS && PRIVATE_KEY) {
      console.log(`  Settling market #${marketId} onchain...`);
      const settler = createOnchainSettler(RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY);
      let txHash: string;

      if (transcript.decision.action === "RESOLVE") {
        txHash = await settler.settle(marketId, transcript);
        console.log(`  Settled! TX: ${txHash}`);
      } else {
        txHash = await settler.escalate(marketId, transcript);
        console.log(`  Escalated! TX: ${txHash}`);
      }

      /* Store txHash in transcript for frontend to pick up */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transcript as any).txHash = txHash;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [AUTO] Trial/settlement failed for market #${marketId}: ${msg}`);
  } finally {
    processingMarkets.delete(marketId);
  }
}

/* ── Automation Loop (local Chainlink Automation equivalent) ── */

async function automationLoop() {
  if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
    console.log("  [AUTO] No CONTRACT_ADDRESS or PRIVATE_KEY — automation disabled.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  console.log("  [AUTO] Automation loop started (polling every 30s)...\n");

  const poll = async () => {
    try {
      const count = Number(await contract.nextMarketId());
      const now = Math.floor(Date.now() / 1000);

      for (let i = 0; i < count; i++) {
        if (processingMarkets.has(i)) continue;

        const raw = await contract.getMarket(i);
        const status = Number(raw.status);
        const deadline = Number(raw.deadline);

        /* OPEN + past deadline → auto-request settlement */
        if (status === STATUS.Open && now >= deadline) {
          console.log(`  [AUTO] Market #${i} deadline passed — requesting settlement...`);
          try {
            const tx = await contract.requestSettlement(i);
            await tx.wait();
            console.log(`  [AUTO] Market #${i} settlement requested.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            /* Ignore if already requested */
            if (!msg.includes("Market not open")) {
              console.error(`  [AUTO] requestSettlement failed for #${i}: ${msg}`);
            }
          }
        }

        /* SETTLEMENT REQUESTED → auto-run trial + settle */
        if (status === STATUS.SettlementRequested) {
          console.log(`  [AUTO] Market #${i} awaiting trial — starting automatically...`);
          /* Run in background so we don't block other markets */
          runTrialAndSettle(i, raw.question);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [AUTO] Poll error: ${msg}`);
    }
  };

  /* Run immediately, then every POLL_INTERVAL */
  await poll();
  setInterval(poll, POLL_INTERVAL);
}

/* ── HTTP Server ── */

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "OPTIONS") {
    sendJson(res, 204, null);
    return;
  }

  try {
    /* ── GET /api/health ── */
    if (method === "GET" && url === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        mode: useMocks ? "mock" : "live",
        automation: "enabled",
        contractAddress: CONTRACT_ADDRESS || "not set",
      });
      return;
    }

    /* ── POST /api/trial ── (manual trigger, also used by frontend) */
    if (method === "POST" && url === "/api/trial") {
      const body = await parseBody(req);
      const marketId = body.marketId as number;
      const questionText = body.question as string;

      if (marketId === undefined || !questionText) {
        sendJson(res, 400, { error: "Missing marketId or question" });
        return;
      }

      await runTrialAndSettle(marketId, questionText);

      const transcript = transcriptStore.get(marketId);
      if (transcript) {
        sendJson(res, 200, { transcript });
      } else {
        sendJson(res, 500, { error: "Trial completed but transcript not available" });
      }
      return;
    }

    /* ── POST /api/settle ── (manual settle, kept for compatibility) */
    if (method === "POST" && url === "/api/settle") {
      const body = await parseBody(req);
      const marketId = body.marketId as number;

      if (marketId === undefined) {
        sendJson(res, 400, { error: "Missing marketId" });
        return;
      }

      const transcript = transcriptStore.get(marketId);
      if (!transcript) {
        /* Market may have been auto-settled already */
        sendJson(res, 200, {
          txHash: (transcript as unknown as Record<string, unknown>)?.txHash || null,
          action: "AUTO_SETTLED",
          verdict: null,
        });
        return;
      }

      /* If already settled by automation, just return the hash */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingHash = (transcript as any).txHash;
      if (existingHash) {
        sendJson(res, 200, {
          txHash: existingHash,
          action: transcript.decision.action,
          verdict: transcript.decision.verdict,
        });
        transcriptStore.delete(marketId);
        return;
      }

      /* Manual settlement fallback */
      if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
        sendJson(res, 500, { error: "CONTRACT_ADDRESS and PRIVATE_KEY must be set" });
        return;
      }

      console.log(`\n  Settling market #${marketId} onchain...`);
      const settler = createOnchainSettler(RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY);
      let txHash: string;

      if (transcript.decision.action === "RESOLVE") {
        txHash = await settler.settle(marketId, transcript);
        console.log(`  Settled! TX: ${txHash}`);
      } else {
        txHash = await settler.escalate(marketId, transcript);
        console.log(`  Escalated! TX: ${txHash}`);
      }

      transcriptStore.delete(marketId);
      sendJson(res, 200, {
        txHash,
        action: transcript.decision.action,
        verdict: transcript.decision.verdict,
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("  Error:", message);
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  TRIALBYFIRE — API Server + Automation");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Port:       ${PORT}`);
  console.log(`  Mode:       ${useMocks ? "MOCK (no API keys)" : "LIVE (real APIs)"}`);
  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Contract:   ${CONTRACT_ADDRESS || "(not set)"}`);
  console.log(`  Automation: Enabled (polling every ${POLL_INTERVAL / 1000}s)`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET  /api/health  — Server status`);
  console.log(`    POST /api/trial   — Run adversarial trial (manual)`);
  console.log(`    POST /api/settle  — Settle market onchain (manual)`);
  console.log(`${"=".repeat(60)}\n`);

  /* Start automation loop after server is ready */
  automationLoop();
});
