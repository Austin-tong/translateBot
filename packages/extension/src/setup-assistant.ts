import type { SetupStatus } from "./setup-client.js";

export interface PopupSetupState {
  assistantTitle: string;
  assistantSummary: string;
  assistantChecklist: string[];
  translateEnabled: boolean;
  showAdvancedLogin: boolean;
}

export function buildPopupSetupState(status?: SetupStatus, error?: string): PopupSetupState {
  if (!status || error) {
    return {
      assistantTitle: "Set up the local proxy",
      assistantSummary: error ? `Proxy unavailable: ${error}` : "Translation is disabled until the proxy is ready.",
      assistantChecklist: [
        "Start the proxy with npm run dev:proxy",
        "If the proxy still does not respond, run ./scripts/bootstrap-local.sh",
        "Reopen the popup after the proxy is listening on {{proxyUrl}}"
      ],
      translateEnabled: false,
      showAdvancedLogin: false
    };
  }

  const provider = status.providers[status.recommendedProvider];
  if (status.nextAction === "ready") {
    return {
      assistantTitle: "Setup complete",
      assistantSummary: status.nextMessage,
      assistantChecklist: [
        `${prettyProviderName(provider.provider)} model ${provider.configuredModel} is available`,
        "Translation is ready."
      ],
      translateEnabled: true,
      showAdvancedLogin: false
    };
  }

  return {
    assistantTitle: "Finish setup",
    assistantSummary: status.nextMessage,
    assistantChecklist: buildChecklist(status),
    translateEnabled: false,
    showAdvancedLogin: false
  };
}

function buildChecklist(status: SetupStatus): string[] {
  if (status.nextAction === "create-config") {
    return [
      `Create ${status.configPath} from ./scripts/bootstrap-local.sh`,
      "Start the proxy with npm run dev:proxy"
    ];
  }

  if (status.nextAction === "start-local-provider") {
    return [
      "Start Ollama or LM Studio",
      "Reopen the popup after the proxy is listening on {{proxyUrl}}"
    ];
  }

  const provider = status.providers[status.recommendedProvider];
  return [
    `${prettyProviderName(provider.provider)} model ${provider.configuredModel} must be available`,
    "Reopen the popup after the proxy is listening on {{proxyUrl}}"
  ];
}

function prettyProviderName(provider: SetupStatus["recommendedProvider"]): string {
  return provider === "ollama" ? "Ollama" : "LM Studio";
}
