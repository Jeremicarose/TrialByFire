import type { LLMClient, LLMRequest, LLMResponse } from "./index.js";

/**
 * Anthropic Claude API adapter.
 *
 * Uses raw fetch() against the Messages API rather than the official SDK.
 * This keeps the adapter lightweight and mirrors how CRE's HTTP Client
 * will make these calls once we port the workflow.
 *
 * Key Anthropic API specifics:
 * - System prompt is a top-level field, NOT a message role
 * - Requires "anthropic-version" header for API versioning
 * - Response body nests text inside a content[] array of typed blocks
 */
export class AnthropicClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    // Read key from environment — will be empty string if not set,
    // and we throw a clear error in call() rather than silently failing
    this.apiKey = process.env.ANTHROPIC_API_KEY || "";
    this.baseUrl = "https://api.anthropic.com/v1/messages";
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const model = request.model || "claude-sonnet-4-20250514";

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        // Anthropic's API takes system prompt as a top-level field,
        // not as a message with role "system"
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userPrompt }],
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Anthropic API error ${response.status}: ${errorBody}`
      );
    }

    const data = await response.json();

    // Anthropic returns content as an array of blocks — we want the text block
    const textBlock = data.content?.find(
      (block: { type: string }) => block.type === "text"
    );

    return {
      content: textBlock?.text || "",
      model: data.model || model,
      tokensUsed:
        (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }
}
