import { access } from "node:fs/promises";
import type { LocalProvider, LocalProviderStatus, ProxyConfig, SetupStatus } from "./types.js";

type ProviderProbe = {
  /** 被探测的本机服务信息，供 setup 页判断“可达”和“是否已加载目标模型”。 */
  provider: LocalProvider;
  baseUrl: string;
  model: string;
  endpoint: string;
  extractModelIds: (json: unknown) => string[];
};

/**
 * 扫描本地 `.env` 和模型服务状态，生成扩展 setup 页需要的完整判断结果。
 * 这个函数只负责“读现状并分流下一步”，不修改任何配置。
 */
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

/**
 * 按当前选中的本机模型服务，渲染可直接写入 `.env` 的最小配置。
 * 这里保留固定端口和超时，只让 model/provider 随用户选择变化。
 */
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

/** 探测单个本机模型服务：返回可达性、可用模型和“是否已准备好”的综合状态。 */
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

/** 从 LM Studio 的 /models 返回里提取模型 id。 */
function extractLmStudioModelIds(json: unknown): string[] {
  const data = json as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
}

/** 从 Ollama 的 /api/tags 返回里提取模型 id，并统一成代理内部的命名格式。 */
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

/** 把 Ollama 的上报名统一成 setup 逻辑里使用的显示名。 */
function prettyProviderName(provider: LocalProvider): string {
  return provider === "ollama" ? "Ollama" : "LM Studio";
}

/** 带超时的 fetch，避免本机模型服务卡住时阻塞 setup 状态刷新。 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** 把系统错误转成 setup 页能直接展示的简短文案。 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

/** 检查本地 env 文件是否存在。 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 根据 setup 状态生成下一步提示语。
 * 这里把“没配置 / 没启动 / 模型不对 / 已就绪”四种分支压成明确的一句话。
 */
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

/** “可直接用”的状态必须同时满足可达和模型已准备好。 */
function isReady(status: LocalProviderStatus): boolean {
  return status.reachable && status.ready;
}

/**
 * 按“已就绪 > 有模型 > 可达 > 不可达”的顺序挑选推荐服务。
 * 这样 setup 页会优先引导用户走成本最低、最少调整的路径。
 */
function selectRecommendedProvider(ollama: LocalProviderStatus, lmstudio: LocalProviderStatus): LocalProvider {
  const ollamaScore = providerUsabilityScore(ollama);
  const lmstudioScore = providerUsabilityScore(lmstudio);

  if (ollamaScore > lmstudioScore) return "ollama";
  if (lmstudioScore > ollamaScore) return "lmstudio";
  return "ollama";
}

/** 把“是否真的可用”拆成可解释的分数，方便比较两个本机服务。 */
function providerUsabilityScore(status: LocalProviderStatus): number {
  if (isReady(status)) return 3;
  if (status.availableModels.length > 0) return 2;
  if (status.reachable) return 1;
  return 0;
}
