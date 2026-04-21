import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../packages/proxy/src/config.js";
import { getSetupStatus, renderLocalEnv } from "../packages/proxy/src/setup.js";
import type { LocalProvider, SetupStatus } from "../packages/proxy/src/types.js";

export interface SetupCliFlags {
  yes: boolean;
  check: boolean;
  overwrite: boolean;
  provider?: LocalProvider;
  model?: string;
}

export function parseArgs(argv: string[]): SetupCliFlags {
  return argv.reduce<SetupCliFlags>((flags, arg) => {
    if (arg === "--yes") {
      flags.yes = true;
      return flags;
    }

    if (arg === "--check") {
      flags.check = true;
      return flags;
    }

    if (arg === "--overwrite") {
      flags.overwrite = true;
      return flags;
    }

    if (arg.startsWith("--provider=")) {
      flags.provider = parseProviderFlag(arg);
      return flags;
    }

    if (arg.startsWith("--model=")) {
      flags.model = arg.slice("--model=".length);
      return flags;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }, {
    yes: false,
    check: false,
    overwrite: false
  });
}

export function chooseSetupProvider(status: SetupStatus, flags: SetupCliFlags): { provider: "ollama" | "lmstudio"; model: string } {
  const provider = flags.provider ?? status.recommendedProvider;
  const statusForProvider = status.providers[provider];

  return {
    provider,
    model: flags.model ?? statusForProvider.availableModels[0] ?? statusForProvider.configuredModel
  };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const status = await getSetupStatus(config);

  if (flags.check) {
    printStatus(status);
    return;
  }

  if (await shouldSkipWrite(config.configPath, flags.overwrite)) {
    printStatus(status);
    console.log(`[translate-bot] existing env file found at ${config.configPath}; pass --overwrite to replace it.`);
    return;
  }

  const selection = await selectSetupProvider(status, flags);
  await writeFile(config.configPath, renderLocalEnv(selection), "utf8");

  console.log(`[translate-bot] wrote ${config.configPath}`);
  console.log(`[translate-bot] provider=${selection.provider} model=${selection.model}`);
  console.log("[translate-bot] next: npm run build && npm run dev:proxy");
}

async function selectSetupProvider(status: SetupStatus, flags: SetupCliFlags): Promise<{ provider: "ollama" | "lmstudio"; model: string }> {
  if (flags.yes || !stdin.isTTY) {
    return chooseSetupProvider(status, flags);
  }

  const fallback = chooseSetupProvider(status, flags);
  const prompt = createInterface({ input: stdin, output: stdout });

  try {
    const providerAnswer = (await prompt.question(`Provider [${fallback.provider}]: `)).trim();
    const modelAnswer = (await prompt.question(`Model [${fallback.model}]: `)).trim();

    return {
      provider: resolveInteractiveProvider(providerAnswer, fallback.provider),
      model: modelAnswer || fallback.model
    };
  } finally {
    prompt.close();
  }
}

async function shouldSkipWrite(configPath: string, overwrite: boolean): Promise<boolean> {
  if (overwrite) return false;

  try {
    await access(configPath);
    return true;
  } catch {
    return false;
  }
}

function printStatus(status: SetupStatus): void {
  console.log(`[translate-bot] ${status.nextMessage}`);
  console.log(`[translate-bot] recommended=${status.recommendedProvider} nextAction=${status.nextAction}`);
}

export function resolveInteractiveProvider(answer: string, fallback: LocalProvider): LocalProvider {
  if (answer === "") return fallback;
  if (answer === "ollama" || answer === "lmstudio") return answer;
  throw new Error(`Invalid provider answer: ${answer}`);
}

function parseProviderFlag(arg: string): LocalProvider {
  const value = arg.slice("--provider=".length);
  if (value === "ollama" || value === "lmstudio") {
    return value;
  }

  throw new Error(`Invalid --provider value: ${value}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(`[translate-bot] setup failed: ${message}`);
    process.exitCode = 1;
  });
}
