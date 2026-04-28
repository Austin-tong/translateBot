/** 单个本机模型服务在 popup/setup 里的状态快照。 */
export interface LocalProviderStatus {
  provider: "ollama" | "lmstudio";
  baseUrl: string;
  configuredModel: string;
  reachable: boolean;
  availableModels: string[];
  ready: boolean;
  detail: string;
}

/** proxy `/setup/status` 返回给 popup 的整体状态。 */
export interface SetupStatus {
  mode: "local-first";
  configPath: string;
  envFileExists: boolean;
  recommendedProvider: "ollama" | "lmstudio";
  providers: {
    ollama: LocalProviderStatus;
    lmstudio: LocalProviderStatus;
  };
  nextAction: "create-config" | "start-local-provider" | "select-model" | "ready";
  nextMessage: string;
}

/** 读取 proxy 的 setup 状态，并在超时时给 popup 一个可恢复错误。 */
export async function fetchSetupStatus(proxyUrl: string, timeoutMs = 1500): Promise<SetupStatus> {
  const baseUrl = proxyUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/setup/status`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as SetupStatus;
  } finally {
    window.clearTimeout(timeout);
  }
}
