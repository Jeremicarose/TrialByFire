export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

export interface LLMClient {
  call(request: LLMRequest): Promise<LLMResponse>;
}

export { OpenAIClient } from "./openai.js";
export { AnthropicClient } from "./anthropic.js";
export { MockLLMClient } from "./mock.js";

export function createLLMClient(
  provider: "openai" | "anthropic" | "mock"
): LLMClient {
  switch (provider) {
    case "openai":
      return new (require("./openai.js") as typeof import("./openai.js")).OpenAIClient();
    case "anthropic":
      return new (require("./anthropic.js") as typeof import("./anthropic.js")).AnthropicClient();
    case "mock":
      return new (require("./mock.js") as typeof import("./mock.js")).MockLLMClient();
  }
}
