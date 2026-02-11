import type { EvidenceItem, MarketQuestion } from "../../types.js";
import type { EvidenceSource } from "../index.js";

/**
 * US Treasury evidence source — fetches interest rate data from
 * the Treasury's Fiscal Data API.
 *
 * This is a free, public US government API with no key required.
 * We fetch average interest rates for Treasury securities, which
 * provides the "risk-free rate" comparison baseline for the
 * ETH staking yield question.
 *
 * API docs: https://fiscaldata.treasury.gov/api-documentation/
 */
export class TreasurySource implements EvidenceSource {
  name = "treasury";

  async fetch(question: MarketQuestion): Promise<EvidenceItem[]> {
    const items: EvidenceItem[] = [];
    const now = new Date();

    try {
      // Fetch average interest rates on Treasury securities
      // Sort by most recent, limit to 10 records
      const url =
        "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/" +
        "v2/accounting/od/avg_interest_rates" +
        "?sort=-record_date&page[size]=10" +
        "&fields=record_date,security_desc,avg_interest_rate_amt";

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        const records = data.data;

        if (records?.length > 0) {
          // Group by date, extract key securities
          const summary = records
            .filter(
              (r: { security_desc: string }) =>
                r.security_desc?.includes("Treasury Note") ||
                r.security_desc?.includes("Treasury Bond") ||
                r.security_desc?.includes("Treasury Bill")
            )
            .map(
              (r: {
                record_date: string;
                security_desc: string;
                avg_interest_rate_amt: string;
              }) =>
                `${r.security_desc}: ${r.avg_interest_rate_amt}% (as of ${r.record_date})`
            )
            .join("; ");

          if (summary) {
            items.push({
              source: "treasury",
              title: "US Treasury: Average Interest Rates (Recent)",
              content: `Recent average interest rates on US Treasury securities: ${summary}`,
              url: "https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities",
              retrievedAt: now,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`[treasury] Failed to fetch rates: ${error}`);
    }

    return items;
  }
}
