import { access } from "node:fs/promises";
import type { LocalProvider, LocalProviderStatus, ProxyConfig, SetupStatus } from "./types.js";

type ProviderProbe = {
  provider: LocalProvider;
  baseUrl: string;
  model: string;
  endpoint: string;
  extractModelIds: (json: unknown) => string[];
};

export async function getSetupStatus(config: ProxyConfig): Promise<SetupStatus> {
  const envFileExists = await pathExists(config.configPath);
  const [ollama, lmstudio] = await Promise.all([
    probeProvider({
      provider: "ollama",
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      endpoint: "/api/tags",
      extractModelIds: extractOllamaModelIds
    }, config.requestTimeoutMs),
    probeProvider({
      provider: "lmstudio",
      baseUrl: config.lmstudioBaseUrl,
      model: config.lmstudioModel,
      endpoint: "/models",
      extractModelIds: extractLmStudioModelIds
    }, config.requestTimeoutMs)
  ]);

  const recommendedProvider = selectRecommendedProvider(ollama, lmstudio);
  const nextAction = isReady(ollama) || isReady(lmstudio)
    ? "ready"
    : !envFileExists
      ? "create-config"
      : ollama.reachable || lmstudio.reachable
        ? "select-model"
        : "start-local-provider";

  return {
    mode: "local-first",
    configPath: config.configPath,
    envFileExists,
    recommendedProvider,
    providers: {
      ollama,
      lmstudio
    },
    nextAction,
    nextMessage: buildNextMessage({ envFileExists, recommendedProvider, nextAction, ollama, lmstudio, configPath: config.configPath })
  };
}

export function renderLocalEnv(input: { provider: "ollama" | "lmstudio"; model: string }): string {
  const lines = input.provider === "ollama"
    ? [
        "HOST=127.0.0.1",
        "PORT=8787",
        "REQUEST_TIMEOUT_MS=45000",
        "OLLAMA_BASE_URL=http://localhost:11434",
        `OLLAMA_MODEL=${input.model}`
      ]
    : [
        "HOST=127.0.0.1",
        "PORT=8787",
        "REQUEST_TIMEOUT_MS=45000",
        "LMSTUDIO_BASE_URL=http://localhost:1234/v1",
        `LMSTUDIO_MODEL=${input.model}`
      ];

  return `${lines.join("\n")}\n`;
}

async function probeProvider(probe: ProviderProbe, timeoutMs: number): Promise<LocalProviderStatus> {
  const baseUrl = probe.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}${probe.endpoint}`;

  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    if (!response.ok) {
      return {
      provider: probe.provider,
      baseUrl,
      configuredModel: probe.model,
      reachable: false,
      availableModels: [],
      ready: false,
      detail: `${prettyProviderName(probe.provider)} probe returned ${response.status} at ${probe.endpoint}.`
      };
    }

    const json = await response.json();
    const availableModels = new Set(probe.extractModelIds(json));
    const ready = availableModels.has(normalizeModel(probe.provider, probe.model));

    return {
      provider: probe.provider,
      baseUrl,
      configuredModel: probe.model,
      reachable: true,
      availableModels: [...availableModels],
      ready,
      detail: ready
        ? `${prettyProviderName(probe.provider)} is ready with ${probe.model}.`
        : `${prettyProviderName(probe.provider)} is reachable, but ${probe.model} is not available.`
    };
  } catch (error) {
    return {
      provider: probe.provider,
      baseUrl,
      configuredModel: probe.model,
      reachable: false,
      availableModels: [],
      ready: false,
      detail: `${prettyProviderName(probe.provider)} is not reachable: ${formatError(error)}`
    };
  }
}

function extractLmStudioModelIds(json: unknown): string[] {
  const data = json as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
}

function extractOllamaModelIds(json: unknown): string[] {
  const parsed = json as { models?: Array<{ name?: string; model?: string }> };
  return (parsed.models ?? [])
    .map((model) => model.name ?? model.model)
    .filter((id): id is string => Boolean(id))
    .map((id) => normalizeModel("ollama", id));
}

function normalizeModel(provider: LocalProvider, model: string): string {
  const trimmed = model.trim();
  if (provider === "ollama" && trimmed === "gemma4-e2b") return "gemma4:e2b";
  return trimmed;
}

function prettyProviderName(provider: LocalProvider): string {
  return provider === "ollama" ? "Ollama" : "LM Studio";
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function buildNextMessage(input: {
  envFileExists: boolean;
  recommendedProvider: LocalProvider;
  nextAction: SetupStatus["nextAction"];
  ollama: LocalProviderStatus;
  lmstudio: LocalProviderStatus;
  configPath: string;
}): string {
  if (input.nextAction === "ready") {
    return `${prettyProviderName(input.recommendedProvider)} is ready.`;
  }

  if (input.nextAction === "create-config") {
    return `Create ${input.configPath} from the local env template, then start a local provider.`;
  }

  if (input.nextAction === "select-model") {
    const provider = input.recommendedProvider === "ollama" ? input.ollama : input.lmstudio;
    return `Select ${prettyProviderName(provider.provider)} model ${provider.configuredModel} or change the local model in ${input.configPath}.`;
  }

  return `Start Ollama or LM Studio, then reload setup status.`;
}

function isReady(status: LocalProviderStatus): boolean {
  return status.reachable && status.ready;
}

function selectRecommendedProvider(ollama: LocalProviderStatus, lmstudio: LocalProviderStatus): LocalProvider {
  const ollamaScore = providerUsabilityScore(ollama);
  const lmstudioScore = providerUsabilityScore(lmstudio);

  if (ollamaScore > lmstudioScore) return "ollama";
  if (lmstudioScore > ollamaScore) return "lmstudio";
  return "ollama";
}

function providerUsabilityScore(status: LocalProviderStatus): number {
  if (isReady(status)) return 3;
  if (status.availableModels.length > 0) return 2;
  if (status.reachable) return 1;
  return 0;
}
