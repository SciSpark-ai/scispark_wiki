# Paper source multi-selection — September 6, 2026

## Behavior

- Settings → Paper sources has four checkbox choices: arXiv, OpenAlex,
  Semantic Scholar, and PubMed. Multiple selections are supported. At least
  one source is required; Save sources is disabled for empty/unchanged choices.
- Save sources persists `paperSources.enabledSources` through the serialized
  settings writer. It does not send a key, run a source probe, or trigger AI.
  Key save/test/remove remains independent and preserves the source choices.
  Fresh/legacy vaults without a selection default to all four sources.
- Feed planning receives the enabled list; returned queries are filtered again
  before retrieval. If planning fails or only proposes disabled sources,
  explicit-topic fallback queries use enabled sources only.
- Search loads the saved list before permitting submission. Its per-question
  scope can narrow that list; the server also intersects incoming and planned
  sources with current preferences. Disabled-only requests fail before AI or
  retrieval. The direct search relay rejects disabled sources too.
- Malformed saved selections fail closed, with key-free errors. Concurrent
  AI settings, source selection, and credential writes preserve each other.
- Scope is Feed/Search, not all network access. Trending's OpenAlex analytics,
  explicit paper resolution/reader/citations, and user-triggered key tests remain
  unchanged. Existing papers/current feeds are not removed or regenerated.
  Source selections live in settings, which remain excluded from exports.

## Verification

- Full Vitest: 2,314 passed, 15 gated skips.
- Production Webpack build, TypeScript and focused ESLint passed.
- Unit coverage includes multi-select save/empty/failure handling, API validation,
  redaction, concurrent sibling preservation, corrupt-data handling, defaults,
  disabled relay rejection, model-plan filtering, feed fallback allowlists,
  Search defaults and disabled-only requests before any provider call.
- Browser verification uses a disposable vault and mocked connection responses;
  no human-test key or paid AI provider is used.
- All 17 production E2E tests passed on `.next-source-selection`. A subsequent
  copy-only adjustment prevents an orphaned “Search” on phones; the final
  `.next-source-selection-final` build reran the full 2,314-test suite and the
  focused production Paper sources E2E. That test checks multi-select save,
  reload, Search integration, blocked disabled-source requests, key preservation,
  desktop/light and phone/dark layouts, keyboard disclosure, and a one-line
  source-selection helper. Screenshots were inspected.
- Port 3113 serves final build `a4jV0KuigzGkNcvovOlmE`, detached PID 9293, using
  the unchanged `/tmp/scispark-production-walkthrough-kafjXM/vault`.

No commit, push, vault reset, live source verification, or paid-provider gate.
