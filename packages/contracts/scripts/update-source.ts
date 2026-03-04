/**
 * Update the Chainlink Functions source code on an existing TrialMarket contract.
 *
 * Usage:
 *   npx hardhat run scripts/update-source.ts --network sepolia
 *
 * Reads trial-source.js and calls setFunctionsSource() on the deployed contract.
 * This avoids redeploying the entire contract just to update the JavaScript.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.error("CONTRACT_ADDRESS not set in .env");
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\n  Updating Functions source on ${contractAddress}`);
  console.log(`  Deployer: ${deployer.address}`);

  const abi = ["function setFunctionsSource(string calldata source) external"];
  const contract = new ethers.Contract(contractAddress, abi, deployer);

  const sourcePath = path.join(__dirname, "../functions/trial-source.js");
  const source = fs.readFileSync(sourcePath, "utf8");

  console.log(`  Source: ${source.length} bytes`);
  console.log("  Sending transaction...");

  const tx = await contract.setFunctionsSource(source);
  await tx.wait();

  console.log(`  Updated! TX: ${tx.hash}`);
  console.log(`  The DON will now use the new dynamic evidence routing.\n`);
}

main().catch((error) => {
  console.error("Update failed:", error);
  process.exitCode = 1;
});
