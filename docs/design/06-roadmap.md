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
| SP5 | Real grounded knowledge-base chat and saved query pages | Built and merged in PR #18 |
| SP6 | Real Projects plus conversation/change History and global undo | Foundation in progress |

## Immediate execution order

### 1. Establish the SP6 foundation

- Validate changesets and persisted audit records strictly.
- Serialize mutations, rebuild derived data, and report post-commit warnings.
- Derive applied/reverted/diverged state from current contents.
- Expose content-free History summaries and persisted-ID-only undo.

### 2. Implement real Projects

- Add the vault-backed project domain and focused tests.
- Replace `/projects`, `/projects/[id]`, Save-to-Project, and project notes.
- Add honest loading, empty, error, conflict, and deletion states.
- Remove the legacy mock/localStorage project persistence path.

### 3. Implement project chat and History UI

- Scope chat to direct project members with deterministic context caps.
- Preserve deleted-project transcripts without global fallback.
- Add URL-addressable Conversations and Changes tabs.
- Preview and safely undo only currently applied changesets; there is no force
  API or UI.

### 4. Release hardening

- Remove or redirect the legacy mock Library route.
- Add browser E2E coverage for the primary research and recovery loops.
- Verify loopback binding, host/origin handling, settings redaction, path
  traversal protection, corrupted-file behavior, and backup recovery.
- Re-run cost-bearing provider gates with explicit approval against the exact
  release commit.
- Publish an npm-installed source checkout as a GitHub developer prerelease.
  Desktop packaging and npm-registry publication remain deferred.

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
