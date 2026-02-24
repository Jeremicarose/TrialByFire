#!/usr/bin/env node

/**
 * TrialByFire — Express API Server (Local Development Fallback)
 *
 * When running locally on Hardhat, Chainlink Functions aren't available
 * (the DON only exists on public testnets). This Express server fills
 * that gap by exposing the engine pipeline as HTTP endpoints that the
 * frontend can call directly.
 *
 * Endpoints:
 *   POST /api/trial   — Run the adversarial trial for a market
 *   POST /api/settle  — Settle or escalate a market onchain
 *   GET  /api/health  — Server health check
 *
 * Usage:
 *   USE_MOCKS=true npx tsx src/api.ts
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx tsx src/api.ts
 *
 * The frontend's Vite dev server proxies /api/* to this server
 * (configured in vite.config.ts), so CORS isn't needed in dev.
 * We include CORS headers anyway for flexibility.
 */

import "dotenv/config";
import http from "node:http";
import { runTrial } from "./pipeline/index.js";
import type { PipelineConfig } from "./pipeline/index.js";
import { createLLMClient } from "./llm/index.js";
import { MockEvidenceSource } from "./evidence/mock.js";
import { DeFiLlamaSource } from "./evidence/sources/defilama.js";
import { TreasurySource } from "./evidence/sources/treasury.js";
import { createOnchainSettler } from "./settlement/onchain.js";
import type { MarketQuestion, TrialTranscript } from "./types.js";
import type { EvidenceSource } from "./evidence/index.js";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const useMocks = process.env.USE_MOCKS === "true";

/*
 * Contract config for the onchain settler.
 * In local dev, these point to the Hardhat node.
 */
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/**
 * Parse JSON from an incoming request body.
 * Node's http module doesn't do this automatically
 * (unlike Express), so we collect chunks manually.
 */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        resolve(body);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send a JSON response with CORS headers.
 */
function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

/*
 * Build the pipeline config once at startup.
 * The same config is reused for every trial request.
 */
const evidenceSources: EvidenceSource[] = useMocks
  ? [new MockEvidenceSource()]
  : [new DeFiLlamaSource(), new TreasurySource()];

function buildPipelineConfig(): PipelineConfig {
  return {
    evidenceSources,
    advocateYesClient: createLLMClient(useMocks ? "mock" : "anthropic"),
    advocateNoClient: createLLMClient(useMocks ? "mock" : "openai"),
    judgeClient: createLLMClient(useMocks ? "mock" : "anthropic"),
    onProgress: (stage, detail) => {
      console.log(`  [${stage.toUpperCase()}] ${detail}`);
    },
  };
}

/*
 * Store completed trial transcripts in memory.
 * Keyed by marketId so the /api/settle endpoint
 * can look up the transcript for a given market.
 * In production this would be a database or IPFS.
 */
const transcriptStore = new Map<number, TrialTranscript>();

/**
 * HTTP request handler — routes requests to the correct endpoint.
 * We use Node's built-in http module instead of Express to avoid
 * adding a dependency. The API surface is tiny (3 endpoints).
 */
const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  /* Handle CORS preflight */
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
        contractAddress: CONTRACT_ADDRESS || "not set",
      });
      return;
    }

    /*
     * POST /api/trial — Run the adversarial trial.
     *
     * Request body:
     *   { marketId: number, question: string, rubricHash: string }
     *
     * Response:
     *   { transcript: TrialTranscript }
     *
     * This endpoint runs the full pipeline (evidence → advocates →
     * judge → confidence check) and returns the complete transcript.
     * The frontend displays the transcript while calling /api/settle
     * to write the result onchain.
     */
    if (method === "POST" && url === "/api/trial") {
      const body = await parseBody(req);
      const marketId = body.marketId as number;
      const questionText = body.question as string;

      if (marketId === undefined || !questionText) {
        sendJson(res, 400, { error: "Missing marketId or question" });
        return;
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(`  Running trial for market #${marketId}`);
      console.log(`  Question: ${questionText}`);
      console.log(`${"=".repeat(60)}`);

      /*
       * Build a MarketQuestion from the request.
       * The rubric is hardcoded for the hackathon — in production,
       * it would be fetched from IPFS using the rubricHash.
       */
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

      /* Store for later settlement */
      transcriptStore.set(marketId, transcript);

      console.log(`\n  Trial complete: ${transcript.decision.action}`);
      if (transcript.decision.verdict) {
        console.log(`  Verdict: ${transcript.decision.verdict}`);
      }

      sendJson(res, 200, { transcript });
      return;
    }

    /*
     * POST /api/settle — Write the trial result onchain.
     *
     * Request body:
     *   { marketId: number }
     *
     * Response:
     *   { txHash: string, action: string, verdict: string | null }
     *
     * Looks up the stored transcript for marketId, then calls
     * settle() or escalate() on the contract via the OnchainSettler.
     * Requires CONTRACT_ADDRESS and PRIVATE_KEY in environment.
     */
    if (method === "POST" && url === "/api/settle") {
      const body = await parseBody(req);
      const marketId = body.marketId as number;

      if (marketId === undefined) {
        sendJson(res, 400, { error: "Missing marketId" });
        return;
      }

      const transcript = transcriptStore.get(marketId);
      if (!transcript) {
        sendJson(res, 404, { error: `No transcript found for market #${marketId}. Run /api/trial first.` });
        return;
      }

      if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
        sendJson(res, 500, { error: "CONTRACT_ADDRESS and PRIVATE_KEY must be set in environment" });
        return;
      }

      console.log(`\n  Settling market #${marketId} onchain...`);
      console.log(`  Action: ${transcript.decision.action}`);

      const settler = createOnchainSettler(RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY);
      let txHash: string;

      if (transcript.decision.action === "RESOLVE") {
        txHash = await settler.settle(marketId, transcript);
        console.log(`  Settled! TX: ${txHash}`);
      } else {
        txHash = await settler.escalate(marketId, transcript);
        console.log(`  Escalated! TX: ${txHash}`);
      }

      /* Clean up stored transcript after settlement */
      transcriptStore.delete(marketId);

      sendJson(res, 200, {
        txHash,
        action: transcript.decision.action,
        verdict: transcript.decision.verdict,
      });
      return;
    }

    /* 404 for everything else */
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("  Error:", message);
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  TRIALBYFIRE — API Server");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  Mode:     ${useMocks ? "MOCK (no API keys)" : "LIVE (real APIs)"}`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Contract: ${CONTRACT_ADDRESS || "(not set)"}`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET  /api/health  — Server status`);
  console.log(`    POST /api/trial   — Run adversarial trial`);
  console.log(`    POST /api/settle  — Settle market onchain`);
  console.log(`${"=".repeat(60)}\n`);
});
