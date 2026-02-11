import type { EvidenceItem, MarketQuestion } from "../types.js";
import type { EvidenceSource } from "./index.js";

/**
 * Mock evidence source that returns realistic fixture data.
 *
 * These fixtures are crafted to support a meaningful adversarial debate
 * about the demo question ("Did ETH staking yields outperform US Treasury
 * rates in January 2026?"). The data is intentionally balanced — some
 * items favor YES, some favor NO — so both advocates have material to
 * work with.
 */
export class MockEvidenceSource implements EvidenceSource {
  name = "mock";

  async fetch(_question: MarketQuestion): Promise<EvidenceItem[]> {
    const now = new Date();

    return [
      {
        source: "defilama",
        title: "DeFiLlama: ETH Staking APR January 2026",
        content:
          "Ethereum staking yields averaged 4.2% APR across January 2026, aggregated from Lido (4.1%), Rocket Pool (4.3%), and Coinbase (4.2%). Daily range: 3.7% - 4.6%. Yields dipped below 4.0% during Jan 1-7 due to reduced network activity.",
        url: "https://defillama.com/yields?project=ethereum-staking",
        retrievedAt: now,
      },
      {
        source: "treasury",
        title: "US Treasury: Average Interest Rates January 2026",
        content:
          "The 10-year Treasury note yield averaged 3.9% in January 2026, ranging from 3.85% to 3.95%. The 30-day T-Bill rate averaged 4.1%. Treasury yields remained stable throughout the month with minimal daily variance.",
        url: "https://api.fiscaldata.treasury.gov",
        retrievedAt: now,
      },
      {
        source: "treasury",
        title: "US Treasury: Daily Yield Curve Rates",
        content:
          "Daily yield curve data shows 10-year rates at: Jan 1-7: 3.88%, Jan 8-14: 3.91%, Jan 15-21: 3.90%, Jan 22-31: 3.92%. The curve remained flat with no significant inversions during the period.",
        url: "https://home.treasury.gov/resource-center/data-chart-center",
        retrievedAt: now,
      },
      {
        source: "newsapi",
        title: "CoinDesk: ETH Staking vs Treasury Yields Analysis",
        content:
          "Analysis by CoinDesk Research shows ETH staking yields outperformed 10-year Treasuries for 26 of 31 days in January 2026, with an average spread of 0.3 percentage points. The five days of underperformance clustered in early January during the New Year holiday period when validator participation temporarily dropped.",
        url: "https://coindesk.com/research/eth-staking-yields-jan-2026",
        retrievedAt: now,
      },
      {
        source: "newsapi",
        title: "The Block: Institutional Demand for ETH Staking Grows",
        content:
          "Institutional staking deposits grew 18% in January 2026 according to The Block Research. Several major asset managers cited the yield premium over Treasuries as a key factor. However, analysts note that staking yields carry smart contract risk and are not directly comparable to risk-free Treasury rates.",
        url: "https://theblock.co/research/institutional-eth-staking",
        retrievedAt: now,
      },
      {
        source: "defilama",
        title: "DeFiLlama: Validator Penalty Data January 2026",
        content:
          "Validator slashing and inactivity penalties totaled approximately 0.05% drag on aggregate staking returns in January 2026. This is within normal historical ranges. MEV rewards contributed an additional 0.15% to total staking returns above the base consensus yield.",
        url: "https://defillama.com/yields/ethereum-penalties",
        retrievedAt: now,
      },
      {
        source: "newsapi",
        title: "Reuters: Federal Reserve Holds Rates Steady",
        content:
          "The Federal Reserve maintained its benchmark interest rate at 4.25% at its January 2026 meeting, citing stable inflation expectations. Treasury yields showed minimal reaction, with the 10-year holding steady near 3.9%. Market expectations for rate cuts later in 2026 remain muted.",
        url: "https://reuters.com/business/fed-holds-rates-jan-2026",
        retrievedAt: now,
      },
    ];
  }
}
