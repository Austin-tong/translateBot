import type { ContentMessage, StatusResponse } from "./messages.js";
import type { ExtensionSettings } from "./settings.js";

const WRAPPER_ATTR = "data-translate-bot-wrapper";
const ORIGINAL_ATTR = "data-translate-bot-original";
const TRANSLATION_ATTR = "data-translate-bot-translation";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "PRE", "CODE"]);

// 每个 SegmentRecord 对应页面里的一个原始文本节点和它旁边的译文节点。
interface SegmentRecord {
  id: string;
  text: string;
  textNode: Text;
  wrapper: HTMLSpanElement;
  translationSpan: HTMLSpanElement;
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
        const id = (entry.target as HTMLElement).dataset.translateBotId;
        if (id) this.enqueue(id);
        this.intersectionObserver?.unobserve(entry.target);
      }
      this.processQueueSoon();
    }, { rootMargin: "600px 0px" });

    // SPA 或无限滚动页面新增内容时继续发现文本节点。
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.discover(node as Element);
          if (node.nodeType === Node.TEXT_NODE) this.discoverTextNode(node as Text);
        }
      }
      this.processQueueSoon();
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  private discover(root: Element | null): void {
    if (!root || !this.enabled) return;
    if (shouldSkipElement(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => isEligibleTextNode(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });

    // 先收集再包装，避免 TreeWalker 遍历时 DOM 被改动导致跳过后续文本。
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }
    for (const textNode of textNodes) this.discoverTextNode(textNode);
  }

  private discoverTextNode(textNode: Text): void {
    if (!this.enabled || !isEligibleTextNode(textNode)) return;
    const text = normalizeText(textNode.data);
    if (shouldSkipText(text)) return;

    const record = wrapTextNode(textNode, `tb-${++this.sequence}`, text);
    this.records.set(record.id, record);

    if (this.cache.has(record.hash)) {
      applyTranslation(record, this.cache.get(record.hash) ?? "");
      record.status = "done";
      this.translated += 1;
      return;
    }

    // near viewport 的文本优先翻译；远处文本交给 IntersectionObserver 后续触发。
    if (isElementNearViewport(record.wrapper)) {
      this.enqueue(record.id);
    } else {
      this.intersectionObserver?.observe(record.wrapper);
    }
  }

  private enqueue(id: string): void {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return;
    record.status = "queued";
    this.queue.push(id);
  }

  private processQueueSoon(): void {
    if (!this.enabled || this.processTimer) return;
    this.processTimer = window.setTimeout(() => {
      this.processTimer = undefined;
      void this.processQueue();
    }, 50);
  }

  private async processQueue(): Promise<void> {
    if (!this.enabled || !this.settings) return;
    while (this.enabled && this.activeBatches < 2 && this.queue.length > 0) {
      const ids = this.queue.splice(0, 8);
      const records = ids.map((id) => this.records.get(id)).filter((record): record is SegmentRecord => Boolean(record));
      for (const record of records) record.status = "translating";
      this.activeBatches += 1;
      const batchRunId = this.runId;
      // 批次异步执行，finally 中用 runId 确认仍属于当前启用周期。
      void this.translateBatch(records, batchRunId).finally(() => {
        if (this.runId !== batchRunId) return;
        this.activeBatches -= 1;
        if (this.queue.length > 0) this.processQueueSoon();
      });
    }
  }

  private async translateBatch(records: SegmentRecord[], batchRunId: number): Promise<void> {
    if (!this.settings || records.length === 0) return;
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
            contextBefore: getSiblingText(record.wrapper, "previousSibling"),
            contextAfter: getSiblingText(record.wrapper, "nextSibling")
          }))
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Proxy returned ${response.status}: ${body.slice(0, 180)}`);
      }

      const payload = (await response.json()) as TranslateProxyResponse;
      if (!this.enabled || this.runId !== batchRunId) return;
      const byId = new Map(payload.segments.map((segment) => [segment.id, segment.translation]));
      for (const record of records) {
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
      for (const record of records) markRecordError(record, this.error);
    }
  }
}

export function isEligibleTextNode(textNode: Text): boolean {
  const parent = textNode.parentElement;
  if (!parent) return false;
  if (parent.closest(`[${WRAPPER_ATTR}]`)) return false;
  if (shouldSkipElement(parent)) return false;
  if (isEditable(parent)) return false;
  const text = normalizeText(textNode.data);
  if (text.length < 2) return false;
  if (!/[A-Za-z0-9\u00C0-\uFFFF]/.test(text)) return false;
  return true;
}

export function shouldSkipText(text: string): boolean {
  if (!text || text.length < 2) return true;
  if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*_+=|/\\-]+$/.test(text)) return true;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // 粗略跳过已经是中文的文本；保留中英混排内容给模型处理。
  return cjk / Math.max(text.length, 1) > 0.55 && latin / Math.max(text.length, 1) < 0.08;
}

export function wrapTextNode(textNode: Text, id: string, text = normalizeText(textNode.data)): SegmentRecord {
  const parent = textNode.parentElement;
  if (!parent) throw new Error("Cannot wrap a detached text node.");

  const wrapper = document.createElement("span");
  wrapper.setAttribute(WRAPPER_ATTR, "true");
  wrapper.dataset.translateBotId = id;

  const originalSpan = document.createElement("span");
  originalSpan.setAttribute(ORIGINAL_ATTR, "true");

  const translationSpan = document.createElement("span");
  translationSpan.setAttribute(TRANSLATION_ATTR, "true");
  translationSpan.hidden = true;
  // 译文继承原容器的核心文字样式，让原文和译文看起来属于同一块内容。
  copyTextStyle(parent, translationSpan);
  if (shouldUseBlockTranslation(parent, text)) {
    translationSpan.style.display = "block";
    translationSpan.style.marginTop = "0.15em";
  } else {
    translationSpan.style.marginLeft = "0.35em";
  }

  parent.insertBefore(wrapper, textNode);
  // 原始 Text 节点被移动到 originalSpan，关闭翻译时再原样放回父节点。
  originalSpan.append(textNode);
  wrapper.append(originalSpan, translationSpan);

  return {
    id,
    text,
    textNode,
    wrapper,
    translationSpan,
    status: "pending",
    hash: hashText(text)
  };
}

export function restoreRecord(record: SegmentRecord): void {
  if (!record.wrapper.parentNode) return;
  record.wrapper.parentNode.insertBefore(record.textNode, record.wrapper);
  record.wrapper.remove();
}

export function applyTranslation(record: SegmentRecord, translation: string): void {
  record.translationSpan.textContent = translation;
  record.translationSpan.hidden = false;
  record.translationSpan.removeAttribute("title");
}

function markRecordError(record: SegmentRecord, message: string): void {
  record.status = "error";
  record.translationSpan.textContent = "Translation unavailable";
  record.translationSpan.title = message;
  record.translationSpan.hidden = false;
}

function shouldSkipElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.closest(`[${WRAPPER_ATTR}]`)) return true;
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shouldUseBlockTranslation(parent: Element, text: string): boolean {
  const display = window.getComputedStyle(parent).display;
  const blockLike = !display.startsWith("inline") && display !== "contents";
  return blockLike && (text.length > 60 || parent.childNodes.length <= 2);
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
  const margin = 600;
  return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
}

function getSiblingText(element: Element, key: "previousSibling" | "nextSibling"): string {
  const sibling = element[key];
  const text = sibling?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.slice(0, 240);
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
