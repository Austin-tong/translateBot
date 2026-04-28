import type { ContentMessage, StatusResponse } from "./messages.js";
import type { ExtensionSettings } from "./settings.js";

const RECORD_ATTR = "data-translate-bot-id";
const TRANSLATION_ATTR = "data-translate-bot-translation";
const TRANSLATION_STATE_ATTR = "data-translate-bot-state";
const TRANSLATION_UI_STYLE_ID = "translate-bot-ui-style";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "PRE", "CODE", "BUTTON"]);
const SKIP_ANCESTOR_SELECTOR = "form";
const UI_LABEL_ANCESTOR_SELECTOR = "button, nav, [role='button'], [role='navigation'], [role='menuitem'], [role='tab']";
const UI_LABEL_TAGS = new Set(["SPAN", "A", "BUTTON"]);
const BLOCK_TRANSLATION_TAGS = new Set(["P", "LI", "DD", "DT", "BLOCKQUOTE", "FIGCAPTION", "SUMMARY", "H1", "H2", "H3", "H4", "H5", "H6"]);
const CONTAINER_TAGS = new Set(["ARTICLE", "ASIDE", "BODY", "FOOTER", "FORM", "HEADER", "MAIN", "NAV", "OL", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
const VIEWPORT_ANCHOR_SELECTOR = `[${RECORD_ATTR}], p, li, dd, dt, blockquote, figcaption, summary, h1, h2, h3, h4, h5, h6, div, article, section, span, a, img, video, canvas, [role='img']`;
const GENERIC_TEXT_CONTAINER_TAGS = new Set(["DIV", "ARTICLE", "SECTION"]);
const STRUCTURAL_CHILD_TAGS = new Set([...BLOCK_TRANSLATION_TAGS, ...CONTAINER_TAGS, "DIV"]);
const INLINE_TEXT_CHILD_TAGS = new Set(["A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "DEL", "DFN", "EM", "I", "INS", "KBD", "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR"]);
const INTERACTIVE_DESCENDANT_SELECTOR = "button, [role='button'], form, nav, [role='navigation'], input, textarea, select";
// X/Twitter 正文里常见“@grok + 英文正文”，单独 @handle 不翻译，但带上下文的整段需要翻译。
const MENTION_RE = /(^|[\s([{"'“‘])@[A-Za-z0-9_]{1,30}\b/;
const OPENAI_BATCH_SIZE = 40;
const LMSTUDIO_BATCH_SIZE = 40;
const OLLAMA_BATCH_SIZE = 8;
const NEAR_VIEWPORT_MARGIN = 900;
const LOG_PREFIX = "[Translate Bot]";
const CACHE_STORAGE_KEY = "translateBot.translationCache.v1";
const CACHE_VERSION = 1;
const CACHE_MAX_ENTRIES = 2000;
const CACHE_MAX_TEXT_LENGTH = 3000;
const SVG_NS = "http://www.w3.org/2000/svg";
// Bootstrap Icons arrow-clockwise, MIT: https://icons.getbootstrap.com/icons/arrow-clockwise/
const REFRESH_ICON_PATHS = [
  "M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z",
  "M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"
];

interface StoredTranslationCacheEntry {
  translation: string;
  createdAt: number;
  lastUsed: number;
}

interface StoredTranslationCache {
  version: number;
  entries: Record<string, StoredTranslationCacheEntry>;
}

/** content script 记录的翻译块：原文、译文、DOM 节点和当前状态都挂在这里。 */
export interface SegmentRecord {
  id: string;
  text: string;
  element: HTMLElement;
  translationElement?: HTMLSpanElement;
  status: "pending" | "queued" | "translating" | "done" | "error";
  hash: string;
  layout: "block" | "inline";
  onRefresh?: () => void;
}

interface TranslateProxyResponse {
  segments: Array<{ id: string; translation: string }>;
}

interface CandidateDecision {
  ok: boolean;
  reason: string;
  text: string;
}

interface ViewportAnchor {
  element: HTMLElement;
  topOffsetFromCenter: number;
}

export function hasDuplicateTextBlockConflict(
  element: HTMLElement,
  hash: string,
  records: Iterable<SegmentRecord>,
  currentRecordId?: string
): boolean {
  // 同一语义块可能在不同层级被发现两次，例如外层标题和内层 Draft 容器。
  // 只要文本 hash 一样，并且 DOM 上有祖先/后代/同级重叠，就视为同一块，避免重复翻译。
  for (const record of records) {
    if (record.hash !== hash) continue;
    if (!record.element.isConnected) continue;
    if (currentRecordId && record.id === currentRecordId) continue;
    if (record.element === element) return true;
    if (record.element.parentElement === element.parentElement) return true;
    if (record.element.contains(element) || element.contains(record.element)) return true;
  }

  return false;
}

/**
 * 页面内翻译运行时。
 * 负责发现候选文本、排队翻译、缓存结果，以及在内容变更时把旧记录恢复或重译。
 */
export class TranslationRuntime {
  private enabled = false;
  private settings?: ExtensionSettings;
  private readonly records = new Map<string, SegmentRecord>();
  private readonly cache = new Map<string, string>();
  private readonly persistentCacheMeta = new Map<string, StoredTranslationCacheEntry>();
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
  private persistTimer?: number;
  private readonly pendingDiscoveryRoots = new Set<Element>();

  async toggle(settings: ExtensionSettings): Promise<StatusResponse> {
    if (this.enabled) {
      console.info(`${LOG_PREFIX} disable translation`, this.settings ? settingsLogPayload(this.settings) : undefined);
      this.disable();
      return this.status();
    }

    this.enabled = true;
    this.settings = settings;
    console.info(`${LOG_PREFIX} enable translation`, settingsLogPayload(settings));
    this.error = undefined;
    this.runId += 1;
    await this.loadPersistentCache();
    if (!this.enabled) return this.status();
    this.installObservers();
    this.discover(document.body);
    this.processQueueSoon();
    return this.status();
  }

  updateSettings(settings: ExtensionSettings): StatusResponse {
    if (this.enabled) {
      console.info(`${LOG_PREFIX} update settings`, {
        from: this.settings ? settingsLogPayload(this.settings) : undefined,
        to: settingsLogPayload(settings)
      });
      this.settings = settings;
      this.processQueueSoon();
    } else {
      console.info(`${LOG_PREFIX} settings update received while disabled`, settingsLogPayload(settings));
    }
    return this.status();
  }

  status(): StatusResponse {
    return {
      enabled: this.enabled,
      pending: this.queue.length + [...this.records.values()].filter((record) => record.status === "pending" || record.status === "translating").length,
      translated: this.translated,
      provider: this.settings?.provider,
      model: this.settings?.model ?? "default",
      error: this.error
    };
  }

  disable(): void {
    const anchor = captureViewportAnchor();
    this.enabled = false;
    this.settings = undefined;
    this.queue = [];
    this.activeBatches = 0;
    this.runId += 1;
    this.error = undefined;
    if (this.processTimer) window.clearTimeout(this.processTimer);
    if (this.discoverTimer) window.clearTimeout(this.discoverTimer);
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      void this.flushPersistentCache();
    }
    this.pendingDiscoveryRoots.clear();
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.mutationObserver = undefined;

    for (const record of [...this.records.values()].reverse()) {
      restoreRecord(record);
    }
    this.records.clear();
    restoreViewportAnchor(anchor);
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
          if (parent && !this.refreshNearestRecord(parent)) roots.add(parent);
          continue;
        }

        const targetElement = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (targetElement && !this.refreshNearestRecord(targetElement)) roots.add(targetElement);

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
    this.pendingDiscoveryRoots.add(root);
    if (this.discoverTimer) return;
    this.discoverTimer = window.setTimeout(() => {
      this.discoverTimer = undefined;
      const roots = [...this.pendingDiscoveryRoots];
      this.pendingDiscoveryRoots.clear();
      for (const pendingRoot of roots) this.discover(pendingRoot);
      this.processQueueSoon();
    }, 80);
  }

  private discover(root: Element | null): void {
    if (!root || !this.enabled) return;
    const candidates = collectCandidateElements(root);
    if (candidates.length > 0) {
      logDebug("discovery candidates", {
        root: describeElement(root),
        count: candidates.length,
        candidates: candidates.slice(0, 8).map((element) => describeElement(element))
      });
    }
    for (const element of candidates) this.discoverElement(element);
  }

  private discoverElement(element: HTMLElement): void {
    if (!this.enabled || element.hasAttribute(RECORD_ATTR)) return;
    const text = getSourceText(element);
    if (!isTranslatableText(text)) return;
    const hash = cacheKeyForText(text);
    if (this.isDuplicateSiblingCandidate(element, hash)) {
      logDebug("duplicate candidate skipped", {
        element: describeElement(element),
        text: previewText(text)
      });
      return;
    }

    const record = createRecord(element, `tb-${++this.sequence}`, text);
    record.onRefresh = () => {
      this.refreshRecord(record.id);
    };
    this.records.set(record.id, record);

    const cached = this.cache.get(hash);
    if (cached) {
      mutatePreservingViewportCenter(() => applyTranslation(record, cached));
      record.status = "done";
      this.translated += 1;
      this.touchCache(hash);
      logDebug("record cache hit", recordLogPayload(record));
      return;
    }

    if (isElementNearViewport(record.element)) {
      logDebug("record queued", recordLogPayload(record));
      this.enqueue(record.id);
    } else {
      logDebug("record observed", recordLogPayload(record));
      this.intersectionObserver?.observe(record.element);
    }
  }

  private isDuplicateSiblingCandidate(element: HTMLElement, hash: string, currentRecordId?: string): boolean {
    return hasDuplicateTextBlockConflict(element, hash, this.records.values(), currentRecordId);
  }

  private refreshNearestRecord(element: Element): boolean {
    const recordElement = element.closest(`[${RECORD_ATTR}]`) as HTMLElement | null;
    const id = recordElement?.getAttribute(RECORD_ATTR);
    const record = id ? this.records.get(id) : undefined;
    if (!record) return false;

    const text = getSourceText(record.element);
    const hash = cacheKeyForText(text);
    if (hash === record.hash) return true;
    if (!isTranslatableText(text)) {
      this.queue = this.queue.filter((queuedId) => queuedId !== record.id);
      this.intersectionObserver?.unobserve(record.element);
      mutatePreservingViewportCenter(() => restoreRecord(record));
      this.records.delete(record.id);
      return true;
    }

    record.text = text;
    record.hash = hash;
    if (this.isDuplicateSiblingCandidate(record.element, hash, record.id)) {
      this.queue = this.queue.filter((queuedId) => queuedId !== record.id);
      this.intersectionObserver?.unobserve(record.element);
      mutatePreservingViewportCenter(() => restoreRecord(record));
      this.records.delete(record.id);
      return true;
    }
    record.status = "pending";
    mutatePreservingViewportCenter(() => {
      record.translationElement?.remove();
      record.translationElement = undefined;
    });
    this.intersectionObserver?.unobserve(record.element);

    const cached = this.cache.get(hash);
    if (cached) {
      mutatePreservingViewportCenter(() => applyTranslation(record, cached));
      record.status = "done";
      this.translated += 1;
      this.touchCache(hash);
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
    mutatePreservingViewportCenter(() => applyLoading(record));
    this.queue.push(id);
  }

  private refreshRecord(id: string): void {
    if (!this.enabled) return;
    const record = this.records.get(id);
    if (!record || record.status === "queued" || record.status === "translating") return;

    const text = getSourceText(record.element);
    if (!isTranslatableText(text)) {
      this.queue = this.queue.filter((queuedId) => queuedId !== record.id);
      this.intersectionObserver?.unobserve(record.element);
      mutatePreservingViewportCenter(() => restoreRecord(record));
      this.records.delete(record.id);
      return;
    }

    record.text = text;
    record.hash = cacheKeyForText(text);
    record.status = "pending";
    this.queue = this.queue.filter((queuedId) => queuedId !== record.id);
    this.intersectionObserver?.unobserve(record.element);
    this.enqueue(record.id);
    this.processQueueSoon();
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
    const maxConcurrent = maxConcurrentBatches(this.settings.provider);
    const batchSize = batchSizeForProvider(this.settings.provider);
    while (this.enabled && this.activeBatches < maxConcurrent && this.queue.length > 0) {
      const ids = this.queue.splice(0, batchSize);
      const records = ids.map((id) => this.records.get(id)).filter((record): record is SegmentRecord => Boolean(record));
      for (const record of records) record.status = "translating";
      this.activeBatches += 1;
      const batchRunId = this.runId;
      // Ollama 小模型对大 JSON 批次很敏感；OpenAI 保持大批次，本地小模型用小批次提高稳定性。
      void this.translateBatch(records, batchRunId).finally(() => {
        if (this.runId !== batchRunId) return;
        this.activeBatches -= 1;
        if (this.queue.length > 0) this.processQueueSoon();
      });
    }
  }

  private async translateBatch(records: SegmentRecord[], batchRunId: number): Promise<void> {
    const settings = this.settings;
    if (!settings || records.length === 0) return;
    const requestedHashes = new Map(records.map((record) => [record.id, record.hash]));
    const startedAt = performance.now();
    const modelLabel = settings.model ?? "default";
    console.info(`${LOG_PREFIX} request translation`, {
      provider: settings.provider,
      model: modelLabel,
      segments: records.length,
      batchSize: batchSizeForProvider(settings.provider),
      maxConcurrent: maxConcurrentBatches(settings.provider),
      ids: records.map((record) => record.id),
      sample: records.slice(0, 4).map((record) => recordLogPayload(record)),
      url: location.href
    });
    try {
      const payload = await this.requestTranslationsWithRetry(records, settings);
      if (!this.enabled || this.runId !== batchRunId) return;
      console.info(`${LOG_PREFIX} translation response`, {
        provider: settings.provider,
        model: modelLabel,
        requested: records.length,
        received: payload.segments.length,
        receivedIds: payload.segments.slice(0, 12).map((segment) => segment.id),
        durationMs: Math.round(performance.now() - startedAt)
      });
      const byId = new Map(payload.segments.map((segment) => [segment.id, segment.translation]));
      mutatePreservingViewportCenter(() => {
        for (const record of records) {
          if (record.hash !== requestedHashes.get(record.id)) continue;
          const translation = byId.get(record.id);
          if (!translation) {
            markRecordError(record, "No translation returned.");
            continue;
          }
          applyTranslation(record, translation);
          record.status = "done";
          this.rememberTranslation(record.hash, record.text, translation);
          this.translated += 1;
        }
      });
    } catch (error) {
      if (!this.enabled || this.runId !== batchRunId) return;
      this.error = error instanceof Error ? error.message : "Translation failed.";
      console.error(`${LOG_PREFIX} translation failed`, {
        provider: settings.provider,
        model: modelLabel,
        segments: records.length,
        ids: records.map((record) => record.id),
        error: this.error
      });
      mutatePreservingViewportCenter(() => {
        for (const record of records) markRecordError(record, this.error);
      });
    }
  }

  private async requestTranslationsWithRetry(records: SegmentRecord[], settings: ExtensionSettings): Promise<TranslateProxyResponse> {
    try {
      return await this.requestTranslations(records, settings);
    } catch (error) {
      if (settings.provider !== "ollama" || records.length <= 1) throw error;

      const midpoint = Math.ceil(records.length / 2);
      const left = records.slice(0, midpoint);
      const right = records.slice(midpoint);
      console.warn(`${LOG_PREFIX} ollama batch failed; retrying with smaller batches`, {
        provider: settings.provider,
        model: settings.model ?? "default",
        segments: records.length,
        split: [left.length, right.length],
        error: formatError(error)
      });
      const leftPayload = await this.requestTranslationsWithRetry(left, settings);
      const rightPayload = await this.requestTranslationsWithRetry(right, settings);
      return {
        segments: [...leftPayload.segments, ...rightPayload.segments]
      };
    }
  }

  private async requestTranslations(records: SegmentRecord[], settings: ExtensionSettings): Promise<TranslateProxyResponse> {
    const response = await fetch(`${settings.proxyUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: settings.provider,
        model: settings.model,
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

    return (await response.json()) as TranslateProxyResponse;
  }

  private async loadPersistentCache(): Promise<void> {
    if (!hasChromeLocalStorage()) return;
    try {
      const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
      const cache = parseStoredCache(stored[CACHE_STORAGE_KEY]);
      if (!cache) return;
      let loaded = 0;
      for (const [key, entry] of Object.entries(cache.entries)) {
        if (!isStoredCacheEntry(entry)) continue;
        this.cache.set(key, entry.translation);
        this.persistentCacheMeta.set(key, entry);
        loaded += 1;
      }
      if (loaded > 0) logDebug("persistent cache loaded", { entries: loaded });
    } catch (error) {
      console.warn(`${LOG_PREFIX} persistent cache load failed`, formatError(error));
    }
  }

  private rememberTranslation(key: string, text: string, translation: string): void {
    this.cache.set(key, translation);
    if (!isPersistentCacheableText(text)) return;
    const now = Date.now();
    this.persistentCacheMeta.set(key, {
      translation,
      createdAt: this.persistentCacheMeta.get(key)?.createdAt ?? now,
      lastUsed: now
    });
    this.trimPersistentCache();
    this.schedulePersistentCacheFlush();
  }

  private touchCache(key: string): void {
    const meta = this.persistentCacheMeta.get(key);
    if (!meta) return;
    meta.lastUsed = Date.now();
    this.schedulePersistentCacheFlush();
  }

  private schedulePersistentCacheFlush(): void {
    if (!hasChromeLocalStorage() || this.persistTimer) return;
    // 命中缓存时只做延迟合并写入，避免滚动页面时频繁写 chrome.storage。
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      void this.flushPersistentCache();
    }, 800);
  }

  private async flushPersistentCache(): Promise<void> {
    if (!hasChromeLocalStorage()) return;
    try {
      this.trimPersistentCache();
      const entries = Object.fromEntries(this.persistentCacheMeta.entries());
      await chrome.storage.local.set({
        [CACHE_STORAGE_KEY]: {
          version: CACHE_VERSION,
          entries
        } satisfies StoredTranslationCache
      });
      logDebug("persistent cache saved", { entries: this.persistentCacheMeta.size });
    } catch (error) {
      console.warn(`${LOG_PREFIX} persistent cache save failed`, formatError(error));
    }
  }

  private trimPersistentCache(): void {
    if (this.persistentCacheMeta.size <= CACHE_MAX_ENTRIES) return;
    const sorted = [...this.persistentCacheMeta.entries()].sort(([, left], [, right]) => left.lastUsed - right.lastUsed);
    for (const [key] of sorted.slice(0, this.persistentCacheMeta.size - CACHE_MAX_ENTRIES)) {
      this.persistentCacheMeta.delete(key);
    }
  }
}

/**
 * 在给定 root 下收集“值得翻译”的候选块。
 * 输入是一个 DOM 子树，输出是去重后的 HTMLElement 列表，保证只保留最深层、最适合做翻译的容器。
 */
export function collectCandidateElements(root: Element): HTMLElement[] {
  const raw: HTMLElement[] = [];
  const maybeRoot = root instanceof HTMLElement ? root : undefined;
  if (maybeRoot) {
    const decision = evaluateCandidateElement(maybeRoot);
    if (decision.ok) raw.push(maybeRoot);
    else logMentionSkip(maybeRoot, decision);
  }

  const elements = root.querySelectorAll<HTMLElement>("p, li, dd, dt, blockquote, figcaption, summary, h1, h2, h3, h4, h5, h6, div, article, section, span, a, button");
  for (const element of elements) {
    const decision = evaluateCandidateElement(element);
    if (decision.ok) raw.push(element);
    else logMentionSkip(element, decision);
  }

  // 保留最深的文本容器，避免把整张卡片和内部段落重复翻译。
  return raw.filter((candidate) => !raw.some((other) => other !== candidate && candidate.contains(other)));
}

/** 判断一个元素本身是不是可翻译候选，不负责做子树遍历。 */
export function isCandidateElement(element: HTMLElement): boolean {
  return evaluateCandidateElement(element).ok;
}

function evaluateCandidateElement(element: HTMLElement): CandidateDecision {
  if (element.hasAttribute(RECORD_ATTR) || element.closest(`[${TRANSLATION_ATTR}]`)) return { ok: false, reason: "already-translated", text: "" };
  const recordAncestor = element.closest(`[${RECORD_ATTR}]`);
  if (recordAncestor && recordAncestor !== element) return { ok: false, reason: "inside-record", text: "" };
  if (shouldSkipElement(element)) return { ok: false, reason: "skip-element", text: getSourceTextForLog(element) };
  if (isChineseLanguageElement(element)) return { ok: false, reason: "non-target-language", text: getSourceTextForLog(element) };
  const text = getSourceText(element);
  if (!isTranslatableText(text)) return { ok: false, reason: "not-translatable", text };
  if (isUiLabelElement(element, text)) return { ok: true, reason: "ui-label", text };
  if (element.closest(UI_LABEL_ANCESTOR_SELECTOR)) return { ok: false, reason: "ui-label-ancestor", text };
  if (BLOCK_TRANSLATION_TAGS.has(element.tagName)) return { ok: true, reason: "block", text };
  if (!GENERIC_TEXT_CONTAINER_TAGS.has(element.tagName)) return { ok: false, reason: "unsupported-tag", text };
  if (CONTAINER_TAGS.has(element.tagName) && element.tagName !== "ARTICLE" && element.tagName !== "SECTION") return { ok: false, reason: "structural-container", text };
  if (element.querySelector(INTERACTIVE_DESCENDANT_SELECTOR)) return { ok: false, reason: "interactive-descendant", text };
  if (isLikelyTextRoot(element, text)) return { ok: true, reason: "text-root", text };
  if (text.length < 25) return { ok: false, reason: "short-generic", text };
  if ([...element.children].some((child) => isBlockingStructuralChild(child as HTMLElement))) return { ok: false, reason: "structural-child", text };
  return { ok: true, reason: "generic", text };
}

/** 只做粗筛：判断一段文本是否值得交给翻译模型处理。 */
export function isTranslatableText(text: string): boolean {
  if (!text || text.length < 2) return false;
  if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*_+=|/\\-]+$/.test(text)) return false;
  if (/^([@#][A-Za-z0-9_]+[\s.,:;!?-]*)+$/.test(text)) return false;
  if (!/[A-Za-z0-9\u00C0-\uFFFF]/.test(text)) return false;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  // 粗略跳过已经是中文的文本；保留中英混排内容给模型处理。
  return !(cjk / Math.max(text.length, 1) > 0.55 && latin / Math.max(text.length, 1) < 0.08);
}

/** 把一个 DOM 元素包装成可追踪的翻译记录，并写上数据属性用于后续恢复。 */
export function createRecord(element: HTMLElement, id: string, text = getSourceText(element)): SegmentRecord {
  element.setAttribute(RECORD_ATTR, id);
  return {
    id,
    text,
    element,
    status: "pending",
    hash: cacheKeyForText(text),
    layout: isUiLabelElement(element, text) ? "inline" : "block"
  };
}

/** 关闭翻译后恢复原始 DOM 结构，并清掉记录标记。 */
export function restoreRecord(record: SegmentRecord): void {
  record.translationElement?.remove();
  record.element.removeAttribute(RECORD_ATTR);
}

/** 把翻译文本写回页面，同时按块类型决定是 block 还是 inline 展示。 */
export function applyTranslation(record: SegmentRecord, translation: string): void {
  const translationElement = prepareTranslationElement(record);
  translationElement.setAttribute(TRANSLATION_STATE_ATTR, "done");
  translationElement.removeAttribute("aria-label");
  translationElement.removeAttribute("title");
  const nodes: Node[] = [document.createTextNode(translation)];
  const refreshButton = createRefreshButton(record);
  if (refreshButton) nodes.push(document.createTextNode(" "), refreshButton);
  translationElement.replaceChildren(...nodes);
}

/** 在目标块里显示“翻译中”占位，避免用户误以为页面卡住。 */
export function applyLoading(record: SegmentRecord): void {
  const translationElement = prepareTranslationElement(record);
  translationElement.setAttribute(TRANSLATION_STATE_ATTR, "loading");
  translationElement.setAttribute("aria-label", "Translating");
  translationElement.removeAttribute("title");
  const spinner = createRefreshIcon();
  spinner.setAttribute("data-translate-bot-loading-spinner", "true");
  spinner.setAttribute("aria-hidden", "true");
  translationElement.replaceChildren(spinner);
}

function markRecordError(record: SegmentRecord, message: string): void {
  const translationElement = prepareTranslationElement(record);
  translationElement.setAttribute(TRANSLATION_STATE_ATTR, "error");
  translationElement.removeAttribute("aria-label");
  translationElement.replaceChildren(document.createTextNode("Translation unavailable"));
  translationElement.title = message;
  record.status = "error";
}

function prepareTranslationElement(record: SegmentRecord): HTMLSpanElement {
  ensureTranslationUiStyle();
  const translationElement = record.translationElement ?? document.createElement("span");
  translationElement.setAttribute(TRANSLATION_ATTR, "true");
  if (record.status !== "queued" && record.status !== "translating") translationElement.removeAttribute("aria-label");
  translationElement.hidden = false;
  copyTextStyle(record.element, translationElement);
  if (record.layout === "inline") {
    translationElement.style.display = "inline";
    translationElement.style.marginLeft = "0.35em";
    translationElement.style.marginTop = "0";
    translationElement.style.whiteSpace = "normal";
  } else {
    translationElement.style.display = "block";
    translationElement.style.marginLeft = "";
    translationElement.style.marginTop = "0.2em";
    translationElement.style.whiteSpace = "pre-wrap";
  }
  translationElement.style.overflowWrap = "break-word";
  translationElement.style.setProperty("overflow-anchor", "none");
  if (!record.translationElement) record.element.append(translationElement);
  record.translationElement = translationElement;
  return translationElement;
}

function createRefreshButton(record: SegmentRecord): HTMLButtonElement | undefined {
  if (!record.onRefresh) return undefined;
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Retranslate this block";
  button.ariaLabel = "Retranslate this block";
  button.setAttribute("data-translate-bot-refresh", "true");
  button.append(createRefreshIcon());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    record.onRefresh?.();
  });
  return button;
}

function createRefreshIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("data-translate-bot-refresh-icon", "true");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("focusable", "false");
  for (const pathData of REFRESH_ICON_PATHS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  }
  icon.firstElementChild?.setAttribute("fill-rule", "evenodd");
  return icon;
}

function ensureTranslationUiStyle(): void {
  if (document.getElementById(TRANSLATION_UI_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TRANSLATION_UI_STYLE_ID;
  style.textContent = `
@keyframes translate-bot-spin {
  to { transform: rotate(360deg); }
}
[${TRANSLATION_ATTR}] [data-translate-bot-loading-spinner="true"] {
  display: inline-block;
  width: 0.95em;
  height: 0.95em;
  vertical-align: -0.1em;
  animation: translate-bot-spin 0.8s linear infinite;
  opacity: 0.68;
}
[${TRANSLATION_ATTR}] [data-translate-bot-refresh="true"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35em;
  height: 1.35em;
  min-height: 1.35em;
  margin-left: 0.35em;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
  opacity: 0.7;
}
[${TRANSLATION_ATTR}] [data-translate-bot-refresh="true"]:hover {
  opacity: 0.95;
}
[${TRANSLATION_ATTR}] [data-translate-bot-refresh-icon="true"] {
  display: inline-block;
  width: 0.95em;
  height: 0.95em;
  opacity: 0.68;
}
@media (prefers-reduced-motion: reduce) {
  [${TRANSLATION_ATTR}] [data-translate-bot-loading-spinner="true"] {
    animation: none;
  }
}
`;
  (document.head ?? document.documentElement).append(style);
}

function batchSizeForProvider(provider: ExtensionSettings["provider"]): number {
  if (provider === "ollama") return OLLAMA_BATCH_SIZE;
  if (provider === "lmstudio") return LMSTUDIO_BATCH_SIZE;
  return OPENAI_BATCH_SIZE;
}

function maxConcurrentBatches(provider: ExtensionSettings["provider"]): number {
  if (provider === "openai") return 1;
  if (provider === "ollama") return 1;
  return 3;
}

function shouldSkipElement(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName) && !isPotentialUiLabelElement(element)) return true;
  const skippedAncestor = element.closest(SKIP_ANCESTOR_SELECTOR);
  if (skippedAncestor && skippedAncestor !== element) return true;
  if (element.closest(`[${TRANSLATION_ATTR}]`)) return true;
  if (element.closest("[aria-hidden='true'], [hidden]")) return true;
  const htmlElement = element as HTMLElement;
  if (isEditable(htmlElement)) return true;
  const style = window.getComputedStyle(htmlElement);
  return style.display === "none" || style.visibility === "hidden";
}

function isChineseLanguageElement(element: Element): boolean {
  const languageElement = element.closest("[lang]");
  const lang = languageElement?.getAttribute("lang")?.trim().toLowerCase().replace(/_/g, "-");
  if (!lang) return false;
  return lang.startsWith("zh");
}

function isPotentialUiLabelElement(element: Element): boolean {
  return UI_LABEL_TAGS.has(element.tagName) && Boolean(element.closest(UI_LABEL_ANCESTOR_SELECTOR));
}

function isUiLabelElement(element: HTMLElement, text = getSourceText(element)): boolean {
  if (!isPotentialUiLabelElement(element)) return false;
  if (text.length < 2 || text.length > 40) return false;
  if (/^[@#]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > 4) return false;
  if (element.children.length > 0) return false;
  return true;
}

function isLikelyTextRoot(element: HTMLElement, text: string): boolean {
  // X 的推文正文通常标记为 data-testid="tweetText"；优先把它作为整段处理，避免只看到 @handle。
  if (element.dataset.testid === "tweetText") return true;
  const hasTextDirection = element.getAttribute("dir") === "auto" || element.hasAttribute("lang");
  // 其他站点没有 testid 时，只放行“有语言/方向标记 + @mention + 真实英文词”的纯内联正文容器。
  if (hasTextDirection && hasMention(text) && hasEnoughWordsAroundMention(text) && hasOnlyInlineTextDescendants(element)) return true;
  return false;
}

function hasOnlyInlineTextDescendants(element: Element): boolean {
  return [...element.children].every((child) => INLINE_TEXT_CHILD_TAGS.has(child.tagName) && hasOnlyInlineTextDescendants(child));
}

function isBlockingStructuralChild(element: HTMLElement): boolean {
  if (!STRUCTURAL_CHILD_TAGS.has(element.tagName)) return false;
  if (element.tagName !== "DIV") return true;
  return !isInlineTextWrapper(element);
}

function isInlineTextWrapper(element: HTMLElement): boolean {
  if (shouldSkipElement(element)) return false;
  return [...element.children].every((child) => {
    if (INLINE_TEXT_CHILD_TAGS.has(child.tagName)) return hasOnlyInlineTextDescendants(child);
    if (child.tagName === "DIV") return isInlineTextWrapper(child as HTMLElement);
    return false;
  });
}

function hasMention(text: string): boolean {
  return MENTION_RE.test(text);
}

function hasEnoughWordsAroundMention(text: string): boolean {
  return text.replace(MENTION_RE, " ").split(/\s+/).filter((word) => /[A-Za-z]/.test(word)).length >= 2;
}

function isEditable(element: Element): boolean {
  const editable = element.closest("[contenteditable]");
  if (!editable) return false;
  return editable.getAttribute("contenteditable") !== "false";
}

function getSourceText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(`[${TRANSLATION_ATTR}]`).forEach((node) => node.remove());
  return normalizeSourceText(extractStructuredText(clone));
}

function getSourceTextForLog(element: Element): string {
  try {
    return getSourceText(element);
  } catch {
    return normalizeInlineText(element.textContent ?? "");
  }
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSourceText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractStructuredText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.matches(`[${TRANSLATION_ATTR}], script, style, noscript, svg, canvas`)) return "";
  if (node.tagName === "BR") return "\n";

  const childText = [...node.childNodes].map(extractStructuredText).join("");
  if (!childText) return "";
  if (node.tagName === "LI") return `\n- ${childText}\n`;
  if (isLineBreakElement(node)) return `\n${childText}\n`;
  return childText;
}

function isLineBreakElement(element: Element): boolean {
  return BLOCK_TRANSLATION_TAGS.has(element.tagName) || ["DIV", "ARTICLE", "SECTION"].includes(element.tagName);
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

function mutatePreservingViewportCenter<T>(mutate: () => T): T {
  const anchor = captureViewportAnchor();
  const result = mutate();
  restoreViewportAnchor(anchor);
  scheduleViewportAnchorRestore(anchor);
  return result;
}

function captureViewportAnchor(): ViewportAnchor | undefined {
  if (typeof window === "undefined" || !document.body) return undefined;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const pointElement = typeof document.elementFromPoint === "function" ? document.elementFromPoint(centerX, centerY) : null;
  const pointAnchor = pointElement ? anchorElementFrom(pointElement) : undefined;
  const element = pointAnchor ?? findNearestViewportAnchor(centerY);
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (!isUsableRect(rect)) return undefined;
  return {
    element,
    topOffsetFromCenter: rect.top - centerY
  };
}

function restoreViewportAnchor(anchor: ViewportAnchor | undefined): void {
  if (!anchor || !anchor.element.isConnected) return;
  const rect = anchor.element.getBoundingClientRect();
  if (!isUsableRect(rect)) return;
  const expectedTop = window.innerHeight / 2 + anchor.topOffsetFromCenter;
  const delta = rect.top - expectedTop;
  if (Math.abs(delta) < 1) return;
  scrollByAnchorDelta(anchor, delta);
}

function scheduleViewportAnchorRestore(anchor: ViewportAnchor | undefined): void {
  if (!anchor) return;
  const restore = () => restoreViewportAnchor(anchor);
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    return;
  }
  window.setTimeout(restore, 0);
}

function scrollByAnchorDelta(anchor: ViewportAnchor, delta: number): void {
  const scroller = findScrollContainer(anchor.element);
  if (scroller) {
    scroller.scrollTop += delta;
    return;
  }
  if (typeof window.scrollBy === "function") window.scrollBy(0, delta);
}

function anchorElementFrom(element: Element): HTMLElement | undefined {
  const translationElement = element.closest<HTMLElement>(`[${TRANSLATION_ATTR}]`);
  const translationRecord = translationElement?.parentElement?.closest<HTMLElement>(`[${RECORD_ATTR}]`);
  if (translationRecord) return translationRecord;
  if (element instanceof HTMLElement && isUsableRect(element.getBoundingClientRect()) && element !== document.body && element !== document.documentElement) {
    return element;
  }
  const recordElement = element.closest<HTMLElement>(`[${RECORD_ATTR}]`);
  if (recordElement) return recordElement;
  const anchor = element.closest<HTMLElement>(VIEWPORT_ANCHOR_SELECTOR);
  if (!anchor || anchor === document.body || anchor === document.documentElement || !isUsableRect(anchor.getBoundingClientRect())) return undefined;
  return anchor;
}

function findNearestViewportAnchor(centerY: number): HTMLElement | undefined {
  let best: { element: HTMLElement; distance: number; height: number } | undefined;
  for (const element of document.querySelectorAll<HTMLElement>(VIEWPORT_ANCHOR_SELECTOR)) {
    if (element === document.body || element === document.documentElement) continue;
    const rect = element.getBoundingClientRect();
    if (!isUsableRect(rect)) continue;
    const distance = rect.top <= centerY && rect.bottom >= centerY ? 0 : Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY));
    if (!best || distance < best.distance || (distance === best.distance && rect.height < best.height)) {
      best = { element, distance, height: rect.height };
    }
  }
  return best?.element;
}

function isUsableRect(rect: DOMRect): boolean {
  return Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && (rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.bottom !== 0);
}

function findScrollContainer(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) return undefined;
    const style = window.getComputedStyle(parent);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
    if (parent.scrollHeight <= parent.clientHeight) continue;
    return parent;
  }
  return undefined;
}

function getSiblingText(element: Element, key: "previousElementSibling" | "nextElementSibling"): string {
  const sibling = element[key];
  const text = sibling ? normalizeInlineText(sibling.textContent ?? "") : "";
  return text.slice(0, 240);
}

function logMentionSkip(element: HTMLElement, decision: CandidateDecision): void {
  if (!decision.text || !hasMention(decision.text)) return;
  // 只对 @mention 相关跳过打调试日志，避免普通页面扫描产生过多噪音。
  logDebug("mention candidate skipped", {
    reason: decision.reason,
    element: describeElement(element),
    text: previewText(decision.text)
  });
}

function logDebug(message: string, payload: unknown): void {
  console.debug(`${LOG_PREFIX} ${message}`, payload);
}

function recordLogPayload(record: SegmentRecord): Record<string, unknown> {
  return {
    id: record.id,
    layout: record.layout,
    status: record.status,
    element: describeElement(record.element),
    hasMention: hasMention(record.text),
    text: previewText(record.text)
  };
}

function settingsLogPayload(settings: ExtensionSettings): Record<string, string> {
  return {
    provider: settings.provider,
    model: settings.model ?? "default",
    proxyUrl: settings.proxyUrl
  };
}

function describeElement(element: Element): string {
  const parts = [element.tagName.toLowerCase()];
  if (element.id) parts.push(`#${element.id}`);
  const testId = (element as HTMLElement).dataset?.testid;
  if (testId) parts.push(`[data-testid="${testId}"]`);
  const role = element.getAttribute("role");
  if (role) parts.push(`[role="${role}"]`);
  const lang = element.getAttribute("lang");
  if (lang) parts.push(`[lang="${lang}"]`);
  const dir = element.getAttribute("dir");
  if (dir) parts.push(`[dir="${dir}"]`);
  return parts.join("");
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
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

function cacheKeyForText(text: string): string {
  return `zh-CN:${text.length}:${hashText(text)}`;
}

function isPersistentCacheableText(text: string): boolean {
  return text.length <= CACHE_MAX_TEXT_LENGTH;
}

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function parseStoredCache(value: unknown): StoredTranslationCache | null {
  if (!value || typeof value !== "object") return null;
  const cache = value as Partial<StoredTranslationCache>;
  if (cache.version !== CACHE_VERSION || !cache.entries || typeof cache.entries !== "object") return null;
  return cache as StoredTranslationCache;
}

function isStoredCacheEntry(value: unknown): value is StoredTranslationCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StoredTranslationCacheEntry>;
  return typeof entry.translation === "string" && typeof entry.createdAt === "number" && typeof entry.lastUsed === "number";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const runtime = new TranslationRuntime();

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type === "TRANSLATE_TOGGLE") {
      void runtime.toggle(message.settings).then(sendResponse);
      return true;
    }
    if (message.type === "TRANSLATE_UPDATE_SETTINGS") {
      sendResponse(runtime.updateSettings(message.settings));
      return false;
    }
    if (message.type === "TRANSLATE_STATUS") {
      sendResponse(runtime.status());
    }
    return false;
  });
}
