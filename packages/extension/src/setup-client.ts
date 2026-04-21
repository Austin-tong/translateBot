export interface LocalProviderStatus {
  provider: "ollama" | "lmstudio";
  baseUrl: string;
  configuredModel: string;
  reachable: boolean;
  availableModels: string[];
  ready: boolean;
  detail: string;
}

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
