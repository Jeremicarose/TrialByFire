import { OpenAIClient } from "./openai.js";
import { AnthropicClient } from "./anthropic.js";
import { MockLLMClient } from "./mock.js";

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

export { OpenAIClient, AnthropicClient, MockLLMClient };

export function createLLMClient(
  provider: "openai" | "anthropic" | "mock"
): LLMClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient();
    case "anthropic":
      return new AnthropicClient();
    case "mock":
      return new MockLLMClient();
  }
}
