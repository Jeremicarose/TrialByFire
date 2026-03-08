// packages/workflow/trial.ts
// Anthropic API integration for adversarial trial with CRE consensus

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";

type Config = {
  anthropicModel: string;
  evms: Array<{
    marketAddress: string;
    chainSelectorName: string;
    gasLimit: string;
  }>;
};

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
}

interface AnthropicApiResponse {
  id?: string;
  content?: Array<{ text?: string }>;
}

interface AnthropicResponse {
  statusCode: number;
  response: string;
  responseId: string;
}

const SYSTEM_PROMPT = `You are an adversarial trial system that determines the outcome of prediction market questions through structured debate.

PROCESS:
1. ADVOCATE FOR YES: Present the strongest factual arguments supporting a YES answer.
2. ADVOCATE FOR NO: Present the strongest factual arguments supporting a NO answer.
3. JUDGE: Evaluate both arguments objectively. Consider evidence strength, logical reasoning, and factual accuracy.
4. VERDICT: Determine the outcome based on the weight of evidence.

OUTPUT FORMAT (CRITICAL):
You MUST respond with ONLY a single JSON object:
{"result": "YES" or "NO", "confidence": <integer 0-10000>}

RULES:
- Output MUST be valid JSON. No markdown, no backticks, no prose, no explanation.
- Output MUST be MINIFIED (one line).
- Confidence 10000 = absolute certainty, 0 = no confidence.
- Use only objective, verifiable information.
- If the question is ambiguous or unanswerable, use "NO" with low confidence.

Your ENTIRE response must be ONLY the JSON object.`;

const USER_PROMPT = `Run an adversarial trial for this prediction market question and return your verdict as JSON:

{"result": "YES" or "NO", "confidence": <integer 0-10000>}

Question: `;

export function askAnthropic(runtime: Runtime<Config>, question: string): AnthropicResponse {
  runtime.log("[Trial] Running adversarial trial via Anthropic...");

  const apiKey = runtime.getSecret({ id: "ANTHROPIC_API_KEY" }).result();
  const httpClient = new cre.capabilities.HTTPClient();

  const result = httpClient
    .sendRequest(
      runtime,
      buildAnthropicRequest(question, apiKey.value),
      consensusIdenticalAggregation<AnthropicResponse>()
    )(runtime.config)
    .result();

  runtime.log(`[Trial] Response: ${result.response}`);
  return result;
}

const buildAnthropicRequest =
  (question: string, apiKey: string) =>
  (sendRequester: HTTPSendRequester, config: Config): AnthropicResponse => {
    const requestData: AnthropicRequestBody = {
      model: config.anthropicModel,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: USER_PROMPT + question,
        },
      ],
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(requestData));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST" as const,
      body,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      cacheSettings: {
        store: true,
        maxAge: "60s",
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`Anthropic API error: ${resp.statusCode} - ${bodyText}`);
    }

    const apiResponse = JSON.parse(bodyText) as AnthropicApiResponse;
    const text = apiResponse?.content?.[0]?.text;

    if (!text) {
      throw new Error("Malformed Anthropic response: missing text");
    }

    return {
      statusCode: resp.statusCode,
      response: text,
      responseId: apiResponse.id || "",
    };
  };
