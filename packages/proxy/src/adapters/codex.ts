import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTranslationPrompt, parseTranslationJson } from "../prompt.js";
import type { ModelAdapter, ProxyConfig, TranslateRequest, TranslateResponse } from "../types.js";

// Codex CLI 支持 output schema；这里约束最终输出只包含 id 和译文，方便和页面节点回填对齐。
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segments"],
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "translation"],
        properties: {
          id: { type: "string" },
          translation: { type: "string" }
        }
      }
    }
  }
};

export class CodexAdapter implements ModelAdapter {
  constructor(private readonly config: ProxyConfig) {}

  async listModels(): Promise<string[]> {
    return [this.config.openaiModel];
  }

  async authStatus(): Promise<{ loggedIn: boolean; detail: string }> {
    // 不读取 Codex 的本地凭证文件，只通过公开 CLI 命令查询登录状态。
    const result = await runCommand(this.config.codexCommand, ["login", "status"], "", 10_000);
    const detail = `${result.stdout}${result.stderr}`.trim();
    return {
      loggedIn: result.exitCode === 0 && /Logged in/i.test(detail),
      detail
    };
  }

  async startAuth(): Promise<{ started: boolean; detail: string }> {
    // 由 Codex CLI 自己打开网页登录流程；代理不接触 token 或 API key。
    const child = spawn(this.config.codexCommand, ["login"], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, NO_COLOR: "1" }
    });
    child.unref();
    return {
      started: true,
      detail: "Started `codex login`. Complete the browser authorization flow opened by Codex."
    };
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const model = request.model ?? this.config.openaiModel;
    const expectedIds = new Set(request.segments.map((segment) => segment.id));
    const tempDir = await mkdtemp(join(tmpdir(), "translate-bot-codex-"));
    const schemaPath = join(tempDir, "schema.json");
    const outputPath = join(tempDir, "output.json");

    try {
      // 每次请求使用临时 schema/output 文件，避免并发翻译任务互相覆盖结果。
      await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA), "utf8");
      const prompt = [
        "Translate the provided webpage segments into Simplified Chinese.",
        "Return only the JSON object required by the output schema. Do not explain.",
        buildTranslationPrompt(request)
      ].join("\n\n");
      const result = await runCommand(this.config.codexCommand, [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "-m",
        model,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-"
      ], prompt, this.config.requestTimeoutMs);

      if (result.exitCode !== 0) {
        const detail = `${result.stderr}\n${result.stdout}`.trim();
        throw new Error(`Codex translation failed with exit code ${result.exitCode}: ${detail.slice(0, 500)}`);
      }

      const raw = await readFile(outputPath, "utf8");
      return {
        provider: "openai",
        model,
        segments: parseTranslationJson(raw, expectedIds)
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

// 简单封装子进程调用：收集 stdout/stderr，并用 timeout 防止代理请求无限挂起。
async function runCommand(command: string, args: string[], stdin: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" }
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });

    child.stdin.end(stdin);
  });
}
