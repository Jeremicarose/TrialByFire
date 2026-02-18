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
 * would be transferred to the CRE Forwarder address.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying TrialMarket with account:", deployer.address)

  const TrialMarket = await ethers.getContractFactory("TrialMarket");
  const market = await TrialMarket.deploy();
  await market.waitForDeployment();

  const address = await market.getAddress();
  
}