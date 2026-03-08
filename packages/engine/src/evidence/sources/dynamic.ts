import type { EvidenceItem, MarketQuestion } from "../../types.js";
import type { EvidenceSource } from "../index.js";
import type { LLMClient } from "../../llm/index.js";

/**
 * DynamicEvidenceSource — AI-powered evidence router.
 *
 * Instead of hardcoding which APIs to call, this source:
 * 1. Sends the market question to an LLM
 * 2. The LLM analyzes what kind of question it is (crypto, sports, policy, etc.)
 * 3. The LLM returns a list of free public API calls to make
 * 4. We execute those API calls and return the results as evidence
 *
 * This means ANY question type works — crypto prices, sports scores,
 * economic data, weather, elections — as long as there's a public API.
 *
 * On Chainlink: This is the local equivalent of Chainlink Functions.
 * In production, the LLM routing + API calls would run inside the DON
 * via Chainlink Functions, making the evidence gathering decentralized
 * and verifiable. The LLM decides WHAT to fetch, Chainlink Functions
 * executes the fetches in a trustless environment.
 */

interface APICall {
  url: string;
  description: string;
  extractField?: string;
}

interface RouterResponse {
  category: string;
  reasoning: string;
  apiCalls: APICall[];
  searchTerms: string[];
}

const ROUTER_SYSTEM_PROMPT = `You are an evidence routing agent for a prediction market resolution system.
Given a market question, you must determine what PUBLIC APIs to call to gather factual evidence.

YOUR JOB:
1. Read the question carefully
2. Identify what KIND of evidence would actually prove or disprove the claim
3. Find the RIGHT public APIs that provide that specific evidence
4. Return complete, valid API URLs ready to fetch

IMPORTANT RULES:
- Only suggest FREE public APIs that require NO API key
- URLs must be complete and valid — no placeholders like {coin}, use actual values
- Focus on factual data sources, not opinions
- Return 2-4 API calls maximum
- Each API call should target different data relevant to the question
- You are NOT limited to any predefined list of APIs — use ANY free public API you know about
- CRITICAL: Choose metrics that ACTUALLY measure what the question asks.
  Wrong metric = wrong verdict. Think carefully:
  - A messaging protocol (CCIP, LayerZero) should be measured by transaction volume, not TVL
  - A staking protocol (Lido) should be measured by TVL and APY
  - A governance question needs context and facts, not price data
  - A comparison question needs data for ALL entities being compared
  - A policy question benefits from Wikipedia context and factual background

EXAMPLES of good public APIs (but use ANY free API that fits):
  CoinGecko, DeFiLlama, US Treasury, Wikipedia, Open-Meteo, GitHub API,
  restcountries.com, exchange rate APIs, sports APIs, etc.

You MUST respond with valid JSON in this exact format:
{
  "category": "crypto|defi|sports|economics|weather|politics|technology|governance|other",
  "reasoning": "Explain what metrics actually answer this question and why you chose these APIs",
  "apiCalls": [
    {
      "url": "https://exact-complete-url-here",
      "description": "What this returns and why it's the RIGHT evidence for this question",
      "extractField": "optional.json.path to key data"
    }
  ],
  "searchTerms": ["keyword1", "keyword2"]
}`;

/**
 * Calls the LLM to determine which APIs are relevant for a given question,
 * then fetches data from those APIs and returns it as evidence items.
 */
export class DynamicEvidenceSource implements EvidenceSource {
  name = "dynamic";
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  async fetch(question: MarketQuestion): Promise<EvidenceItem[]> {
    const items: EvidenceItem[] = [];
    const now = new Date();

    /* Step 1: Ask the LLM what APIs to call */
    let routerResponse: RouterResponse;
    try {
      const llmResult = await this.llmClient.call({
        systemPrompt: ROUTER_SYSTEM_PROMPT,
        userPrompt: `Market question: "${question.question}"\n\nAnalyze this question and return the JSON specifying which public APIs to call for evidence.`,
        maxTokens: 1024,
        temperature: 0.1,
      });

      routerResponse = parseRouterResponse(llmResult.content);
      console.log(
        `  [DYNAMIC] Category: ${routerResponse.category} | APIs: ${routerResponse.apiCalls.length}`
      );
    } catch (err) {
      console.warn(`[dynamic] LLM routing failed: ${err}`);
      return [];
    }

    /* Step 2: Execute all API calls in parallel */
    const apiResults = await Promise.allSettled(
      routerResponse.apiCalls.map(async (apiCall) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
          const response = await fetch(apiCall.url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const content = extractRelevantData(data, apiCall);

          return {
            source: "dynamic",
            title: `[${routerResponse.category.toUpperCase()}] ${apiCall.description}`,
            content,
            url: apiCall.url.split("?")[0], // Clean URL without params
            retrievedAt: now,
          } as EvidenceItem;
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    for (const result of apiResults) {
      if (result.status === "fulfilled" && result.value) {
        items.push(result.value);
      } else if (result.status === "rejected") {
        console.warn(`  [DYNAMIC] API call failed: ${result.reason}`);
      }
    }

    /* Step 3: Add the LLM's reasoning as meta-evidence */
    if (routerResponse.reasoning) {
      items.push({
        source: "dynamic-meta",
        title: `Evidence Routing: ${routerResponse.category}`,
        content: `The evidence router classified this as a "${routerResponse.category}" question. ${routerResponse.reasoning}. Search terms identified: ${routerResponse.searchTerms.join(", ")}.`,
        retrievedAt: now,
      });
    }

    return items;
  }
}

/**
 * Parse the LLM's JSON response, handling markdown code fences
 * and other common LLM output quirks.
 */
function parseRouterResponse(raw: string): RouterResponse {
  /* Strip markdown code fences if present */
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  /* Validate structure */
  if (!parsed.apiCalls || !Array.isArray(parsed.apiCalls)) {
    throw new Error("Router response missing apiCalls array");
  }

  return {
    category: parsed.category || "other",
    reasoning: parsed.reasoning || "",
    apiCalls: parsed.apiCalls
      .filter((c: APICall) => c.url && c.description)
      .slice(0, 4), // Cap at 4 API calls
    searchTerms: parsed.searchTerms || [],
  };
}

/**
 * Extract relevant data from an API response.
 * Tries to intelligently summarize the data rather than dumping raw JSON.
 */
function extractRelevantData(
  data: unknown,
  apiCall: APICall
): string {
  /* If a specific field path was requested, try to extract it */
  if (apiCall.extractField) {
    const value = getNestedValue(data, apiCall.extractField);
    if (value !== undefined) {
      return typeof value === "object"
        ? JSON.stringify(value, null, 2).slice(0, 2000)
        : String(value);
    }
  }

  /* Smart summarization based on common API response shapes */
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;

    /* CoinGecko price response */
    if (obj.market_data) {
      const md = obj.market_data as Record<string, unknown>;
      const price = (md.current_price as Record<string, number>)?.usd;
      const change24h = md.price_change_percentage_24h;
      const change7d = md.price_change_percentage_7d;
      const change30d = md.price_change_percentage_30d;
      const mcap = (md.market_cap as Record<string, number>)?.usd;
      return (
        `Current price: $${price}. ` +
        `24h change: ${change24h}%. 7d change: ${change7d}%. 30d change: ${change30d}%. ` +
        `Market cap: $${mcap ? (mcap / 1e9).toFixed(2) + "B" : "N/A"}.`
      );
    }

    /* Simple price object (e.g., CoinGecko /simple/price) */
    if (Object.values(obj).every((v) => typeof v === "object")) {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(obj)) {
        if (typeof val === "object" && val !== null) {
          const inner = val as Record<string, unknown>;
          parts.push(
            `${key}: ${Object.entries(inner)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}`
          );
        }
      }
      if (parts.length > 0 && parts.length <= 10) {
        return parts.join(". ");
      }
    }

    /* Array response — summarize first few items */
    if (Array.isArray(data)) {
      const summary = data
        .slice(0, 5)
        .map((item) =>
          typeof item === "object"
            ? JSON.stringify(item).slice(0, 300)
            : String(item)
        )
        .join("\n");
      return `${data.length} results. Top entries:\n${summary}`;
    }

    /* Generic object — stringify with truncation */
    const json = JSON.stringify(data, null, 2);
    return json.length > 2000 ? json.slice(0, 2000) + "... (truncated)" : json;
  }

  return String(data).slice(0, 2000);
}

/**
 * Safely traverse a nested object by dot-separated path.
 * e.g., getNestedValue({a: {b: 1}}, "a.b") → 1
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
