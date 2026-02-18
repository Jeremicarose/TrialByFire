import { ethers } from "hardhat";

/**
 * Deploy TrialMarket to the configured network.
 * 
 * Usage:
 *  npx hardhat run scripts/deploy.ts --network hardhat   (local)
 *  npx hardhat run scripts/deploy.ts --network sepolia   (testnet)
 * 
 * The deployer address become the contract owner, which is the
 * authorized settler for the hackathon demo. In production this
 * 
 */