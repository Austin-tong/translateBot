import type { ContentMessage, StatusResponse } from "./messages.js";
import type { ExtensionSettings } from "./settings.js";

const RECORD_ATTR = "data-translate-bot-id";
const TRANSLATION_ATTR = "data-translate-bot-translation";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "PRE", "CODE", "BUTTON"]);
const BLOCK_TRANSLATION_TAGS = new Set(["P", "LI", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "SUMMARY", "H1", "H2", "H3", "H4", "H5", "H6"]);
const CONTAINER_TAGS = new Set(["ARTICLE", "ASIDE", "BODY", "FOOTER", "FORM", "HEADER", "MAIN", "NAV", "OL", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
const STRUCTURAL_CHILD_TAGS = new Set([...BLOCK_TRANSLATION_TAGS, ...CONTAINER_TAGS, "DIV"]);
const BATCH_SIZE = 40;
const NEAR_VIEWPORT_MARGIN = 900;

export interface SegmentRecord {
  id: string;
  text: string;
  element: HTMLElement;
  translationElement?: HTMLSpanElement;
  status: "pending" | "queued" | "translating" | "done" | "error";
  hash: string;
}

interface TranslateProxyResponse {
  segments: Array<{ id: string; translation: string }>;
}

class TranslationRuntime {
  private enabled = false;
  private settings?: ExtensionSettings;
  private readonly records = new Map<string, SegmentRecord>();
  private readonly cache = new Map<string, string>();
  private queue: string[] = [];
  private translated = 0;
  private activeBatches = 0;
  private sequence = 0;
  // 每次启用/关闭都会推进 runId，避免旧的异步翻译请求在关闭后继续回写 DOM。
  private runId = 0;
  private error?: string;
  private intersectionObserver?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private processTimer?: number;
  private discoverTimer?: number;

  async toggle(settings: ExtensionSettings): Promise<StatusResponse> {
    if (this.enabled) {
      this.disable();
      return this.status();
    }

    this.enabled = true;
    this.settings = settings;
    this.error = undefined;
    this.runId += 1;
    this.installObservers();
    this.discover(document.body);
    this.processQueueSoon();
    return this.status();
  }

  status(): StatusResponse {
    return {
      enabled: this.enabled,
      pending: this.queue.length + [...this.records.values()].filter((record) => record.status === "pending" || record.status === "translating").length,
      translated: this.translated,
      error: this.error
    };
  }

  disable(): void {
    this.enabled = false;
    this.settings = undefined;
    this.queue = [];
    this.activeBatches = 0;
    this.runId += 1;
    this.error = undefined;
    if (this.processTimer) window.clearTimeout(this.processTimer);
    if (this.discoverTimer) window.clearTimeout(this.discoverTimer);
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.mutationObserver = undefined;

    for (const record of [...this.records.values()].reverse()) {
      restoreRecord(record);
    }
    this.records.clear();
  }

  private installObservers(): void {
    // 视口外文本先不翻译，滚动接近后再入队，减少长页面的首屏等待。
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).getAttribute(RECORD_ATTR);
        if (id) this.enqueue(id);
        this.intersectionObserver?.unobserve(entry.target);
      }
      this.processQueueSoon();
    }, { rootMargin: `${NEAR_VIEWPORT_MARGIN}px 0px` });

    // SPA 或无限滚动页面新增/改写内容时，重新发现局部文本容器。
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      const roots = new Set<Element>();

      for (const mutation of mutations) {
        if (isTranslationMutation(mutation)) continue;

        if (mutation.type === "characterData") {
          const parent = mutation.target.parentElement;
          if (parent) this.refreshNearestRecord(parent) || roots.add(parent);
          continue;
        }

        const targetElement = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (targetElement) this.refreshNearestRecord(targetElement);

        for (const node of mutation.addedNodes) {
          if (isTranslationNode(node)) continue;
          if (node.nodeType === Node.ELEMENT_NODE) roots.add(node as Element);
          if (node.nodeType === Node.TEXT_NODE && node.parentElement) roots.add(node.parentElement);
        }
      }

      for (const root of roots) this.discoverSoon(root);
      this.processQueueSoon();
    });
    this.mutationObserver.observe(document.body, { characterData: true, childList: true, subtree: true });
  }

  private discoverSoon(root: Element): void {
    if (!this.enabled) return;
    if (this.discoverTimer) window.clearTimeout(this.discoverTimer);
    this.discoverTimer = window.setTimeout(() => {
      this.discoverTimer = undefined;
      this.discover(root);
      this.processQueueSoon();
    }, 80);
  }

  private discover(root: Element | null): void {
    if (!root || !this.enabled) return;
    const candidates = collectCandidateElements(root);
    for (const element of candidates) this.discoverElement(element);
  }

  private discoverElement(element: HTMLElement): void {
    if (!this.enabled || element.hasAttribute(RECORD_ATTR)) return;
    const text = getSourceText(element);
    if (!isTranslatableText(text)) return;

    const record = createRecord(element, `tb-${++this.sequence}`, text);
    this.records.set(record.id, record);

    const cached = this.cache.get(record.hash);
    if (cached) {
      applyTranslation(record, cached);
      record.status = "done";
      this.translated += 1;
      return;
    }

    if (isElementNearViewport(record.element)) {
      this.enqueue(record.id);
    } else {
      this.intersectionObserver?.observe(record.element);
    }
  }

  private refreshNearestRecord(element: Element): boolean {
    const recordElement = element.closest(`[${RECORD_ATTR}]`) as HTMLElement | null;
    const id = recordElement?.getAttribute(RECORD_ATTR);
    const record = id ? this.records.get(id) : undefined;
    if (!record) return false;

    const text = getSourceText(record.element);
    const hash = hashText(text);
    if (!isTranslatableText(text) || hash === record.hash) return true;

    record.text = text;
    record.hash = hash;
    record.status = "pending";
    record.translationElement?.remove();
    record.translationElement = undefined;
    this.intersectionObserver?.unobserve(record.element);

    const cached = this.cache.get(hash);
    if (cached) {
      applyTranslation(record, cached);
      record.status = "done";
      this.translated += 1;
      return true;
    }

    if (isElementNearViewport(record.element)) this.enqueue(record.id);
    else this.intersectionObserver?.observe(record.element);
    return true;
  }

  private enqueue(id: string): void {
    const record = this.records.get(id);
    if (!record || record.status !== "pending" || this.queue.includes(id)) return;
    record.status = "queued";
    this.queue.push(id);
  }

  private processQueueSoon(): void {
    if (!this.enabled || this.processTimer) return;
    this.processTimer = window.setTimeout(() => {
      this.processTimer = undefined;
      void this.processQueue();
    }, 30);
  }

  private async processQueue(): Promise<void> {
    if (!this.enabled || !this.settings) return;
    const maxConcurrent = this.settings.provider === "lmstudio" ? 3 : 1;
    while (this.enabled && this.activeBatches < maxConcurrent && this.queue.length > 0) {
      const ids = this.queue.splice(0, BATCH_SIZE);
      const records = ids.map((id) => this.records.get(id)).filter((record): record is SegmentRecord => Boolean(record));
      for (const record of records) record.status = "translating";
      this.activeBatches += 1;
      const batchRunId = this.runId;
      // Codex CLI 启动开销高，所以按更大的元素批次翻译，避免全屏分成很多小请求。
      void this.translateBatch(records, batchRunId).finally(() => {
        if (this.runId !== batchRunId) return;
        this.activeBatches -= 1;
        if (this.queue.length > 0) this.processQueueSoon();
      });
    }
  }

  private async translateBatch(records: SegmentRecord[], batchRunId: number): Promise<void> {
    if (!this.settings || records.length === 0) return;
    const requestedHashes = new Map(records.map((record) => [record.id, record.hash]));
    const startedAt = performance.now();
    const modelLabel = this.settings.model ?? "default";
    console.info("[Translate Bot] request translation", {
      provider: this.settings.provider,
      model: modelLabel,
      segments: records.length,
      url: location.href
    });
    try {
      const response = await fetch(`${this.settings.proxyUrl}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: this.settings.provider,
          model: this.settings.model,
          targetLanguage: "zh-CN",
          page: {
            url: location.href,
            title: document.title,
            lang: document.documentElement.lang
          },
          segments: records.map((record) => ({
            id: record.id,
            text: record.text,
            // 给模型一点邻近文本，避免把网页片段当成孤立句子翻译。
            contextBefore: getSiblingText(record.element, "previousElementSibling"),
            contextAfter: getSiblingText(record.element, "nextElementSibling")
          }))
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Proxy returned ${response.status}: ${body.slice(0, 180)}`);
      }

      const payload = (await response.json()) as TranslateProxyResponse;
      if (!this.enabled || this.runId !== batchRunId) return;
      console.info("[Translate Bot] translation response", {
        provider: this.settings.provider,
        model: modelLabel,
        requested: records.length,
        received: payload.segments.length,
        durationMs: Math.round(performance.now() - startedAt)
      });
      const byId = new Map(payload.segments.map((segment) => [segment.id, segment.translation]));
      for (const record of records) {
        if (record.hash !== requestedHashes.get(record.id)) continue;
        const translation = byId.get(record.id);
        if (!translation) {
          markRecordError(record, "No translation returned.");
          continue;
        }
        applyTranslation(record, translation);
        record.status = "done";
        this.cache.set(record.hash, translation);
        this.translated += 1;
      }
    } catch (error) {
      if (!this.enabled || this.runId !== batchRunId) return;
      this.error = error instanceof Error ? error.message : "Translation failed.";
      console.error("[Translate Bot] translation failed", {
        provider: this.settings.provider,
        model: modelLabel,
        segments: records.length,
        error: this.error
      });
      for (const record of records) markRecordError(record, this.error);
    }
  }
}

export function collectCandidateElements(root: Element): HTMLElement[] {
  const raw: HTMLElement[] = [];
  const maybeRoot = root instanceof HTMLElement ? root : undefined;
  if (maybeRoot && isCandidateElement(maybeRoot)) raw.push(maybeRoot);

  const elements = root.querySelectorAll<HTMLElement>("p, li, dd, dt, blockquote, figcaption, summary, h1, h2, h3, h4, h5, h6, div");
  for (const element of elements) {
    if (isCandidateElement(element)) raw.push(element);
  }

  // 保留最深的文本容器，避免把整张卡片和内部段落重复翻译。
  return raw.filter((candidate) => !raw.some((other) => other !== candidate && candidate.contains(other)));
}

export function isCandidateElement(element: HTMLElement): boolean {
  if (element.hasAttribute(RECORD_ATTR) || element.closest(`[${TRANSLATION_ATTR}]`)) return false;
  const recordAncestor = element.closest(`[${RECORD_ATTR}]`);
  if (recordAncestor && recordAncestor !== element) return false;
  if (shouldSkipElement(element)) return false;
  const text = getSourceText(element);
  if (!isTranslatableText(text)) return false;
  if (BLOCK_TRANSLATION_TAGS.has(element.tagName)) return true;
  if (element.tagName !== "DIV") return false;
  if (CONTAINER_TAGS.has(element.tagName)) return false;
  if (text.length < 25) return false;
  return ![...element.children].some((child) => STRUCTURAL_CHILD_TAGS.has(child.tagName));
}

export function isTranslatableText(text: string): boolean {
  if (!text || text.length < 2) return false;
  if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*_+=|/\\-]+$/.test(text)) return false;
  if (!/[A-Za-z0-9\u00C0-\uFFFF]/.test(text)) return false;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // 粗略跳过已经是中文的文本；保留中英混排内容给模型处理。
  return !(cjk / Math.max(text.length, 1) > 0.55 && latin / Math.max(text.length, 1) < 0.08);
}

export function createRecord(element: HTMLElement, id: string, text = getSourceText(element)): SegmentRecord {
  element.setAttribute(RECORD_ATTR, id);
  return {
    id,
    text,
    element,
    status: "pending",
    hash: hashText(text)
  };
}

export function restoreRecord(record: SegmentRecord): void {
  record.translationElement?.remove();
  record.element.removeAttribute(RECORD_ATTR);
}

export function applyTranslation(record: SegmentRecord, translation: string): void {
  const translationElement = record.translationElement ?? document.createElement("span");
  translationElement.setAttribute(TRANSLATION_ATTR, "true");
  translationElement.textContent = translation;
  translationElement.hidden = false;
  translationElement.removeAttribute("title");
  copyTextStyle(record.element, translationElement);
  translationElement.style.display = "block";
  translationElement.style.marginTop = "0.2em";
  translationElement.style.whiteSpace = "pre-wrap";
  translationElement.style.overflowWrap = "break-word";
  if (!record.translationElement) record.element.append(translationElement);
  record.translationElement = translationElement;
}

function markRecordError(record: SegmentRecord, message: string): void {
  const translationElement = record.translationElement ?? document.createElement("span");
  translationElement.setAttribute(TRANSLATION_ATTR, "true");
  translationElement.textContent = "Translation unavailable";
  translationElement.title = message;
  translationElement.hidden = false;
  translationElement.style.display = "block";
  translationElement.style.marginTop = "0.2em";
  if (!record.translationElement) record.element.append(translationElement);
  record.translationElement = translationElement;
  record.status = "error";
}

function shouldSkipElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.closest(`[${TRANSLATION_ATTR}]`)) return true;
  if (element.closest("[aria-hidden='true'], [hidden]")) return true;
  const htmlElement = element as HTMLElement;
  if (isEditable(htmlElement)) return true;
  const style = window.getComputedStyle(htmlElement);
  return style.display === "none" || style.visibility === "hidden";
}

function isEditable(element: Element): boolean {
  const editable = element.closest("[contenteditable]");
  if (!editable) return false;
  return editable.getAttribute("contenteditable") !== "false";
}

function getSourceText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(`[${TRANSLATION_ATTR}]`).forEach((node) => node.remove());
  return normalizeText(clone.textContent ?? "");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function copyTextStyle(source: Element, target: HTMLElement): void {
  const style = window.getComputedStyle(source);
  target.style.fontFamily = style.fontFamily;
  target.style.fontSize = style.fontSize;
  target.style.fontStyle = style.fontStyle;
  target.style.fontWeight = style.fontWeight;
  target.style.lineHeight = style.lineHeight;
  target.style.letterSpacing = style.letterSpacing;
  target.style.color = style.color;
}

function isElementNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true;
  return rect.bottom >= -NEAR_VIEWPORT_MARGIN && rect.top <= window.innerHeight + NEAR_VIEWPORT_MARGIN;
}

function getSiblingText(element: Element, key: "previousElementSibling" | "nextElementSibling"): string {
  const sibling = element[key];
  const text = sibling?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.slice(0, 240);
}

function isTranslationNode(node: Node): boolean {
  return node instanceof Element && (node.hasAttribute(TRANSLATION_ATTR) || Boolean(node.closest(`[${TRANSLATION_ATTR}]`)));
}

function isTranslationMutation(mutation: MutationRecord): boolean {
  if (isTranslationNode(mutation.target)) return true;
  return [...mutation.addedNodes, ...mutation.removedNodes].some(isTranslationNode);
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return String(hash >>> 0);
}

const runtime = new TranslationRuntime();

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "TRANSLATE_TOGGLE") {
      void runtime.toggle(message.settings).then(sendResponse);
      return true;
    }
    if (message.type === "TRANSLATE_STATUS") {
      sendResponse(runtime.status());
    }
    return false;
  });
}
