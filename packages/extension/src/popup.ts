import type { BackgroundMessage, StatusResponse, ToggleResponse } from "./messages.js";
import { type ExtensionSettings, getSettings, saveSettings } from "./settings.js";
import { fetchSetupStatus } from "./setup-client.js";
import { buildPopupSetupState, type PopupSetupState } from "./setup-assistant.js";

const provider = document.querySelector<HTMLSelectElement>("#provider");
const model = document.querySelector<HTMLInputElement>("#model");
const proxyUrl = document.querySelector<HTMLInputElement>("#proxyUrl");
const status = document.querySelector<HTMLParagraphElement>("#status");
const toggle = document.querySelector<HTMLButtonElement>("#toggle");
const health = document.querySelector<HTMLButtonElement>("#health");
const login = document.querySelector<HTMLButtonElement>("#login");
const assistantTitle = document.querySelector<HTMLHeadingElement>("#assistantTitle");
const assistantSummary = document.querySelector<HTMLParagraphElement>("#assistantSummary");
const assistantChecklist = document.querySelector<HTMLUListElement>("#assistantChecklist");

void init();

/**
 * popup 的启动入口。
 * 按“读设置 -> 渲染表单 -> 绑定事件 -> 刷新 setup 和当前页状态”的顺序初始化界面。
 */
async function init(): Promise<void> {
  const settings = await getSettings();
  setForm(settings);

  provider?.addEventListener("change", () => {
    clearIncompatibleModelForProvider();
    updateLoginVisibility();
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

  updateLoginVisibility();
  void refreshSetupAssistant(settings.proxyUrl);
  void refreshActiveTabStatus();
}

/** 请求 proxy 的 setup 状态并渲染顶部助手区域。 */
async function refreshSetupAssistant(proxy: string): Promise<void> {
  try {
    const setupStatus = await fetchSetupStatus(proxy);
    renderSetupAssistant(buildPopupSetupState(setupStatus), proxy);
  } catch (error) {
    renderSetupAssistant(buildPopupSetupState(undefined, formatError(error)), proxy);
  }
}

/** 保存当前表单，并把新设置同步给当前标签页。 */
async function saveCurrentForm(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  const saved = await getSettings();
  console.info("[Translate Bot] popup saved settings", settingsLogPayload(saved));
  const update = await notifySettingsChanged(saved);
  setStatus(`Saved. Provider: ${saved.provider}. Model: ${saved.model ?? "default"}.${formatUpdateStatus(update)}`);
}

/** 读取当前 tab 的翻译状态，更新 popup 底部状态栏。 */
async function refreshActiveTabStatus(): Promise<void> {
  const pageStatus = await getActiveTabStatus();
  setPageStatus(pageStatus);
}

/** 在 proxy 上启动 OpenAI Codex 的 OAuth 登录流程。 */
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

/** 保存表单后切换当前标签页的翻译开关。 */
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

/** 手动刷新 proxy 的健康状态，方便排查本机模型服务是否已启动。 */
async function checkProxy(): Promise<void> {
  const settings = readForm();
  await saveSettings(settings);
  try {
    const response = await fetch(`${settings.proxyUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { openaiAuth?: string; openaiModel?: string; lmstudioBaseUrl?: string; ollamaModel?: string; ollamaBaseUrl?: string };
    const openaiAuthDetail = settings.provider === "openai" ? await fetchOpenAIAuthDetail(settings.proxyUrl) : body.openaiAuth ?? "not checked";
    await refreshSetupAssistant(settings.proxyUrl);
    setStatus(`Proxy ready. OpenAI auth: ${openaiAuthDetail}. Ollama: ${body.ollamaModel ?? "unknown"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Proxy unavailable: ${message}`);
  }
}

/** 向 proxy 查询 OpenAI Codex OAuth 的登录态。 */
async function fetchOpenAIAuthDetail(proxy: string): Promise<string> {
  try {
    const response = await fetch(`${proxy}/auth/openai/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { loggedIn?: boolean; detail?: string };
    if (body.detail) return body.detail;
    return body.loggedIn ? "OpenAI Codex OAuth is ready." : "OpenAI Codex OAuth is not ready.";
  } catch (error) {
    return `unknown (${formatError(error)})`;
  }
}

/** popup 保存设置后，通过 background 通知当前标签页更新翻译参数。 */
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

/** 查询当前标签页的翻译运行状态，超时后直接回退为空。 */
async function getActiveTabStatus(): Promise<StatusResponse | undefined> {
  try {
    return await withTimeout(chrome.runtime.sendMessage<BackgroundMessage, StatusResponse | undefined>({ type: "GET_TAB_STATUS" }), 800);
  } catch {
    return undefined;
  }
}

/** 触发当前标签页的翻译切换，并把错误收敛成可展示消息。 */
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

/** 给异步操作加上前端超时，避免 popup 一直挂起。 */
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

/** 把设置对象写回表单控件。 */
function setForm(settings: ExtensionSettings): void {
  if (provider) provider.value = settings.provider;
  if (model) model.value = settings.model ?? "";
  if (proxyUrl) proxyUrl.value = settings.proxyUrl;
}

/** 从表单读取当前设置，并把空值收敛成默认配置。 */
function readForm(): ExtensionSettings {
  const rawProvider = provider?.value;
  return {
    provider: rawProvider === "openai" || rawProvider === "lmstudio" || rawProvider === "ollama" ? rawProvider : "ollama",
    model: model?.value.trim() || undefined,
    proxyUrl: (proxyUrl?.value.trim() || "http://127.0.0.1:8787").replace(/\/$/, "")
  };
}

/** 更新 popup 底部状态栏文案。 */
function setStatus(message: string): void {
  if (status) status.textContent = message;
}

/** 渲染顶部的 setup 助手区域，并替换占位符中的 proxyUrl。 */
function renderSetupAssistant(state: PopupSetupState, proxyUrl: string): void {
  if (assistantTitle) assistantTitle.textContent = state.assistantTitle;
  if (assistantSummary) assistantSummary.textContent = formatAssistantText(state.assistantSummary, proxyUrl);
  if (assistantChecklist) {
    assistantChecklist.replaceChildren(
      ...state.assistantChecklist.map((item) => {
        const li = document.createElement("li");
        li.textContent = formatAssistantText(item, proxyUrl);
        return li;
      })
    );
  }
  if (toggle) toggle.disabled = !state.translateEnabled;
  updateLoginVisibility();
}

/** 把当前页翻译状态收敛成一句可读摘要。 */
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

/** 切换 provider 时清理明显不匹配的模型名，避免把 OpenAI 模型发给本地引擎。 */
function clearIncompatibleModelForProvider(): void {
  if (!provider || !model) return;
  const currentModel = model.value.trim();
  if (provider.value === "ollama" && /^gpt-/i.test(currentModel)) model.value = "";
  if (provider.value === "openai" && /^(gemma|qwen|llama|mistral|deepseek)/i.test(currentModel)) model.value = "";
}

/** 只有 OpenAI provider 才显示登录按钮。 */
function updateLoginVisibility(): void {
  if (!login) return;
  login.hidden = provider?.value !== "openai";
}

/** 把模板里的 proxy 占位符替换成真实地址。 */
function formatAssistantText(text: string, proxyUrl: string): string {
  return text.replaceAll("{{proxyUrl}}", proxyUrl);
}

/** 把翻译开关的结果补到已保存状态后面，方便用户知道当前页是否已启用。 */
function formatUpdateStatus(statusResponse: StatusResponse | undefined): string {
  if (!statusResponse?.enabled) return " Active page: translation is off.";
  return ` Active page: translation is on with ${statusResponse.provider ?? "unknown"} / ${statusResponse.model ?? "default"}.`;
}

/** 日志里只保留关键设置字段。 */
function settingsLogPayload(settings: ExtensionSettings): Record<string, string> {
  return {
    provider: settings.provider,
    model: settings.model ?? "default",
    proxyUrl: settings.proxyUrl
  };
}

/** 把异常转成可展示的文案。 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
