import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { LMStudioAdapter } from "./adapters/lmstudio.js";
import { OllamaAdapter } from "./adapters/ollama.js";
import { CodexAdapter } from "./adapters/codex.js";
import { getSetupStatus } from "./setup.js";
import type { AuthAwareModelAdapter, ModelAdapter, Provider, TranslateRequest } from "./types.js";

const config = loadConfig();
const codexAdapter = new CodexAdapter(config);
// provider=openai 走长驻 proxy 内的 OpenAI Codex OAuth；provider=lmstudio/ollama 走本机模型服务。
const adapters: Record<Provider, ModelAdapter> = {
  openai: codexAdapter,
  lmstudio: new LMStudioAdapter(config),
  ollama: new OllamaAdapter(config)
};

const server = createServer(async (request, response) => {
  try {
    // 扩展运行在 chrome-extension://，需要允许它访问本机代理。
    setCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        openaiAuth: "codex-oauth",
        openaiModel: config.openaiModel,
        lmstudioBaseUrl: config.lmstudioBaseUrl,
        ollamaBaseUrl: config.ollamaBaseUrl,
        ollamaModel: config.ollamaModel
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/setup/status") {
      sendJson(response, 200, await getSetupStatus(config));
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/openai/status") {
      sendJson(response, 200, await (adapters.openai as AuthAwareModelAdapter).authStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/openai/start") {
      sendJson(response, 200, await (adapters.openai as AuthAwareModelAdapter).startAuth());
      return;
    }

    if (request.method === "GET" && url.pathname === "/models") {
      const provider = parseProvider(url.searchParams.get("provider"));
      const models = await adapters[provider].listModels();
      sendJson(response, 200, { provider, models });
      return;
    }

    if (request.method === "POST" && url.pathname === "/translate") {
      const body = validateTranslateRequest(await readJson(request));
      const startedAt = Date.now();
      const requestedModel = body.model ?? defaultModelForProvider(body.provider);
      console.log(`[translate-bot] translate request provider=${body.provider} model=${requestedModel} segments=${body.segments.length} ids=${formatIds(body.segments.map((segment) => segment.id))} sample=${formatSegmentSample(body.segments)} url=${body.page.url}`);
      const translated = await adapters[body.provider].translate(body);
      console.log(`[translate-bot] translate response provider=${translated.provider} model=${translated.model} segments=${translated.segments.length} ids=${formatIds(translated.segments.map((segment) => segment.id))} durationMs=${Date.now() - startedAt}`);
      sendJson(response, 200, translated);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    sendJson(response, 500, { error: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`translate-bot proxy listening on http://${config.host}:${config.port}`);
});

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parseProvider(raw: string | null): Provider {
  if (raw === "openai" || raw === "lmstudio" || raw === "ollama") return raw;
  throw new Error("provider must be openai, lmstudio, or ollama.");
}

function defaultModelForProvider(provider: Provider): string {
  if (provider === "openai") return config.openaiModel;
  if (provider === "lmstudio") return config.lmstudioModel;
  return config.ollamaModel;
}

function formatIds(ids: string[]): string {
  const head = ids.slice(0, 12).join(",");
  return ids.length > 12 ? `${head},...` : head;
}

function formatSegmentSample(segments: TranslateRequest["segments"]): string {
  // 日志只保留短预览，方便排查 segment 是否发出，同时避免把整页正文刷满终端。
  return JSON.stringify(segments.slice(0, 3).map((segment) => ({
    id: segment.id,
    text: previewText(segment.text)
  })));
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    // 本地代理只接收批量文本片段，不允许异常大请求占用内存。
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function validateTranslateRequest(raw: unknown): TranslateRequest {
  // 代理边界做最小结构校验，避免把不完整请求直接传给模型 adapter。
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body.");
  const request = raw as Partial<TranslateRequest>;
  if (request.provider !== "openai" && request.provider !== "lmstudio" && request.provider !== "ollama") throw new Error("Invalid provider.");
  if (request.targetLanguage !== "zh-CN") throw new Error("Only zh-CN targetLanguage is supported.");
  if (!request.page || typeof request.page.url !== "string" || typeof request.page.title !== "string") {
    throw new Error("Invalid page context.");
  }
  if (!Array.isArray(request.segments) || request.segments.length === 0 || request.segments.length > 100) {
    throw new Error("segments must include 1 to 100 items.");
  }
  for (const segment of request.segments) {
    if (!segment || typeof segment.id !== "string" || typeof segment.text !== "string" || segment.text.trim().length === 0) {
      throw new Error("Invalid segment.");
    }
  }
  return request as TranslateRequest;
}
