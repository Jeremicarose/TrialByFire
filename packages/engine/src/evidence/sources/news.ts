import type { EvidenceItem, MarketQuestion } from "../../types.js";
import type { EvidenceSource } from "../index.js";

/**
 * NewsAPI evidence source — fetches relevant news articles.
 *
 * Requires NEWS_API_KEY in environment (free tier at newsapi.org).
 * If the key is missing, returns an empty array rather than crashing,
 * so the pipeline degrades gracefully.
 *
 * We extract keywords from the market question to build a search query,
 * then take the top 5 most relevant articles as evidence items.
 */
export class NewsAPISource implements EvidenceSource {
  name = "newsapi";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.NEWS_API_KEY || "";
  }

  async fetch(question: MarketQuestion): Promise<EvidenceItem[]> {
    if (!this.apiKey) {
      console.warn("[newsapi] NEWS_API_KEY not set — skipping news evidence");
      return [];
    }

    const items: EvidenceItem[] = [];
    const now = new Date();

    try {
      // Extract meaningful keywords from the question for search
      const keywords = extractKeywords(question.question);
      const query = encodeURIComponent(keywords);

      const url =
        `https://newsapi.org/v2/everything` +
        `?q=${query}` +
        `&sortBy=relevancy` +
        `&pageSize=5` +
        `&language=en` +
        `&apiKey=${this.apiKey}`;

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        if (data.articles?.length > 0) {
          for (const article of data.articles) {
            items.push({
              source: "newsapi",
              title: `${article.source?.name || "News"}: ${article.title}`,
              content:
                article.description ||
                article.content?.slice(0, 500) ||
                "No content available",
              url: article.url,
              retrievedAt: now,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`[newsapi] Failed to fetch news: ${error}`);
    }

    return items;
  }
}

/**
 * Extracts meaningful search keywords from a market question.
 * Strips common filler words to improve search relevance.
 */
function extractKeywords(question: string): string {
  const stopWords = new Set([
    "did",
    "does",
    "do",
    "the",
    "a",
    "an",
    "in",
    "of",
    "by",
    "was",
    "is",
    "are",
    "were",
    "been",
    "be",
    "to",
    "for",
    "and",
    "or",
    "its",
    "it",
    "has",
    "have",
    "had",
    "that",
    "this",
    "with",
  ]);

  return question
    .replace(/[?.,!]/g, "")
    .split(/\s+/)
    .filter((word) => !stopWords.has(word.toLowerCase()))
    .slice(0, 8) // Cap at 8 keywords to keep the query focused
    .join(" ");
}
