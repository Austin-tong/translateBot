import type { BackgroundMessage, StatusResponse, ToggleResponse } from "./messages.js";
import { getSettings } from "./settings.js";

// background 只负责把浏览器命令、toolbar 点击和 popup 消息转发给当前标签页。
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

/** 根据当前活动标签页切换翻译状态，必要时先注入 content script。 */
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

/** 把 popup 保存的新设置同步给当前标签页的 content script。 */
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

/** 读取当前窗口的活动标签页。 */
async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** 查询当前活动标签页的翻译运行状态。 */
async function getCurrentTabStatus(): Promise<StatusResponse | undefined> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isSupportedUrl(tab.url)) return undefined;

  try {
    return await sendTabMessage<StatusResponse>(tab.id, { type: "TRANSLATE_STATUS" });
  } catch {
    return undefined;
  }
}

/** 确保目标标签页里已经有 content script；没有就动态注入。 */
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

/** 包一层 chrome.tabs.sendMessage，统一返回值类型。 */
function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

/** 只允许 http/https 页面接收翻译功能。 */
function isSupportedUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** 日志里只保留设置的关键字段，避免直接打印整份对象。 */
function settingsLogPayload(settings: Awaited<ReturnType<typeof getSettings>>): Record<string, string> {
  return {
    provider: settings.provider,
    model: settings.model ?? "default",
    proxyUrl: settings.proxyUrl
  };
}

/** 把任意异常转成 popup 可展示的简短消息。 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
