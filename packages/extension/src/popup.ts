import type { BackgroundMessage } from "./messages.js";
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
}

async function saveCurrentForm(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  setStatus(`Saved. Model: ${settings.model ?? "default"}.`);
}

async function startCodexLogin(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  try {
    const response = await fetch(`${settings.proxyUrl}/auth/openai/start`, { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus("Codex login started. Complete the browser authorization flow.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Could not start Codex login: ${message}`);
  }
}

async function saveAndToggle(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  setStatus("Starting translation...");
  const result = await chrome.runtime.sendMessage<BackgroundMessage, { ok: boolean; error?: string }>({
    type: "TOGGLE_TRANSLATION",
    settings
  });
  setStatus(result?.ok ? "Translation toggled." : result?.error ?? "Could not start translation.");
}

async function checkProxy(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  try {
    const response = await fetch(`${settings.proxyUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { openaiAuth?: string; codexCommand?: string; lmstudioBaseUrl?: string };
    setStatus(`Proxy ready. OpenAI auth: ${body.openaiAuth ?? "unknown"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Proxy unavailable: ${message}`);
  }
}

function setForm(settings: ExtensionSettings): void {
  if (provider) provider.value = settings.provider;
  if (model) model.value = settings.model ?? "";
  if (proxyUrl) proxyUrl.value = settings.proxyUrl;
}

function readForm(): ExtensionSettings {
  return {
    provider: provider?.value === "lmstudio" ? "lmstudio" : "openai",
    model: model?.value.trim() || undefined,
    proxyUrl: (proxyUrl?.value.trim() || "http://127.0.0.1:8787").replace(/\/$/, "")
  };
}

function setStatus(message: string): void {
  if (status) status.textContent = message;
}
