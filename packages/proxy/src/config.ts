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
    codexCommand: process.env.CODEX_COMMAND ?? "codex",
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    lmstudioModel: process.env.LMSTUDIO_MODEL ?? "local-model",
    requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 45000)
  };
}
