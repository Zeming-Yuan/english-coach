# Story reader design QA — 2026-11-02

Source visual truth: [approved reference](../story-reader/reference.png).

Implementation: [desktop screenshot](../story-reader/desktop.png).
Full comparison: [reference left / implementation right](../story-reader/comparison.png).
Focused comparisons: [typography](../story-reader/compare-typography.png), [dictionary](../story-reader/compare-dictionary.png).

- Source and implementation: 1487 × 1058 pixels, CSS viewport 1487 × 1058, deviceScaleFactor 1. No density rescaling used for the comparison files.
- Same state: The Little Bookshop, bilingual text visible, bookshop selected, definition loaded, light theme.
- Responsive evidence: [420 × 880 reader](../story-reader/mobile.png), [420 × 880 dictionary](../story-reader/mobile-lookup.png), [768 × 1024](../story-reader/tablet.png), [1024 × 768](../story-reader/small-desktop.png). Additional 320 × 700 check found no horizontal overflow.
- Browser: Playwright Chromium, explicitly authorized after the Codex in-app browser blocked localhost. Screenshots come from the real built React application and isolated FastAPI/SQLite fixture server. No screenshot used as app content.
- Preview: http://127.0.0.1:42965/ — choose 故事, then The Little Bookshop. This is a sample database with external AI/speech test adapters, not the user's learning database.

## Findings

No remaining actionable P0/P1/P2 visual findings for the approved light story-reader screen.

| Fidelity surface | Result |
| --- | --- |
| Fonts / typography | Tinos regular matches the reference's narrow book serif more closely than the initial Source Serif rendering. English body is 30px/1.4 at the reference viewport; Chinese is secondary Noto Sans SC/system sans. Initial extra line wrapping was corrected. Some font rasterization and individual line breaks differ slightly (P3). |
| Spacing / layout | Sidebar 259px, toolbar 79px, article 740px, gap 54px, dictionary 326px at the reference viewport. Dictionary has a short top rule, no full-height divider/card/background. Title, paragraph rhythm and bottom return action checked at full size and in region crops. |
| Colors / tokens | Porcelain #FCFAF6, stone #F1EEE8, ink #302E2B, clay #A26243, rule #E5DFD5. Secondary text #736C63 retains readable contrast. No teal or decorative gradient. |
| Image / icon fidelity | No raster illustrations in this target. Book mark and controls use the real Phosphor icon library, not hand-drawn SVG/CSS or text-symbol replacements. Slight library glyph differences are P3. |
| Copy / content | Story text and translations use the same source sample. Context quotes only the selected word's sentence. Add-word support copy says 在单词本中继续复习: the existing API does not persist the selected sentence, so the mock's promise to retain it was deliberately not copied. |

## Comparison history

1. Initial capture: [desktop](../story-reader/desktop-initial.png), [combined comparison](../story-reader/comparison-initial.png). **Blocked**: P2 body font was too wide, changed paragraph wrapping and pushed the end of the story below the reference position. P2 dictionary repeated the entire paragraph, pushing its action too low.
2. Fixed font family, body scale, heading tracking, paragraph spacing and final paragraph margin. Selected-word context now uses the containing sentence. Dictionary vertical spacing and its icon/action were adjusted. Mobile uses a bounded drawer, keyboard focus management, and the same icon family in bottom navigation.
3. Opened final full comparison and both full-resolution region comparisons together. Major proportions and reading hierarchy now match; responsive captures preserve the reading task. No additional P0/P1/P2 visual fixes required.

## Interaction verification

- 8/8 reader browser tests passed across desktop and mobile: translation, font size, keyboard word selection, Escape and focus return, contextual sentence, panel closing, viewport fit.
- Full sample narration exercised in a browser: 11 sequential sentence requests from the first sentence to the last; every request within the existing 200-character TTS limit; no error toast. Curly quotes and accented punctuation are normalized only for speech, not in the displayed story.
- Screenshot capture emitted no browser page errors.
- Existing self-rating save-failure/retry and visible/offscreen target-contact browser cases passed.
- Build passed; 7 frontend unit tests and 8 story/static HTTP tests passed.

## Open questions and release limits

- This is a visual acceptance result, not a whole-project release certificate. The full Python run had **642 passed, 28 failed**, primarily EL-09's destructive-downgrade guard conflicting with older migration tests, plus two EL-09 retention scenarios. This design task did not modify backend files.
- The wider browser run had **18 passed, 2 failed** for sentence-audio contact recording. Isolated audio checks passed on both viewports. The same intermittent audio failure was reproduced with the original HEAD App/StoriesPage compiled separately (5 passed, 1 failed). Keep this as an unresolved existing release/test-environment issue; do not silently count those executions as passes.
- Full failure names and reports are recorded in [verification.json](../story-reader/verification.json).
- Dark-mode token compatibility is retained, but the approved target and visual comparison are light mode. No claim of a separate dark design acceptance.

## Implementation checklist

- [x] Approved palette, serif reading typography and quieter dictionary panel implemented.
- [x] Existing lookup, add-word, ratings, sentence speech and contact boundaries retained.
- [x] New font/translation controls work; word actions have keyboard-accessible semantics.
- [x] Narrow-screen drawer, focus return, reduced-motion and overflow checked.
- [x] Same-state screenshots and focused visual comparison inspected after final changes.
- [x] Whole-project failures disclosed separately from visual acceptance.

## Follow-up polish

- P3: small differences in serif glyphs, Chinese line wrapping, and icon geometry relative to the generated reference.
- Homepage, practice screens and other application routes retain their existing design; this change establishes the approved story-reading surface.

final result: passed
