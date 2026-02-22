/**
 * TrialByFire — Chainlink Functions Source Code
 *
 * This JavaScript runs on Chainlink's Decentralized Oracle Network (DON).
 * Multiple independent nodes execute this code simultaneously and reach
 * consensus on the result before writing it back to the blockchain.
 *
 * What it does:
 *   1. Receives market question + rubric + ETH price as args[]
 *   2. Fetches evidence from public APIs (DeFiLlama, Treasury)
 *   3. Runs two AI advocates (YES and NO) in parallel via LLM APIs
 *   4. Runs a judge to score both sides
 *   5. Evaluates confidence (margin check + hallucination detection)
 *   6. Returns ABI-encoded result: (action, verdict, scoreYes, scoreNo)
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

/*
 * Convert the Chainlink Data Feed price to human-readable format.
 * The price has 8 decimals, so 350000000000 = $3,500.00.
 * We pass this to the LLMs as verified evidence.
 */
const ethPriceUsd = (parseInt(ethUsdPrice) / 1e8).toFixed(2);

// ── Step 1: Gather Evidence ─────────────────────────────────────

/*
 * Fetch evidence from multiple public APIs in parallel.
 * Functions.makeHttpRequest is the Chainlink-provided HTTP client.
 * It works like fetch() but is sandboxed and metered by the DON.
 *
 * We use Promise.allSettled (not Promise.all) so that if one
 * API is down, we still get evidence from the others. A failed
 * source returns status: "rejected" and we skip it gracefully.
 */
const evidenceResponses = await Promise.allSettled([
  /*
   * DeFiLlama: Fetch ETH staking pool yields.
   * No API key needed — public endpoint.
   * Returns an array of pools with APY data.
   */
  Functions.makeHttpRequest({
    url: "https://yields.llama.fi/pools",
    method: "GET",
    timeout: 5000,
  }),

  /*
   * US Treasury: Fetch average interest rates.
   * No API key needed — US government public data.
   * Returns Treasury Note/Bond/Bill rates.
   */
  Functions.makeHttpRequest({
    url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=10",
    method: "GET",
    timeout: 5000,
  }),
]);

/*
 * Build the evidence summary string.
 * We extract the most relevant data from each API response
 * and format it as text that the LLM advocates can cite.
 */
let evidenceSummary = `Verified Chainlink Data Feed: ETH/USD = $${ethPriceUsd}\n\n`;

// Process DeFiLlama response
if (evidenceResponses[0].status === "fulfilled" && !evidenceResponses[0].value.error) {
  const pools = evidenceResponses[0].value.data.data || [];
  /*
   * Filter for ETH staking pools from major protocols.
   * We look for Lido (stETH), Rocket Pool (rETH), and Coinbase (cbETH).
   * These are the three largest ETH staking providers.
   */
  const ethPools = pools
    .filter((p) => p.symbol && p.symbol.match(/stETH|rETH|cbETH/i))
    .slice(0, 5);

  if (ethPools.length > 0) {
    evidenceSummary += "ETH Staking Yields (DeFiLlama):\n";
    ethPools.forEach((p) => {
      evidenceSummary += `  - ${p.project} (${p.symbol}): APY ${p.apy?.toFixed(2)}%\n`;
    });
    evidenceSummary += "\n";
  }
}

// Process Treasury response
if (evidenceResponses[1].status === "fulfilled" && !evidenceResponses[1].value.error) {
  const records = evidenceResponses[1].value.data.data || [];
  /*
   * Filter for Treasury Notes and Bonds (the standard benchmark
   * for "risk-free rate" in traditional finance).
   */
  const notes = records
    .filter((r) => r.security_desc && r.security_desc.match(/Note|Bond/))
    .slice(0, 5);

  if (notes.length > 0) {
    evidenceSummary += "US Treasury Rates (fiscal.treasury.gov):\n";
    notes.forEach((r) => {
      evidenceSummary += `  - ${r.security_desc}: ${r.avg_interest_rate_amt}%\n`;
    });
    evidenceSummary += "\n";
  }
}

// ── Step 2: Run Advocates in Parallel ───────────────────────────

/*
 * The adversarial trial core: two LLMs argue opposite sides.
 *
 * YES advocate (Anthropic/Claude): Argues that the answer is YES.
 * NO advocate (OpenAI/GPT): Argues that the answer is NO.
 *
 * Using DIFFERENT models for each side prevents model-specific biases.
 * If both used the same model, they'd share the same training biases
 * and blind spots, defeating the adversarial structure.
 *
 * Each advocate must:
 *   1. Cite specific evidence from the evidence summary
 *   2. Make arguments per rubric criterion
 *   3. Rate their own confidence (0-100)
 *   4. Identify weaknesses in the opposing case
 *
 * Output is JSON validated by the contract's expectations.
 */
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

/*
 * Fire both advocates simultaneously.
 * Promise.all runs them in parallel on the DON node,
 * which cuts total execution time roughly in half.
 */
const [yesResponse, noResponse] = await Promise.all([
  /*
   * YES Advocate — uses Anthropic Claude.
   * The system prompt is a top-level field in Claude's API,
   * not a message role. This is a key difference from OpenAI.
   */
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

  /*
   * NO Advocate — uses OpenAI GPT-4o.
   * System prompt is a message with role: "system".
   * response_format: { type: "json_object" } forces JSON output.
   */
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

/*
 * Parse advocate responses.
 * Claude returns content in data.content[0].text.
 * OpenAI returns in data.choices[0].message.content.
 */
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

/*
 * The judge sees both arguments + the original evidence and must:
 *   1. Score each side per criterion (0-100)
 *   2. Determine an overall winner
 *   3. Flag any hallucinated evidence citations
 *   4. Write a prose ruling explaining the decision
 *
 * The judge uses a DIFFERENT model instance to avoid self-bias.
 * Temperature is lower (0.2) for more deterministic scoring.
 */
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

/*
 * The confidence evaluation determines whether to RESOLVE or ESCALATE.
 *
 * Two independent safety gates:
 *
 *   Gate 1 — Margin check:
 *     margin = |scoreYes - scoreNo|
 *     If margin < 20 (the confidence threshold), ESCALATE.
 *     The winner isn't clear enough to auto-resolve.
 *
 *   Gate 2 — Hallucination check:
 *     If the judge flagged ANY hallucinated citations, ESCALATE.
 *     Fabricated evidence means the trial can't be trusted.
 *
 * Both gates must pass for RESOLVE. Either failing means ESCALATE.
 * The failure mode is always "ask a human" rather than "guess wrong."
 */
const scoreYes = Math.round(ruling.scoreYes || 0);
const scoreNo = Math.round(ruling.scoreNo || 0);
const margin = Math.abs(scoreYes - scoreNo);
const confidenceThreshold = 20;
const hallucinations = ruling.hallucinationsDetected || [];

let action; // 1 = RESOLVE, 2 = ESCALATE
let verdict; // 1 = YES, 2 = NO

if (hallucinations.length > 0) {
  // Gate 2 failed: hallucination detected → ESCALATE
  action = 2;
  verdict = 0;
} else if (margin < confidenceThreshold) {
  // Gate 1 failed: margin too thin → ESCALATE
  action = 2;
  verdict = 0;
} else {
  // Both gates passed → RESOLVE with the winner
  action = 1;
  verdict = ruling.finalVerdict === "YES" ? 1 : 2;
}

// ── Step 5: Encode and Return ───────────────────────────────────

/*
 * ABI-encode the result for the contract's _fulfillRequest() callback.
 *
 * The encoding matches what the contract expects:
 *   (uint8 action, uint8 verdict, uint256 scoreYes, uint256 scoreNo)
 *
 * Functions.encodeUint256 only handles single values, so we manually
 * pack our four values into bytes. The contract uses abi.decode()
 * to unpack them.
 *
 * Encoding:
 *   - Each uint8 is padded to 32 bytes (standard ABI encoding)
 *   - Each uint256 is 32 bytes
 *   - Total: 128 bytes (4 × 32)
 */
const encoded = new Uint8Array(128);

// action (uint8 → 32 bytes, value at position 31)
encoded[31] = action;

// verdict (uint8 → 32 bytes, value at position 63)
encoded[63] = verdict;

/*
 * scoreYes (uint256 → 32 bytes, big-endian at positions 64-95)
 * Scores are 0-100, so they fit in a single byte,
 * but ABI encoding requires full 32-byte words.
 */
encoded[95] = scoreYes;

// scoreNo (uint256 → 32 bytes, big-endian at positions 96-127)
encoded[127] = scoreNo;

return encoded;
