# Trending: retain independent field rankings

## Reported failure

The user's cached October 4 update contained Computer Science and Neuroscience
anchors, no source or survey error, and ten topics, all classified as Computer
Science. Candidate selection took the twenty largest topics across both fields;
ranking then discarded everything beyond the combined top ten. The Neuroscience
filter could only filter those retained topics, so it had no independent ranking
to display. The cache alone does not establish which Neuroscience topics cleared
the old candidate cutoff; both truncation stages could exclude them.

## Change

Candidates are now limited to twenty per field, and the stored ranking retains
ten per field in combined growth order. All fields displays the combined top ten;
each field tab uses its retained ranking. Growth formulas, volume floors, canonical
field/subfield scopes, measured-count failure handling and paper identity stay the
same. Filtering remains local and invokes neither retrieval nor an LLM.

The bound is now at most sixty prior-count requests and thirty representative-paper
requests for three fields, rather than twenty and ten globally. Qualitative briefs
still use one skill run per represented field (subject to existing retry/budget
rules). The increase is bounded and allows smaller fields to be represented.

New boards carry additive `topicCoverage: "per-field"` metadata. Old version-five
boards remain readable, with an explicit instruction to Refresh for independent
rankings. There is no cache-version migration that triggers new model work merely
because of this code update. Ordinary existing staleness refresh behavior remains.
The highly cited sidebar retains its clearly labeled all-fields scope.

## Verification

- Two regressions failed before implementation: smaller-field candidates were
  zero, and its retained ranking was zero. Both now pass.
- Focused tests: 106 passed. Includes stored per-field coverage, bounded prior
  lookups, two field-level briefs, independent UI filtering and old-cache guidance.
- Full Vitest: 2,685 passed, 19 gated skips. Browser purity, theme and source-hygiene
  guards passed. TypeScript passed; ESLint has zero errors and only the existing
  ConnectAiCard exhaustive-deps warning.
- Production build `.next-trending-coverage` passed.
- Five Chromium tests passed with the production build and a disposable vault:
  field coverage, responsive layout, fields/settings, subfields, and paper/reading
  integration with refresh failure recovery.
- The new browser test runs the real ranking orchestrator against synthetic source
  counts and a MockProvider. All combined top-ten positions belong to Computer
  Science, while Neuroscience still displays its own ten rows at 1440 and 390 px.
- Local port 3000 now serves this build. The user's existing Trending cache was
  inspected read-only and left intact; opening the updated page shows the explicit
  refresh guidance. No live model or OpenAlex refresh was invoked during testing.

Artifacts and synthetic screenshots:
`/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/trending-field-coverage-2026-10-04/`.
