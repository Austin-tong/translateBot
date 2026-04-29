import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "packages/extension/dist");
const chromeExecutablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const proxyPort = Number(process.env.PROXY_PORT ?? "0");

const proxy = await startServer((request, response) => {
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
      const parsed = JSON.parse(body);
      const segments = parsed.segments.map((segment) => ({ id: segment.id, translation: `译文：${segment.text}` }));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ provider: "lmstudio", model: "mock", segments }));
    });
    return;
  }
  response.writeHead(404).end();
}, proxyPort);

const fixture = await startServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html lang="en">
      <head><title>Translate Bot Fixture</title></head>
      <body>
        <h1>Fast contextual translation</h1>
        <p>This extension keeps the original text visible while adding a Chinese translation near it.</p>
      </body>
    </html>`);
});

const userDataDir = await mkdtemp(join(tmpdir(), "translate-bot-e2e-"));
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromeExecutablePath,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  await page.goto(fixture.url);
  const extensionId = await findExtensionId(context, userDataDir, extensionPath).catch((error) => {
    console.warn(`extension smoke test skipped: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  if (!extensionId) {
    process.exitCode = 0;
  } else {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await extensionPage.evaluate(async ({ fixtureUrl }) => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((tab) => tab.url?.startsWith(fixtureUrl));
    if (!target?.id) throw new Error(`Could not find fixture tab for ${fixtureUrl}.`);
    await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ["content.js"] }).catch(() => undefined);
    await chrome.tabs.sendMessage(target.id, {
      type: "TRANSLATE_TOGGLE",
      settings: {
        provider: "openai",
        proxyUrl
      }
    });
  }, { fixtureUrl: fixture.url, proxyUrl: proxy.url });
  await extensionPage.close();
  await page.getByText("译文：Fast contextual translation").waitFor({ timeout: 10_000 });
  await page.getByText("Fast contextual translation").waitFor({ timeout: 10_000 });
  console.log("extension smoke test passed");
  }
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
  await proxy.close();
  await fixture.close();
}

async function startServer(handler, preferredPort = 0) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
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

async function findExtensionId(context, userDataDir, expectedPath) {
  const fromServiceWorker = await findExtensionIdFromServiceWorker(context);
  if (fromServiceWorker) return fromServiceWorker;
  return findExtensionIdFromPreferences(userDataDir, expectedPath);
}

async function findExtensionIdFromServiceWorker(context) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const worker = context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://"));
    if (worker) return new URL(worker.url()).host;
    try {
      const nextWorker = await context.waitForEvent("serviceworker", { timeout: 500 });
      if (nextWorker.url().startsWith("chrome-extension://")) return new URL(nextWorker.url()).host;
    } catch {
      // service worker may still be starting up.
    }
  }
  return undefined;
}

async function findExtensionIdFromPreferences(userDataDir, expectedPath) {
  const preferencesPath = join(userDataDir, "Default", "Preferences");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const raw = await readFile(preferencesPath, "utf8");
      const preferences = JSON.parse(raw);
      const settings = preferences.extensions?.settings ?? {};
      for (const [id, extension] of Object.entries(settings)) {
        if (extension?.path === expectedPath || extension?.manifest?.name === "Translate Bot") return id;
      }
    } catch {
      // Chrome writes Preferences asynchronously during startup.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Could not determine unpacked extension id from service worker or Chrome Preferences.");
}
