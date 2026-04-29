# Translation Block Planning

## Goal

Define a stable block-selection strategy for the browser extension so that visible foreign-language text and UI labels are translated in-place without duplicate translations or missed blocks, with X/Twitter longform articles as the primary failure case.

## Phases

| Phase | Status | Description | Verify |
|---|---|---|---|
| 1 | complete | Inspect current candidate-discovery, dedupe, and render logic | Relevant code paths identified in `packages/extension/src/content.ts` |
| 2 | complete | Map current behavior to the user requirement and identify gaps | Failure modes documented in `findings.md` |
| 3 | complete | Produce a concrete block-selection design and validation plan | Design document written under `docs/` |
| 4 | complete | Implement standardized source-block selection and owner-based conflict resolution | Content tests pass with duplicate text, longform, and owner-migration scenarios |
| 5 | complete | Implement owner migration and fallback during DOM rerender | Mutation-driven migration tests pass |

## Deliverables

- `docs/extension-block-selection-plan.md`
- `findings.md`
- `progress.md`

## Decisions

- Define "duplicate" by DOM ownership of a visible source block, not by text equality across different visible blocks.
- Keep the selector standardized; site-specific knowledge is limited to explicit root markers inside the same pipeline.
- Keep translation injected into the original source container, with block/inline layout derived from the source role.

## Open Items

- Whether X longform title, deck, and body should always be translated as separate roots even when nested wrappers share the same normalized text.
- Whether repeated UI labels across separate controls should each receive their own in-place translation.
- Whether to extend the explicit rich-text marker set beyond current X/Draft shapes before broader cross-site testing.
