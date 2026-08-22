# SciSpark Paper Manager

SciSpark is a local-first, AI-assisted research radar and personal knowledge
base. It helps researchers discover papers, read and annotate source material,
turn evidence into a Markdown wiki, ask grounded questions, and develop research
ideas while keeping the vault and API keys on the user's machine.

## Current status

SciSpark is an internal alpha moving toward a local beta. The core research
workflows and Projects are real and vault-backed. The remaining SP6 work adds
project-scoped chat, the global History UI, and developer-preview hardening.

| Surface | Status |
|---|---|
| Search, paper pages, digest, ingest, wiki, review inbox | Vault-backed |
| Personalized feed, profile, companion, trending | Vault-backed |
| Reader, highlights, select-to-ask | Vault-backed |
| Knowledge-base chat and saved answers | Vault-backed |
| Projects, membership, and project notes | Vault-backed |
| Visualization, Spark, lint, spend tracking | Vault-backed |
| Conversation history | Vault-backed |
| Project-scoped chat and Changes History UI | SP6 follow-up |
| Legacy Library route | Prototype; redirect scheduled in SP6 |

See [project_memory.md](./project_memory.md) for the verified repository baseline
and [docs/design/06-roadmap.md](./docs/design/06-roadmap.md) for the execution
roadmap.

## Runtime model

The browser is the UI. A local Next.js server owns the runtime:

```text
Browser UI
   │ same-origin API calls
   ▼
Local Next.js runtime
   ├── filesystem Markdown vault
   ├── LLM skill orchestration and usage metering
   ├── server-held BYOK settings
   └── paper search, resolve, fetch, and citation relays
```

The default vault is `~/SciSpark/vault`. Set `SCISPARK_VAULT` to use another
folder. Agent-authored vault mutations use validated, conflict-checked
changesets with persisted undo records. Derived wiki, trend, timeline, and graph
views are rebuilt from the vault instead of becoming separate sources of truth.

Stored LLM keys are never returned to the browser. The settings API exposes only
presence flags, and the generic vault-file API blocks access to
`.scispark/settings.json`.

## Stack

- Next.js 16.2 App Router, React 19.2, and strict TypeScript 5
- Tailwind CSS 4 with semantic theme tokens
- Zustand for remaining client-only UI state
- Vitest 4 and jsdom for unit/component tests
- Zod schemas and Anthropic/OpenAI-compatible LLM providers
- Sigma.js, Graphology, and D3 for research visualizations
- pdf.js and DOMPurify for the reader

This Next.js version includes breaking API and file-layout changes. Read
[AGENTS.md](./AGENTS.md) and the relevant installed guide under
`node_modules/next/dist/docs/` before changing Next.js code.

## Getting started

Requirements: a current Node.js runtime and npm.

```bash
npm install
cp .env.example .env.local   # optional public-data credentials
npm run dev
```

Open <http://localhost:3000>. Configure an LLM provider through Settings in the
app. Normal use does not require placing an LLM key in `.env.local`.

For a production-mode local run:

```bash
npm run build
npm run start
```

The v1 trust model assumes a loopback-only local server. There is currently no
local auth token, so do not bind the app to a public or shared network interface.

## Verification commands

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Live LLM tests use real credentials, network services, and money. They are
environment-gated and must be run as explicit release gates, not as ordinary
unit tests. The relevant milestone plan documents the required variables and
acceptance assertions.

## Optional public-data credentials

| Variable | Required? | Purpose |
|---|---|---|
| `SCISPARK_VAULT` | No | Override the default `~/SciSpark/vault` location |
| `OPENALEX_MAILTO` | Recommended | OpenAlex polite-pool contact |
| `OPENALEX_API_KEY` | No | Higher OpenAlex credit allowance |
| `UNPAYWALL_EMAIL` | Required for Unpaywall resolution | Contact required by Unpaywall |
| `S2_API_KEY` | No | Higher Semantic Scholar limits and citation lookup |
| `NCBI_API_KEY` | No | Higher PubMed limits |

## Repository layout

```text
src/app/          App Router pages and local API routes
src/components/   Product UI and interaction components
src/lib/chat/     Grounded KB chat and session persistence
src/lib/llm/      Provider abstraction, settings, budgets, metering
src/lib/skills/   Pure skill definitions and shared runner
src/lib/vault/    Storage adapters, schemas, bundles, changesets
src/lib/wiki/     Ingest, authoring, review, lint, derived dashboards
src/lib/papers/   Search providers, normalization, resolution
src/lib/spark/    Quick and Deep research-idea workflows
src/lib/trending/ Deterministic trend metrics and qualitative surveys
docs/design/      Product and architecture decisions
docs/superpowers/ Milestone specifications and implementation plans
```

## Engineering rules

- Preserve the browser/server boundary. Client modules must not import
  filesystem, secret, or server-only code.
- Keep skills storage-free. Orchestrators own persistence, filtering,
  degradation, metering, and atomic changesets.
- Make vault mutations schema-validated, atomic, and undoable.
- Use semantic CSS tokens rather than raw component colors.
- Add focused regression tests for behavior changes.

See [CLAUDE.md](./CLAUDE.md) for the detailed decision ledger and
[AGENTS.md](./AGENTS.md) for the concise working contract.
