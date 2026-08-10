# Verified Facts

- The repository is `scispark-app-frontend`, a private Next.js 16.2.1 / React
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
- `README.md` now describes the implemented local-runtime architecture and
  labels Projects and the legacy Library route as remaining prototype surfaces.
- The filesystem is case-insensitive: `agents.md` and `AGENTS.md` resolve to the
  same file/inode.

# Current Release/Session State

- SP5 PR #18 is merged into `main` at merge commit
  `5e729f8c22aff0a38450fe16f635ca9b78dd98f5`.
- SP6 implementation is active on `codex/sp6-foundation`, created from that
  updated `main` commit. The approved delivery is four sequential reviewable
  PRs ending in a GitHub developer preview, not a desktop or npm release.
- The SP6 design and implementation plan are recorded under
  `docs/superpowers/specs/2026-08-10-sp6-projects-history-design.md` and
  `docs/superpowers/plans/2026-08-10-sp6-projects-history.md`.
- This session generated and validated an Understand Anything knowledge graph for
  all 599 scanned files. The graph contains 1,357 nodes, 2,997 edges, 9 exhaustive
  architecture layers, and a 15-step guided tour; no application behavior changed.
- PR 1 foundation work now strictly validates changesets and persisted records,
  derives applied/reverted/diverged state from live contents, serializes vault
  changesets and log appends, returns warnings for post-commit derived refresh
  failures, and exposes content-free History plus persisted-ID-only undo APIs.
- The SP6 foundation deterministic gate passed on 2026-08-10: 2,008 tests
  passed with 15 environment-gated skips, `npx tsc --noEmit` passed,
  `npm run lint` passed, and the Next.js production build generated all 51
  pages successfully.
- SP6 foundation commit `5915084` is published in draft PR #19 from
  `codex/sp6-foundation` to `main`. PR 2 must start from updated `main` only
  after PR #19 is reviewed and merged.
- The pre-merge audit hardened full chat-session shape validation and serialized
  same-session turns in the local runtime so concurrent tabs cannot lose transcript
  updates.
- The deterministic verification gate passed on 2026-08-09: 1,982 tests passed
  with 15 environment-gated skips, `npx tsc --noEmit` passed, `npm run lint`
  passed, and the Next.js production build generated all 50 pages successfully.
- The July 28 real-provider SP5 acceptance was not rerun during Phase 0; current
  verification is deterministic and does not make a new live-LLM claim.
- The final `.understand-anything` graph, metadata, fingerprints, and ignore
  configuration are intentional project artifacts; intermediate and temporary
  analysis output should not be committed.

# Known Pitfalls

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
- Do not give an inline `dangerouslySetInnerHTML={{ __html: ... }}` object a new
  identity on each render; React 19.2 can recreate the DOM and break selection.
- Do not perform incrementing or other side effects inside JSX expressions; key
  evaluation order can create duplicate sibling keys.
- Treat live LLM tests as explicit, cost-bearing gates. Ordinary verification
  should use deterministic unit tests, lint, type-checking, and builds.
- Chat selected-page count is capped, but selected non-paper page bodies are not
  yet character/token capped. Measure real vault sizes before setting a truncation
  policy; do not silently introduce one that can remove answer-bearing context.
- Chat transcript serialization is process-local and keyed by the shared
  `VaultStorage` instance. A future multi-process/sync backend needs its own
  cross-process concurrency control.
