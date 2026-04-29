# Progress

## 2026-04-29

- Read the planning and code-analysis skills relevant to a design task.
- Inspected current candidate-discovery, dedupe, and render code in `packages/extension/src/content.ts`.
- Confirmed the main design tension: "no duplicate translation" must mean "one translation per visible source block", not "one translation per unique text string".
- Wrote `docs/extension-block-selection-plan.md` with the proposed source-block model, X-specific strategy, dedupe redesign, and validation matrix.
- Implemented standardized candidate prioritization and owner-based overlap resolution in `packages/extension/src/content.ts`.
- Changed duplicate-text behavior so separate visible blocks with the same English copy can both translate.
- Added mutation-time owner migration and fallback behavior when a better rich-text root appears or disappears.
- Added runtime coverage for longform ownership migration, fallback after richer-owner removal, and repeated UI labels.
- Added a reusable real-page mirror helper under `scripts/real-page-mirror.ts` and coverage for primary-content extraction.
- Added a browser-level real-page smoke script under `scripts/e2e-real-page-smoke.ts` so real article pages can be regression-tested against the built `content.js` in an actual browser.
- Verified with `npx vitest run packages/extension/tests/content.test.ts scripts/real-page-mirror.test.ts`, `npm run build -w @translate-bot/extension`, and browser smoke against the local mirror page.
