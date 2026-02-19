import { ethers } from "ethers";
import type { TrialTranscript } from "../types.js";

/**
 * OnchainSettler interface — abstracts the contract interaction
 * so we can swap implementations (ethers.js now, CRE EVM Client later).
 */
export interface OnchainSettler {
  /** Call settle() on the contract. Returns the transaction hash. */
  settle(marketId: number, transcript: TrialTranscript): Promise<string>;

  /** Call escalate() on the contract. Returns the transaction hash. */
  escalate(marketId: number, transcript: TrialTranscript): Promise<string>;
}

/*
 * ABI subset — only the functions we call.
 * We don't need the full ABI because we only interact with
 * settle() and escalate(). This keeps the module lightweight
 * and avoids importing the entire Hardhat artifacts directory.
 */
const TRIAL_MARKET_ABI = [
  "function settle(uint256 marketId, uint8 outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash) external",
  "function escalate(uint256 marketId, bytes32 transcriptHash) external",
];

/**
 * Creates an OnchainSettler that uses ethers.js to interact with
 * the TrialMarket contract on a given network.
 *
 * @param rpcUrl        - The JSON-RPC endpoint (e.g. Sepolia RPC or localhost:8545)
 * @param contractAddress - Deployed TrialMarket contract address
 * @param privateKey    - The settler's private key (must be contract owner)
 *
 * Why privateKey and not a Signer?
 * For the hackathon demo, we run this from a CLI script where we have
 * the deployer's private key in .env. In production (CRE), the signing
 * happens inside the DON via the Forwarder contract — no private key needed.
 */
export function createOnchainSettler(
  rpcUrl: string,
  contractAddress: string,
  privateKey: string
): OnchainSettler {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, TRIAL_MARKET_ABI, signer);

  return {
    async settle(marketId: number, transcript: TrialTranscript): Promise<string> {
      /*
       * Hash the full transcript JSON for onchain storage.
       * keccak256 produces a 32-byte hash that uniquely identifies
       * this trial. Anyone can later verify a transcript by hashing
       * it and comparing against the stored hash.
       */
      const transcriptHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(transcript))
      );

      /*
       * Map our Verdict string to the contract's enum value.
       * Solidity enum: None=0, Yes=1, No=2
       * Our TypeScript: "YES" or "NO"
       */
      const verdictEnum = transcript.decision.verdict === "YES" ? 1 : 2;

      const tx = await contract.settle(
        marketId,
        verdictEnum,
        transcript.judgeRuling.scoreYes,
        transcript.judgeRuling.scoreNo,
        transcriptHash
      );

      const receipt = await tx.wait();
      return receipt.hash;
    },

    async escalate(marketId: number, transcript: TrialTranscript): Promise<string> {
      const transcriptHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(transcript))
      );

      const tx = await contract.escalate(marketId, transcriptHash);
      const receipt = await tx.wait();
      return receipt.hash;
    },
  };
}
