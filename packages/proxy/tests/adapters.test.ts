import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/adapters/codex.js";
import { LMStudioAdapter } from "../src/adapters/lmstudio.js";
import type { ProxyConfig, TranslateRequest } from "../src/types.js";

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; stdin: string }>,
  mode: "translate" as "translate" | "status"
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn((command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdin: { end: (input: string) => void };
      kill: (signal: string) => void;
    };
    child.stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    child.stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    child.stdout.setEncoding = () => undefined;
    child.stderr.setEncoding = () => undefined;
    child.kill = () => undefined;
    child.stdin = {
      end: (input: string) => {
        spawnState.calls.push({ command, args, stdin: input });
        queueMicrotask(async () => {
          if (spawnState.mode === "status") {
            child.stdout.emit("data", "Logged in using ChatGPT\n");
            child.emit("close", 0);
            return;
          }
          const outputPath = args[args.indexOf("--output-last-message") + 1];
          await writeFile(outputPath, '{"segments":[{"id":"s1","translation":"你好，世界。"}]}', "utf8");
          child.emit("close", 0);
        });
      }
    };
    return child;
  })
}));

const config: ProxyConfig = {
  host: "127.0.0.1",
  port: 8787,
  openaiModel: "default",
  codexCommand: "codex",
  lmstudioBaseUrl: "http://localhost:1234/v1",
  lmstudioModel: "local-model",
  requestTimeoutMs: 1000
};

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
  afterEach(() => {
    vi.restoreAllMocks();
    spawnState.calls = [];
    spawnState.mode = "translate";
  });

  it("uses Codex CLI auth flow for OpenAI instead of an API key", async () => {
    const response = await new CodexAdapter(config).translate(request);

    const call = spawnState.calls[0];
    expect(call?.command).toBe("codex");
    expect(call?.args).toContain("exec");
    expect(call?.args).toContain("--ephemeral");
    expect(call?.args).toContain("read-only");
    expect(call?.args).not.toContain("-m");
    expect(call?.args).not.toContain("gpt-5.1-codex-mini");
    expect(call?.stdin).toContain("Hello world.");
    expect(call?.stdin).not.toContain("sk-");
    expect(response.segments).toEqual([{ id: "s1", translation: "你好，世界。" }]);
  });

  it("passes an explicit Codex model when the user overrides default", async () => {
    await new CodexAdapter(config).translate({ ...request, model: "gpt-5.1-codex-mini" });

    const call = spawnState.calls[0];
    expect(call?.args).toContain("-m");
    expect(call?.args).toContain("gpt-5.1-codex-mini");
  });

  it("reports Codex ChatGPT login status", async () => {
    spawnState.mode = "status";
    const status = await new CodexAdapter(config).authStatus();

    expect(spawnState.calls[0]?.args).toEqual(["login", "status"]);
    expect(status.loggedIn).toBe(true);
  });

  it("lists the Codex model family choices used by the popup", async () => {
    await expect(new CodexAdapter(config).listModels()).resolves.toEqual([
      "gpt-5.1-codex-mini",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max"
    ]);
  });

  it("sends LM Studio requests to the configured local base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"segments":[{"id":"s1","translation":"你好，世界。"}]}' } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await new LMStudioAdapter(config).translate({ ...request, provider: "lmstudio" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:1234/v1/chat/completions");
    expect(response.model).toBe("local-model");
    expect(response.segments[0]?.id).toBe("s1");
  });
});
