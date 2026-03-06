import { ethers } from "ethers";
import type { TrialTranscript } from "../types.js";

/**
 * OnchainSettler interface — abstracts the contract interaction
 * so we can swap implementations (ethers.js now, CRE EVM Client later).
 */
export interface OnchainSettler {
  /** Call settle() on the contract. Returns the transaction hash. */
  settle(marketId: number, transcript: TrialTranscript, ipfsCid?: string): Promise<string>;

  /** Call escalate() on the contract. Returns the transaction hash. */
  escalate(marketId: number, transcript: TrialTranscript, ipfsCid?: string): Promise<string>;
}

/*
 * ABI subset — only the functions we call.
 * settle/escalate now include cidA/cidB for IPFS transcript storage.
 */
const TRIAL_MARKET_ABI = [
  "function settle(uint256 marketId, uint8 outcome, uint256 scoreYes, uint256 scoreNo, bytes32 transcriptHash, bytes32 cidA, bytes32 cidB) external",
  "function escalate(uint256 marketId, bytes32 transcriptHash, bytes32 cidA, bytes32 cidB) external",
];

/**
 * Encode an IPFS CID string into two bytes32 values.
 * CIDv0 is 46 ASCII chars — first 32 go into cidA, remaining into cidB.
 */
function cidToBytes32Pair(cid: string | undefined): [string, string] {
  if (!cid) {
    return [ethers.zeroPadBytes("0x", 32), ethers.zeroPadBytes("0x", 32)];
  }
  const bytes = ethers.toUtf8Bytes(cid);
  const partA = bytes.slice(0, 32);
  const partB = bytes.slice(32);
  return [
    ethers.hexlify(ethers.getBytes(ethers.zeroPadBytes(ethers.hexlify(partA), 32))),
    ethers.hexlify(ethers.getBytes(ethers.zeroPadBytes(partB.length > 0 ? ethers.hexlify(partB) : "0x", 32))),
  ];
}

/**
 * Creates an OnchainSettler that uses ethers.js to interact with
 * the TrialMarket contract on a given network.
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
    async settle(marketId: number, transcript: TrialTranscript, ipfsCid?: string): Promise<string> {
      const transcriptHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(transcript))
      );

      const verdictEnum = transcript.decision.verdict === "YES" ? 1 : 2;
      const [cidA, cidB] = cidToBytes32Pair(ipfsCid);

      const tx = await contract.settle(
        marketId,
        verdictEnum,
        Math.round(transcript.judgeRuling.scoreYes),
        Math.round(transcript.judgeRuling.scoreNo),
        transcriptHash,
        cidA,
        cidB
      );

      const receipt = await tx.wait();
      return receipt.hash;
    },

    async escalate(marketId: number, transcript: TrialTranscript, ipfsCid?: string): Promise<string> {
      const transcriptHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(transcript))
      );

      const [cidA, cidB] = cidToBytes32Pair(ipfsCid);

      const tx = await contract.escalate(marketId, transcriptHash, cidA, cidB);
      const receipt = await tx.wait();
      return receipt.hash;
    },
  };
}
