// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTranslation, isEligibleTextNode, restoreRecord, shouldSkipText, wrapTextNode } from "../src/content.js";

describe("content translation DOM helpers", () => {
  it("skips script, code, editable, hidden, and already translated text", () => {
    document.body.innerHTML = `
      <main>
        <p id="ok">Hello world</p>
        <script id="script">Hello world</script>
        <code id="code">Hello world</code>
        <p id="editable" contenteditable="true">Hello world</p>
        <p hidden id="hidden">Hello world</p>
        <span data-translate-bot-wrapper="true" id="wrapped">Hello world</span>
      </main>
    `;

    expect(isEligibleTextNode(document.querySelector("#ok")?.firstChild as Text)).toBe(true);
    expect(isEligibleTextNode(document.querySelector("#script")?.firstChild as Text)).toBe(false);
    expect(isEligibleTextNode(document.querySelector("#code")?.firstChild as Text)).toBe(false);
    expect(isEligibleTextNode(document.querySelector("#editable")?.firstChild as Text)).toBe(false);
    expect(isEligibleTextNode(document.querySelector("#hidden")?.firstChild as Text)).toBe(false);
    expect(isEligibleTextNode(document.querySelector("#wrapped")?.firstChild as Text)).toBe(false);
  });

  it("wraps original text and inserts translation without dropping the original", () => {
    document.body.innerHTML = `<p id="copy">A fast brown fox jumps over the lazy dog.</p>`;
    const textNode = document.querySelector("#copy")?.firstChild as Text;
    const record = wrapTextNode(textNode, "seg-1");

    applyTranslation(record, "一只敏捷的棕色狐狸跳过懒狗。");

    const original = document.querySelector("[data-translate-bot-original]");
    const translation = document.querySelector("[data-translate-bot-translation]");
    expect(original?.textContent).toBe("A fast brown fox jumps over the lazy dog.");
    expect(translation?.textContent).toBe("一只敏捷的棕色狐狸跳过懒狗。");
    expect((translation as HTMLElement).hidden).toBe(false);
  });

  it("restores the original text node when disabled", () => {
    document.body.innerHTML = `<p id="copy">Keep this text.</p>`;
    const paragraph = document.querySelector("#copy") as HTMLParagraphElement;
    const record = wrapTextNode(paragraph.firstChild as Text, "seg-2");

    restoreRecord(record);

    expect(paragraph.textContent).toBe("Keep this text.");
    expect(paragraph.querySelector("[data-translate-bot-wrapper]")).toBeNull();
  });

  it("roughly skips already Chinese text and punctuation-only text", () => {
    expect(shouldSkipText("这是一个中文页面")).toBe(true);
    expect(shouldSkipText("... 123 !!!")).toBe(true);
    expect(shouldSkipText("This page explains translation quality.")).toBe(false);
  });
});
