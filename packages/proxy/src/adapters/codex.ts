import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { complete, type AssistantMessage, type Model, type OAuthCredentials } from "@mariozechner/pi-ai";
import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import { buildTranslationPrompt, parseTranslationJson } from "../prompt.js";
import type { ModelAdapter, ProxyConfig, TranslateRequest, TranslateResponse } from "../types.js";

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_AUTH_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const MODEL_IDS = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2"
];

interface StoredCodexAuth {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export class CodexAdapter implements ModelAdapter {
  private authPromise: Promise<void> | null = null;

  constructor(private readonly config: ProxyConfig) {}

  async listModels(): Promise<string[]> {
    return MODEL_IDS;
  }

  async authStatus(): Promise<{ loggedIn: boolean; detail: string }> {
    if (this.authPromise) {
      return { loggedIn: false, detail: "OpenAI Codex OAuth login is still running in the browser." };
    }

    const credentials = await this.loadCredentials();
    if (!credentials) {
      return {
        loggedIn: false,
        detail: `No OpenAI Codex OAuth credentials found at ${this.authPath()}.`
      };
    }

    try {
      await this.resolveAccessToken();
      const latestCredentials = await this.loadCredentials();
      return {
        loggedIn: true,
        detail: `OpenAI Codex OAuth is ready. Token expires at ${new Date(latestCredentials?.expires ?? credentials.expires).toISOString()}.`
      };
    } catch (error) {
      return {
        loggedIn: false,
        detail: `OpenAI Codex OAuth refresh failed: ${formatError(error)}`
      };
    }
  }

  async startAuth(): Promise<{ started: boolean; detail: string; authUrl?: string }> {
    if (this.authPromise) {
      return {
        started: true,
        detail: "OpenAI Codex OAuth login is already running. Complete the browser flow."
      };
    }

    let resolveUrl: (url: string) => void;
    let rejectUrl: (error: unknown) => void;
    const urlReady = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });

    // OAuth 回调服务器由 pi-ai 在 127.0.0.1:1455 启动；proxy 只负责打开浏览器并持久化结果。
    this.authPromise = loginOpenAICodex({
      originator: "translate-bot",
      onAuth: (info) => {
        openBrowser(info.url);
        resolveUrl(info.url);
      },
      onProgress: (message) => {
        console.log(`[translate-bot] openai codex oauth: ${message}`);
      },
      onPrompt: async () => {
        throw new Error("Manual OAuth code paste is not supported from the extension popup. Retry after closing any process using port 1455.");
      }
    }).then(async (credentials) => {
      await this.saveCredentials(credentials);
      console.log(`[translate-bot] openai codex oauth complete expires=${new Date(credentials.expires).toISOString()}`);
    }).catch((error) => {
      rejectUrl(error);
      console.error(`[translate-bot] openai codex oauth failed: ${formatError(error)}`);
    }).finally(() => {
      this.authPromise = null;
    });

    const authUrl = await urlReady;
    return {
      started: true,
      authUrl,
      detail: "Opened OpenAI Codex OAuth in the browser. Complete the authorization flow to save the local proxy token."
    };
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const model = normalizeModel(request.model ?? this.config.openaiModel);
    const expectedIds = new Set(request.segments.map((segment) => segment.id));
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeoutMs);

    try {
      const message = await complete(this.model(model), {
        systemPrompt: [
          "You are a webpage translation engine.",
          "Return only JSON. Do not include Markdown or explanation."
        ].join("\n"),
        messages: [{
          role: "user",
          content: buildTranslationPrompt(request),
          timestamp: Date.now()
        }]
      }, {
        apiKey: await this.resolveAccessToken(),
        signal: controller.signal,
        transport: "sse",
        textVerbosity: "low",
        reasoningEffort: "low"
      });

      return {
        provider: "openai",
        model,
        segments: parseTranslationJson(assistantText(message), expectedIds),
        usage: message.usage
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private model(id: string): Model<"openai-codex-responses"> {
    return {
      id,
      name: id,
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text"],
      contextWindow: id === "gpt-5.4" ? 1_050_000 : 272_000,
      maxTokens: 128_000,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0
      }
    };
  }

  private authPath(): string {
    return this.config.openaiCodexAuthPath.replace(/^~(?=$|\/)/, homedir());
  }

  private async resolveAccessToken(): Promise<string> {
    const credentials = await this.loadCredentials();
    if (!credentials) {
      throw new Error("OpenAI Codex OAuth is not configured. Click Open OpenAI login in the extension popup first.");
    }

    if (credentials.expires > Date.now() + CODEX_AUTH_REFRESH_WINDOW_MS) {
      return credentials.access;
    }

    // 只在 proxy 本地刷新 OAuth token；扩展不会接触 access/refresh token。
    const refreshed = await refreshOpenAICodexToken(credentials.refresh);
    await this.saveCredentials(refreshed);
    return refreshed.access;
  }

  private async loadCredentials(): Promise<StoredCodexAuth | null> {
    try {
      const parsed = JSON.parse(await readFile(this.authPath(), "utf8")) as Partial<StoredCodexAuth>;
      if (typeof parsed.access !== "string" || typeof parsed.refresh !== "string" || typeof parsed.expires !== "number") {
        return null;
      }
      return {
        access: parsed.access,
        refresh: parsed.refresh,
        expires: parsed.expires,
        accountId: typeof parsed.accountId === "string" ? parsed.accountId : undefined
      };
    } catch {
      return null;
    }
  }

  private async saveCredentials(credentials: OAuthCredentials): Promise<void> {
    const path = this.authPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      accountId: typeof credentials.accountId === "string" ? credentials.accountId : undefined
    }, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  return trimmed && trimmed !== "default" ? trimmed : DEFAULT_CODEX_MODEL;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
