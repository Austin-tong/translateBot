import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractBodyHtml, extractPrimaryContentHtml, sanitizeMirrorHtml, startRealPageMirror } from "./real-page-mirror.js";

describe("real-page mirror helpers", () => {
  it("extracts and sanitizes body markup", () => {
    const html = `
      <html>
        <head><script>window.bad = true;</script></head>
        <body>
          <div onclick="alert(1)">Hello</div>
          <script>window.bad = true;</script>
        </body>
      </html>
    `;

    const body = extractBodyHtml(html);
    const sanitized = sanitizeMirrorHtml(body);

    expect(body).toContain("<div onclick=\"alert(1)\">Hello</div>");
    expect(sanitized).toContain("<div>Hello</div>");
    expect(sanitized).not.toContain("onclick=");
    expect(sanitized).not.toContain("<script");
  });

  it("keeps title and article body while dropping navigation noise in primary-content mode", () => {
    const html = `
      <html>
        <body>
          <nav aria-label="Site">
            <a href="/wiki/Main_Page"><span>Main page</span></a>
            <a href="/wiki/Donate"><span>Donate</span></a>
          </nav>
          <main id="content" class="mw-body">
            <header class="mw-body-header vector-page-titlebar no-font-mode-scale">
              <h1 id="firstHeading" class="firstHeading mw-first-heading">Artificial intelligence</h1>
              <div id="p-lang-btn">
                <span>175 languages</span>
              </div>
            </header>
            <div id="mw-content-text" class="mw-body-content">
              <p>Artificial intelligence (AI) is the capability of computational systems to perform tasks typically associated with human intelligence.</p>
            </div>
          </main>
        </body>
      </html>
    `;

    const primary = extractPrimaryContentHtml(html);

    expect(primary).toContain("Artificial intelligence");
    expect(primary).toContain("Artificial intelligence (AI) is the capability of computational systems");
    expect(primary).not.toContain("Main page");
    expect(primary).not.toContain("Donate");
    expect(primary).not.toContain("175 languages");
  });

  it("falls back to sanitized body markup when no primary-content root exists", () => {
    const html = `
      <html>
        <body>
          <section onclick="noop()"><p>Fallback article copy.</p></section>
        </body>
      </html>
    `;

    const primary = extractPrimaryContentHtml(html);

    expect(primary).toContain("Fallback article copy.");
    expect(primary).not.toContain("onclick=");
  });

  it("promotes leading article paragraphs ahead of wikipedia-style hatnotes and sidebars", () => {
    const html = `
      <html>
        <body>
          <main id="content" class="mw-body">
            <header class="mw-body-header">
              <h1 id="firstHeading">Artificial intelligence</h1>
            </header>
            <div id="mw-content-text" class="mw-body-content">
              <div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr">
                <div class="shortdescription" style="display:none">Intelligence of machines</div>
                <div role="note" class="hatnote">"AI" redirects here.</div>
                <table class="sidebar"><tbody><tr><td>Part of a series on AI</td></tr></tbody></table>
                <p>Artificial intelligence (AI) is the capability of computational systems to perform tasks typically associated with human intelligence.</p>
                <p>Some high-profile applications of AI include advanced web search engines and recommendation systems.</p>
              </div>
            </div>
          </main>
        </body>
      </html>
    `;

    const primary = extractPrimaryContentHtml(html);

    expect(primary).toContain("Artificial intelligence (AI) is the capability of computational systems");
    expect(primary).toContain("Some high-profile applications of AI include advanced web search engines");
    expect(primary).not.toContain("\"AI\" redirects here.");
    expect(primary).not.toContain("Part of a series on AI");
    expect(primary).not.toContain("Intelligence of machines");
  });

  it("prefers known article body containers over earlier generic article tags", () => {
    const html = `
      <html>
        <body>
          <main id="content" class="mw-body">
            <article class="lead-media"><img src="/lock.png" alt="Page semi-protected"></article>
            <header><h1>Artificial intelligence</h1></header>
            <div id="mw-content-text" class="mw-body-content">
              <p>Artificial intelligence (AI) is the capability of computational systems to perform tasks typically associated with human intelligence.</p>
            </div>
          </main>
        </body>
      </html>
    `;

    const primary = extractPrimaryContentHtml(html);

    expect(primary).toContain("Artificial intelligence (AI) is the capability of computational systems");
    expect(primary).not.toContain("Page semi-protected");
  });

  it("returns a usable bound url when the mirror listens on an ephemeral port", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html>
        <body>
          <main><p>Ephemeral port mirror body that is long enough for extraction to keep.</p></main>
        </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    })));

    const tempDir = await mkdtemp(join(tmpdir(), "real-page-mirror-test-"));
    const contentScriptPath = join(tempDir, "content.js");
    await writeFile(contentScriptPath, "");

    const mirror = await startRealPageMirror({
      targetUrl: "https://example.test/article",
      port: 0,
      mode: "body",
      contentScriptPath
    });

    try {
      expect(mirror.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(mirror.url.endsWith(":0")).toBe(false);

      const html = await realFetch(mirror.url).then((response) => response.text());
      expect(html).toContain(mirror.url);
      expect(html).not.toContain("http://127.0.0.1:0");
    } finally {
      await mirror.close();
      await rm(tempDir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});
