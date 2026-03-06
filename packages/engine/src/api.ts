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

/* ── Contract ABI (for reading market state + triggering Chainlink) ── */
const CONTRACT_ABI = [
  "function getMarket(uint256 marketId) view returns (tuple(string question, string rubricHash, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, bytes32 transcriptHash, address creator, uint256 creationDeposit))",
  "function nextMarketId() view returns (uint256)",
  "function requestSettlement(uint256 marketId)",
  "function sendTrialRequest(uint256 marketId) returns (bytes32)",
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

/* IPFS CID store — maps marketId to Pinata CID */
const cidStore = new Map<number, string>();

/**
 * Upload transcript JSON to Pinata IPFS.
 * Returns the CID string on success, null on failure.
 */
async function uploadToIpfs(transcript: TrialTranscript, marketId: number): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;

  try {
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataContent: transcript,
        pinataMetadata: { name: `trialbyfire-market-${marketId}` },
      }),
    });

    if (response.ok) {
      const data = await response.json() as { IpfsHash: string };
      return data.IpfsHash;
    }
  } catch (err) {
    console.error("  [IPFS] Upload failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

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

    /* Upload transcript to IPFS for persistence */
    const cid = await uploadToIpfs(transcript, marketId);
    if (cid) {
      console.log(`  [IPFS] Transcript pinned: ${cid}`);
      cidStore.set(marketId, cid);
    }

    /* Auto-settle onchain */
    if (CONTRACT_ADDRESS && PRIVATE_KEY) {
      console.log(`  Settling market #${marketId} onchain...`);
      const settler = createOnchainSettler(RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY);
      let txHash: string;

      if (transcript.decision.action === "RESOLVE") {
        txHash = await settler.settle(marketId, transcript, cid || undefined);
        console.log(`  Settled! TX: ${txHash}`);
      } else {
        txHash = await settler.escalate(marketId, transcript, cid || undefined);
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

/*
 * ── Automation Loop ──
 *
 * This loop bridges deadlines to Chainlink Functions.
 * It does NOT run the trial locally — it triggers the DON.
 *
 * Flow:
 *   1. Detect markets past deadline with status Open
 *      → call requestSettlement() to transition to SettlementRequested
 *   2. Detect markets with status SettlementRequested
 *      → call sendTrialRequest() to trigger Chainlink Functions on the DON
 *   3. The DON executes trial-source.js (evidence + advocates + judge)
 *   4. DON nodes reach consensus and call _fulfillRequest() on the contract
 *   5. The contract auto-resolves or escalates — fully decentralized
 *
 * In production, Chainlink Automation keepers handle step 1 via
 * checkUpkeep()/performUpkeep(). This loop is a backup that also
 * triggers sendTrialRequest() (step 2), which keepers don't do.
 */
async function automationLoop() {
  if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
    console.log("  [AUTO] No CONTRACT_ADDRESS or PRIVATE_KEY — automation disabled.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  console.log("  [AUTO] Automation loop started (polling every 30s)...");
  console.log("  [AUTO] Mode: DECENTRALIZED — triggering Chainlink Functions DON\n");

  const poll = async () => {
    try {
      const count = Number(await contract.nextMarketId());
      const now = Math.floor(Date.now() / 1000);

      for (let i = 0; i < count; i++) {
        if (processingMarkets.has(i)) continue;

        const raw = await contract.getMarket(i);
        const status = Number(raw.status);
        const deadline = Number(raw.deadline);

        /* OPEN + past deadline → request settlement */
        if (status === STATUS.Open && now >= deadline) {
          console.log(`  [AUTO] Market #${i} deadline passed — requesting settlement...`);
          try {
            const tx = await contract.requestSettlement(i);
            await tx.wait();
            console.log(`  [AUTO] Market #${i} settlement requested.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("Market not open")) {
              console.error(`  [AUTO] requestSettlement failed for #${i}: ${msg}`);
            }
          }
        }

        /*
         * SETTLEMENT REQUESTED → trigger Chainlink Functions DON
         *
         * This calls sendTrialRequest() on the contract, which:
         *   1. Reads ETH/USD from Chainlink Data Feeds
         *   2. Builds a Chainlink Functions request with the trial JS source
         *   3. Sends it to the DON via the Functions Router
         *   4. DON nodes execute trial-source.js independently
         *   5. DON reaches consensus → calls _fulfillRequest()
         *   6. Contract auto-resolves or escalates
         *
         * The trial runs entirely on the DON — not on this server.
         */
        if (status === STATUS.SettlementRequested) {
          processingMarkets.add(i);
          console.log(`  [AUTO] Market #${i} awaiting trial — triggering Chainlink Functions DON...`);
          try {
            const tx = await contract.sendTrialRequest(i);
            const receipt = await tx.wait();
            console.log(`  [AUTO] Market #${i} trial request sent to DON! TX: ${receipt.hash}`);
            console.log(`  [AUTO] DON will execute trial-source.js and call _fulfillRequest() when done.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("Settlement not requested")) {
              /* Already processed — Chainlink Automation may have called it first */
              console.log(`  [AUTO] Market #${i} already being processed by DON.`);
            } else {
              console.error(`  [AUTO] sendTrialRequest failed for #${i}: ${msg}`);

              /*
               * Fallback: if Chainlink Functions fails (e.g., subscription out of LINK,
               * secrets expired, source not set), run the trial locally as backup.
               */
              console.log(`  [AUTO] Falling back to local trial for market #${i}...`);
              runTrialAndSettle(i, raw.question);
            }
          } finally {
            /* Remove from processing after a delay to avoid re-triggering
             * while the DON is still executing (typically takes 30-60s) */
            setTimeout(() => processingMarkets.delete(i), 120_000);
          }
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

    /* ── GET /api/transcript/:marketId ── (fetch trial results for display) */
    const transcriptMatch = method === "GET" && url?.match(/^\/api\/transcript\/(\d+)$/);
    if (transcriptMatch) {
      const marketId = parseInt(transcriptMatch[1], 10);
      const transcript = transcriptStore.get(marketId);
      if (transcript) {
        sendJson(res, 200, { transcript });
      } else {
        sendJson(res, 404, { error: "No transcript found for this market" });
      }
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
  console.log(`    GET  /api/health            — Server status`);
  console.log(`    GET  /api/transcript/:id    — Fetch trial results`);
  console.log(`    POST /api/trial             — Run adversarial trial (manual)`);
  console.log(`    POST /api/settle            — Settle market onchain (manual)`);
  console.log(`${"=".repeat(60)}\n`);

  /* Start automation loop after server is ready */
  automationLoop();
});
