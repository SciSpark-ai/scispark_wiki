# Verified Facts

- The repository is `scispark-app-frontend`, a private Next.js 16.3.2 / React
  19.2.4 / TypeScript application using the App Router.
- The checked source footprint on 2026-08-09 is 551 files under `src/`, including
  60 app files, 125 component files, 359 library files, 7 store files, and 190
  `*.test.ts` / `*.test.tsx` files.
- The browser is a UI client for a local Next.js runtime. The runtime owns the
  filesystem vault, LLM calls, settings, metering, paper relays, and skill
  orchestration through `src/app/api/**/route.ts`.
- Vault persistence is abstracted behind `VaultStorage`. Production uses
  server-side `NodeFsVaultStorage`; browser code uses `RemoteVaultStorage`; tests
  use `MemoryVaultStorage`.
- Agent-authored vault changes use validated atomic changesets with persisted undo
  data. Derived wiki/graph/timeline/citation/author views are recomputed rather
  than stored as independent sources of truth.
- The implemented product includes literature search and resolution, personalized
  feed, progressive paper pages, ingest/wiki/review flows, reader/highlights,
  research companion, visualization workspace, Spark ideation, personalized
  trending, lint/spend tooling, and grounded knowledge-base chat.
- `README.md` describes the implemented local-runtime architecture. Projects,
  membership, project notes, scoped chat, and recoverable Changes History are
  vault-backed; `/library` redirects to the saved-paper Wiki shelf.
- The filesystem is case-insensitive: `agents.md` and `AGENTS.md` resolve to the
  same file/inode.

# Current Release/Session State

- September 9: user authorized commit and push. Isolated review commit candidate
  passed 2,356 tests / 17 gated skips, production build, TypeScript, targeted lint
  and six Chromium tests. Includes required chat/source/billing dependencies;
  unrelated local work remains unstaged. Live scientific acceptance remains open.

- September 9 general review coverage fix: question-specific requirements now
  drive search, gap retrieval and synthesis; coverage is assessed independently
  from claim grounding. Grounded but incomplete answers remain partial and reject
  claim-only retries. Edits invalidate generated coverage assessments. Bounded
  public PDF and exact-DOI Europe PMC XML recovery distinguish local relay blocks
  from publisher restrictions. Source-only live checks recovered two of three
  cited papers, both explicitly truncated; no model spending. Full suite: 2,487
  passed / 17 skipped; targeted lint and production compilation/TypeScript passed.
  Production review and restart browser regressions passed. New live synthesis
  acceptance remains open; existing report/ledger preserved with $0.603068 left.
  No commit/push. See `docs/testing/2026-09-09-deep-review-coverage.md`.

- Production browser/server import boundary fixed 2026-09-05. Trending's
  cache-loading/freshness/scope helpers now live in `trending/cache.ts`, and its
  shared interfaces in `trending/types.ts`. Browser imports no longer pull in
  the dashboard AI runner. The next build exposed the same pattern in the
  reader's digest schema; `skills/digest-contract.ts` now holds that shared
  schema independently. Cache formats, scoring, provider configuration and
  server APIs are unchanged. Server modules retain compatibility re-exports.
  The purity gate now bans whole orchestrator modules and resolves relative
  imports; a TypeScript-AST graph test follows indirect client dependencies
  to detect server runners, providers and Node builtins. The stronger guard
  failed on the original Trending imports before the fix.
- Production browser acceptance exposed a route-transition bug: App Router
  destination children could mount inside an exiting pathname-keyed wrapper,
  then mount again, dropping a typed Chat follow-up or reading selection.
  AppShell now leaves page identity to Next with a stable content wrapper;
  sidebar animation remains. Regression tests reproduced the state loss for
  Chat and Trending -> paper before the fix and passed afterward. Setup remains
  protected too. No timing sleeps, forced clicks or retries were added to hide
  the failures. A final test-fixture correction uses the refresh API's actual
  terminal NDJSON error shape instead of ordinary JSON.
- Final verification: default `npm run build` (Turbopack) passed after the final
  application changes; the webpack production build also passed the import
  fixes. All 16 Playwright tests passed against the final Turbopack production
  artifact (not a dev server), including Trending -> cached paper/digest ->
  reading Ask -> failed refresh preserving the board -> reload. Its screenshot
  was inspected. 2,198 unit/component tests passed (15 gated skips), TypeScript,
  ESLint and `git diff --check` passed. The initial browser run's two navigation
  failures are resolved, not ignored. `SCISPARK_E2E_PRODUCTION_DIST_DIR` enables
  repeatable production-artifact testing with a disposable vault and isolated
  loopback ports; README documents it. Sandbox port binding required approved
  execution for browser tests and the default build. This supersedes the
  production-build blockers below, but not paid-provider or release approvals.
  Scratch builds and their generated TypeScript config additions were cleaned;
  the user's running server, vault, unrelated changes and Git history were not
  replaced. No paid provider, commit, push, merge or release was performed.

- Offline font loading fixed 2026-09-05: `src/lib/fonts.ts` now uses
  `next/font/local` with checked-in Geist/Geist Mono variable fonts and Halant
  400/700. Existing CSS variables and font families are preserved. Unmodified
  upstream TTFs, SIL OFL notices, pinned source links and SHA-256 checksums live
  under `src/assets/fonts`; README documents that neither builds nor browser
  font loading require Google Fonts. Regression tests guard binary integrity,
  weights, licenses and accidental reintroduction of remote font loading.
- Font verification: 2,187 unit/component tests passed (15 gated skips),
  TypeScript, ESLint and `git diff --check` passed; all 15 disposable-vault
  Playwright tests passed. The new browser test blocks external requests and
  verifies all four font faces load from same-origin assets at desktop/light
  and phone/dark sizes. Both screenshots were inspected; five additional
  onboarding viewport checks passed. No paid provider or user vault was used.
- Production build is still NOT a release pass. The isolated default Turbopack
  attempt stayed at compile with no progress for over six minutes and was
  cancelled. The supported webpack attempt emitted all four local font assets
  with matching checksums, then failed on the existing client import chain
  `trending/page.tsx` -> `trending/dashboard.ts` -> `skills/runner.ts` -> LLM
  settings -> Anthropic SDK (`node:fs` / `node:path`). This supersedes the Google
  Fonts blocker below, not the separate browser/server-boundary build issue.
  Only this task's scratch build directories were removed; the active dev
  server, user vault, unrelated work, Git commits and remotes were unchanged.

- Preference-learning slice 1 implemented 2026-09-05 as `weighted-v2`; this
  supersedes the v1 learning descriptions below. Feedback derives a structured
  facet, allowed effect, related-paper scope and current horizon from canonical
  server-owned votes. The assessment stage proposes evidence-paired memory
  matches; `recommendation/preference-effects.ts` validates reasons, quotes,
  identity and duplicate examples before code computes ranking effects. Learned
  method/population preferences now affect ranking even without a profile
  `hasApproach` flag; baseline negative penalties are not counted twice.
  Direct examples contribute +/-8 points, bare dislike -4, related matches half,
  30-day decay / 180-day expiry, aggregate cap +/-20. The old +/-5 topic helper
  remains only for compatibility, not the live path. “Too old” changes only a
  matched subject's recency half-life (7–14 days); missing dates stay unknown.
  Votes no longer automatically exclude even their exact paper on future runs;
  saved work, explicit Dismiss and Already read retain separate exclusions.
- Feed cards expose applied memory IDs/timestamps, source/candidate excerpts and
  score effects; Settings labels preference facets and inactive learning. Missing
  or unsupported matches warn. Ten-paper memory-enabled batches bound output
  within the existing token budget; no feedback-click LLM call or separate
  extraction stage was added. v1 caches still load. Canonical feedback is unchanged,
  so Undo/reset/export/import cannot leave a separate stale learned-memory file.
  README and `docs/design/07-recommendation-pipeline.md` disclose the new policy.
- Verification for this slice: 2,180 unit/component tests passed, 15 gated skips;
  TypeScript, ESLint and `git diff --check` passed. All 14 disposable-vault
  Playwright tests passed, including feedback → next-run method penalty → rendered
  evidence details and History Undo. Desktop/phone screenshots were inspected.
  Tests use fixture providers/public-paper adapters, not paid AI. The isolated
  production build failed fetching existing Geist, Geist Mono and Halant Google
  Fonts; this is NOT a release-build pass. Its generated scratch build was removed.
  No user vault, provider configuration, commit, push or release was changed.
  Semantic embeddings, enduring/project-scoped memory management, venue-data
  integration and human-rated learned-weight evaluation are still unimplemented.

- Sparky paper-feedback memory implemented 2026-09-05. Feed cards expose thumbs
  up/down; a successful thumbs down keeps the paper visible and opens a small optional
  bottom-right question. Topic/method/age/already-read/other reasons and a short
  note refine the saved vote with a revision check; Skip retains the original
  vote. The user-triggered question is free of LLM calls, respects the companion
  name, queues different papers and cannot be replaced by late proactive replies.
  Server-owned snapshots let a follow-up survive feed-cache replacement. Notes,
  feedback and refinement are local and History-undoable; profile answers are not
  overwritten. Settings → Recommendations → Your feed memory reveals responses.
- User correction 2026-09-05: feedback is not dismissal. Votes and reasons must
  leave already-recommended cards visible, including on navigation/reload. Only
  explicit Dismiss hides a current card; future refresh selection still reads
  feedback. The cached feed is never rewritten by a feedback action.
  Correction verified with 18 focused component tests, TypeScript, ESLint and
  the disposable-vault recommendation E2E: vote/refinement/Skip keep the card
  visible after reload; Dismiss hides it; Undo restores visibility while retaining
  the preceding negative vote. The generated cache remains unchanged. The first
  browser run caught an ambiguous test selector shared with the companion's
  Dismiss button; scoping it to the paper card fixed the test, and the rerun passed.
- `usermodel/feed-memory.ts` reconstructs a feed-specific memory view from the
  canonical feedback JSON. Single votes enter planning and candidate assessment
  immediately, including new positive interests; selection uses topical overlap
  and recency, balances signs and caps each context at 24 records / 18,000 chars.
  Disable/reset/180-day expiry apply to this memory path as well as the older
  numeric topic bonus. Already-read and ordinary dismissal never become topic
  dislikes. The prior +/-5 cap applies only to the legacy bonus, NOT to changes
  in AI relevance assessments/searches from reason-aware memory. This is agent
  context personalization, not trained embeddings or an evaluated learned ranker.
  Refresh provenance stores supplied memory IDs. No venue adapter was added.
- Verification for Sparky feedback: 2,164 unit/component tests passed (15 gated
  skips), TypeScript and ESLint passed, and all 14 disposable-vault browser tests
  passed on the final full run. Light desktop/dark phone feedback screenshots
  were inspected. Tests cover reason persistence/reload, optional Skip, Enter
  submission, original vote/refinement Undo, stale revisions, cache rotation,
  memory selection and delivery to next-run planning/assessment, and disabled
  learning/reset. The E2E test now sets/restores its theme rather than assuming
  prior tests left light mode enabled. An earlier full run also had an intermittent
  existing Chat Send-disabled timeout; the final run passed it without changing
  Chat or route transitions in this task. No paid provider was called, user vault
  modified, or commit/push performed. Real-provider recommendation quality and
  the previously blocked production build remain separate acceptance gaps.

- Feed recommendation redesign approved and implemented on 2026-09-04; the
  recorded contract is `docs/design/07-recommendation-pipeline.md`, with a public
  explanation in README's "How the recommendation feed works" section.
  `src/lib/recommendation` now separates source-preserving retrieval, grounded
  0–4 relevance assessment, deterministic 70/20/10 relevance/recency/venue scoring,
  diversity-aware selection and bounded explicit-feedback learning. The live
  `runFeed` uses this pipeline; old rank/rerank exports remain only for compatibility.
  It retrieves a 14-day window, widens once to 90 days when sparse, balances queries,
  assesses at most 50 candidates, and selects up to 12 in recent/older/unknown-date
  groups. Scores and sources are inspectable; mandatory persuasive why-prose and
  refresh-triggered profile consolidation are removed.
- Topic diversity is editable in onboarding, Profile and Settings. Explicit
  more-like-this/not-my-topic feedback needs two independent papers per topic,
  decays with a 30-day half-life, expires at 180 days and affects a score by at
  most +/-5 points. It does not train on clicks or automatically rewrite the
  explicit profile or global weights. Disable and timestamped reset are
  revision-checked profile changes. Paper dismissals remain independent of the
  learning toggle. Feedback uses atomic History-undoable changesets at
  `profile/recommendation-feedback.json`; corrupt records are preserved and
  concurrent writes conflict rather than losing a vote. Export/import tests
  include preferences and feedback and exclude provider secrets.
- Venue scoring is an optional provenance-bearing injection contract, NOT a
  connected JIF or conference-ranking dataset. The live default remains unknown
  and neutral. Weight optimization, semantic grading accuracy and real-provider
  acceptance still need human/live evaluation; the defaults are not calibrated
  scientific-quality scores. Unranked fallbacks disclose incomplete preference
  checks and do not overwrite an existing cache.
- The browser now loads feed caches through `skills/feed-cache.ts`, not the
  server orchestrator. The browser-purity guard bans value imports from
  `skills/feed.ts`. Setup/onboarding omit keyed exit animations: the full browser
  trace showed the prior wrapper could remount BYOK setup after a key was typed,
  wiping the input and potentially restarting initialization. This is separate
  from the earlier auto-start timer guard fix documented below.
- Recommendation validation uses deterministic providers and disposable vaults;
  final verification: 2,152 unit/component tests passed (15 gated skips), all
  14 disposable-vault browser tests passed, and TypeScript, ESLint and
  `git diff --check` passed. A final 8-test onboarding/setup/recommendation
  browser rerun also passed after copy polish on 2026-09-05. Browser checks
  cover long onboarding at desktop/short-desktop/phone/short-phone/landscape
  sizes, first-feed setup with a new or saved connection, persisted diversity
  and learning controls, feedback/reload/History Undo, and existing streaming
  chat/project/export workflows. Onboarding preferences use a native dialog so
  they cannot push the current prompt out of the fixed-height transcript.
  No paid LLM request, user-vault reset, commit, push, merge or release was made
  for this implementation. Production build acceptance remains blocked on this
  host: Turbopack fails binding an internal CSS-worker port (`EPERM`); its webpack
  fallback exposes the existing Trending dashboard's server-provider import
  chain. Feed's own cache/orchestrator import chain was separated as described
  above. Do not report either attempted build as a successful release gate.

- First-feed setup could remain at "Sparky is preparing" without sending a
  request: `FeedRefreshBar` latched its auto-start guard before scheduling work,
  then StrictMode effect replay (or changed parent callbacks) cancelled the timer
  without clearing that guard. The guard now latches only inside the executing
  callback. Regression coverage includes effect replay, callback changes before
  and during startup, and unmount cancellation. Browser setup tests use the real
  onboarding/profile/settings flow and a local BYOK ping; feed transport/cache
  fixtures isolate external retrieval. They cover both a newly connected key and
  a saved key, completion into Home, and reopening setup without duplicate work.
  No paid provider validation was run for this fix. Tests should exercise the real
  setup child under StrictMode, not replace the refresh component with a button.
  Verification on 2026-09-04: 2,132 unit/component tests and all 13 disposable-vault
  E2E tests passed, along with TypeScript. The existing port-3111 server and
  redacted key-presence check succeeded outside the sandbox; a sandbox-only
  connection refusal must not be interpreted as proof that the preview is offline.
- Onboarding now uses a viewport-bounded chat panel: the header and composer
  remain visible while only the transcript scrolls. Question changes scroll the
  transcript locally (not the document), and typing preserves manual scrollback.
  The intro compacts on short screens, the app shell uses dynamic viewport height,
  and the duplicate floating mascot is absent on onboarding. The development
  badge is disabled because it intercepted the Back button on narrow previews;
  compile/runtime error overlays remain enabled. Layout regression tests cover
  five desktop/phone/landscape sizes, long replies, Back, both themes, and failed
  profile saving without completing onboarding in the user's active vault.
  Verification on 2026-09-04: the full 2,127-test unit suite and all 11 E2E tests
  passed. After the final short-screen padding adjustment, all 5 layout E2E
  tests and 9 focused onboarding/progressive-text tests passed again. Desktop,
  phone, and landscape screenshots were visually reviewed in light/dark themes.
- Chat, project Chat, reader Ask, and the companion bubble now stream provisional
  answer text from the configured provider (Anthropic, OpenAI-compatible/OpenRouter,
  or Gemini). Structured replies expose only their answer/utterance string while
  generating; schema/citation validation and transcript persistence still complete
  before the final result. Retry snapshots replace drafts instead of duplicating
  text, and dismissing a streaming companion bubble cannot reopen it. Thinking
  settings are unchanged and reasoning text is not displayed. Pre-BYOK onboarding
  remains scripted, with progressive prompt reveal, stable bubble sizing, and
  reduced-motion support; it does not pretend to call a model without a key.
  Verification on 2026-09-04: 2,126 unit/component tests passed (15 gated skips),
  TypeScript passed, and all 6 disposable-vault Playwright tests passed, including
  visible partial text before provider completion in Chat/project Chat/reader Ask
  and transcript reload. Provider tests used local fixtures, not paid endpoints.
  Light/dark onboarding was inspected in the browser without saving a test profile.
  An isolated production rebuild again hit the host's Turbopack CSS-worker
  internal-port `EPERM` after the font-download permission retry; no production
  build or release is claimed for these changes.
- Human acceptance feedback is being addressed on
  `codex/human-test-onboarding-profile-refresh`; the earlier candidate
  `65d6f561a595133d9a26671ca8cab14c207fffbc` is invalidated and must not be
  released as the preview candidate.
- The active branch now has a Sparky-led transcript onboarding with name first,
  a revision-checked profile editor for name/avatar/all onboarding answers, and
  atomic History-compatible profile mutations. Existing profiles without a
  `## Name` section safely open as `Researcher` so the user can rename them.
- Fresh onboarding now continues to `/setup`, where BYOK connection is the next
  explicit step. A successfully saved and tested key automatically starts the
  first feed refresh, shows stage-by-stage initialization progress, and ends in
  a ready state linking to Home. An existing usable feed skips setup work, while
  an existing configured key with no feed resumes initialization automatically.
  A persistent semantic light/dark toggle is visible in desktop and mobile
  navigation, and onboarding response bubbles use inverse theme tokens for
  readable contrast. The 2026-09-04 gate passed 2,099 tests with 15
  environment-gated skips, TypeScript, ESLint, and `git diff --check`; live
  dark-mode browser inspection of `/setup` passed with no Next.js issue overlay.
  No real provider key was entered during this verification. The exact-current
  Turbopack build remains blocked by the Codex host's CSS-worker internal-port
  `EPERM`; the supported webpack fallback reaches the tree's pre-existing
  client/server import incompatibility and is not a clean production-build gate.
- `/papers` is now an AI-driven research search rather than a one-source keyword
  form. Sparky plans 2-6 profile-aware, source-specific queries across the
  user-selected arXiv, OpenAlex, Semantic Scholar, and PubMed scope; retrieval
  runs concurrently, records are interleaved/deduplicated, and a second bounded
  AI pass ranks up to 15 results with metadata-grounded explanations. The UI
  exposes the interpreted intent, exact date bound, ordering, query/rationale
  provenance, retrieval counts, and per-result source trail. A ranking failure
  preserves source-order results with an explicit warning, while no real
  provider call was made during deterministic verification. The 2026-09-04
  search gate passed the full 2,109-test suite with 15 environment-gated skips,
  TypeScript, ESLint, `git diff --check`, and live light/dark browser inspection.
- Feed refresh and its pre-refresh consolidation are server single-flight so a
  reload or second tab joins existing paid work. Structured feed prompts request
  Qwen non-thinking mode, candidate ranking is capped at two 25-paper batches,
  and the UI shows real stage plus elapsed time. Opening Home no longer starts a
  background trending LLM refresh; paid trending refresh remains explicit.
- The 2026-08-29 deterministic checks for these acceptance fixes passed: 2,075
  tests passed with 15 environment-gated skips, `npx tsc --noEmit` passed,
  ESLint passed, and all 4 Playwright developer-preview scenarios passed. A
  production build generated 53 routes before the final no-post-commit-reread
  hardening; the exact-current Turbopack rebuild later hit a Codex sandbox-only
  internal-port denial (Webpack is not a supported fallback for this tree).
  The current source is running through the loopback development server at
  `http://127.0.0.1:3111` with the correct preserved disposable vault for the
  next human walkthrough. A clean exact-current production build remains a
  candidate gate, not a confirmed result.
- Human feed acceptance exposed Qwen inconsistently removing the object wrapper
  from each feed schema whose only property is a list: first `feed-rank`'s
  `{ scores: [...] }`, then `feed-strategy`'s `{ queries: [...] }` on the next
  attempt. Strategy, rank, and rerank now explicitly normalize their equivalent
  bare-list wire form before strict validation while still advertising the
  original root-object JSON schema; all item, score, and index constraints remain
  strict. One full-pipeline
  regression replays bare arrays through all three stages. Next-specific
  single-flight test reset hooks were also moved out of `route.ts` modules so
  Next 16 generated route types remain valid. Subsequent real-provider attempts
  exposed a second, independent Qwen failure: the configured `Qwen/Qwen3.8-27B`
  exhausted exactly both 2,048-token strategy allowances or both 4,096-token
  rerank allowances before returning incomplete JSON. The `/no_think` prompt
  hint was therefore not reliably disabling GMI-hosted Qwen thinking. Feed
  requests now opt into an internal `thinking: "disabled"` control, and the
  OpenAI-compatible adapter maps that opt-in only for Qwen models to Qwen's
  documented `chat_template_kwargs.enable_thinking: false` plus its non-thinking
  sampling settings. Other models' payloads are unchanged. A user-triggered
  real GMI/Qwen refresh after the hard switch completed the product route in 101
  seconds: strategy, two rank batches, and rerank all succeeded, and the cache
  contains 12 items selected from 50 ranked candidates. Individual arXiv 429s
  degraded retrieval but did not fail the refresh. Digest acceptance then
  exposed another root-array variant. Digest now explicitly requires one root
  object and safely normalizes only a singleton object wrapper or unique digest
  fields split across an array before applying the original strict schema. It
  retains controlled Qwen thinking at `medium` effort with an 8,192-token cap.
  A subsequent user-triggered live digest completed successfully through the
  product route in 22.3 seconds (383 input and 1,028 output tokens), and later
  requests correctly reused its cache. The focused 60-test
  provider/structured/feed/digest/API gate, full 2,075-test suite, TypeScript,
  and ESLint pass. The exact-current production build still reaches the known
  Codex-host Turbopack CSS-worker internal-port `EPERM`, not a source diagnostic.
- The paper detail page now uses a responsive research-desk layout rather than
  a fixed `max-w-3xl` column: a wider editorial header and actions lead into a
  primary evidence column plus a sticky 340px context rail on wide screens.
  Feed rationale is a three-part comparison strip, digest typography and
  sections have clearer hierarchy, and smaller viewports stack everything
  without horizontal overflow. Dark desktop (1600x1000) and mobile (390x844)
  screenshots were visually inspected; all 22 focused paper tests, the full
  2,075-test suite, TypeScript, and ESLint pass.
- A generated paper digest is durably restored from its validated
  `.scispark/digests/<paper-slug>.json` cache whenever the paper page opens.
  Hydration uses a read-only GET route that cannot acquire full text or invoke
  an LLM; missing/corrupt cache records degrade to a normal miss, and canonical
  slug validation blocks traversal. A headless-browser reload of the exact
  human-acceptance paper showed the digest before and after reload with only GET
  requests, and the generated action is visibly complete/non-clickable. The
  persistence checkpoint passed 2,081 tests with 15 environment-gated skips,
  TypeScript, ESLint, and `git diff --check`.
- The reader's unavailable-full-text state now centers a clear external-source
  handoff instead of showing a detached technical error card. Canonical DOI,
  arXiv, and PubMed records take precedence, followed by validated HTTP(S)
  source URLs and stable metadata records; unsafe URL schemes are rejected.
  The exact human-acceptance paper resolves to its DOI in a new tab, with the
  paper-detail return kept secondary. Desktop dark and mobile light browser
  screenshots passed without horizontal overflow. The exact-current gate
  passes 2,086 tests with 15 environment-gated skips, TypeScript, ESLint, and
  `git diff --check`.
- During visual QA, a preview was initially launched with the incorrect
  `SCISPARK_VAULT_PATH` variable instead of `SCISPARK_VAULT`. It therefore read
  the configured default vault and Home triggered companion/trending work before
  the processes were stopped. Four successful LLM runs recorded $0.045597 total
  usage and updated the default vault's usage, run, event, and trending-cache
  files. With user approval, the entirely incident-created usage log, event log,
  and four run records were backed up and removed on 2026-08-29. The prior
  trending cache had been overwritten and no exact backup or reconstructable
  copy existed, so the valid refreshed dashboard was retained rather than
  causing further data loss. The seven incident artifacts, including that
  dashboard, are recoverably copied under
  `/private/tmp/scispark-incident-backup.ZrawFe` for this machine session.

- SP5 PR #18 is merged into `main` at merge commit
  `5e729f8c22aff0a38450fe16f635ca9b78dd98f5`.
- SP6 foundation PR #19 is merged into `main` at merge commit
  `f45e61b9e88db973811b7d69e08073133ed17e13`.
- SP6 Projects PR #20 is merged into `main` at merge commit `d4b5e8c`. SP6
  project-chat/History PR #21 is merged into `main` at merge commit `aed6f07`.
  SP6 PR 4 developer-preview hardening is merged through PR #22 at merge commit
  `baa1708b790823b6c80b2a6e835ff0b7f82c6a8a`. All four approved SP6
  implementation PRs are now merged. The next gate is a complete local human
  product walkthrough against one exact commit, followed by separately approved
  provider/PDF gates and a GitHub developer preview, not a desktop or npm
  release.
- PR #15 (`loop/loop-engineering-hardening`) was triaged on 2026-08-29 and
  converted to draft. Its run-ledger, scheduler, backoff, acceptance-metric,
  post-ingest-lint, and projective-budget ideas were not merged elsewhere, but
  the 44-file branch is 88 commits behind `main` and conflicts with the current
  runtime. Preserve it as a post-preview reference; do not merge or rebase it
  into the human-test candidate.
- The SP6 design and implementation plan are recorded under
  `docs/superpowers/specs/2026-08-10-sp6-projects-history-design.md` and
  `docs/superpowers/plans/2026-08-10-sp6-projects-history.md`.
- This session generated and validated an Understand Anything knowledge graph for
  all 599 scanned files. The graph contains 1,357 nodes, 2,997 edges, 9 exhaustive
  architecture layers, and a 15-step guided tour; no application behavior changed.
- PR 1 foundation work strictly validates changesets and persisted records,
  derives applied/reverted/diverged state from live contents, serializes vault
  changesets and log appends, returns warnings for post-commit derived refresh
  failures, and exposes content-free History plus persisted-ID-only undo APIs.
- The SP6 foundation deterministic gate passed on 2026-08-10: 2,008 tests
  passed with 15 environment-gated skips, `npx tsc --noEmit` passed,
  `npm run lint` passed, and the Next.js production build generated all 51
  pages successfully.
- PR 2 adds schema-routed stable project pages, full-page SHA-256 revisions,
  strict project APIs, page-authoritative membership, routed project-note CRUD,
  atomic delete-and-unlink previews, real project/paper/note UI, and explicit
  legacy-prototype-data dismissal without migration.
- The PR 2 deterministic gate passed on 2026-08-11: 2,018 tests passed with 15
  environment-gated skips, `npx tsc --noEmit` passed, `npm run lint` passed,
  and the Next.js production build generated all 52 pages successfully.
- PR 3 adds persisted stable project chat scope/title snapshots, current-member
  retrieval with a paper-only subset, project guidance subordinate to grounding,
  deterministic 16k-per-page/64k-total context limits with visible truncation,
  deleted-project fail-closed behavior, project conversation UI, URL-addressable
  Conversations/Changes History, safe applied-only Undo, and the real Library
  redirect.
- The PR 3 deterministic gate passed on 2026-08-21: 2,032 tests passed with 15
  environment-gated skips, `npx tsc --noEmit` passed, `npm run lint -- --quiet`
  passed, and the Next.js production build generated all 52 pages successfully.
- PR 3 implementation commit `ab4aae2` and documentation follow-up `9fd503c`
  were merged through PR #21 at `aed6f07`.
- The pre-merge audit hardened full chat-session shape validation and serialized
  same-session turns in the local runtime so concurrent tabs cannot lose transcript
  updates.
- PR 4 adds Playwright 1.62 with a fresh temporary vault, isolated Next build,
  dynamic loopback ports, and a local no-cost OpenAI-compatible fake. Its browser
  gate covers request security, project creation, paper membership, note
  create/edit, project-scoped chat, conversation/change History, deletion/undo,
  stale revisions, corrupt project/chat/changeset isolation, explicit legacy-data
  deletion, and export/import restoration of project/chat/wiki/History state.
- Development and production-preview scripts bind to `127.0.0.1`. A Next.js 16
  proxy rejects mutating API requests with non-loopback Host or unsafe
  Origin/fetch-site signals. Generic vault paths are strict relative paths,
  generic clients cannot write/delete changeset audit records, and ZIP imports
  validate every entry before writing while excluding settings case-insensitively.
- The PR 4 deterministic gate passed on 2026-08-21: 2,057 tests passed with 15
  environment-gated skips, `npx tsc --noEmit` passed, `npm run lint -- --quiet`
  passed, the production build generated all 52 routes, and all 4 Playwright
  scenarios passed against a disposable on-disk vault.
- Developer-preview hardening upgraded the vulnerable runtime dependency set to
  Next.js and eslint-config-next 16.3.2, pdfjs-dist 6.2.108,
  fast-xml-parser 5.10.1, and the current patched DOMPurify release. A final
  `npm audit` reported zero production or development vulnerabilities before
  the exact-tree gate was rerun.
- An optimized `npm run preview` smoke on 2026-08-21 confirmed Next.js 16.3.2
  bound only to `127.0.0.1`, scaffolded a disposable vault with HTTP 200, and
  returned HTTP 403 for an unsafe Host/Origin mutation. The temporary server
  and vault were removed afterward.
- Developer-preview clone/install/run, vault location, backup, security, and
  known-limit guidance is recorded in `docs/DEVELOPER_PREVIEW.md`. No GitHub
  prerelease or tag has been published.
- Human acceptance uses an exact commit SHA. Any source, dependency, or
  configuration change after the candidate is designated invalidates that
  candidate and requires a fresh deterministic gate plus another affected-flow
  walkthrough. The local full-product walkthrough has not yet been completed.
- The deterministic verification gate passed on 2026-08-09: 1,982 tests passed
  with 15 environment-gated skips, `npx tsc --noEmit` passed, `npm run lint`
  passed, and the Next.js production build generated all 50 pages successfully.
- The July 28 real-provider SP5 acceptance was not rerun during Phase 0; current
  verification is deterministic and does not make a new live-LLM claim.
- The final `.understand-anything` graph, metadata, fingerprints, and ignore
  configuration are intentional project artifacts; intermediate and temporary
  analysis output should not be committed.

# Known Pitfalls

- The vault override is `SCISPARK_VAULT`, not `SCISPARK_VAULT_PATH`. Resolve and
  verify the effective vault before opening any route that can trigger provider
  work; never assume a temporary-vault preview from the command label alone.

- Do not rely on generic Next.js knowledge for this installed version; consult
  `node_modules/next/dist/docs/` first.
- Do not trust the README's old mocked/localStorage architecture claim without
  reconciling it with the current source and `CLAUDE.md`.
- Do not import server-only modules into client components. Browser-purity tests
  enforce this boundary.
- Do not return persisted API-key values to the browser or expose
  `.scispark/settings.json` through generic vault routes.
- Do not bypass changesets for agent-authored vault mutations, and do not leave
  partial writes after validation failure.
- Never accept client-supplied paths or file contents for undo. Resolve a strict
  persisted audit record by safe `changesetId`, and do not add a force-revert
  API or UI.
- Project membership mutations accept a validated wiki page ID plus its current
  content revision, never client-supplied page contents. Project deletion must
  confirm both the project revision and the composite deletion-preview revision
  before the one atomic delete-and-unlink changeset is committed.
- Do not give an inline `dangerouslySetInnerHTML={{ __html: ... }}` object a new
  identity on each render; React 19.2 can recreate the DOM and break selection.
- Do not perform incrementing or other side effects inside JSX expressions; key
  evaluation order can create duplicate sibling keys.
- Treat live LLM tests as explicit, cost-bearing gates. Ordinary verification
  should use deterministic unit tests, lint, type-checking, and builds.
- Do not run Playwright directly with `npx playwright test`; use `npm run e2e`
  so the runner provisions and cleans a disposable vault, isolated build, and
  dynamic loopback ports.
- Do not expose the preview on a LAN/public interface. It has no local auth
  token; mutation security assumes the supplied loopback binding.
- Chat context is capped at 16,000 characters per selected page and 64,000
  characters total. Any affected page IDs must remain persisted and visible to
  the user; do not silently remove this disclosure.
- Chat transcript serialization is process-local and keyed by the shared
  `VaultStorage` instance. A future multi-process/sync backend needs its own
  cross-process concurrency control.
