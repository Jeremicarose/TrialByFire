import { ethers } from "hardhat";
async function main() {
  const c = await ethers.getContractAt("TrialMarket", "0x07E2257a60A3AA4A8ed58D256C371b510671331e");
  const m = await c.getMarket(0);
  console.log("Status:", Number(m.status), "(3=Escalated, 2=Resolved)");
  console.log("Outcome:", Number(m.outcome), "(0=None, 1=Yes, 2=No)");
  console.log("TranscriptHash:", m.transcriptHash);

  // Check fulfillment events
  const filter = c.filters.MarketEscalated(0);
  const events = await c.queryFilter(filter);
  console.log("\nEscalation events:", events.length);
  for (const e of events) {
    console.log("  TX:", e.transactionHash);
  }

  const resolveFilter = c.filters.MarketResolved(0);
  const resolveEvents = await c.queryFilter(resolveFilter);
  console.log("Resolution events:", resolveEvents.length);
}
main();
