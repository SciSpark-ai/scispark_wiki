# Official Trending field selection — September 6, 2026

Supersedes the free-text general-topic editor described in
`2026-09-06-trending-topics.md`.

## Behavior

- Settings → Trending fields offers searchable, keyboard-accessible multiple
  selection from the official 26 OpenAlex fields. At most three are selected.
  Search is a local catalog filter, never a way to create an arbitrary field.
- A single public, keyless catalog request verified all field IDs, labels and
  domains on 2026-09-06. The bundled catalog works offline.
- Narrow interests remain free text. Suggest from my interests makes an explicit
  OpenAlex request without AI. Results are only previews until Add and Save.
  Existing unconfigured automatic settings retain initial field derivation.
- The server validates canonical IDs in both manual and automatic settings,
  rejects duplicates/unknown fields and supplies canonical labels. Legacy custom
  entries remain visible for explicit replacement, not silently mapped by name.
- Topic grouping, recent/prior corpus counts, prior topic counts, representative
  papers and breakout papers all use the same primary-field ID filter.
  They exclude paratext; field-name keyword searching is no longer added.
  Representative papers also carry a topic-ID filter. OpenAlex metadata and
  classification can contain errors; these metrics are not quality assessments.
- Cache version 5 invalidates older keyword-scoped metrics. Valid paper records
  from version 4 remain readable so existing paper detail links still resolve.
- Saving alone does not perform retrieval or AI calls. Changes apply on the next
  refresh. A general field works without narrow interests.
- Frontend-design guided the searchable checkbox list, selected-field chips,
  sentence-level helper wrapping, and responsive light/dark layouts.

## Verification

- Full Vitest: 2,342 passed; 15 gated skips.
- TypeScript, full ESLint, focused ESLint and production Webpack build passed.
- Unit/component regressions cover canonical IDs, missing/untrusted labels,
  legacy-entry review, max-three selection, explicit suggestion confirmation,
  load/save failures, concurrent settings edits and cache compatibility.
- A route-to-OpenAlex-adapter test inspects every generated request URL. It
  verifies consistent field/paratext filters and no text search for any metric
  or paper request, including a paper title without the field name.
- Browser verification uses an isolated disposable vault and the real production
  settings API. Suggestions and refresh responses are fixtures, not live research
  or paid AI calls. It covers keyboard selection, filtering, limits, persistence,
  reopening, explicit Add/Save, and a field-only Trending board.
- All 18 production browser tests passed again on the final artifact (1.4 min).
- Desktop/light and phone/dark screenshots are inspected for readability and
  overflow. The final production artifact is `.next-trending-fields`, build
  `udq9eZUHyjDWHyNmwL4sk`.
- Port 3113 now serves that artifact as detached PID 20536, using the unchanged
  `/tmp/scispark-production-walkthrough-kafjXM/vault`.

No human-test profile, key, selected field list, feed or other vault file is
changed by this implementation or its tests. No commit or push.
