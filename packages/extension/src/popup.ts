import type { BackgroundMessage, StatusResponse, ToggleResponse } from "./messages.js";
import { type ExtensionSettings, getSettings, saveSettings } from "./settings.js";

const provider = document.querySelector<HTMLSelectElement>("#provider");
const model = document.querySelector<HTMLInputElement>("#model");
const proxyUrl = document.querySelector<HTMLInputElement>("#proxyUrl");
const status = document.querySelector<HTMLParagraphElement>("#status");
const toggle = document.querySelector<HTMLButtonElement>("#toggle");
const health = document.querySelector<HTMLButtonElement>("#health");
const login = document.querySelector<HTMLButtonElement>("#login");

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  setForm(settings);

  provider?.addEventListener("change", () => {
    clearIncompatibleModelForProvider();
    void saveCurrentForm();
  });

  model?.addEventListener("change", () => {
    void saveCurrentForm();
  });

  model?.addEventListener("blur", () => {
    void saveCurrentForm();
  });

  proxyUrl?.addEventListener("change", () => {
    void saveCurrentForm();
  });

  proxyUrl?.addEventListener("blur", () => {
    void saveCurrentForm();
  });

  toggle?.addEventListener("click", () => {
    void saveAndToggle();
  });

  health?.addEventListener("click", () => {
    void checkProxy();
  });

  login?.addEventListener("click", () => {
    void startCodexLogin();
  });

  void refreshActiveTabStatus();
}

async function saveCurrentForm(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  const saved = await getSettings();
  console.info("[Translate Bot] popup saved settings", settingsLogPayload(saved));
  const update = await notifySettingsChanged(saved);
  setStatus(`Saved. Provider: ${saved.provider}. Model: ${saved.model ?? "default"}.${formatUpdateStatus(update)}`);
}

async function refreshActiveTabStatus(): Promise<void> {
  const pageStatus = await getActiveTabStatus();
  setPageStatus(pageStatus);
}

async function startCodexLogin(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  try {
    const response = await fetch(`${settings.proxyUrl}/auth/openai/start`, { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus("OpenAI Codex login started. Complete the browser authorization flow.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Could not start OpenAI Codex login: ${message}`);
  }
}

async function saveAndToggle(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  const saved = await getSettings();
  console.info("[Translate Bot] popup toggle settings", settingsLogPayload(saved));
  setStatus(`Starting translation with ${saved.provider} / ${saved.model ?? "default"}...`);
  const result = await sendToggleMessage(saved);
  if (!result?.ok) {
    setStatus(result?.error ?? "Could not start translation.");
    return;
  }
  setPageStatus(result.status);
}

async function checkProxy(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  try {
    const response = await fetch(`${settings.proxyUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { openaiAuth?: string; openaiModel?: string; lmstudioBaseUrl?: string; ollamaModel?: string; ollamaBaseUrl?: string };
    setStatus(`Proxy ready. OpenAI auth: ${body.openaiAuth ?? "unknown"}. Ollama: ${body.ollamaModel ?? "unknown"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Proxy unavailable: ${message}`);
  }
}

async function notifySettingsChanged(settings: ExtensionSettings): Promise<StatusResponse | undefined> {
  try {
    const response = await chrome.runtime.sendMessage<BackgroundMessage, ToggleResponse>({
      type: "UPDATE_TRANSLATION_SETTINGS",
      settings
    });
    console.info("[Translate Bot] popup settings update response", response);
    return response?.status;
  } catch {
    // popup 保存是主路径；当前 tab 未注入 content script 时无需打扰用户。
    return undefined;
  }
}

async function getActiveTabStatus(): Promise<StatusResponse | undefined> {
  try {
    return await withTimeout(chrome.runtime.sendMessage<BackgroundMessage, StatusResponse | undefined>({ type: "GET_TAB_STATUS" }), 800);
  } catch {
    return undefined;
  }
}

async function sendToggleMessage(settings: ExtensionSettings): Promise<ToggleResponse | undefined> {
  try {
    return await chrome.runtime.sendMessage<BackgroundMessage, ToggleResponse>({
      type: "TOGGLE_TRANSLATION",
      settings
    });
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Timed out."));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function setForm(settings: ExtensionSettings): void {
  if (provider) provider.value = settings.provider;
  if (model) model.value = settings.model ?? "";
  if (proxyUrl) proxyUrl.value = settings.proxyUrl;
}

function readForm(): ExtensionSettings {
  const rawProvider = provider?.value;
  return {
    provider: rawProvider === "openai" || rawProvider === "lmstudio" || rawProvider === "ollama" ? rawProvider : "ollama",
    model: model?.value.trim() || undefined,
    proxyUrl: (proxyUrl?.value.trim() || "http://127.0.0.1:8787").replace(/\/$/, "")
  };
}

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

function setPageStatus(pageStatus: StatusResponse | undefined): void {
  if (!pageStatus?.enabled) {
    setStatus("Current page: translation is off.");
    if (toggle) toggle.textContent = "Translate page";
    return;
  }

  const pending = pageStatus.pending > 0 ? ` ${pageStatus.pending} pending.` : "";
  const error = pageStatus.error ? ` Last error: ${pageStatus.error}` : "";
  setStatus(`Current page: translation is on. ${pageStatus.translated} translated.${pending}${error}`);
  if (toggle) toggle.textContent = "Turn off";
}

function clearIncompatibleModelForProvider(): void {
  if (!provider || !model) return;
  const currentModel = model.value.trim();
  if (provider.value === "ollama" && /^gpt-/i.test(currentModel)) model.value = "";
  if (provider.value === "openai" && /^(gemma|qwen|llama|mistral|deepseek)/i.test(currentModel)) model.value = "";
}

function formatUpdateStatus(statusResponse: StatusResponse | undefined): string {
  if (!statusResponse?.enabled) return " Active page: translation is off.";
  return ` Active page: translation is on with ${statusResponse.provider ?? "unknown"} / ${statusResponse.model ?? "default"}.`;
}

function settingsLogPayload(settings: ExtensionSettings): Record<string, string> {
  return {
    provider: settings.provider,
    model: settings.model ?? "default",
    proxyUrl: settings.proxyUrl
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
