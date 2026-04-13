import { describe, expect, it } from "vitest";
import { buildTranslationPrompt, parseTranslationJson } from "../src/prompt.js";
import type { TranslateRequest } from "../src/types.js";

const request: TranslateRequest = {
  provider: "openai",
  targetLanguage: "zh-CN",
  page: {
    url: "https://example.com/docs",
    title: "Example Docs",
    lang: "en"
  },
  segments: [
    {
      id: "a",
      text: "Open the settings panel.",
      contextBefore: "Welcome",
      contextAfter: "Save your changes"
    }
  ]
};

describe("translation prompt helpers", () => {
  it("includes page and neighboring context", () => {
    const prompt = buildTranslationPrompt(request);
    expect(prompt).toContain("Example Docs");
    expect(prompt).toContain("https://example.com/docs");
    expect(prompt).toContain("Open the settings panel.");
    expect(prompt).toContain("Save your changes");
  });

  it("parses fenced JSON and validates expected ids", () => {
    const segments = parseTranslationJson('```json\n{"segments":[{"id":"a","translation":"打开设置面板。"}]}\n```', new Set(["a"]));
    expect(segments).toEqual([{ id: "a", translation: "打开设置面板。" }]);
  });

  it("rejects unexpected segment ids", () => {
    expect(() => parseTranslationJson('{"segments":[{"id":"b","translation":"错误"}]}', new Set(["a"]))).toThrow(/unexpected/);
  });
});
