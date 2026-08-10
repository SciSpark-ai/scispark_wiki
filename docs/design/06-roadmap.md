# SciSpark execution roadmap

This file is the short current roadmap. Detailed decisions live in the linked
specifications and implementation plans under `docs/superpowers/`.

## Foundation milestones

The original local-first product foundation is implemented.

| Milestone | Delivered | Status |
|---|---|---|
| M1 | Markdown vault, schemas, bundles, changesets, export/import | Built |
| M2 | LLM providers, tier mapping, structured output, metering, budgets | Built |
| M3 | Paper search, resolve, fetch, and citation relays | Built |
| M4 | Digest, ingest, wiki, review queue, and undo | Built |
| M5 | Event log, user model, personalized feed, consolidation | Built |
| M6 | HTML/PDF reader, highlights, select-to-ask | Built; PDF acceptance remains a release gate |
| M7 | Research companion and deterministic proactivity | Built |
| M8 | Graph, timeline, citation-flow, and author visualizations | Built |
| M9 | Quick and Deep Spark research-idea generation | Built |
| M10 | Personalized Academia Right Now dashboard | Built |
| M11 | Local Next.js runtime, filesystem vault, server-held BYOK settings | Built |
| M12 | Vault lint, spend panel, export/import QA, runtime hardening | Built |

## Product-system refresh

The six-part refresh turns the foundation into one coherent product.

| Milestone | Delivered | Status |
|---|---|---|
| SP1 | Shell, navigation, design tokens, settings system | Built |
| SP2 | Coherent discover → paper → read → digest → save loop | Built |
| SP2.1 | Feed and paper-page follow-ups | Built |
| SP3 | Knowledge-base dashboard and visualization workspace | Built |
| SP4 | Academia Right Now trending redesign | Built |
| SP5 | Real grounded knowledge-base chat and saved query pages | Built on `uiux/sp5-kb-chat`; integration pending |
| SP6 | Real Projects plus conversation/change History and global undo | Next |

## Immediate execution order

### 0. Integrate SP5

1. Preserve the project-memory and architecture-graph scaffolding.
2. Remove the ESLint baseline and exclude generated nested worktrees.
3. Make README and roadmap describe the current runtime truthfully.
4. Run unit tests, type-checking, lint, production build, and a real-vault chat
   smoke test.
5. Push, review, and merge `uiux/sp5-kb-chat` into `main`.

### 1. Specify SP6

- Project pages under `wiki/projects/` are the project source of truth.
- Member pages keep canonical `projects: [...]` frontmatter.
- Project create/update/rename/delete and membership mutations are changesets.
- Chat sessions may carry an optional project scope.
- History has separate Conversations and Changes views.
- Changeset state is derived by comparing current files with stored `before` and
  `after` content; diverged files are never overwritten silently.

### 2. Implement real Projects

- Add the vault-backed project domain and focused tests.
- Replace `/projects`, `/projects/[id]`, Save-to-Project, and project notes.
- Add honest loading, empty, error, conflict, and deletion states.
- Remove the legacy mock/localStorage project persistence path.

### 3. Implement global History and undo

- List changeset summaries and affected files.
- Classify records as applied, reverted, or diverged.
- Preview and safely revert applicable changesets.
- Keep force-revert out of the ordinary UI.

### 4. Release hardening

- Remove or redirect the legacy mock Library route.
- Add browser E2E coverage for the primary research and recovery loops.
- Verify loopback binding, host/origin handling, settings redaction, path
  traversal protection, corrupted-file behavior, and backup recovery.
- Re-run cost-bearing provider gates with explicit approval against the exact
  release commit.
- Decide whether the first release is an npm-based developer preview or a
  packaged desktop beta.

## Release definition

The local beta is ready only when:

- no primary navigation route is mock-backed;
- every agent-authored vault mutation is recoverable through the UI;
- tests, type-checking, lint, build, and browser acceptance pass;
- a real disposable vault completes the full discover → read → retain → chat →
  project → undo journey;
- secret handling and backup recovery are verified against the release commit.

## Explicitly deferred

- Auto-ingesting saved chat answers
- Embeddings and vector search
- Chat-driven personalization events
- Cloud sync, accounts, collaboration, and hosted multi-user infrastructure
- Public trending infrastructure
- New Spark modes and non-blocking reader polish
