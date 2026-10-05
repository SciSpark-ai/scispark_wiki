# Full-text reader availability

The ingested-paper page treated `full_text: false` as proof that no open-access
source existed. Ingestion only attempted HTML, even when the digest and Sparky
had already read a saved PDF. The reported SGAD paper had a 2.8 MB local PDF and
a full-text digest, but this historical flag disabled its reader button.

## Changes

- Keep Read full text available after ingestion. The reader resolves saved
  sources or attempts retrieval; an earlier failed acquisition cannot prove
  permanent unavailability. Remove the incorrect notice and its predicate.
- Ingestion now uses the same verified text cache, local HTML/PDF extraction,
  and bounded public-source acquisition as digest and paper chat. Pass the
  source metadata into digest generation and mark verified PDF text as full
  text in the atomic wiki changeset.
- Retain newly acquired, identity-verified HTML/PDF bytes for offline reading.
  Snapshot failures retain usable verified text and report the storage failure
  in source notes. Unverified sources are never saved by this path.
- Existing wiki entries are not rewritten merely by opening the reader.

## Verification

- Regression tests first reproduced the disabled button, missing HTML/PDF
  snapshots, and cached-PDF ingestion writing `full_text: false`.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors, one existing ConnectAiCard exhaustive-deps warning.
- `npx vitest run --maxWorkers=4`: **2,700 passed, 19 skipped**, 273 passing files.
  Four obsolete availability-predicate cases were removed; three new cache and
  ingestion regressions were added. Existing component expectations now assert
  that an ingested paper can still be read. The first unrestricted concurrent
  run had one 5-second CLI fixture timeout; the bounded full rerun passed.
- `SCISPARK_LIVE_GATE_DIST_DIR=.next-fulltext-reader npm run build`: passed.
- Production Playwright: five relevant checks passed across the final runs:
  cached PDF reading through navigation/reload, background ingestion + Undo,
  digest recovery, pending-chat recovery, and selection-to-Sparky recovery.
  The new reader test required correcting an ambiguous canvas selector and
  distinguishing paper actions from the shell's companion-notification checks.
  It confirms no remote fetch, no digest/ingest/chat request, and no wiki rewrite
  when opening the saved PDF. These use a disposable vault and mock providers.
- Actual local app: clicked Read full text on
  `/paper/10-48550-arxiv-2608-01618`; the saved SGAD PDF rendered in `/reader`
  with selectable article text. No re-ingestion or research question was sent.
  Screenshot:
  `/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/fulltext-reader/sgad-pdf-open.png`.

The updated production build is running on localhost:3000 with the scheduler
off. No commit or push was made for this fix.
