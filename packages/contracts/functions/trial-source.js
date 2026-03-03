/**
 * TrialByFire — Chainlink Functions Source Code
 *
 * This JavaScript runs on Chainlink's Decentralized Oracle Network (DON).
 * Multiple independent nodes execute this code simultaneously and reach
 * consensus on the result before writing it back to the blockchain.
 *
 * What it does:
 *   1. Receives market question + rubric + ETH price as args[]
 *   2. DYNAMICALLY selects relevant APIs based on the question content
 *   3. Fetches evidence from those APIs (not hardcoded sources)
 *   4. Runs two AI advocates (YES and NO) in parallel via LLM APIs
 *   5. Runs a judge to score both sides
 *   6. Evaluates confidence (margin check + hallucination detection)
 *   7. Returns ABI-encoded result: (action, verdict, scoreYes, scoreNo)
 *
 * Dynamic Evidence Selection:
 *   The key innovation — instead of always fetching the same APIs,
 *   the code analyzes the question to determine its CATEGORY (crypto price,
 *   DeFi yields, sports, economics, etc.) and selects relevant free APIs.
 *   This means TrialByFire can resolve ANY subjective question, not just
 *   crypto questions.
 *
 * Chainlink Functions constraints:
 *   - Must use Functions.makeHttpRequest() for all HTTP calls
 *   - Secrets accessed via secrets.apiKey (encrypted, DON-only)
 *   - Return value must be a Uint8Array (we ABI-encode our result)
 *   - ~10 second execution time limit
 *   - No Node.js-specific APIs (runs in WASM sandbox)
 *
 * args[] from the contract (set in sendTrialRequest):
 *   [0] marketId    — which market we're resolving
 *   [1] question    — the full question text
 *   [2] rubricHash  — identifier for scoring criteria
 *   [3] ethUsdPrice — Chainlink Data Feed ETH/USD price (8 decimals)
 *
 * secrets (encrypted, stored off-chain):
 *   secrets.openaiKey    — OpenAI API key for NO advocate
 *   secrets.anthropicKey — Anthropic API key for YES advocate + judge
 */

// ── Parse Arguments ─────────────────────────────────────────────

const marketId = args[0];
const question = args[1];
const rubricHash = args[2];
const ethUsdPrice = args[3];

const ethPriceUsd = (parseInt(ethUsdPrice) / 1e8).toFixed(2);

// ── Step 0: Classify Question & Select APIs ─────────────────────

/**
 * Dynamic evidence routing — the core innovation.
 *
 * We analyze the question text to determine what KIND of data is needed,
 * then select the right free public APIs. This runs INSIDE the DON,
 * so the evidence selection itself is decentralized and verifiable.
 *
 * Categories and their API sources:
 *   - crypto_price:  CoinGecko price + market data
 *   - defi_yields:   DeFiLlama staking/yield pools
 *   - economics:     US Treasury rates, exchange rates
 *   - sports:        Public sports APIs
 *   - weather:       Open-Meteo weather data
 *   - general:       Wikipedia + web search fallback
 */
const questionLower = question.toLowerCase();

function classifyQuestion(q) {
  // Crypto price questions (ETH, BTC, SOL, etc.)
  const cryptoPriceKeywords = [
    "price", "worth", "value", "market cap", "trading",
    "$", "usd", "ath", "all-time high", "crash", "rally",
    "bull", "bear", "pump", "dump"
  ];
  const cryptoAssets = [
    "eth", "ethereum", "btc", "bitcoin", "sol", "solana",
    "bnb", "xrp", "ada", "cardano", "doge", "dogecoin",
    "avax", "avalanche", "matic", "polygon", "dot", "polkadot",
    "link", "chainlink", "uni", "uniswap", "aave", "crypto",
    "token", "coin"
  ];

  const hasCryptoAsset = cryptoAssets.some((k) => q.includes(k));
  const hasPriceKeyword = cryptoPriceKeywords.some((k) => q.includes(k));

  if (hasCryptoAsset && hasPriceKeyword) return "crypto_price";

  // DeFi yield questions
  const defiKeywords = [
    "yield", "apy", "apr", "staking", "lending", "tvl",
    "liquidity", "defi", "lido", "rocket pool", "compound",
    "protocol", "validator"
  ];
  if (hasCryptoAsset && defiKeywords.some((k) => q.includes(k))) return "defi_yields";

  // General crypto (not price-specific)
  if (hasCryptoAsset) return "crypto_general";

  // Economics / finance
  const econKeywords = [
    "interest rate", "inflation", "gdp", "federal reserve",
    "treasury", "bond", "stock", "s&p", "nasdaq", "dow",
    "unemployment", "cpi", "fed", "monetary", "fiscal",
    "recession", "economy", "economic"
  ];
  if (econKeywords.some((k) => q.includes(k))) return "economics";

  // Sports
  const sportsKeywords = [
    "win", "championship", "game", "match", "season",
    "nba", "nfl", "mlb", "soccer", "football", "basketball",
    "baseball", "tennis", "team", "player", "score", "league",
    "world cup", "super bowl", "playoffs", "finals"
  ];
  if (sportsKeywords.some((k) => q.includes(k))) return "sports";

  // Weather / climate
  const weatherKeywords = [
    "weather", "temperature", "rain", "snow", "hurricane",
    "climate", "drought", "flood", "celsius", "fahrenheit",
    "forecast"
  ];
  if (weatherKeywords.some((k) => q.includes(k))) return "weather";

  // Tech
  const techKeywords = [
    "ai", "artificial intelligence", "software", "app",
    "launch", "release", "users", "github", "open source",
    "technology", "startup"
  ];
  if (techKeywords.some((k) => q.includes(k))) return "technology";

  return "general";
}

/**
 * Build the list of API calls based on the question category.
 * All APIs are FREE and require NO API key — critical for DON execution.
 */
function getApiCalls(category, q) {
  const calls = [];

  switch (category) {
    case "crypto_price": {
      // Detect which coin(s) the question is about
      const coinMap = {
        ethereum: ["eth", "ethereum", "ether"],
        bitcoin: ["btc", "bitcoin"],
        solana: ["sol", "solana"],
        "binancecoin": ["bnb", "binance"],
        ripple: ["xrp", "ripple"],
        cardano: ["ada", "cardano"],
        dogecoin: ["doge", "dogecoin"],
        "avalanche-2": ["avax", "avalanche"],
        "matic-network": ["matic", "polygon"],
        polkadot: ["dot", "polkadot"],
        chainlink: ["link", "chainlink"],
        uniswap: ["uni", "uniswap"],
        aave: ["aave"],
      };

      let coinId = "ethereum"; // default
      for (const [id, keywords] of Object.entries(coinMap)) {
        if (keywords.some((k) => q.includes(k))) {
          coinId = id;
          break;
        }
      }

      // Current price + market data
      calls.push({
        url: `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
        description: `CoinGecko: ${coinId} current price, market cap, 24h/7d/30d changes`,
        extract: "market_data",
      });

      // 90-day price history for trend analysis
      calls.push({
        url: `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=90`,
        description: `CoinGecko: ${coinId} 90-day price history`,
        extract: "prices",
      });

      break;
    }

    case "defi_yields": {
      // DeFiLlama yield pools
      calls.push({
        url: "https://yields.llama.fi/pools",
        description: "DeFiLlama: All DeFi yield pools with current APY",
        extract: "eth_staking",
      });

      // Detect specific protocol
      const protocols = ["lido", "rocket-pool", "aave", "compound", "maker", "uniswap"];
      const matchedProtocol = protocols.find((p) => q.includes(p.replace("-", " ")));
      if (matchedProtocol) {
        calls.push({
          url: `https://api.llama.fi/protocol/${matchedProtocol}`,
          description: `DeFiLlama: ${matchedProtocol} TVL and protocol data`,
          extract: "protocol",
        });
      }

      break;
    }

    case "crypto_general": {
      // General crypto info — get prices + DeFi overview
      const coinMap2 = {
        ethereum: ["eth", "ethereum"],
        bitcoin: ["btc", "bitcoin"],
        solana: ["sol", "solana"],
      };
      let coinId2 = "ethereum";
      for (const [id, keywords] of Object.entries(coinMap2)) {
        if (keywords.some((k) => q.includes(k))) {
          coinId2 = id;
          break;
        }
      }
      calls.push({
        url: `https://api.coingecko.com/api/v3/coins/${coinId2}?localization=false&tickers=false&community_data=false&developer_data=false`,
        description: `CoinGecko: ${coinId2} overview data`,
        extract: "market_data",
      });
      calls.push({
        url: `https://api.llama.fi/tvl/${coinId2}`,
        description: `DeFiLlama: ${coinId2} ecosystem TVL`,
        extract: "raw",
      });
      break;
    }

    case "economics": {
      // US Treasury rates
      calls.push({
        url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=10&fields=record_date,security_desc,avg_interest_rate_amt",
        description: "US Treasury: Average interest rates on government securities",
        extract: "treasury",
      });

      // Exchange rates
      calls.push({
        url: "https://open.er-api.com/v6/latest/USD",
        description: "Exchange rates: Major currency rates vs USD",
        extract: "exchange_rates",
      });

      break;
    }

    case "sports": {
      // Wikipedia for context on teams/events
      const keywords = q.replace(/[?.,!]/g, "").split(/\s+/).filter(
        (w) => w.length > 3 && !["will", "does", "have", "been", "this", "that", "with"].includes(w)
      ).slice(0, 3);
      const topic = keywords.join("_");

      calls.push({
        url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        description: `Wikipedia: Summary for "${keywords.join(" ")}"`,
        extract: "wikipedia",
      });

      break;
    }

    case "weather": {
      // Default to major cities if no specific location
      calls.push({
        url: "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America/New_York&past_days=30",
        description: "Open-Meteo: 30-day weather history for New York (default)",
        extract: "weather",
      });
      break;
    }

    case "technology": {
      const keywords = q.replace(/[?.,!]/g, "").split(/\s+/).filter(
        (w) => w.length > 3
      ).slice(0, 3);

      calls.push({
        url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keywords.join("_"))}`,
        description: `Wikipedia: Context on "${keywords.join(" ")}"`,
        extract: "wikipedia",
      });
      break;
    }

    default: {
      // General — use Wikipedia for any topic
      const keywords = q.replace(/[?.,!]/g, "").split(/\s+/).filter(
        (w) => w.length > 3 && !["will", "does", "have", "been", "this", "that", "with"].includes(w)
      ).slice(0, 4);

      calls.push({
        url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keywords.join("_"))}`,
        description: `Wikipedia: Context on "${keywords.join(" ")}"`,
        extract: "wikipedia",
      });
      break;
    }
  }

  return calls;
}

const category = classifyQuestion(questionLower);
const apiCalls = getApiCalls(category, questionLower);

// ── Step 1: Gather Evidence (Dynamic) ────────────────────────────

/**
 * Fetch evidence from dynamically selected APIs.
 * The APIs were chosen based on the question category — not hardcoded.
 * This is the key difference from the previous version.
 */
const evidenceResponses = await Promise.allSettled(
  apiCalls.map((call) =>
    Functions.makeHttpRequest({
      url: call.url,
      method: "GET",
      timeout: 5000,
    })
  )
);

/**
 * Build evidence summary from API responses.
 * We extract the most useful data from each response and format it
 * as text that the LLM advocates can cite.
 */
let evidenceSummary = `Verified Chainlink Data Feed: ETH/USD = $${ethPriceUsd}\n`;
evidenceSummary += `Question category: ${category} (${apiCalls.length} dynamic sources selected)\n\n`;

evidenceResponses.forEach((result, i) => {
  if (result.status !== "fulfilled" || result.value.error) return;

  const call = apiCalls[i];
  const data = result.value.data;

  evidenceSummary += `--- ${call.description} ---\n`;

  try {
    switch (call.extract) {
      case "market_data": {
        // CoinGecko coin detail
        const md = data.market_data || {};
        const price = md.current_price?.usd;
        const change24h = md.price_change_percentage_24h;
        const change7d = md.price_change_percentage_7d;
        const change30d = md.price_change_percentage_30d;
        const mcap = md.market_cap?.usd;
        const high24h = md.high_24h?.usd;
        const low24h = md.low_24h?.usd;
        const ath = md.ath?.usd;
        const athDate = md.ath_date?.usd;

        evidenceSummary += `  Current price: $${price}\n`;
        evidenceSummary += `  24h change: ${change24h?.toFixed(2)}% | 7d: ${change7d?.toFixed(2)}% | 30d: ${change30d?.toFixed(2)}%\n`;
        evidenceSummary += `  24h range: $${low24h} — $${high24h}\n`;
        evidenceSummary += `  Market cap: $${mcap ? (mcap / 1e9).toFixed(2) + "B" : "N/A"}\n`;
        evidenceSummary += `  All-time high: $${ath} (${athDate?.slice(0, 10)})\n`;
        break;
      }

      case "prices": {
        // CoinGecko price history — summarize as trend
        const prices = data.prices || [];
        if (prices.length > 0) {
          const oldest = prices[0][1];
          const newest = prices[prices.length - 1][1];
          const change = ((newest - oldest) / oldest * 100).toFixed(2);
          const min = Math.min(...prices.map((p) => p[1]));
          const max = Math.max(...prices.map((p) => p[1]));
          evidenceSummary += `  90-day trend: $${oldest.toFixed(2)} → $${newest.toFixed(2)} (${change}%)\n`;
          evidenceSummary += `  90-day range: $${min.toFixed(2)} — $${max.toFixed(2)}\n`;
        }
        break;
      }

      case "eth_staking": {
        // DeFiLlama pools — filter for ETH staking
        const pools = data.data || [];
        const ethPools = pools
          .filter((p) => p.symbol && p.symbol.match(/stETH|rETH|cbETH/i))
          .slice(0, 5);
        if (ethPools.length > 0) {
          ethPools.forEach((p) => {
            evidenceSummary += `  ${p.project} (${p.symbol}): APY ${p.apy?.toFixed(2)}%\n`;
          });
        }
        break;
      }

      case "protocol": {
        // DeFiLlama protocol detail
        const tvl = data.currentChainTvls?.Ethereum;
        if (tvl) {
          evidenceSummary += `  TVL on Ethereum: $${(tvl / 1e9).toFixed(2)}B\n`;
        }
        break;
      }

      case "treasury": {
        // US Treasury rates
        const records = (data.data || [])
          .filter((r) => r.security_desc?.match(/Note|Bond|Bill/))
          .slice(0, 5);
        records.forEach((r) => {
          evidenceSummary += `  ${r.security_desc}: ${r.avg_interest_rate_amt}%\n`;
        });
        break;
      }

      case "exchange_rates": {
        // Currency exchange rates
        const rates = data.rates || {};
        const majors = ["EUR", "GBP", "JPY", "CNY", "CHF"];
        majors.forEach((c) => {
          if (rates[c]) evidenceSummary += `  USD/${c}: ${rates[c]}\n`;
        });
        break;
      }

      case "wikipedia": {
        // Wikipedia summary
        if (data.extract) {
          evidenceSummary += `  ${data.extract.slice(0, 500)}\n`;
        }
        break;
      }

      case "weather": {
        // Open-Meteo weather
        const daily = data.daily || {};
        if (daily.temperature_2m_max) {
          const temps = daily.temperature_2m_max;
          const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
          evidenceSummary += `  Avg max temp (30 days): ${avg.toFixed(1)}C\n`;
        }
        break;
      }

      default: {
        // Raw data — truncate
        const raw = typeof data === "string" ? data : JSON.stringify(data);
        evidenceSummary += `  ${raw.slice(0, 500)}\n`;
      }
    }
  } catch (e) {
    evidenceSummary += `  (Data available but parsing failed)\n`;
  }

  evidenceSummary += "\n";
});

// ── Step 2: Run Advocates in Parallel ───────────────────────────

const advocateSystemPrompt = (side) => `You are an advocate arguing the ${side} position in a structured debate.

Your assigned position is: ${side}

Rules:
1. Argue ONLY for the ${side} position, regardless of your personal assessment.
2. Cite specific evidence from the provided data.
3. Score each rubric criterion for your side's strength (0-100).
4. Identify weaknesses in the opposing side's likely arguments.
5. Return ONLY valid JSON matching the schema below.

JSON Schema:
{
  "side": "${side}",
  "confidence": <number 0-100>,
  "arguments": [
    {
      "criterion": "<criterion name>",
      "claim": "<your argument>",
      "evidenceCitations": ["<source: relevant quote>"],
      "strength": <number 0-100>
    }
  ],
  "weaknessesInOpposingCase": ["<weakness 1>", "<weakness 2>"]
}`;

const advocateUserPrompt = `Question: ${question}

Evidence:
${evidenceSummary}

Rubric criteria: Data accuracy (30%), Time period coverage (25%), Source diversity (20%), Logical coherence (25%)
Confidence threshold: 20 points

Provide your structured argument as JSON.`;

const [yesResponse, noResponse] = await Promise.all([
  Functions.makeHttpRequest({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "x-api-key": secrets.anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    data: {
      model: "claude-sonnet-4-20250514",
      system: advocateSystemPrompt("YES"),
      messages: [{ role: "user", content: advocateUserPrompt }],
      max_tokens: 2048,
      temperature: 0.3,
    },
    timeout: 8000,
  }),

  Functions.makeHttpRequest({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.openaiKey}`,
      "Content-Type": "application/json",
    },
    data: {
      model: "gpt-4o",
      messages: [
        { role: "system", content: advocateSystemPrompt("NO") },
        { role: "user", content: advocateUserPrompt },
      ],
      max_tokens: 2048,
      temperature: 0.3,
      response_format: { type: "json_object" },
    },
    timeout: 8000,
  }),
]);

let yesArgument, noArgument;

if (yesResponse.error || !yesResponse.data) {
  throw new Error("YES advocate API call failed");
}
const yesText = yesResponse.data.content?.[0]?.text || "";
yesArgument = JSON.parse(yesText);

if (noResponse.error || !noResponse.data) {
  throw new Error("NO advocate API call failed");
}
const noText = noResponse.data.choices?.[0]?.message?.content || "";
noArgument = JSON.parse(noText);

// ── Step 3: Run Judge ───────────────────────────────────────────

const judgeSystemPrompt = `You are an impartial judge evaluating a structured debate between two advocates.

Two advocates have argued opposite sides of a question. You must:
1. Score each side per criterion (0-100).
2. Determine which side presented the stronger case.
3. Flag any citations that don't match the provided evidence (hallucinations).
4. Write a brief ruling explaining your decision.

Return ONLY valid JSON:
{
  "finalVerdict": "YES" or "NO",
  "scoreYes": <total 0-100>,
  "scoreNo": <total 0-100>,
  "criterionScores": [
    { "criterion": "<name>", "scoreYes": <0-100>, "scoreNo": <0-100>, "reasoning": "<why>" }
  ],
  "rulingText": "<your ruling>",
  "hallucinationsDetected": ["<citation not in evidence>"]
}`;

const judgeUserPrompt = `Question: ${question}

Evidence provided to both advocates:
${evidenceSummary}

YES Advocate's Argument:
${JSON.stringify(yesArgument, null, 2)}

NO Advocate's Argument:
${JSON.stringify(noArgument, null, 2)}

Score both sides and determine the winner.`;

const judgeResponse = await Functions.makeHttpRequest({
  url: "https://api.anthropic.com/v1/messages",
  method: "POST",
  headers: {
    "x-api-key": secrets.anthropicKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  },
  data: {
    model: "claude-sonnet-4-20250514",
    system: judgeSystemPrompt,
    messages: [{ role: "user", content: judgeUserPrompt }],
    max_tokens: 2048,
    temperature: 0.2,
  },
  timeout: 8000,
});

if (judgeResponse.error || !judgeResponse.data) {
  throw new Error("Judge API call failed");
}

const judgeText = judgeResponse.data.content?.[0]?.text || "";
const ruling = JSON.parse(judgeText);

// ── Step 4: Evaluate Confidence ─────────────────────────────────

const scoreYes = Math.round(ruling.scoreYes || 0);
const scoreNo = Math.round(ruling.scoreNo || 0);
const margin = Math.abs(scoreYes - scoreNo);
const confidenceThreshold = 20;
const hallucinations = ruling.hallucinationsDetected || [];

let action; // 1 = RESOLVE, 2 = ESCALATE
let verdict; // 1 = YES, 2 = NO

if (hallucinations.length > 0) {
  action = 2;
  verdict = 0;
} else if (margin < confidenceThreshold) {
  action = 2;
  verdict = 0;
} else {
  action = 1;
  verdict = ruling.finalVerdict === "YES" ? 1 : 2;
}

// ── Step 5: Encode and Return ───────────────────────────────────

const encoded = new Uint8Array(128);

// action (uint8 → 32 bytes, value at position 31)
encoded[31] = action;

// verdict (uint8 → 32 bytes, value at position 63)
encoded[63] = verdict;

// scoreYes (uint256 → 32 bytes, big-endian at position 95)
encoded[95] = scoreYes;

// scoreNo (uint256 → 32 bytes, big-endian at position 127)
encoded[127] = scoreNo;

return encoded;
