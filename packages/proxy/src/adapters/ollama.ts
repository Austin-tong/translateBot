import { buildTranslationPrompt, parseTranslationJson } from "../prompt.js";
import type { ModelAdapter, ProxyConfig, TranslateRequest, TranslateResponse } from "../types.js";

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    content?: string;
  };
  usage?: unknown;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export class OllamaAdapter implements ModelAdapter {
  constructor(private readonly config: ProxyConfig) {}

  async listModels(): Promise<string[]> {
    const response = await fetchWithTimeout(`${this.baseUrl()}/api/tags`, {
      signalTimeoutMs: this.config.requestTimeoutMs
    });
    if (!response.ok) {
      throw new Error(`Ollama model list failed with ${response.status}.`);
    }
    const json = (await response.json()) as OllamaTagsResponse;
    return (json.models ?? [])
      .map((model) => model.name ?? model.model)
      .filter((id): id is string => Boolean(id));
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const model = normalizeModel(request.model ?? this.config.ollamaModel, this.config.ollamaModel);
    const expectedIds = new Set(request.segments.map((segment) => segment.id));
    // Ollama 走本机原生 /api/chat 接口；stream=false 让 proxy 一次拿到完整 JSON 后再解析。
    const response = await fetchWithTimeout(`${this.baseUrl()}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: "json",
        options: {
          temperature: 0.2
        },
        messages: [
          {
            role: "system",
            content: "Translate webpage segments into natural Simplified Chinese. Do not think step by step. Do not include reasoning, analysis, notes, or explanations. Return JSON only."
          },
          {
            role: "user",
            content: ["/no_think", "Do not think. Directly return the final translation JSON.", buildTranslationPrompt(request)].join("\n")
          }
        ]
      }),
      signalTimeoutMs: this.config.requestTimeoutMs
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Ollama translation failed with ${response.status}: ${message.slice(0, 300)}`);
    }

    const json = (await response.json()) as OllamaChatResponse;
    const text = json.message?.content;
    if (!text) throw new Error("Ollama response did not include message content.");

    return {
      provider: "ollama",
      model: json.model ?? model,
      segments: parseTranslationJson(stripThinking(text), expectedIds),
      usage: json.usage ?? {
        promptEvalCount: json.prompt_eval_count,
        evalCount: json.eval_count,
        totalDuration: json.total_duration
      }
    };
  }

  private baseUrl(): string {
    return this.config.ollamaBaseUrl.replace(/\/$/, "");
  }
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function normalizeModel(model: string, fallback: string): string {
  const trimmed = model.trim();
  if (trimmed === "gemma4-e2b") return "gemma4:e2b";
  return trimmed && trimmed !== "default" ? trimmed : fallback;
}

// 本地 Ollama 未启动或模型冷启动时会慢一些，超时后让页面显示可恢复错误。
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
