import "dotenv/config";
import type { ProxyConfig } from "./types.js";

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): ProxyConfig {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: numberFromEnv("PORT", 8787),
    openaiModel: process.env.OPENAI_MODEL ?? "default",
    openaiCodexAuthPath: process.env.OPENAI_CODEX_AUTH_PATH ?? "~/.translate-bot/openai-codex-oauth.json",
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    lmstudioModel: process.env.LMSTUDIO_MODEL ?? "local-model",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4:e2b",
    requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 45000)
  };
}
