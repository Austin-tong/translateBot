import type { BackgroundMessage, StatusResponse } from "./messages.js";
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
    void toggleCurrentTab(message.settings).then(sendResponse);
    return true;
  }

  if (message.type === "GET_TAB_STATUS") {
    void getActiveTab().then((tab) => (tab?.id ? sendTabMessage<StatusResponse>(tab.id, { type: "TRANSLATE_STATUS" }) : undefined)).then(sendResponse);
    return true;
  }

  return false;
});

async function toggleCurrentTab(overrideSettings?: Awaited<ReturnType<typeof getSettings>>): Promise<{ ok: boolean; error?: string }> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !isSupportedUrl(tab.url)) {
    return { ok: false, error: "This page cannot be translated. Try a normal http or https page." };
  }

  const settings = overrideSettings ?? (await getSettings());
  await ensureContentScript(tab.id);
  await sendTabMessage(tab.id, { type: "TRANSLATE_TOGGLE", settings });
  return { ok: true };
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
