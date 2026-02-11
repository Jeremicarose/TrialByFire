import type { LLMClient, LLMRequest, LLMResponse } from "./index.js";

export class OpenAIClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || "";
    this.baseUrl = "https://api.openai.com/v1/chat/completions";
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const model = request.model || "gpt-4o";

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI API error ${response.status}: ${errorBody}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || "",
      model: data.model || model,
      tokensUsed: data.usage?.total_tokens || 0,
    };
  }
}
