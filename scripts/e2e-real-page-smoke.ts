import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { startRealPageMirror } from "./real-page-mirror.js";

const root = resolve(import.meta.dirname, "..");
const chromeExecutablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const targetUrl = process.env.TARGET_URL ?? "https://en.wikipedia.org/wiki/Artificial_intelligence";
const expectedTitle = process.env.EXPECT_TITLE ?? "Artificial intelligence";
const expectedIntroSnippet = process.env.EXPECT_INTRO_SNIPPET ?? "Artificial intelligence (AI) is the capability of computational systems";
const proxyPort = Number(process.env.PROXY_PORT ?? "0");
const mirrorPort = Number(process.env.MIRROR_PORT ?? "0");
const unexpectedNoise = (process.env.UNEXPECTED_NOISE ?? "Main page|Donate|175 languages")
  .split("|")
  .map((item) => item.trim())
  .filter(Boolean);

const proxy = await startServer(handleProxyRequest, proxyPort);
const mirror = await startRealPageMirror({
  targetUrl,
  port: mirrorPort,
  mode: "primary-content",
  contentScriptPath: resolve(root, "packages/extension/dist/content.js")
});

let browser: Browser | undefined;

try {
  browser = await chromium.launch({
    executablePath: chromeExecutablePath,
    headless: true
  });
  const page = await browser.newPage();
  await page.goto(mirror.url);
  await runSmokeAssertions(page, mirror.url, proxy.url);
} finally {
  await browser?.close();
  await mirror.close();
  await proxy.close();
}

/**
 * 提供 mock 翻译代理，保证 smoke test 不依赖真实翻译服务。
 * 输入是扩展发来的批量 segments，输出是逐条加上固定前缀的“译文”结果。
 */
function handleProxyRequest(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, openaiConfigured: false }));
    return;
  }
  if (request.method === "POST" && request.url === "/translate") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const segments = (parsed.segments ?? []).map((segment: { id: string; text: string }) => ({
        id: segment.id,
        translation: `译文：${segment.text}`
      }));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ provider: "mock", model: "mock", segments }));
    });
    return;
  }
  response.writeHead(404).end();
}

/**
 * 对真实网页镜像执行一轮浏览器级 smoke 断言：
 * 1. 页面内加载真实构建产物 `content.js`
 * 2. 页面 load 后自动触发翻译开关
 * 3. 等待标题和正文首段都出现对应译文，并确认正文页没有导航噪音
 */
async function runSmokeAssertions(page: Page, mirrorUrl: string, proxyUrl: string): Promise<void> {
  const headingTranslation = page.locator("h1 [data-translate-bot-translation='true']");
  await headingTranslation.waitFor({ timeout: 15_000 });
  if (await headingTranslation.count() !== 1) {
    throw new Error("Expected exactly one translated heading block on the mirror page.");
  }
  const headingText = (await headingTranslation.innerText()).trim();
  if (headingText !== `译文：${expectedTitle}`) {
    throw new Error(`Unexpected heading translation: ${headingText}`);
  }

  const introParagraph = page.locator("p").filter({ hasText: expectedIntroSnippet });
  await introParagraph.waitFor({ timeout: 15_000 });
  if (await introParagraph.count() !== 1) {
    throw new Error("Expected exactly one intro paragraph matching the configured snippet.");
  }
  const introTranslation = introParagraph.locator("[data-translate-bot-translation='true']");
  await introTranslation.waitFor({ timeout: 15_000 });
  const introTranslationText = (await introTranslation.innerText()).trim();
  if (!introTranslationText.startsWith(`译文：${expectedIntroSnippet}`)) {
    throw new Error(`Unexpected intro translation: ${introTranslationText}`);
  }

  const bodyText = await page.locator("body").innerText();
  for (const noise of unexpectedNoise) {
    if (bodyText.includes(noise)) {
      throw new Error(`Mirror page still contains filtered noise: ${noise}`);
    }
  }

  const translationCount = await page.locator("[data-translate-bot-translation='true']").count();
  console.log(JSON.stringify({
    ok: true,
    targetUrl,
    mirrorUrl,
    proxyUrl,
    translationCount
  }));
}

/**
 * 启动一个本地 HTTP 服务并返回可关闭句柄。
 * 端到端 smoke 需要显式控制代理和镜像两个本地入口，便于脚本独立运行。
 */
async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  preferredPort = 0
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(preferredPort, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start test server.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  };
}
