export type Provider = "openai" | "lmstudio";

export interface ExtensionSettings {
  provider: Provider;
  model?: string;
  proxyUrl: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: "openai",
  proxyUrl: "http://127.0.0.1:8787"
};

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set(normalizeSettings(settings));
}

function normalizeSettings(raw: Partial<ExtensionSettings>): ExtensionSettings {
  const provider = raw.provider === "lmstudio" ? "lmstudio" : "openai";
  const rawModel = typeof raw.model === "string" ? raw.model.trim() : "";
  const model = rawModel && rawModel !== "default" ? rawModel : undefined;
  const proxyUrl = typeof raw.proxyUrl === "string" && raw.proxyUrl.trim() ? raw.proxyUrl.trim().replace(/\/$/, "") : DEFAULT_SETTINGS.proxyUrl;
  return { provider, model, proxyUrl };
}
