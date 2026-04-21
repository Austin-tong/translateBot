import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetupStatus, renderLocalEnv } from "../src/setup.js";
import type { ProxyConfig } from "../src/types.js";

let tempDir: string;

describe("setup contract", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "translate-bot-setup-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("prefers ollama when reachable and model available", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response(JSON.stringify({
          models: [{ name: "gemma4:e2b" }, { model: "qwen3:8b" }]
        }), { status: 200 });
      }

      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "local-model" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeFile(join(tempDir, ".env"), "OLLAMA_MODEL=gemma4:e2b\n");

    const status = await getSetupStatus(makeConfig());

    expect(status.mode).toBe("local-first");
    expect(status.configPath).toBe(join(tempDir, ".env"));
    expect(status.envFileExists).toBe(true);
    expect(status.recommendedProvider).toBe("ollama");
    expect(status.nextAction).toBe("ready");
    expect(status.nextMessage).toContain("Ollama is ready");
    expect(status.providers.ollama).toEqual(expect.objectContaining({
      provider: "ollama",
      reachable: true,
      ready: true,
      configuredModel: "gemma4:e2b",
      availableModels: ["gemma4:e2b", "qwen3:8b"]
    }));
    expect(status.providers.lmstudio).toEqual(expect.objectContaining({
      provider: "lmstudio",
      reachable: true,
      ready: true,
      configuredModel: "local-model",
      availableModels: ["local-model"]
    }));
  });

  it("guides toward the reachable local provider in a mixed degraded state", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response("gateway error", { status: 500 });
      }

      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "other-model" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeFile(join(tempDir, ".env"), "LMSTUDIO_MODEL=local-model\n");

    const status = await getSetupStatus(makeConfig({ lmstudioModel: "local-model" }));

    expect(status.recommendedProvider).toBe("lmstudio");
    expect(status.nextAction).toBe("select-model");
    expect(status.nextMessage).toContain("LM Studio");
    expect(status.providers.ollama).toEqual(expect.objectContaining({
      reachable: false,
      ready: false,
      availableModels: []
    }));
    expect(status.providers.lmstudio).toEqual(expect.objectContaining({
      reachable: true,
      ready: false,
      configuredModel: "local-model",
      availableModels: ["other-model"]
    }));
  });

  it("treats a usable default Ollama setup as ready even without a local env file", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response(JSON.stringify({
          models: [{ name: "gemma4:e2b" }]
        }), { status: 200 });
      }

      if (String(url).includes("/models")) {
        throw new Error("connection refused");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await getSetupStatus(makeConfig());

    expect(status.envFileExists).toBe(false);
    expect(status.recommendedProvider).toBe("ollama");
    expect(status.nextAction).toBe("ready");
    expect(status.nextMessage).toContain("Ollama is ready");
    expect(status.providers.ollama).toEqual(expect.objectContaining({
      reachable: true,
      ready: true,
      configuredModel: "gemma4:e2b",
      availableModels: ["gemma4:e2b"]
    }));
  });

  it("recommends LM Studio when both runtimes are reachable but only LM Studio is usable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response(JSON.stringify({
          models: [{ name: "other-model" }]
        }), { status: 200 });
      }

      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "local-model" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeFile(join(tempDir, ".env"), "LMSTUDIO_MODEL=local-model\n");

    const status = await getSetupStatus(makeConfig({ lmstudioModel: "local-model" }));

    expect(status.providers.ollama).toEqual(expect.objectContaining({
      reachable: true,
      ready: false,
      configuredModel: "gemma4:e2b",
      availableModels: ["other-model"]
    }));
    expect(status.providers.lmstudio).toEqual(expect.objectContaining({
      reachable: true,
      ready: true,
      configuredModel: "local-model",
      availableModels: ["local-model"]
    }));
    expect(status.recommendedProvider).toBe("lmstudio");
    expect(status.nextAction).toBe("ready");
  });

  it("recommends LM Studio when both runtimes are reachable but only LM Studio exposes selectable models", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response(JSON.stringify({
          models: []
        }), { status: 200 });
      }

      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "other-model" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeFile(join(tempDir, ".env"), "LMSTUDIO_MODEL=local-model\n");

    const status = await getSetupStatus(makeConfig({ lmstudioModel: "local-model" }));

    expect(status.providers.ollama).toEqual(expect.objectContaining({
      reachable: true,
      ready: false,
      availableModels: []
    }));
    expect(status.providers.lmstudio).toEqual(expect.objectContaining({
      reachable: true,
      ready: false,
      configuredModel: "local-model",
      availableModels: ["other-model"]
    }));
    expect(status.recommendedProvider).toBe("lmstudio");
    expect(status.nextAction).toBe("select-model");
  });

  it("marks non-OK probe responses as unreachable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response("not found", { status: 404 });
      }

      if (String(url).includes("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "local-model" }]
        }), { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeFile(join(tempDir, ".env"), "OLLAMA_MODEL=gemma4:e2b\n");

    const status = await getSetupStatus(makeConfig());

    expect(status.providers.ollama).toEqual(expect.objectContaining({
      reachable: false,
      ready: false,
      availableModels: []
    }));
    expect(status.providers.ollama.detail).toContain("404");
  });

  it("renders local env without OpenAI defaults and with the selected local model", () => {
    const rendered = renderLocalEnv({ provider: "lmstudio", model: "google/gemma-4-e4b" });

    expect(rendered).toContain("LMSTUDIO_MODEL=google/gemma-4-e4b");
    expect(rendered).toContain("LMSTUDIO_BASE_URL=http://localhost:1234/v1");
    expect(rendered).not.toContain("OPENAI_MODEL=");
    expect(rendered).not.toContain("OPENAI_CODEX_AUTH_PATH=");
  });
});

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    configPath: join(tempDir, ".env"),
    openaiModel: "default",
    openaiCodexAuthPath: "/tmp/translate-bot/oauth.json",
    lmstudioBaseUrl: "http://localhost:1234/v1",
    lmstudioModel: "local-model",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "gemma4:e2b",
    requestTimeoutMs: 1000,
    ...overrides
  };
}
