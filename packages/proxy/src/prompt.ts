import type { TranslateRequest } from "./types.js";

/**
 * 生成给模型的统一翻译提示词。
 * 输入是扩展采集好的页面上下文和片段列表，输出是只包含 JSON 要求的纯文本提示。
 */
export function buildTranslationPrompt(request: TranslateRequest): string {
  // 每个文本片段都带上前后文，降低逐句硬翻译的概率。
  const segments = request.segments.map((segment) => ({
    id: segment.id,
    text: segment.text,
    contextBefore: segment.contextBefore ?? "",
    contextAfter: segment.contextAfter ?? ""
  }));

  return [
    "You are translating webpage text into natural Simplified Chinese.",
    "Use the page title, URL, and neighboring text as context. Do not translate isolated snippets mechanically.",
    "Preserve numbers, code, URLs, product names, emphasis markers, list markers, paragraph breaks, and line breaks.",
    "If the source text contains bullets, blank lines, or short emphasized lines, keep the same readable structure in the translation.",
    "Return only valid JSON with this exact shape: {\"segments\":[{\"id\":\"...\",\"translation\":\"...\"}]}",
    "",
    `Page title: ${request.page.title}`,
    `Page URL: ${request.page.url}`,
    `Page language: ${request.page.lang ?? "unknown"}`,
    `Target language: ${request.targetLanguage}`,
    "",
    JSON.stringify({ segments })
  ].join("\n");
}

/**
 * 解析模型返回的 JSON 翻译结果。
 * 只接受和请求里的 segment id 一一对应的翻译，避免模型多写内容时污染页面。
 */
export function parseTranslationJson(raw: string, expectedIds: Set<string>): Array<{ id: string; translation: string }> {
  const trimmed = raw.trim();
  // 模型偶尔会包一层 Markdown 代码块，这里做兼容提取后再严格校验结构。
  const jsonText = extractJson(trimmed);
  const parsed = JSON.parse(jsonText) as unknown;

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { segments?: unknown }).segments)) {
    throw new Error("Model response did not include a segments array.");
  }

  const segments = (parsed as { segments: unknown[] }).segments;
  return segments.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Model response included an invalid segment item.");
    }
    const id = (item as { id?: unknown }).id;
    const translation = (item as { translation?: unknown }).translation;
    if (typeof id !== "string" || typeof translation !== "string" || !expectedIds.has(id)) {
      throw new Error("Model response included an unexpected segment id or translation.");
    }
    return { id, translation };
  });
}

/** 从可能被代码块或额外说明包裹的内容里，尽量提取 JSON 本体。 */
function extractJson(text: string): string {
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}
