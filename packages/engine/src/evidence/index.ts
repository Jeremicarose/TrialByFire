import type { MarketQuestion, EvidenceBundle, EvidenceItem } from "../types.js";

/**
 * Interface for evidence sources. Each source knows how to fetch
 * data relevant to a market question from a specific API/provider.
 *
 * Adding a new source (e.g., Reddit API) means implementing this
 * interface — the orchestrator picks it up automatically.
 */
export interface EvidenceSource {
  name: string;
  fetch(question: MarketQuestion): Promise<EvidenceItem[]>;
}

/**
 * Gathers evidence from all provided sources in parallel.
 *
 * Uses Promise.allSettled (not Promise.all) so that if one source
 * fails (e.g., API key missing, rate limited), the others still
 * contribute their data. Failed sources are logged but don't
 * crash the pipeline.
 */
export async function gatherEvidence(
  question: MarketQuestion,
  sources: EvidenceSource[]
): Promise<EvidenceBundle> {
  const results = await Promise.allSettled(
    sources.map((source) => source.fetch(question))
  );

  const items: EvidenceItem[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      // Log the failure but don't crash — other sources may succeed
      console.warn(
        `[evidence] Source "${sources[index].name}" failed: ${result.reason}`
      );
    }
  });

  return {
    questionId: question.id,
    items,
    gatheredAt: new Date(),
  };
}

// Re-export source implementations for convenience
export { MockEvidenceSource } from "./mock.js";
export { DeFiLlamaSource } from "./sources/defilama.js";
export { NewsAPISource } from "./sources/news.js";
export { TreasurySource } from "./sources/treasury.js";
