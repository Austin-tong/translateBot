# Extension Block Selection Plan

## Objective

Build a block-selection model for the browser extension that satisfies four hard requirements:

1. Every visible foreign-language button label must be translated.
2. Every visible foreign-language text block must be translated.
3. The translation must be inserted back into the same source container.
4. The same visible source block must never receive two translations, and a visible source block must never be skipped.

The primary failure case to solve is X/Twitter longform content, but the design is generic-first and must also cover ordinary feed text, UI labels, and dynamic page updates.

## Current State

The current implementation in [`packages/extension/src/content.ts`](../packages/extension/src/content.ts) uses a three-part strategy:

1. Tag-based discovery:
   - Scan `p`, headings, list items, `div`, `article`, `section`, `span`, `a`, `button`.
2. Candidate heuristics:
   - Use explicit block tags, UI-label checks, generic-container checks, and a small text-root escape hatch.
3. Duplicate suppression:
   - Reject overlapping candidates when normalized text hash matches and the DOM relationship looks equivalent.

This strategy is adequate for simple paragraphs and simple buttons. It is not adequate for X longform because the visible block boundary is not aligned with semantic tags alone.

## Requirement Interpretation

The requirement needs one precise definition:

- "Cannot duplicate" means one visible source block can produce only one translation node.
- It does not mean identical English text appearing in two different visible blocks should collapse into one translation.

That distinction changes the dedupe model. Dedupe must be based on source-block ownership, not just text equality.

## Failure Modes To Eliminate

### 1. Wrapper duplication

Examples:
- `h2` and an inner Draft block both represent the same visible title.
- A longform wrapper `div` and its inner rich-text block both qualify independently.

Bad outcome:
- Two Chinese translations appear for one visible block.

### 2. Wrapper omission

Examples:
- X longform body lines use wrapper `div`s around inline links.
- A visible paragraph is represented by a rich-text root that fails generic-container heuristics.

Bad outcome:
- The paragraph is never queued for translation.

### 3. Text-equality over-dedupe

Examples:
- Two visible buttons both say `Follow`.
- Two visible repeated captions have the same English copy.

Bad outcome:
- Only one visible instance receives translation.

### 4. Dynamic rerender drift

Examples:
- X rerenders a longform block after initial translation.
- The same visible block moves between wrapper levels during hydration.

Bad outcome:
- Old translation remains attached to a stale node, or the same block is translated twice.

## Proposed Model

Replace the current "candidate element" mindset with a "source block" model.

### Source block

A source block is the smallest visible DOM container that satisfies all four conditions:

1. It owns a coherent visible text run or UI label from the user's perspective.
2. Appending a translation node inside it preserves the visual grouping.
3. Its parent is not a better owner for the same visible text.
4. Its child is not a better owner for the same visible text.

### Source block classes

Every candidate is classified into one of four roles:

1. `ui-label`
   - Short visible text inside an interactive control.
   - Examples: `Back`, `Follow`, menu labels, dialog buttons.
   - Render mode: `inline`.

2. `semantic-block`
   - Native block tags that already align with visible reading units.
   - Examples: `p`, `li`, `blockquote`, `h1`-`h6`, `figcaption`, `summary`.
   - Render mode: `block`.

3. `rich-text-root`
   - Non-semantic containers that still represent one visible reading block.
   - Examples: X longform Draft block, `tweetText`, rich text with inline links, inline wrappers, line breaks.
   - Render mode: `block` unless explicitly proven inline.

4. `meta-text`
   - Small visible text that is not an interactive control but still a standalone visible unit.
   - Examples: small status chips, role labels, short non-button captions.
   - Render mode: `inline` or `block` based on layout score.

## Proposed Selection Pipeline

### Phase A: visible text fragment extraction

Walk the DOM subtree and extract visible text fragments with structure metadata:

- fragment text
- owning element
- nearest interactive ancestor
- nearest semantic block ancestor
- nearest explicit X rich-text marker
- geometry hints
- language hints

This phase should not decide the final translation root. It only builds facts.

### Phase B: root promotion

Promote fragments to source blocks using ordered rules:

1. Explicit text roots win first.
   - `data-testid="tweetText"`
   - X longform/Draft block markers such as `public-DraftStyleDefault-block`
   - Other explicit rich-text markers introduced later

2. Native semantic block tags win second.
   - `p`, headings, list items, blockquote-like text containers

3. UI labels win third.
   - Short text inside buttons, menu items, nav controls, tabs

4. Generic containers are last resort.
   - Only when they are the smallest visible owner of a coherent text block and no explicit child root exists

### Phase C: ownership resolution

Resolve competing roots by score, not by hash-only dedupe.

Priority order:

1. Explicit rich-text root
2. Semantic block tag
3. UI label
4. Generic rich-text container
5. Generic fallback container

Conflict rules:

1. Ancestor/descendant conflict:
   - Keep the higher-priority owner.
   - If priority ties, keep the smaller visible owner.
2. Sibling same-text conflict:
   - Keep both if they occupy different visible boxes.
   - Do not dedupe by text equality alone.
3. Rerender conflict:
   - Rebind translation to the canonical owner for the current DOM generation.

## Site Marker Strategy

The selector must stay standardized. Site-specific handling is limited to explicit marker detection inside the same generic pipeline.

### Explicit rich-text roots

Use explicit root markers before generic heuristics. X is only one example source of such markers:

1. Standard tweet/reply body:
   - `[data-testid="tweetText"]`
2. Longform title/body rich-text block:
   - `.public-DraftStyleDefault-block`
   - longform block containers carrying `data-offset-key`
3. Rich text wrappers inside longform:
   - inline link wrappers
   - `br`-separated paragraph segments

### Ownership rules for marker-backed rich text

1. A longform title should map to one source block.
2. A longform body paragraph should map to one source block.
3. Inline handles and inline links belong to the containing paragraph block, not to standalone translation roots.
4. Action-row counters and buttons should be treated separately from the article body.
5. Avatar, media, charts, and icons are not OCR targets in this phase.

## Generic Rich-Text Strategy

For non-X pages, generic `div/article/section` containers should only be accepted when they satisfy all of these:

1. Visible text length exceeds a minimum threshold.
2. No child semantic block is a better owner.
3. Child `div`s are rich-text wrappers, not layout partitions.
4. The subtree is mostly text-bearing, not card-layout-bearing.
5. Appending translation to the container preserves the visible reading unit.

This avoids translating whole cards while still capturing DOMs that use wrapper `div`s for styled rich text.

## Dedupe Redesign

The dedupe key should separate identity from text:

### Block identity key

Computed from:

- source role
- canonical owner element
- stable DOM path signature
- optional geometry signature
- normalized source text hash

### Why this matters

1. Two different buttons both labeled `Follow` should both translate.
2. One longform title discovered through two wrapper levels should still produce one translation.
3. If the DOM rerenders but the visible block identity remains the same, the translation should rebind rather than duplicate.

## Rendering Rules

Rendering stays in the source container, but source role controls layout:

1. `ui-label`
   - inline append
   - preserve line height and spacing
2. `semantic-block`
   - block append
   - preserve paragraph grouping
3. `rich-text-root`
   - default block append
   - preserve line breaks and paragraph boundaries
4. `meta-text`
   - layout chosen by display context

## Dynamic Update Strategy

The mutation path needs to become identity-aware.

### Required behavior

1. If source text changes within the same source block, refresh the same record.
2. If ownership shifts to a better root after rerender, remove the old translation and bind to the new canonical root.
3. If a new visible block appears, create a new record even if its text equals an existing block elsewhere.
4. If a visible block disappears, remove the attached translation record cleanly.

## Validation Matrix

Implementation is not complete without this test matrix.

### X coverage

1. Longform title with nested Draft wrappers
2. Longform paragraph with inline links wrapped by `div`
3. Longform paragraph starting with `@mention`
4. Longform multi-paragraph body with `br`
5. Standard tweet body under `tweetText`
6. Repeated action labels in separate controls

### Generic site coverage

1. Ordinary paragraph
2. Rich-text editor output with inline links
3. Navigation and button labels
4. Cards with text plus buttons
5. Mixed Chinese and English text

### Stability coverage

1. Rerender of the same block
2. Scroll-driven discovery
3. Toggle off and restore
4. Manual retranslate
5. Two identical visible strings in different locations

## Implementation Plan

### Step 1: Introduce explicit source-block roles

- Refactor candidate evaluation to return role and ownership metadata, not only `ok/reason`.
- Separate discovery from ownership resolution.

### Step 2: Add X-specific root detectors

- Detect `tweetText`
- Detect longform Draft block roots
- Detect longform paragraph/title ownership boundaries

### Step 3: Replace hash-only dedupe with owner-based dedupe

- Keep one translation per canonical owner
- Allow repeated identical text across distinct visible owners

### Step 4: Rework mutation refresh path

- Re-evaluate ownership on rerender
- Rebind records when the best owner changes

### Step 5: Expand tests before broad rollout

- Add DOM fixtures modeled on real X longform markup
- Add runtime tests for repeated identical buttons and repeated identical paragraphs
- Add rerender tests for owner migration

## Acceptance Criteria

The design is successful when all of the following are true:

1. X longform title, body paragraphs, and visible button labels are translated.
2. Each visible source block shows exactly one translation.
3. Two different visible blocks with the same English text can both show translations.
4. Turning translation off restores the original DOM cleanly.
5. Rerendering does not create stale or duplicated translations.

## Recommended Next Move

Implement this in two passes:

1. First pass:
   - Introduce source-block roles and X-specific root detection
   - Add real DOM fixtures and tests
2. Second pass:
   - Replace current dedupe and refresh logic with owner-based identity resolution

This order reduces regression risk because the test matrix is established before the mutation and dedupe logic is rewritten.
