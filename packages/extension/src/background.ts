import type { BackgroundMessage, StatusResponse, ToggleResponse } from "./messages.js";
import { getSettings } from "./settings.js";

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-translation") {
    void toggleCurrentTab();
  }
});

chrome.action.onClicked.addListener(() => {
  void toggleCurrentTab();
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message.type === "TOGGLE_TRANSLATION") {
    void toggleCurrentTab(message.settings).then(sendResponse, (error: unknown) => {
      sendResponse({ ok: false, error: formatError(error) } satisfies ToggleResponse);
    });
    return true;
  }

  if (message.type === "UPDATE_TRANSLATION_SETTINGS") {
    void updateCurrentTabSettings(message.settings).then(sendResponse);
    return true;
  }

  if (message.type === "GET_TAB_STATUS") {
    void getCurrentTabStatus().then(sendResponse);
    return true;
  }

  return false;
});

async function toggleCurrentTab(overrideSettings?: Awaited<ReturnType<typeof getSettings>>): Promise<ToggleResponse> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isSupportedUrl(tab.url)) {
    return { ok: false, error: "This page cannot be translated. Try a normal http or https page." };
  }

  const settings = overrideSettings ?? (await getSettings());
  console.info("[Translate Bot] background toggle", settingsLogPayload(settings));
  await ensureContentScript(tab.id);
  const status = await sendTabMessage<StatusResponse>(tab.id, { type: "TRANSLATE_TOGGLE", settings });
  return { ok: true, status };
}

async function updateCurrentTabSettings(settings: Awaited<ReturnType<typeof getSettings>>): Promise<{ ok: boolean; error?: string; status?: StatusResponse }> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isSupportedUrl(tab.url)) {
    return { ok: true };
  }

  try {
    console.info("[Translate Bot] background update settings", settingsLogPayload(settings));
    const status = await sendTabMessage<StatusResponse>(tab.id, { type: "TRANSLATE_UPDATE_SETTINGS", settings });
    console.info("[Translate Bot] background update status", status);
    return { ok: true, status };
  } catch {
    // 当前页面可能还没有注入 content script；设置仍已保存，等下一次开启时会读取新值。
    return { ok: true };
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getCurrentTabStatus(): Promise<StatusResponse | undefined> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isSupportedUrl(tab.url)) return undefined;

  try {
    return await sendTabMessage<StatusResponse>(tab.id, { type: "TRANSLATE_STATUS" });
  } catch {
    return undefined;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendTabMessage(tabId, { type: "TRANSLATE_STATUS" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

function isSupportedUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function settingsLogPayload(settings: Awaited<ReturnType<typeof getSettings>>): Record<string, string> {
  return {
    provider: settings.provider,
    model: settings.model ?? "default",
    proxyUrl: settings.proxyUrl
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
