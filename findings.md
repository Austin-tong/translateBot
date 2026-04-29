# Findings

## Current implementation

1. Candidate discovery is based on a fixed tag scan plus local heuristics in `collectCandidateElements()` and `evaluateCandidateElement()`.
2. Generic container acceptance currently depends on structural-child heuristics, visible-state checks, and a small set of text-root escapes.
3. Duplicate suppression is currently tied to normalized text hash plus DOM overlap/sibling checks.
4. Translation rendering appends a translation node directly into the chosen source container and keeps the layout as `block` or `inline`.

## Requirement gaps

1. X/Twitter longform content is not stable under the current generic-container heuristics because the real DOM uses wrapper `div`s around inline text and links.
2. The current duplicate rule is stricter than the user requirement. Identical text in two different visible controls or blocks can still require two separate translations.
3. The current candidate strategy is DOM-shape-driven, not view-block-driven, so the same visible content can be discovered at multiple wrapper levels or at none.
4. The current tests cover slices of the behavior, but not yet a full matrix of X longform title/body/meta/button cases plus dynamic rerender cases.
