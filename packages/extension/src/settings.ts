/** 扩展端可选的翻译提供方，与 proxy 层保持一致。 */
export type Provider = "openai" | "lmstudio" | "ollama";

/** 扩展保存到 `chrome.storage.sync` 的用户级设置。 */
export interface ExtensionSettings {
  provider: Provider;
  model?: string;
  proxyUrl: string;
}

/** 未配置时的默认值，保证 popup 首次打开时有可用表单。 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: "ollama",
  proxyUrl: "http://127.0.0.1:8787"
};

/** 从同步存储读取设置，并把缺省值和脏数据收敛成稳定结构。 */
export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

/** 把当前表单保存到同步存储，供其它标签页和下次打开复用。 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set(normalizeSettings(settings));
}

/** 只接受合法 provider，并清理空值、default 占位和尾部斜杠。 */
function normalizeSettings(raw: Partial<ExtensionSettings>): ExtensionSettings {
  const provider = raw.provider === "openai" || raw.provider === "lmstudio" || raw.provider === "ollama" ? raw.provider : DEFAULT_SETTINGS.provider;
  const rawModel = typeof raw.model === "string" ? raw.model.trim() : "";
  const model = rawModel && rawModel !== "default" ? rawModel : undefined;
  const proxyUrl = typeof raw.proxyUrl === "string" && raw.proxyUrl.trim() ? raw.proxyUrl.trim().replace(/\/$/, "") : DEFAULT_SETTINGS.proxyUrl;
  return { provider, model, proxyUrl };
}
