// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTranslation, collectCandidateElements, createRecord, isCandidateElement, isTranslatableText, restoreRecord, TranslationRuntime } from "../src/content.js";

describe("content translation DOM helpers", () => {
  it("collects deepest paragraph-like containers instead of individual text nodes", () => {
    document.body.innerHTML = `
      <article id="tweet">
        <div id="tweetText">
          <span>Someone recently suggested to me that the reason OpenClaw moment was so big is because</span>
          <span> large groups of non-technical people experienced the latest agentic models.</span>
        </div>
      </article>
    `;

    const candidates = collectCandidateElements(document.body);

    expect(candidates.map((element) => element.id)).toEqual(["tweetText"]);
  });

  it("skips script, code, editable, hidden, form text, and already translated text", () => {
    document.body.innerHTML = `
      <main>
        <p id="ok">Hello world from a normal paragraph.</p>
        <script id="script">Hello world from a script.</script>
        <code id="code">Hello world from code.</code>
        <p id="editable" contenteditable="true">Hello world from editable text.</p>
        <p hidden id="hidden">Hello world from hidden text.</p>
        <button id="button">Hello world from a button.</button>
        <nav><div id="nav">Hello world from navigation text that should not be translated as a block.</div></nav>
        <form><p id="form">Hello world from form helper text that should not be translated.</p></form>
        <p data-translate-bot-translation="true" id="translated">Hello world from translated text.</p>
      </main>
    `;

    expect(isCandidateElement(document.querySelector("#ok") as HTMLElement)).toBe(true);
    expect(isCandidateElement(document.querySelector("#script") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#code") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#editable") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#hidden") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#button") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#nav") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#form") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#translated") as HTMLElement)).toBe(false);
  });

  it("appends paragraph translations as a new line inside the same container", () => {
    document.body.innerHTML = `<p id="copy">A fast brown fox jumps over the lazy dog.</p>`;
    const paragraph = document.querySelector("#copy") as HTMLParagraphElement;
    const record = createRecord(paragraph, "seg-1");

    applyTranslation(record, "一只敏捷的棕色狐狸跳过懒狗。");

    const translation = paragraph.querySelector("[data-translate-bot-translation]") as HTMLElement;
    expect(paragraph.textContent).toContain("A fast brown fox jumps over the lazy dog.");
    expect(translation.textContent).toBe("一只敏捷的棕色狐狸跳过懒狗。");
    expect(translation.style.display).toBe("block");
    expect(translation.parentElement).toBe(paragraph);
  });

  it("appends menu and button label translations inline", () => {
    document.body.innerHTML = `
      <nav>
        <a><svg></svg><span id="home">Home</span></a>
        <button><span id="follow">Follow</span></button>
      </nav>
    `;
    const home = document.querySelector("#home") as HTMLSpanElement;
    const follow = document.querySelector("#follow") as HTMLSpanElement;

    expect(isCandidateElement(home)).toBe(true);
    expect(isCandidateElement(follow)).toBe(true);

    const record = createRecord(home, "seg-ui");
    applyTranslation(record, "首页");

    const translation = home.querySelector("[data-translate-bot-translation]") as HTMLElement;
    expect(translation.textContent).toBe("首页");
    expect(translation.style.display).toBe("inline");
    expect(translation.style.marginLeft).toBe("0.35em");
  });

  it("does not translate profile cards as one mixed container when a button is present", () => {
    document.body.innerHTML = `
      <article id="profile">
        <div id="card">
          <div id="header">
            <span>Greg Brockman</span>
            <span>@gdb</span>
            <button><span id="followLabel">Follow</span></button>
          </div>
          <div id="bio">President & Co-Founder <a>@OpenAI</a></div>
        </div>
      </article>
    `;

    const candidates = collectCandidateElements(document.body);

    expect(candidates.map((element) => element.id)).toContain("followLabel");
    expect(candidates.map((element) => element.id)).toContain("bio");
    expect(candidates.map((element) => element.id)).not.toContain("card");
    expect(candidates.map((element) => element.id)).not.toContain("header");
  });

  it("collects X post text that starts with an @ mention as one block", () => {
    document.body.innerHTML = `
      <article>
        <div id="tweetText" data-testid="tweetText" lang="en" dir="auto">
          <a id="mention">@grok</a><span> help me understand context?</span><br>
          <span>- what kind of memory is it?</span><br>
          <span>- how token consumption can reduce?</span>
        </div>
      </article>
    `;

    const candidates = collectCandidateElements(document.body);
    const ids = candidates.map((element) => element.id);

    expect(ids).toContain("tweetText");
    expect(ids).not.toContain("mention");
  });

  it("collects short mention replies on lang/dir text roots", () => {
    document.body.innerHTML = `
      <article>
        <div id="reply" lang="en" dir="auto"><a>@grok</a><span> does this really work?</span></div>
      </article>
    `;

    const candidates = collectCandidateElements(document.body);

    expect(candidates.map((element) => element.id)).toEqual(["reply"]);
  });

  it("restores the original container when disabled", () => {
    document.body.innerHTML = `<p id="copy">Keep this text.</p>`;
    const paragraph = document.querySelector("#copy") as HTMLParagraphElement;
    const record = createRecord(paragraph, "seg-2");
    applyTranslation(record, "保留这段文字。");

    restoreRecord(record);

    expect(paragraph.textContent).toBe("Keep this text.");
    expect(paragraph.querySelector("[data-translate-bot-translation]")).toBeNull();
    expect(paragraph.hasAttribute("data-translate-bot-id")).toBe(false);
  });

  it("roughly skips already Chinese text and punctuation-only text", () => {
    expect(isTranslatableText("这是一个中文页面")).toBe(false);
    expect(isTranslatableText("... 123 !!!")).toBe(false);
    expect(isTranslatableText("@grok @OpenAI")).toBe(false);
    expect(isTranslatableText("This page explains translation quality.")).toBe(true);
  });

});

describe("content translation runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("uses updated settings for the next translation request without toggling off", async () => {
    const fetchMock = mockTranslationFetch();
    const runtime = new TranslationRuntime();
    document.body.innerHTML = `<main><p id="first">First paragraph has enough English words for translation.</p></main>`;

    await runtime.toggle({
      provider: "openai",
      proxyUrl: "http://proxy.test",
      model: "gpt-5.4-mini"
    });
    await settleRuntime();

    runtime.updateSettings({
      provider: "openai",
      proxyUrl: "http://proxy.test",
      model: "gpt-5.4"
    });
    document.querySelector("main")?.append(createParagraph("second", "Second paragraph arrives later and should use the new model."));
    await settleRuntime();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).model).toBe("gpt-5.4-mini");
    expect(requestBody(fetchMock, 1).model).toBe("gpt-5.4");
  });

  it("keeps paragraph breaks and list markers in source text sent for translation", async () => {
    const fetchMock = mockTranslationFetch();
    const runtime = new TranslationRuntime();
    document.body.innerHTML = `
      <div id="post">
        This is a big deal.
        <br><br>
        - Built entirely around prompt engineering
        <br>
        - No framework, just one .md file
        <br><br>
        100% open-source.
      </div>
    `;

    await runtime.toggle({ provider: "openai", proxyUrl: "http://proxy.test" });
    await settleRuntime();

    const text = requestBody(fetchMock, 0).segments[0]?.text;
    expect(text).toContain("This is a big deal.\n\n- Built entirely around prompt engineering");
    expect(text).toContain("\n- No framework, just one .md file\n\n100% open-source.");
  });

  it("keeps every dynamic root discovered within the debounce window", async () => {
    const fetchMock = mockTranslationFetch();
    const runtime = new TranslationRuntime();
    document.body.innerHTML = `<main id="feed"></main>`;

    await runtime.toggle({ provider: "openai", proxyUrl: "http://proxy.test" });
    await settleRuntime();

    document.querySelector("#feed")?.append(createParagraph("first", "First dynamic paragraph has enough English words for translation."));
    await Promise.resolve();
    document.querySelector("#feed")?.append(createParagraph("second", "Second dynamic paragraph has enough English words for translation."));
    await settleRuntime();

    const texts = fetchMock.mock.calls.flatMap(([_url, init]) => requestSegments(init).map((segment) => segment.text));
    expect(texts).toContain("First dynamic paragraph has enough English words for translation.");
    expect(texts).toContain("Second dynamic paragraph has enough English words for translation.");
  });

  it("uses smaller single-flight batches for Ollama", async () => {
    const firstFetch = deferred<Response>();
    const secondFetch = deferred<Response>();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as ProxyRequest;
      bodies.push(body);
      return bodies.length === 1 ? firstFetch.promise : secondFetch.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const runtime = new TranslationRuntime();
    document.body.innerHTML = `<main>${Array.from({ length: 10 }, (_, index) => `<p id="p${index}">Ollama paragraph ${index} has enough English words for translation batching.</p>`).join("")}</main>`;

    await runtime.toggle({ provider: "ollama", proxyUrl: "http://proxy.test" });
    await settleRuntime(40);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((bodies[0] as ProxyRequest).segments).toHaveLength(8);

    firstFetch.resolve(translationResponse((bodies[0] as ProxyRequest).segments, "translated"));
    await settleRuntime();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((bodies[1] as ProxyRequest).segments).toHaveLength(2);
    secondFetch.resolve(translationResponse((bodies[1] as ProxyRequest).segments, "translated"));
    await settleRuntime();
  });

  it("requeues changed text and prevents stale translations from overwriting the new hash", async () => {
    const firstFetch = deferred<Response>();
    const secondFetch = deferred<Response>();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? firstFetch.promise : secondFetch.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const runtime = new TranslationRuntime();
    document.body.innerHTML = `<p id="copy">Original English paragraph has enough words to translate.</p>`;

    await runtime.toggle({ provider: "openai", proxyUrl: "http://proxy.test" });
    await settleRuntime(40);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const copy = document.querySelector("#copy") as HTMLParagraphElement;
    copy.firstChild!.textContent = "Updated English paragraph has enough words to translate.";
    await settleRuntime();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    firstFetch.resolve(translationResponse((bodies[0] as ProxyRequest).segments, "OLD"));
    await settleRuntime();
    expect(copy.querySelector("[data-translate-bot-translation]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    secondFetch.resolve(translationResponse((bodies[1] as ProxyRequest).segments, "NEW"));
    await settleRuntime();

    expect(copy.querySelector("[data-translate-bot-translation]")?.textContent).toBe("NEW");
    expect((bodies[1] as ProxyRequest).segments[0]?.text).toBe("Updated English paragraph has enough words to translate.");
  });
});

class FakeIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

interface ProxyRequest {
  model?: string;
  segments: Array<{ id: string; text: string }>;
}

function createParagraph(id: string, text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.id = id;
  paragraph.textContent = text;
  return paragraph;
}

function mockTranslationFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    return translationResponse(requestSegments(init), "translated");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): ProxyRequest {
  return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body)) as ProxyRequest;
}

function requestSegments(init?: RequestInit): ProxyRequest["segments"] {
  return (JSON.parse(String(init?.body)) as ProxyRequest).segments;
}

function translationResponse(segments: ProxyRequest["segments"], prefix: string): Response {
  return new Response(JSON.stringify({
    segments: segments.map((segment) => ({
      id: segment.id,
      translation: prefix === "translated" ? `${prefix}:${segment.text}` : prefix
    }))
  }), { status: 200 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function settleRuntime(ms = 160): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
  await Promise.resolve();
}
