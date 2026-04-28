import type { SetupStatus } from "./setup-client.js";

/** popup 顶部 setup 助手区域所需的展示状态。 */
export interface PopupSetupState {
  assistantTitle: string;
  assistantSummary: string;
  assistantChecklist: string[];
  translateEnabled: boolean;
  showAdvancedLogin: boolean;
}

/**
 * 把 proxy 返回的 setup 状态压成 popup 里可直接渲染的文案和 checklist。
 * 这里把“不可用 / 进行中 / 已就绪”三种用户态明确拆开。
 */
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

/** 根据下一步动作生成一组可执行的检查项。 */
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

/** 把 provider id 转成适合界面展示的名字。 */
function prettyProviderName(provider: SetupStatus["recommendedProvider"]): string {
  return provider === "ollama" ? "Ollama" : "LM Studio";
}
