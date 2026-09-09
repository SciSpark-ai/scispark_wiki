# Editable Trending topics — September 6, 2026

## Behavior

- Settings → Trending fields now separates editable General topics from narrow
  interests. Users can add, rename and remove up to three broad topics, then Save.
  No source or AI request is triggered by saving.
- Manual topics persist in the server-owned settings file and remain authoritative.
  Use suggestions + Save explicitly resets automatic derivation. Removing the
  final manual topic does not silently repopulate it.
- Manual names are required, unique after whitespace/case normalization and at
  most 120 characters. Invalid manual settings are rejected with 400 before any
  settings section is written. Failed loading prevents accidental overwrites;
  failed saving preserves the draft, and duplicate submissions are blocked.
- Custom labels use text query scopes with custom IDs. Unchanged derived fields
  retain their OpenAlex identity; renaming switches to a custom ID so the old
  taxonomy cannot control retrieval. This does not add an OpenAlex taxonomy
  autocomplete or claim that arbitrary text equals a complete indexed discipline.
- General topics alone can load/refresh Trending without narrow interests.
  The empty-page action now opens Trending settings rather than the profile.
- A manual edit made during automatic derivation wins both in storage and the
  scope selected for that refresh. Existing keys and other settings survive.
- Frontend-design guided plain labels, sentence-level helper wrapping and the
  existing theme. Desktop and phone checks use the real production bundle.

## Verification

- Full Vitest: 2,328 passed, 15 gated skips.
- TypeScript, focused ESLint and production Webpack build passed.
- Regressions cover multiple topics, rename identity, removal, suggestions reset,
  invalid submissions, load/save failures, duplicate saves, settings preservation,
  concurrent derivation and general-topic-only retrieval.
- Browser coverage uses a disposable vault, real settings API and cached-board
  reads. A mocked refresh outage verifies the refresh path without contacting
  public research sources or a paid provider.
- All 18 production E2E tests passed. The new browser case checks add, duplicate
  rejection, save, reopen, rename, remove, suggestions reset, and a general-topic-
  only board. Desktop/light and phone/dark screenshots were visually inspected;
  helper sentences stay on one line each at phone width, with no horizontal
  page overflow.
- The tested build is `.next-trending-topics`, build ID
  `QVoMeCcoPpHSRFulKCWDM`. It replaces only the previous app server on port 3113,
  using the same `/tmp/scispark-production-walkthrough-kafjXM/vault`.

No human-test profile, source key, saved topic list or feed was changed.
No commit, push or paid-provider gate.
