import type { EvidenceItem, MarketQuestion } from "../../types.js";
import type { EvidenceSource } from "../index.js";

/**
 * DeFiLlama evidence source — fetches DeFi yield and TVL data.
 *
 * DeFiLlama's API is free and requires no API key, making it ideal
 * for a hackathon. We hit two endpoints:
 *   - /pools: Staking yield data for ETH validators
 *   - /protocol/lido: Protocol-specific TVL and yield data
 *
 * The fetched data is transformed into EvidenceItem format so
 * advocates can cite it in their arguments.
 */
export class DeFiLlamaSource implements EvidenceSource {
  name = "defilama";

  async fetch(question: MarketQuestion): Promise<EvidenceItem[]> {
    const items: EvidenceItem[] = [];
    const now = new Date();

    try {
      // Fetch ETH staking pool yields
      const poolsRes = await fetch(
        "https://yields.llama.fi/pools"
      );

      if (poolsRes.ok) {
        const poolsData = await poolsRes.json();

        // Filter for ETH staking pools (Lido, Rocket Pool, Coinbase)
        const ethStakingPools = poolsData.data
          ?.filter(
            (pool: { project: string; symbol: string }) =>
              pool.symbol?.toUpperCase().includes("ETH") &&
              ["lido", "rocket-pool", "coinbase-wrapped-staked-eth"].includes(
                pool.project
              )
          )
          ?.slice(0, 5);

        if (ethStakingPools?.length > 0) {
          const avgApy =
            ethStakingPools.reduce(
              (sum: number, p: { apy: number }) => sum + (p.apy || 0),
              0
            ) / ethStakingPools.length;

          items.push({
            source: "defilama",
            title: "DeFiLlama: ETH Staking Pool Yields (Current)",
            content: `Current ETH staking yields from DeFiLlama: average APY across ${ethStakingPools.length} major pools is ${avgApy.toFixed(2)}%. Individual pools: ${ethStakingPools.map((p: { project: string; apy: number }) => `${p.project}: ${p.apy?.toFixed(2)}%`).join(", ")}.`,
            url: "https://defillama.com/yields?project=lido",
            retrievedAt: now,
          });
        }
      }
    } catch (error) {
      console.warn(`[defilama] Failed to fetch pools: ${error}`);
    }

    try {
      // Fetch Lido protocol data for TVL context
      const lidoRes = await fetch(
        "https://api.llama.fi/protocol/lido"
      );

      if (lidoRes.ok) {
        const lidoData = await lidoRes.json();
        const currentTvl = lidoData.currentChainTvls?.Ethereum;

        if (currentTvl) {
          items.push({
            source: "defilama",
            title: "DeFiLlama: Lido Protocol TVL",
            content: `Lido (largest ETH staking provider) currently has $${(currentTvl / 1e9).toFixed(2)}B TVL on Ethereum. This represents the largest share of staked ETH.`,
            url: "https://defillama.com/protocol/lido",
            retrievedAt: now,
          });
        }
      }
    } catch (error) {
      console.warn(`[defilama] Failed to fetch Lido data: ${error}`);
    }

    return items;
  }
}
