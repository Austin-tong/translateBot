import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/adapters/codex.js";
import { LMStudioAdapter } from "../src/adapters/lmstudio.js";
import { OllamaAdapter } from "../src/adapters/ollama.js";
import type { ProxyConfig, TranslateRequest } from "../src/types.js";

const aiState = vi.hoisted(() => ({
  complete: vi.fn(),
  loginOpenAICodex: vi.fn(),
  refreshOpenAICodexToken: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: aiState.complete
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  loginOpenAICodex: aiState.loginOpenAICodex,
  refreshOpenAICodexToken: aiState.refreshOpenAICodexToken
}));

vi.mock("node:child_process", () => ({
  spawn: aiState.spawn
}));

let tempDir: string;

const request: TranslateRequest = {
  provider: "openai",
  targetLanguage: "zh-CN",
  page: {
    url: "https://example.com",
    title: "Example"
  },
  segments: [{ id: "s1", text: "Hello world." }]
};

describe("model adapters", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "translate-bot-test-"));
    aiState.spawn.mockReturnValue({ unref: vi.fn() });
    aiState.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: '{"segments":[{"id":"s1","translation":"你好，世界。"}]}' }],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now()
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses the long-running OpenAI Codex OAuth adapter instead of Codex CLI", async () => {
    const config = makeConfig();
    await writeAuth(config);

    const response = await new CodexAdapter(config).translate(request);

    expect(aiState.complete).toHaveBeenCalledWith(
      expect.objectContaining({ api: "openai-codex-responses", provider: "openai-codex", id: "gpt-5.4-mini" }),
      expect.objectContaining({ messages: [expect.objectContaining({ content: expect.stringContaining("Hello world.") })] }),
      expect.objectContaining({ apiKey: "access-token", transport: "sse", reasoningEffort: "low" })
    );
    expect(aiState.spawn).not.toHaveBeenCalled();
    expect(response.segments).toEqual([{ id: "s1", translation: "你好，世界。" }]);
  });

  it("passes an explicit Codex model when the user overrides default", async () => {
    const config = makeConfig();
    await writeAuth(config);

    await new CodexAdapter(config).translate({ ...request, model: "gpt-5.4" });

    expect(aiState.complete.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ id: "gpt-5.4" }));
  });

  it("reports OAuth status from the proxy credential store", async () => {
    const config = makeConfig();
    await writeAuth(config);

    const status = await new CodexAdapter(config).authStatus();

    expect(status.loggedIn).toBe(true);
    expect(status.detail).toContain("OpenAI Codex OAuth is ready");
  });

  it("refreshes expired OpenAI Codex OAuth credentials before translating", async () => {
    const config = makeConfig();
    await writeAuth(config, { access: "old-access", refresh: "refresh-token", expires: Date.now() - 1000 });
    aiState.refreshOpenAICodexToken.mockResolvedValue({
      access: "new-access",
      refresh: "new-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct"
    });

    await new CodexAdapter(config).translate(request);

    expect(aiState.refreshOpenAICodexToken).toHaveBeenCalledWith("refresh-token");
    expect(aiState.complete.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ apiKey: "new-access" }));
    expect(await readFile(config.openaiCodexAuthPath, "utf8")).toContain("new-refresh");
  });

  it("starts browser OAuth and saves the returned credentials", async () => {
    const config = makeConfig();
    aiState.loginOpenAICodex.mockImplementation(async ({ onAuth }) => {
      onAuth({ url: "https://auth.openai.com/oauth/authorize?example=1" });
      return { access: "oauth-access", refresh: "oauth-refresh", expires: Date.now() + 60_000, accountId: "acct" };
    });

    const result = await new CodexAdapter(config).startAuth();

    expect(result.started).toBe(true);
    expect(result.authUrl).toContain("auth.openai.com");
    expect(aiState.spawn).toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect(await readFile(config.openaiCodexAuthPath, "utf8")).toContain("oauth-refresh");
    });
  });

  it("lists the Codex OAuth model family choices used by the popup", async () => {
    await expect(new CodexAdapter(makeConfig()).listModels()).resolves.toContain("gpt-5.4-mini");
  });

  it("sends LM Studio requests to the configured local base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"segments":[{"id":"s1","translation":"你好，世界。"}]}' } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await new LMStudioAdapter(makeConfig()).translate({ ...request, provider: "lmstudio" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:1234/v1/chat/completions");
    expect(response.model).toBe("local-model");
    expect(response.segments[0]?.id).toBe("s1");
  });

  it("sends Ollama requests to the configured local chat endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "gemma4:e2b",
      message: { content: '{"segments":[{"id":"s1","translation":"你好，世界。"}]}' },
      prompt_eval_count: 10,
      eval_count: 6
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await new OllamaAdapter(makeConfig()).translate({ ...request, provider: "ollama" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model?: string; stream?: boolean; think?: boolean; format?: string; messages?: Array<{ content?: string }> };

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/chat");
    expect(body.model).toBe("gemma4:e2b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.format).toBe("json");
    expect(body.messages?.[1]?.content).toContain("/no_think");
    expect(response.provider).toBe("ollama");
    expect(response.segments[0]?.translation).toBe("你好，世界。");
  });

  it("strips leaked Ollama thinking blocks before parsing JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "gemma4:e2b",
      message: { content: '<think>I should translate.</think>{"segments":[{"id":"s1","translation":"你好，世界。"}]}' }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await new OllamaAdapter(makeConfig()).translate({ ...request, provider: "ollama" });

    expect(response.segments).toEqual([{ id: "s1", translation: "你好，世界。" }]);
  });

  it("lists Ollama local tags as model choices", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: "gemma4:e2b" }, { model: "qwen3:8b" }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OllamaAdapter(makeConfig()).listModels()).resolves.toEqual(["gemma4:e2b", "qwen3:8b"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/tags");
  });

  it("maps the user's hyphenated Gemma shorthand to the Ollama model tag", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "gemma4:e2b",
      message: { content: '{"segments":[{"id":"s1","translation":"你好，世界。"}]}' }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaAdapter(makeConfig()).translate({ ...request, provider: "ollama", model: "gemma4-e2b" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model?: string };

    expect(body.model).toBe("gemma4:e2b");
  });
});

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    openaiModel: "default",
    openaiCodexAuthPath: join(tempDir, "oauth.json"),
    lmstudioBaseUrl: "http://localhost:1234/v1",
    lmstudioModel: "local-model",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "gemma4:e2b",
    requestTimeoutMs: 1000,
    ...overrides
  };
}

async function writeAuth(config: ProxyConfig, overrides: Partial<{ access: string; refresh: string; expires: number; accountId: string }> = {}): Promise<void> {
  await mkdir(dirname(config.openaiCodexAuthPath), { recursive: true });
  await writeFile(config.openaiCodexAuthPath, JSON.stringify({
    access: "access-token",
    refresh: "refresh-token",
    expires: Date.now() + 600_000,
    accountId: "acct",
    ...overrides
  }), "utf8");
}
