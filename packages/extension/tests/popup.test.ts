// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupStatus } from "../src/setup-client.js";
import { buildPopupSetupState } from "../src/setup-assistant.js";

describe("popup setup assistant state", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows proxy-first guidance and keeps translation disabled when the proxy is unavailable", () => {
    const state = buildPopupSetupState(undefined, "fetch failed");

    expect(state.translateEnabled).toBe(false);
    expect(state.showAdvancedLogin).toBe(false);
    expect(state.assistantTitle).toBe("Set up the local proxy");
    expect(state.assistantSummary).toContain("Proxy unavailable: fetch failed");
    expect(state.assistantChecklist).toEqual([
      "Start the proxy with npm run dev:proxy",
      "If the proxy still does not respond, run ./scripts/bootstrap-local.sh",
      "Reopen the popup after the proxy is listening on {{proxyUrl}}"
    ]);
  });

  it("shows ready guidance and enables translation for a ready Ollama setup", () => {
    const status: SetupStatus = {
      mode: "local-first",
      configPath: "/tmp/local.env",
      envFileExists: true,
      recommendedProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          configuredModel: "gemma4:e2b",
          reachable: true,
          availableModels: ["gemma4:e2b"],
          ready: true,
          detail: "Ollama is ready with gemma4:e2b."
        },
        lmstudio: {
          provider: "lmstudio",
          baseUrl: "http://127.0.0.1:1234",
          configuredModel: "local-model",
          reachable: false,
          availableModels: [],
          ready: false,
          detail: "LM Studio is not reachable."
        }
      },
      nextAction: "ready",
      nextMessage: "Ollama is ready."
    };

    const state = buildPopupSetupState(status);

    expect(state.assistantTitle).toBe("Setup complete");
    expect(state.assistantSummary).toBe("Ollama is ready.");
    expect(state.assistantChecklist).toEqual([
      "Ollama model gemma4:e2b is available",
      "Translation is ready."
    ]);
    expect(state.translateEnabled).toBe(true);
    expect(state.showAdvancedLogin).toBe(false);
  });

  it("renders the assistant and disables translation when setup is unavailable", async () => {
    document.body.innerHTML = readFileSync(resolvePopupHtmlPath(), "utf8");
    stubChrome({
      provider: "openai",
      proxyUrl: "http://proxy.test:9999"
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    })));

    await import("../src/popup.js");
    await flush();

    expect(document.querySelector("#assistantTitle")?.textContent).toBe("Set up the local proxy");
    expect(document.querySelector("#assistantSummary")?.textContent).toContain("Proxy unavailable");
    expect([...document.querySelectorAll("#assistantChecklist li")].map((element) => element.textContent)).toEqual([
      "Start the proxy with npm run dev:proxy",
      "If the proxy still does not respond, run ./scripts/bootstrap-local.sh",
      "Reopen the popup after the proxy is listening on http://proxy.test:9999"
    ]);
    expect(document.querySelector<HTMLButtonElement>("#toggle")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#login")?.hidden).toBe(false);
  });

  it("refreshes setup state after checking the proxy so translation can be enabled without reopening", async () => {
    document.body.innerHTML = readFileSync(resolvePopupHtmlPath(), "utf8");
    stubChrome({
      provider: "ollama",
      proxyUrl: "http://proxy.test:9999"
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/setup/status")) {
        return {
          ok: true,
          json: async () => readyOllamaStatus()
        };
      }
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ollamaModel: "gemma4:e2b" })
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await import("../src/popup.js");
    await flush();

    expect(document.querySelector<HTMLButtonElement>("#toggle")?.disabled).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/setup/status")) {
        return {
          ok: true,
          json: async () => readyOllamaStatus()
        };
      }
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ollamaModel: "gemma4:e2b" })
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    document.querySelector<HTMLButtonElement>("#toggle")!.disabled = true;
    document.querySelector<HTMLButtonElement>("#health")?.click();
    await flush();

    expect(document.querySelector<HTMLButtonElement>("#toggle")?.disabled).toBe(false);
  });

  it("reports incomplete OpenAI OAuth after a proxy check when credentials were not written", async () => {
    document.body.innerHTML = readFileSync(resolvePopupHtmlPath(), "utf8");
    stubChrome({
      provider: "openai",
      proxyUrl: "http://proxy.test:9999"
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/setup/status")) {
        return {
          ok: true,
          json: async () => readyOllamaStatus()
        };
      }
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ openaiAuth: "codex-oauth", ollamaModel: "gemma4:e2b" })
        };
      }
      if (url.endsWith("/auth/openai/status")) {
        return {
          ok: true,
          json: async () => ({ loggedIn: false, detail: "OpenAI Codex OAuth is not ready yet." })
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await import("../src/popup.js");
    await flush();

    document.querySelector<HTMLButtonElement>("#health")?.click();
    await flush();

    expect(document.querySelector("#status")?.textContent).toContain("OpenAI auth: OpenAI Codex OAuth is not ready yet.");
    expect(document.querySelector("#status")?.textContent).not.toContain("codex-oauth");
  });
});

function readyOllamaStatus(): SetupStatus {
  return {
    mode: "local-first",
    configPath: "/tmp/local.env",
    envFileExists: true,
    recommendedProvider: "ollama",
    providers: {
      ollama: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        configuredModel: "gemma4:e2b",
        reachable: true,
        availableModels: ["gemma4:e2b"],
        ready: true,
        detail: "Ollama is ready with gemma4:e2b."
      },
      lmstudio: {
        provider: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        configuredModel: "local-model",
        reachable: false,
        availableModels: [],
        ready: false,
        detail: "LM Studio is not reachable."
      }
    },
    nextAction: "ready",
    nextMessage: "Ollama is ready."
  };
}

function stubChrome(settings: { provider: "openai" | "lmstudio" | "ollama"; proxyUrl: string }): void {
  const storage = {
    sync: {
      get: vi.fn(async () => settings),
      set: vi.fn(async () => undefined)
    }
  };

  const runtime = {
    sendMessage: vi.fn(async () => undefined)
  };

  vi.stubGlobal("chrome", { storage, runtime });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function resolvePopupHtmlPath(): string {
  const localPath = join(process.cwd(), "public/popup.html");
  if (existsSync(localPath)) return localPath;
  return join(process.cwd(), "packages/extension/public/popup.html");
}
