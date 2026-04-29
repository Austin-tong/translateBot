import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

export type MirrorMode = "body" | "primary-content";

interface StartMirrorOptions {
  targetUrl: string;
  port?: number;
  mode?: MirrorMode;
  contentScriptPath?: string;
}

/**
 * 从完整 HTML 中提取 body 内部标记，便于后续做镜像裁剪。
 */
export function extractBodyHtml(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}

/**
 * 清理远端页面里不适合直接复用的内容：
 * - script/style/noscript 避免和内容脚本冲突
 * - 内联事件避免把第三方行为带进镜像页
 */
export function sanitizeMirrorHtml(markup: string): string {
  return markup
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/\s+on[a-z]+=(?:"[^"]*"|'[^']*')/gi, "");
}

/**
 * 抽取更接近“用户当前真正想看的正文区域”的主内容片段。
 * 优先保留标题和正文容器，主动丢掉导航、工具栏、语言下拉等外围噪音。
 */
export function extractPrimaryContentHtml(html: string): string {
  const bodyMarkup = sanitizeMirrorHtml(extractBodyHtml(html));
  const dom = new JSDOM(`<!doctype html><body>${bodyMarkup}</body>`);
  const { document } = dom.window;
  const mainRoot = document.querySelector("main, article, [role='main']");
  if (!mainRoot) return bodyMarkup;

  const bodyRoot = selectPrimaryBodyRoot(mainRoot) ?? mainRoot;
  const title = mainRoot.querySelector("h1, header h1, .mw-page-title-main") ?? document.querySelector("h1");

  const wrapper = document.createElement("section");
  wrapper.setAttribute("data-mirror-mode", "primary-content");
  if (title) wrapper.append(title.cloneNode(true));
  appendPrimaryContentBlocks(wrapper, bodyRoot);

  for (const element of wrapper.querySelectorAll("nav, aside, footer, [role='navigation'], [role='banner'], [role='contentinfo'], #p-lang-btn, .vector-page-toolbar, .vector-user-links, .vector-dropdown-content")) {
    element.remove();
  }

  return sanitizeMirrorHtml(wrapper.innerHTML);
}

function appendPrimaryContentBlocks(wrapper: Element, bodyRoot: Element): void {
  const selectedBlocks = collectPrimaryContentBlocks(bodyRoot);
  if (selectedBlocks.length === 0) {
    wrapper.append(bodyRoot.cloneNode(true));
    return;
  }
  for (const block of selectedBlocks) wrapper.append(block.cloneNode(true));
}

function selectPrimaryBodyRoot(mainRoot: Element): Element | null {
  for (const selector of [
    "#mw-content-text",
    ".mw-parser-output",
    "[itemprop='articleBody']",
    ".article-content",
    ".post-content",
    ".entry-content",
    "article"
  ]) {
    const match = mainRoot.querySelector(selector);
    if (match) return match;
  }
  return null;
}

function collectPrimaryContentBlocks(bodyRoot: Element): Element[] {
  const blocks = bodyRoot.querySelectorAll("p, h2, h3, h4, h5, h6, ul, ol, blockquote, figure, img");
  const selected: Element[] = [];
  for (const block of blocks) {
    if (isExcludedPrimaryContentBlock(block)) continue;
    if (!hasMeaningfulPrimaryContent(block)) continue;
    selected.push(block);
    if (selected.length >= 12) break;
  }
  return selected;
}

function isExcludedPrimaryContentBlock(block: Element): boolean {
  return Boolean(block.closest(
    "nav, aside, footer, table, .sidebar, .infobox, .shortdescription, .hatnote, [role='note'], .metadata, .mw-empty-elt, .reference, .navbox, .toc, .vector-page-toolbar, #p-lang-btn"
  ));
}

function hasMeaningfulPrimaryContent(block: Element): boolean {
  if (block.tagName === "IMG") return true;
  const text = block.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length >= 40;
}

function buildMirrorPageHtml({
  targetUrl,
  proxyUrl,
  bodyMarkup,
  contentScript
}: {
  targetUrl: string;
  proxyUrl: string;
  bodyMarkup: string;
  contentScript: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mirror Smoke: ${escapeHtml(targetUrl)}</title>
  <style>
    body { margin: 0; background: #fff; color: #111; }
    .mirror-shell { max-width: 1100px; margin: 0 auto; padding: 24px; }
    img, video { max-width: 100%; height: auto; }
    [data-translate-bot-translation="true"] { display: block; color: #0b57d0; margin-top: 0.15em; }
    [data-translate-bot-refresh="true"] { margin-left: 0.35rem; }
  </style>
</head>
<body>
  <div class="mirror-shell">${bodyMarkup}</div>
  <script>
    const listeners = [];
    const storageState = { provider: "openai", proxyUrl: ${JSON.stringify(proxyUrl)} };
    window.chrome = {
      runtime: {
        onMessage: { addListener(fn) { listeners.push(fn); } },
        sendMessage: async () => ({ ok: true })
      },
      storage: {
        local: {
          async get() { return storageState; },
          async set(next) { Object.assign(storageState, next); }
        }
      }
    };
    window.__dispatchTranslateBotMessage = async (message) => {
      for (const listener of listeners) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          const maybe = listener(message, { id: "real-page-mirror" }, finish);
          if (maybe && typeof maybe.then === "function") maybe.then(finish);
          if (maybe === false || maybe === undefined) queueMicrotask(() => finish(undefined));
        });
      }
    };
  </script>
  <script>${contentScript}</script>
  <script>
    window.addEventListener("load", async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await window.__dispatchTranslateBotMessage({
        type: "TRANSLATE_TOGGLE",
        settings: { provider: "openai", proxyUrl: ${JSON.stringify(proxyUrl)} }
      });
    });
  </script>
</body>
</html>`;
}

export async function startRealPageMirror(options: StartMirrorOptions) {
  const {
    targetUrl,
    port = 8791,
    mode = "body",
    contentScriptPath = resolve(import.meta.dirname, "..", "packages/extension/dist/content.js")
  } = options;
  const contentScript = await readFile(contentScriptPath, "utf8");
  let boundPort = port;

  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (request.url === "/translate" && request.method === "POST") {
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
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ provider: "mock", model: "mock", segments }));
      });
      return;
    }

    if (request.url === "/" || request.url?.startsWith("/?")) {
      const upstream = await fetch(targetUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      const html = await upstream.text();
      const bodyMarkup = mode === "primary-content"
        ? extractPrimaryContentHtml(html)
        : sanitizeMirrorHtml(extractBodyHtml(html));
      const proxyUrl = `http://127.0.0.1:${boundPort}`;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(buildMirrorPageHtml({
        targetUrl,
        proxyUrl,
        bodyMarkup,
        contentScript
      }));
      return;
    }

    response.writeHead(404).end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine mirror server port."));
        return;
      }
      boundPort = address.port;
      resolve();
    });
  });

  return {
    url: `http://127.0.0.1:${boundPort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

async function main(): Promise<void> {
  const targetUrl = process.env.TARGET_URL ?? "https://en.wikipedia.org/wiki/Artificial_intelligence";
  const port = Number(process.env.PORT ?? "8791");
  const mode = (process.env.MIRROR_MODE as MirrorMode | undefined) ?? "primary-content";
  const server = await startRealPageMirror({ targetUrl, port, mode });
  console.log(`mirror server ready: ${server.url} -> ${targetUrl} (${mode})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
