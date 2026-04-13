import { buildTranslationPrompt, parseTranslationJson } from "../prompt.js";
import type { ModelAdapter, ProxyConfig, TranslateRequest, TranslateResponse } from "../types.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: unknown;
}

export class LMStudioAdapter implements ModelAdapter {
  constructor(private readonly config: ProxyConfig) {}

  async listModels(): Promise<string[]> {
    const response = await fetchWithTimeout(`${this.baseUrl()}/models`, {
      signalTimeoutMs: this.config.requestTimeoutMs
    });
    if (!response.ok) {
      throw new Error(`LM Studio model list failed with ${response.status}.`);
    }
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const model = request.model ?? this.config.lmstudioModel;
    const expectedIds = new Set(request.segments.map((segment) => segment.id));
    // LM Studio 暴露 OpenAI-compatible Chat Completions，本地模型不需要云端凭证。
    const response = await fetchWithTimeout(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Translate webpage segments. Return JSON only."
          },
          {
            role: "user",
            content: buildTranslationPrompt(request)
          }
        ],
        temperature: 0.2
      }),
      signalTimeoutMs: this.config.requestTimeoutMs
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`LM Studio translation failed with ${response.status}: ${message.slice(0, 300)}`);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error("LM Studio response did not include message content.");

    return {
      provider: "lmstudio",
      model,
      segments: parseTranslationJson(text, expectedIds),
      usage: json.usage
    };
  }

  private baseUrl(): string {
    return this.config.lmstudioBaseUrl.replace(/\/$/, "");
  }
}

// LM Studio 本地服务可能未启动或模型加载较慢，超时后让页面显示可恢复错误。
async function fetchWithTimeout(url: string, init: RequestInit & { signalTimeoutMs: number }): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.signalTimeoutMs);
  try {
    const { signalTimeoutMs: _signalTimeoutMs, ...fetchInit } = init;
    return await fetch(url, { ...fetchInit, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
