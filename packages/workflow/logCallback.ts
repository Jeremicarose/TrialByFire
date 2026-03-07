// packages/workflow/logCallback.ts
// Handles SettlementRequested events: decode → AI trial → write settlement report

import {
  cre,
  type Runtime,
  type EVMLog,
  getNetwork,
  bytesToHex,
  hexToBase64,
  TxStatus,
} from "@chainlink/cre-sdk";
import {
  decodeEventLog,
  parseAbi,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { askAnthropic } from "./trial";

type Config = {
  anthropicModel: string;
  evms: Array<{
    marketAddress: string;
    chainSelectorName: string;
    gasLimit: string;
  }>;
};

interface TrialResult {
  result: "YES" | "NO";
  confidence: number; // 0-10000
}

// ABI for decoding the SettlementRequested event
const EVENT_ABI = parseAbi([
  "event SettlementRequested(uint256 indexed marketId, string question)",
]);

// ABI parameters for the settlement report (matches _processReport in TrialMarket.sol)
// outcome: 0 = Yes, 1 = No
const SETTLEMENT_PARAMS = parseAbiParameters("uint256 marketId, uint8 outcome, uint16 confidence");

/**
 * CRE Log Trigger handler for market settlement.
 *
 * Flow:
 * 1. Decode the SettlementRequested event to get marketId and question
 * 2. Query Anthropic AI with condensed adversarial trial prompt
 * 3. Encode settlement data with 0x01 prefix
 * 4. Write signed report to contract via KeystoneForwarder
 */
export function onLogTrigger(runtime: Runtime<Config>, log: EVMLog): string {
  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  runtime.log("TrialByFire CRE Workflow: Settlement Trial");
  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    // ─────────────────────────────────────────────────────────────
    // Step 1: Decode the SettlementRequested event
    // ─────────────────────────────────────────────────────────────
    const topics = log.topics.map((t: Uint8Array) => bytesToHex(t)) as [
      `0x${string}`,
      ...`0x${string}`[]
    ];
    const data = bytesToHex(log.data);

    const decodedLog = decodeEventLog({ abi: EVENT_ABI, data, topics });
    const marketId = decodedLog.args.marketId as bigint;
    const question = decodedLog.args.question as string;

    runtime.log(`[Step 1] Settlement requested for Market #${marketId}`);
    runtime.log(`[Step 1] Question: "${question}"`);

    // ─────────────────────────────────────────────────────────────
    // Step 2: Run adversarial trial via Anthropic AI
    // ─────────────────────────────────────────────────────────────
    runtime.log("[Step 2] Running adversarial trial via Anthropic...");

    const trialResult = askAnthropic(runtime, question);

    // Parse the AI response
    const jsonMatch = trialResult.response.match(/\{[\s\S]*"result"[\s\S]*"confidence"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse AI response: ${trialResult.response}`);
    }
    const parsed = JSON.parse(jsonMatch[0]) as TrialResult;

    if (!["YES", "NO"].includes(parsed.result)) {
      throw new Error(`Invalid result: ${parsed.result}. Must be YES or NO.`);
    }
    if (parsed.confidence < 0 || parsed.confidence > 10000) {
      throw new Error(`Invalid confidence: ${parsed.confidence}`);
    }

    runtime.log(`[Step 2] Verdict: ${parsed.result}`);
    runtime.log(`[Step 2] Confidence: ${parsed.confidence / 100}%`);

    // Convert result to outcome value (0 = Yes, 1 = No)
    const outcomeValue = parsed.result === "YES" ? 0 : 1;

    // ─────────────────────────────────────────────────────────────
    // Step 3: Generate and write settlement report
    // ─────────────────────────────────────────────────────────────
    runtime.log("[Step 3] Generating settlement report...");

    const evmConfig = runtime.config.evms[0];
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: evmConfig.chainSelectorName,
      isTestnet: true,
    });

    if (!network) {
      throw new Error(`Unknown chain: ${evmConfig.chainSelectorName}`);
    }

    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

    // Encode settlement data
    const settlementData = encodeAbiParameters(SETTLEMENT_PARAMS, [
      marketId,
      outcomeValue,
      parsed.confidence,
    ]);

    // Prepend 0x01 prefix so contract routes to _processReport → settlement
    const reportData = ("0x01" + settlementData.slice(2)) as `0x${string}`;

    const reportResponse = runtime
      .report({
        encodedPayload: hexToBase64(reportData),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      })
      .result();

    runtime.log(`[Step 3] Writing to contract: ${evmConfig.marketAddress}`);

    const writeResult = evmClient
      .writeReport(runtime, {
        receiver: evmConfig.marketAddress,
        report: reportResponse,
        gasConfig: {
          gasLimit: evmConfig.gasLimit,
        },
      })
      .result();

    if (writeResult.txStatus === TxStatus.SUCCESS) {
      const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
      runtime.log(`[Step 3] Settlement successful: ${txHash}`);
      runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return `Settled Market #${marketId}: ${txHash}`;
    }

    throw new Error(`Transaction failed: ${writeResult.txStatus}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.log(`[ERROR] ${msg}`);
    runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    throw err;
  }
}
