// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTranslation, collectCandidateElements, createRecord, isCandidateElement, isTranslatableText, restoreRecord } from "../src/content.js";

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

  it("skips script, code, editable, hidden, controls, and already translated text", () => {
    document.body.innerHTML = `
      <main>
        <p id="ok">Hello world from a normal paragraph.</p>
        <script id="script">Hello world from a script.</script>
        <code id="code">Hello world from code.</code>
        <p id="editable" contenteditable="true">Hello world from editable text.</p>
        <p hidden id="hidden">Hello world from hidden text.</p>
        <button id="button">Hello world from a button.</button>
        <p data-translate-bot-translation="true" id="translated">Hello world from translated text.</p>
      </main>
    `;

    expect(isCandidateElement(document.querySelector("#ok") as HTMLElement)).toBe(true);
    expect(isCandidateElement(document.querySelector("#script") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#code") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#editable") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#hidden") as HTMLElement)).toBe(false);
    expect(isCandidateElement(document.querySelector("#button") as HTMLElement)).toBe(false);
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
    expect(isTranslatableText("This page explains translation quality.")).toBe(true);
  });
});
