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
- `README.md` still describes the older prototype as entirely mocked and
  localStorage-backed. `CLAUDE.md`, current source, and milestone status blocks
  are more accurate for the implemented architecture.
- The filesystem is case-insensitive: `agents.md` and `AGENTS.md` resolve to the
  same file/inode.

# Current Release/Session State

- Baseline inspected at commit `96b52995bfb5ef2df28a6b649fc2277670b7a431`
  on branch `uiux/sp5-kb-chat`; the worktree was clean before memory scaffolding.
- SP5 knowledge-base chat is present and documented as built/live-verified.
- The documented remaining UI/UX milestone is SP6: real Projects and History plus
  a general changeset-undo surface. Chat event integration into the Tier-1 user
  model is also recorded as a future product decision.
- This session generated and validated an Understand Anything knowledge graph for
  all 599 scanned files. The graph contains 1,357 nodes, 2,997 edges, 9 exhaustive
  architecture layers, and a 15-step guided tour; no application behavior changed.
- Phase 0 stabilization is in progress on `uiux/sp5-kb-chat`: the eight existing
  ESLint findings were removed, full-root lint now ignores `.claude/**`, and the
  README/roadmap were updated from the fork-era mock architecture to the current
  local-runtime model.
- The deterministic verification gate passed on 2026-08-09: 1,979 tests passed
  with 15 environment-gated skips, `npx tsc --noEmit` passed, `npm run lint`
  passed, and the Next.js production build generated all 50 pages successfully.
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
- Do not give an inline `dangerouslySetInnerHTML={{ __html: ... }}` object a new
  identity on each render; React 19.2 can recreate the DOM and break selection.
- Do not perform incrementing or other side effects inside JSX expressions; key
  evaluation order can create duplicate sibling keys.
- Treat live LLM tests as explicit, cost-bearing gates. Ordinary verification
  should use deterministic unit tests, lint, type-checking, and builds.
