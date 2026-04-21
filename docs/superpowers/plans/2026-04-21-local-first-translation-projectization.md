# Local-First Translation Plugin Projectization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Translate Bot prototype into a formal local-first Chromium translation project with one-command bootstrap, a first-run setup assistant, and repeatable developer/user setup.

**Architecture:** Keep the existing `extension -> local proxy -> local model runtime` split. Add a small setup-status contract in the proxy, a guided first-run assistant in the popup, and a repository bootstrap path that installs dependencies, writes local config, builds the extension, and prints the exact next step. Preserve the current DOM translation runtime and adapter structure; do not refactor translation behavior unless required by setup/productization work.

**Tech Stack:** TypeScript, Node.js HTTP server, Chrome Extension Manifest V3, esbuild, Vitest, Bash

---

## Scope Decisions

- Primary supported path is local inference through `Ollama` and `LM Studio`.
- Existing `OpenAI Codex OAuth` support stays in the codebase, but it becomes an advanced/optional provider instead of the default story.
- "One-line deploy" means a fresh checkout can be prepared with `./scripts/bootstrap-local.sh`, producing:
  - installed dependencies
  - a generated `packages/proxy/.env`
  - a built unpacked extension at `packages/extension/dist`
  - a clear command to start the proxy and a clear path to load in Chromium
- "Initialization assistant" means:
  - a CLI first-run assistant that detects local providers and writes config
  - a popup setup assistant that tells the user what is still missing
- Out of scope for this plan:
  - Chrome Web Store publishing
  - native desktop wrappers
  - auto-installing the extension into Chrome without user interaction

## File Structure

- Create: `docs/superpowers/plans/2026-04-21-local-first-translation-projectization.md`
  - This implementation plan.
- Create: `packages/proxy/src/setup.ts`
  - Shared local-setup status logic used by both the proxy API and the CLI assistant.
- Modify: `packages/proxy/src/types.ts`
  - Add `SetupStatus` and provider-health types.
- Modify: `packages/proxy/src/config.ts`
  - Surface the resolved `.env` path so setup status can report it.
- Modify: `packages/proxy/src/server.ts`
  - Expose `GET /setup/status`.
- Create: `packages/proxy/tests/setup.test.ts`
  - Unit coverage for setup status and `.env` rendering.
- Create: `packages/extension/src/setup-client.ts`
  - Popup-side fetch wrapper for setup status.
- Create: `packages/extension/src/setup-assistant.ts`
  - Pure view-model builder for popup setup state.
- Modify: `packages/extension/src/popup.ts`
  - Fetch setup status on popup load and render assistant state.
- Modify: `packages/extension/public/popup.html`
  - Add assistant container and copy.
- Modify: `packages/extension/public/popup.css`
  - Add assistant card styling and disabled state.
- Create: `packages/extension/tests/popup.test.ts`
  - Coverage for the popup assistant view model.
- Create: `scripts/setup-local.ts`
  - Interactive/non-interactive initialization assistant.
- Create: `scripts/setup-local.test.ts`
  - CLI argument parsing and provider-choice tests.
- Create: `scripts/bootstrap-local.sh`
  - One-line bootstrap entrypoint from a clean checkout.
- Modify: `package.json`
  - Add local bootstrap/setup/doctor scripts.
- Modify: `vitest.config.ts`
  - Include `scripts/**/*.test.ts`.
- Modify: `README.md`
  - Rewrite around local-first bootstrap.
- Modify: `docs/browser-setup.md`
  - Replace manual setup steps with the new bootstrap flow.
- Modify: `packages/extension/public/manifest.json`
  - Update product description to local-first wording.

## Task 1: Add a Local-First Setup Contract in the Proxy

**Files:**
- Create: `packages/proxy/src/setup.ts`
- Create: `packages/proxy/tests/setup.test.ts`
- Modify: `packages/proxy/src/types.ts`
- Modify: `packages/proxy/src/config.ts`
- Modify: `packages/proxy/src/server.ts`
- Test: `packages/proxy/tests/setup.test.ts`

- [ ] **Step 1: Write the failing tests for setup status and env rendering**

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSetupStatus, renderLocalEnv } from "../src/setup.js";
import type { ProxyConfig } from "../src/types.js";

let tempDir = "";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setup status", () => {
  it("prefers ollama when a local Ollama model is reachable", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "translate-bot-setup-"));
    const envPath = join(tempDir, ".env");
    await writeFile(envPath, "OLLAMA_MODEL=gemma4:e2b\n", "utf8");

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const raw = String(url);
      if (raw.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "gemma4:e2b" }] }), { status: 200 });
      }
      if (raw.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${raw}`);
    }));

    const status = await getSetupStatus(makeConfig({ configPath: envPath }));

    expect(status.mode).toBe("local-first");
    expect(status.recommendedProvider).toBe("ollama");
    expect(status.providers.ollama.ready).toBe(true);
    expect(status.nextAction).toBe("ready");
  });

  it("renders a local-first env file without OpenAI defaults", () => {
    const env = renderLocalEnv({ provider: "ollama", model: "gemma4:e2b" });

    expect(env).toContain("OLLAMA_MODEL=gemma4:e2b");
    expect(env).toContain("PORT=8787");
    expect(env).not.toContain("OPENAI_MODEL");
    expect(env).not.toContain("OPENAI_CODEX_AUTH_PATH");
  });
});

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    configPath: join(tempDir || tmpdir(), ".env"),
    openaiModel: "default",
    openaiCodexAuthPath: join(tempDir || tmpdir(), "oauth.json"),
    lmstudioBaseUrl: "http://localhost:1234/v1",
    lmstudioModel: "local-model",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "gemma4:e2b",
    requestTimeoutMs: 1000,
    ...overrides
  };
}
```

- [ ] **Step 2: Run the new proxy tests to verify they fail**

Run: `npx vitest run packages/proxy/tests/setup.test.ts -v`

Expected: FAIL with module or export errors for `../src/setup.js`, `getSetupStatus`, or `renderLocalEnv`.

- [ ] **Step 3: Implement the minimal setup-status module and route**

```ts
// packages/proxy/src/types.ts
export interface LocalProviderStatus {
  provider: "ollama" | "lmstudio";
  baseUrl: string;
  configuredModel: string;
  reachable: boolean;
  availableModels: string[];
  ready: boolean;
  detail: string;
}

export interface SetupStatus {
  mode: "local-first";
  configPath: string;
  envFileExists: boolean;
  recommendedProvider: "ollama" | "lmstudio";
  providers: {
    ollama: LocalProviderStatus;
    lmstudio: LocalProviderStatus;
  };
  nextAction: "create-config" | "start-local-provider" | "select-model" | "ready";
  nextMessage: string;
}

export interface ProxyConfig {
  host: string;
  port: number;
  configPath: string;
  openaiModel: string;
  openaiCodexAuthPath: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  requestTimeoutMs: number;
}
```

```ts
// packages/proxy/src/config.ts
import "dotenv/config";
import { resolve } from "node:path";
import type { ProxyConfig } from "./types.js";

const DEFAULT_CONFIG_PATH = resolve(import.meta.dirname, "..", ".env");

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): ProxyConfig {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: numberFromEnv("PORT", 8787),
    configPath: process.env.TRANSLATE_BOT_ENV_PATH ?? DEFAULT_CONFIG_PATH,
    openaiModel: process.env.OPENAI_MODEL ?? "default",
    openaiCodexAuthPath: process.env.OPENAI_CODEX_AUTH_PATH ?? "~/.translate-bot/openai-codex-oauth.json",
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    lmstudioModel: process.env.LMSTUDIO_MODEL ?? "local-model",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4:e2b",
    requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 45000)
  };
}
```

```ts
// packages/proxy/src/setup.ts
import { existsSync } from "node:fs";
import type { LocalProviderStatus, ProxyConfig, SetupStatus } from "./types.js";

export async function getSetupStatus(config: ProxyConfig): Promise<SetupStatus> {
  const [ollama, lmstudio] = await Promise.all([
    probeOllama(config),
    probeLmStudio(config)
  ]);

  const recommendedProvider = ollama.ready ? "ollama" : lmstudio.ready ? "lmstudio" : "ollama";
  const envFileExists = existsSync(config.configPath);

  if (!envFileExists) {
    return {
      mode: "local-first",
      configPath: config.configPath,
      envFileExists,
      recommendedProvider,
      providers: { ollama, lmstudio },
      nextAction: "create-config",
      nextMessage: `Run ./scripts/bootstrap-local.sh to create ${config.configPath}.`
    };
  }

  if (ollama.ready || lmstudio.ready) {
    return {
      mode: "local-first",
      configPath: config.configPath,
      envFileExists,
      recommendedProvider,
      providers: { ollama, lmstudio },
      nextAction: "ready",
      nextMessage: `Local translation is ready with ${recommendedProvider}.`
    };
  }

  return {
    mode: "local-first",
    configPath: config.configPath,
    envFileExists,
    recommendedProvider,
    providers: { ollama, lmstudio },
    nextAction: "start-local-provider",
    nextMessage: "Start Ollama or load a model in LM Studio, then reopen the popup."
  };
}

export function renderLocalEnv(input: { provider: "ollama" | "lmstudio"; model: string }): string {
  const modelLine = input.provider === "ollama"
    ? `OLLAMA_MODEL=${input.model}`
    : `LMSTUDIO_MODEL=${input.model}`;
  return [
    "HOST=127.0.0.1",
    "PORT=8787",
    "REQUEST_TIMEOUT_MS=45000",
    "OLLAMA_BASE_URL=http://localhost:11434",
    "LMSTUDIO_BASE_URL=http://localhost:1234/v1",
    modelLine
  ].join("\n") + "\n";
}

async function probeOllama(config: ProxyConfig): Promise<LocalProviderStatus> {
  return probeProvider("ollama", `${config.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`, config.ollamaModel, (json) =>
    (json.models ?? []).map((model: { name?: string; model?: string }) => model.name ?? model.model).filter(Boolean)
  );
}

async function probeLmStudio(config: ProxyConfig): Promise<LocalProviderStatus> {
  return probeProvider("lmstudio", `${config.lmstudioBaseUrl.replace(/\/$/, "")}/models`, config.lmstudioModel, (json) =>
    (json.data ?? []).map((model: { id?: string }) => model.id).filter(Boolean)
  );
}

async function probeProvider(
  provider: "ollama" | "lmstudio",
  url: string,
  configuredModel: string,
  pickModels: (json: any) => string[]
): Promise<LocalProviderStatus> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const availableModels = pickModels(await response.json());
    const ready = availableModels.includes(configuredModel) || availableModels.length > 0;
    return {
      provider,
      baseUrl: url.replace(/\/(api\/tags|models)$/, ""),
      configuredModel,
      reachable: true,
      availableModels,
      ready,
      detail: ready ? `${provider} ready.` : `${provider} reachable, but no model is loaded.`
    };
  } catch (error) {
    return {
      provider,
      baseUrl: url.replace(/\/(api\/tags|models)$/, ""),
      configuredModel,
      reachable: false,
      availableModels: [],
      ready: false,
      detail: `${provider} unreachable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
```

```ts
// packages/proxy/src/server.ts
import { getSetupStatus } from "./setup.js";

if (request.method === "GET" && url.pathname === "/setup/status") {
  sendJson(response, 200, await getSetupStatus(config));
  return;
}
```

- [ ] **Step 4: Run the proxy tests again to verify they pass**

Run: `npx vitest run packages/proxy/tests/setup.test.ts packages/proxy/tests/adapters.test.ts -v`

Expected: PASS for `packages/proxy/tests/setup.test.ts` and no regressions in `packages/proxy/tests/adapters.test.ts`.

- [ ] **Step 5: Commit the proxy setup contract**

```bash
git add packages/proxy/src/types.ts packages/proxy/src/config.ts packages/proxy/src/setup.ts packages/proxy/src/server.ts packages/proxy/tests/setup.test.ts
git commit -m "feat: add local setup status endpoint"
```

## Task 2: Add a Popup First-Run Setup Assistant

**Files:**
- Create: `packages/extension/src/setup-client.ts`
- Create: `packages/extension/src/setup-assistant.ts`
- Create: `packages/extension/tests/popup.test.ts`
- Modify: `packages/extension/src/popup.ts`
- Modify: `packages/extension/public/popup.html`
- Modify: `packages/extension/public/popup.css`
- Test: `packages/extension/tests/popup.test.ts`

- [ ] **Step 1: Write the failing popup assistant tests**

```ts
import { describe, expect, it } from "vitest";
import { buildPopupSetupState } from "../src/setup-assistant.js";

describe("popup setup assistant", () => {
  it("shows the bootstrap command when the proxy is unavailable", () => {
    const state = buildPopupSetupState(undefined, "Failed to fetch");

    expect(state.title).toBe("Setup assistant");
    expect(state.summary).toContain("Local proxy is not reachable yet");
    expect(state.checklist).toContain("Run ./scripts/bootstrap-local.sh from the repository root.");
    expect(state.translateEnabled).toBe(false);
  });

  it("enables translation when Ollama is ready", () => {
    const state = buildPopupSetupState({
      mode: "local-first",
      configPath: "/tmp/.env",
      envFileExists: true,
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
          configuredModel: "local-model",
          reachable: false,
          availableModels: [],
          ready: false,
          detail: "lmstudio unreachable."
        }
      },
      nextAction: "ready",
      nextMessage: "Local translation is ready with ollama."
    });

    expect(state.summary).toContain("Local translation is ready");
    expect(state.translateEnabled).toBe(true);
    expect(state.showAdvancedLogin).toBe(false);
  });
});
```

- [ ] **Step 2: Run the popup assistant tests to verify they fail**

Run: `npx vitest run packages/extension/tests/popup.test.ts -v`

Expected: FAIL with module or export errors for `../src/setup-assistant.js` or `buildPopupSetupState`.

- [ ] **Step 3: Implement the popup assistant with minimal UI changes**

```ts
// packages/extension/src/setup-client.ts
export interface SetupStatus {
  mode: "local-first";
  configPath: string;
  envFileExists: boolean;
  recommendedProvider: "ollama" | "lmstudio";
  providers: {
    ollama: {
      provider: "ollama";
      baseUrl: string;
      configuredModel: string;
      reachable: boolean;
      availableModels: string[];
      ready: boolean;
      detail: string;
    };
    lmstudio: {
      provider: "lmstudio";
      baseUrl: string;
      configuredModel: string;
      reachable: boolean;
      availableModels: string[];
      ready: boolean;
      detail: string;
    };
  };
  nextAction: "create-config" | "start-local-provider" | "select-model" | "ready";
  nextMessage: string;
}

export async function fetchSetupStatus(proxyUrl: string): Promise<SetupStatus> {
  const response = await fetch(`${proxyUrl}/setup/status`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as SetupStatus;
}
```

```ts
// packages/extension/src/setup-assistant.ts
import type { SetupStatus } from "./setup-client.js";

export interface PopupSetupState {
  title: string;
  summary: string;
  checklist: string[];
  translateEnabled: boolean;
  showAdvancedLogin: boolean;
}

export function buildPopupSetupState(status?: SetupStatus, error?: string): PopupSetupState {
  if (!status) {
    return {
      title: "Setup assistant",
      summary: "Local proxy is not reachable yet.",
      checklist: [
        "Run ./scripts/bootstrap-local.sh from the repository root.",
        "Start the proxy with npm run dev:proxy.",
        "Reopen this popup after the proxy is listening on http://127.0.0.1:8787."
      ],
      translateEnabled: false,
      showAdvancedLogin: false
    };
  }

  return {
    title: "Setup assistant",
    summary: status.nextMessage,
    checklist: [
      `Config: ${status.configPath}`,
      `Recommended provider: ${status.recommendedProvider}`,
      `Ollama: ${status.providers.ollama.detail}`,
      `LM Studio: ${status.providers.lmstudio.detail}`
    ],
    translateEnabled: status.nextAction === "ready",
    showAdvancedLogin: false
  };
}
```

```html
<!-- packages/extension/public/popup.html -->
<section id="assistant" class="assistant">
  <h2 id="assistantTitle">Setup assistant</h2>
  <p id="assistantSummary">Checking local setup…</p>
  <ul id="assistantChecklist" class="assistant-list"></ul>
</section>
```

```css
/* packages/extension/public/popup.css */
.assistant {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #d6d3d1;
  border-radius: 10px;
  background: #f8fafc;
}

.assistant h2 {
  margin: 0;
  font-size: 14px;
}

.assistant-list {
  margin: 0;
  padding-left: 18px;
  color: #475569;
  font-size: 12px;
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
```

```ts
// packages/extension/src/popup.ts
import { buildPopupSetupState } from "./setup-assistant.js";
import { fetchSetupStatus } from "./setup-client.js";

const assistantTitle = document.querySelector<HTMLHeadingElement>("#assistantTitle");
const assistantSummary = document.querySelector<HTMLParagraphElement>("#assistantSummary");
const assistantChecklist = document.querySelector<HTMLUListElement>("#assistantChecklist");

async function init(): Promise<void> {
  const settings = await getSettings();
  setForm(settings);
  await refreshSetupAssistant(settings.proxyUrl);
  // existing listeners stay in place
}

async function refreshSetupAssistant(proxyUrl: string): Promise<void> {
  try {
    const status = await fetchSetupStatus(proxyUrl);
    renderSetupAssistant(buildPopupSetupState(status));
  } catch (error) {
    renderSetupAssistant(buildPopupSetupState(undefined, formatError(error)));
  }
}

function renderSetupAssistant(state: ReturnType<typeof buildPopupSetupState>): void {
  if (assistantTitle) assistantTitle.textContent = state.title;
  if (assistantSummary) assistantSummary.textContent = state.summary;
  if (assistantChecklist) {
    assistantChecklist.innerHTML = "";
    for (const item of state.checklist) {
      const li = document.createElement("li");
      li.textContent = item;
      assistantChecklist.append(li);
    }
  }
  if (toggle) toggle.disabled = !state.translateEnabled;
  if (login) login.hidden = !state.showAdvancedLogin;
}
```

- [ ] **Step 4: Run popup and extension regression tests**

Run: `npx vitest run packages/extension/tests/popup.test.ts packages/extension/tests/content.test.ts -v`

Expected: PASS for the new popup tests and no regressions in content runtime tests.

- [ ] **Step 5: Commit the popup onboarding work**

```bash
git add packages/extension/src/setup-client.ts packages/extension/src/setup-assistant.ts packages/extension/src/popup.ts packages/extension/public/popup.html packages/extension/public/popup.css packages/extension/tests/popup.test.ts
git commit -m "feat: add popup setup assistant"
```

## Task 3: Add One-Command Bootstrap and a CLI Initialization Assistant

**Files:**
- Create: `scripts/setup-local.ts`
- Create: `scripts/setup-local.test.ts`
- Create: `scripts/bootstrap-local.sh`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Test: `scripts/setup-local.test.ts`

- [ ] **Step 1: Write failing tests for CLI argument parsing and provider choice**

```ts
import { describe, expect, it } from "vitest";
import { chooseSetupProvider, parseArgs } from "./setup-local.js";

describe("setup-local cli", () => {
  it("parses non-interactive flags", () => {
    expect(parseArgs(["--yes", "--provider=lmstudio", "--model=qwen3:8b"])).toEqual({
      yes: true,
      check: false,
      overwrite: false,
      provider: "lmstudio",
      model: "qwen3:8b"
    });
  });

  it("prefers ollama when both local runtimes are available", () => {
    expect(chooseSetupProvider({
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
    }, { yes: true, check: false, overwrite: false })).toEqual({
      provider: "ollama",
      model: "gemma4:e2b"
    });
  });
});
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run: `npx vitest run scripts/setup-local.test.ts -v`

Expected: FAIL because `scripts/setup-local.ts` does not exist yet and `vitest.config.ts` does not include `scripts/**/*.test.ts`.

- [ ] **Step 3: Implement the CLI assistant, bootstrap entrypoint, and package scripts**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
    globals: true
  }
});
```

```ts
// scripts/setup-local.ts
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../packages/proxy/src/config.js";
import { getSetupStatus, renderLocalEnv } from "../packages/proxy/src/setup.js";
import type { SetupStatus } from "../packages/proxy/src/types.js";

export interface SetupCliFlags {
  yes: boolean;
  check: boolean;
  overwrite: boolean;
  provider?: "ollama" | "lmstudio";
  model?: string;
}

export function parseArgs(argv: string[]): SetupCliFlags {
  return argv.reduce<SetupCliFlags>((flags, arg) => {
    if (arg === "--yes") flags.yes = true;
    else if (arg === "--check") flags.check = true;
    else if (arg === "--overwrite") flags.overwrite = true;
    else if (arg.startsWith("--provider=")) flags.provider = arg.slice("--provider=".length) as "ollama" | "lmstudio";
    else if (arg.startsWith("--model=")) flags.model = arg.slice("--model=".length);
    return flags;
  }, { yes: false, check: false, overwrite: false });
}

export function chooseSetupProvider(status: SetupStatus, flags: SetupCliFlags): { provider: "ollama" | "lmstudio"; model: string } {
  if (flags.provider === "lmstudio") {
    return { provider: "lmstudio", model: flags.model ?? status.providers.lmstudio.availableModels[0] ?? status.providers.lmstudio.configuredModel };
  }
  if (flags.provider === "ollama") {
    return { provider: "ollama", model: flags.model ?? status.providers.ollama.availableModels[0] ?? status.providers.ollama.configuredModel };
  }
  if (status.providers.ollama.ready) {
    return { provider: "ollama", model: flags.model ?? status.providers.ollama.availableModels[0] ?? status.providers.ollama.configuredModel };
  }
  return { provider: "lmstudio", model: flags.model ?? status.providers.lmstudio.availableModels[0] ?? status.providers.lmstudio.configuredModel };
}

async function run(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const status = await getSetupStatus(config);

  if (flags.check) {
    console.log(`[translate-bot] setup check nextAction=${status.nextAction} recommendedProvider=${status.recommendedProvider}`);
    return;
  }

  const selection = flags.yes ? chooseSetupProvider(status, flags) : await promptForSelection(status, flags);
  const env = renderLocalEnv(selection);
  await writeFile(config.configPath, env, "utf8");

  console.log(`[translate-bot] wrote ${config.configPath}`);
  console.log(`[translate-bot] provider=${selection.provider} model=${selection.model}`);
  console.log("[translate-bot] next: npm run build && npm run dev:proxy");
}

async function promptForSelection(status: SetupStatus, flags: SetupCliFlags): Promise<{ provider: "ollama" | "lmstudio"; model: string }> {
  const rl = createInterface({ input, output });
  try {
    const fallback = chooseSetupProvider(status, flags);
    const providerAnswer = (await rl.question(`Provider [${fallback.provider}]: `)).trim() || fallback.provider;
    const modelAnswer = (await rl.question(`Model [${fallback.model}]: `)).trim() || fallback.model;
    return {
      provider: providerAnswer === "lmstudio" ? "lmstudio" : "ollama",
      model: modelAnswer
    };
  } finally {
    rl.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void run();
}
```

```bash
#!/usr/bin/env bash
# scripts/bootstrap-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm install
./node_modules/.bin/tsx scripts/setup-local.ts --yes "$@"
npm run build

printf '\nTranslate Bot is ready.\n'
printf 'Load unpacked extension from: %s/packages/extension/dist\n' "$ROOT"
printf 'Start proxy with: npm run dev:proxy\n'
```

```json
// package.json
{
  "scripts": {
    "setup:local": "tsx scripts/setup-local.ts",
    "doctor:local": "tsx scripts/setup-local.ts --check",
    "bootstrap:local": "bash ./scripts/bootstrap-local.sh",
    "build": "npm run build --workspaces",
    "test": "vitest run",
    "check": "npm run build && npm test"
  }
}
```

- [ ] **Step 4: Run the CLI tests and bootstrap smoke checks**

Run: `npx vitest run scripts/setup-local.test.ts packages/proxy/tests/setup.test.ts -v`

Expected: PASS for CLI parsing/provider-choice tests and the existing proxy setup tests.

Run: `./node_modules/.bin/tsx scripts/setup-local.ts --check`

Expected: a single status line like `[translate-bot] setup check nextAction=ready recommendedProvider=ollama`.

Run: `bash ./scripts/bootstrap-local.sh`

Expected: dependency install completes, `packages/proxy/.env` exists, and the script prints the unpacked extension path plus `npm run dev:proxy`.

- [ ] **Step 5: Commit the bootstrap flow**

```bash
git add vitest.config.ts scripts/setup-local.ts scripts/setup-local.test.ts scripts/bootstrap-local.sh package.json
git commit -m "feat: add one-command local bootstrap"
```

## Task 4: Rewrite Project Docs Around the Local-First Product Story

**Files:**
- Modify: `README.md`
- Modify: `docs/browser-setup.md`
- Modify: `packages/extension/public/manifest.json`
- Modify: `package.json`
- Test: repository smoke verification commands

- [ ] **Step 1: Write the failing documentation smoke check**

Run: `rg "bootstrap-local|doctor:local|Setup assistant|local-first" README.md docs/browser-setup.md packages/extension/public/manifest.json package.json`

Expected: the new bootstrap/setup-assistant terms are missing or incomplete in the current files.

- [ ] **Step 2: Verify the existing docs still describe the manual flow**

Run: `sed -n '1,140p' README.md`

Expected: the install section still shows the manual sequence `npm install`, `npm run build`, `cp packages/proxy/.env.example packages/proxy/.env` instead of the one-command bootstrap.

- [ ] **Step 3: Replace the docs and metadata with the formal local-first project story**

````md
<!-- README.md -->
# Translate Bot

Local-first Chromium page translation with Ollama or LM Studio.

## Quick start

```bash
./scripts/bootstrap-local.sh
```

This command:

1. installs dependencies
2. detects local runtimes
3. writes `packages/proxy/.env`
4. builds the unpacked extension

Then start the proxy:

```bash
npm run dev:proxy
```

Load the unpacked extension from:

```text
/Users/apple/translateBot/packages/extension/dist
```

## Local providers

- `Ollama` is the default and recommended path
- `LM Studio` is supported when a local model is already loaded
- `OpenAI Codex OAuth` is optional and treated as an advanced provider
````

````md
<!-- docs/browser-setup.md -->
## 1. Bootstrap the project

```bash
cd /Users/apple/translateBot
./scripts/bootstrap-local.sh
```

If you want to re-check the local environment without rewriting config:

```bash
npm run doctor:local
```

The popup now includes a `Setup assistant` card that reports:

- whether the proxy is reachable
- whether `Ollama` is up
- whether `LM Studio` has a loaded model
- whether the current page can be translated yet
````

```json
// packages/extension/public/manifest.json
{
  "description": "Local-first Chromium page translation powered by Ollama or LM Studio."
}
```

```json
// package.json
{
  "description": "Local-first Chromium translation extension with a local proxy and guided setup."
}
```

- [ ] **Step 4: Run full project verification**

Run: `npm run build`

Expected: workspace build succeeds and `packages/extension/dist` is regenerated.

Run: `npm test`

Expected: all Vitest suites in `packages/**` and `scripts/**` pass.

Run: `rg "bootstrap-local|doctor:local|Setup assistant|local-first" README.md docs/browser-setup.md packages/extension/public/manifest.json package.json`

Expected: matches appear in all four files and the README no longer leads with the old manual copy flow.

- [ ] **Step 5: Commit the docs and metadata refresh**

```bash
git add README.md docs/browser-setup.md packages/extension/public/manifest.json package.json
git commit -m "docs: formalize local-first project workflow"
```

## Self-Review

### Spec Coverage

- Define the project as a local on-device model translation plugin:
  - Covered by Task 1 proxy setup contract, Task 2 popup assistant wording, and Task 4 documentation/manifest wording.
- Make it a formal project:
  - Covered by Task 3 repository scripts and Task 4 metadata/docs refresh.
- One-line deploy:
  - Covered by Task 3 `scripts/bootstrap-local.sh` and root `bootstrap:local`.
- Initialization assistant:
  - Covered by Task 2 popup assistant and Task 3 CLI assistant.

### Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders remain.
- Every code-changing step includes concrete code.
- Every verification step includes a concrete command and expected result.

### Type Consistency

- `SetupStatus` is defined once in proxy types and mirrored in extension fetch client.
- `buildPopupSetupState()` consumes `SetupStatus`.
- `chooseSetupProvider()` and `renderLocalEnv()` both operate on the same provider IDs: `ollama` and `lmstudio`.

### Residual Risks

- `scripts/setup-local.ts` imports package source directly; keep that script small and avoid pulling browser-only code into it.
- Popup onboarding should remain informational; do not let it silently mutate `.env`, because the proxy may not be running yet.
- If Windows support becomes a requirement, add a follow-up plan for a PowerShell bootstrap path instead of stretching this one.
