import { describe, expect, it } from "vitest";
import { chooseSetupProvider, parseArgs, resolveInteractiveProvider } from "./setup-local.js";
import type { SetupStatus } from "../packages/proxy/src/types.js";

describe("setup-local cli", () => {
  it("parses non-interactive flags", () => {
    expect(parseArgs(["--yes", "--check", "--overwrite", "--provider=lmstudio", "--model=qwen3:8b"])).toEqual({
      yes: true,
      check: true,
      overwrite: true,
      provider: "lmstudio",
      model: "qwen3:8b"
    });
  });

  it("throws on unknown flags", () => {
    expect(() => parseArgs(["--yes", "--bogus"])).toThrow("Unknown flag: --bogus");
  });

  it("throws on invalid provider flags", () => {
    expect(() => parseArgs(["--provider=bogus"])).toThrow("Invalid --provider value: bogus");
  });

  it("prefers ollama when both local runtimes are available", () => {
    const status = {
      mode: "local-first",
      configPath: "/tmp/.env",
      envFileExists: false,
      recommendedProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          baseUrl: "http://localhost:11434",
          configuredModel: "gemma4:e2b",
          reachable: true,
          availableModels: ["gemma4:e2b"],
          ready: true,
          detail: "ollama ready."
        },
        lmstudio: {
          provider: "lmstudio",
          baseUrl: "http://localhost:1234/v1",
          configuredModel: "qwen3:8b",
          reachable: true,
          availableModels: ["qwen3:8b"],
          ready: true,
          detail: "lmstudio ready."
        }
      },
      nextAction: "ready",
      nextMessage: "ready"
    } satisfies SetupStatus;

    expect(chooseSetupProvider(status, {
      yes: true,
      check: false,
      overwrite: false
    })).toEqual({
      provider: "ollama",
      model: "gemma4:e2b"
    });
  });

  it("honors an explicit provider override", () => {
    const status = {
      mode: "local-first",
      configPath: "/tmp/.env",
      envFileExists: false,
      recommendedProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          baseUrl: "http://localhost:11434",
          configuredModel: "gemma4:e2b",
          reachable: true,
          availableModels: ["gemma4:e2b"],
          ready: true,
          detail: "ollama ready."
        },
        lmstudio: {
          provider: "lmstudio",
          baseUrl: "http://localhost:1234/v1",
          configuredModel: "qwen3:8b",
          reachable: true,
          availableModels: ["qwen3:8b", "qwen3:14b"],
          ready: true,
          detail: "lmstudio ready."
        }
      },
      nextAction: "ready",
      nextMessage: "ready"
    } satisfies SetupStatus;

    expect(chooseSetupProvider(status, {
      yes: true,
      check: false,
      overwrite: false,
      provider: "lmstudio",
      model: "qwen3:14b"
    })).toEqual({
      provider: "lmstudio",
      model: "qwen3:14b"
    });
  });

  it("accepts blank interactive provider answers and rejects invalid ones", () => {
    expect(resolveInteractiveProvider("", "ollama")).toBe("ollama");
    expect(resolveInteractiveProvider("lmstudio", "ollama")).toBe("lmstudio");
    expect(resolveInteractiveProvider("ollama", "lmstudio")).toBe("ollama");
    expect(() => resolveInteractiveProvider("other", "ollama")).toThrow("Invalid provider answer: other");
  });
});
