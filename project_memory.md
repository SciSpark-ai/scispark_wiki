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

- Human acceptance feedback is being addressed on
  `codex/human-test-onboarding-profile-refresh`; the earlier candidate
  `65d6f561a595133d9a26671ca8cab14c207fffbc` is invalidated and must not be
  released as the preview candidate.
- The active branch now has an Ember-led transcript onboarding with name first,
  a revision-checked profile editor for name/avatar/all onboarding answers, and
  atomic History-compatible profile mutations. Existing profiles without a
  `## Name` section safely open as `Researcher` so the user can rename them.
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
