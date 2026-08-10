# Project Overview

SciSpark Paper Manager is a local-first, AI-assisted research radar and personal
knowledge-base application. It discovers and digests literature, stores a
user-owned Markdown vault, supports grounded chat and research-idea generation,
and derives wiki, trend, and graph views from that vault.

# Tech Stack

- Next.js 16.2 App Router, React 19.2, and TypeScript 5 in strict mode.
- Tailwind CSS 4 with semantic theme tokens in `src/app/globals.css`.
- Zustand for the remaining client-side UI state.
- Vitest 4 and jsdom for unit/component tests; ESLint 9 with Next.js rules.
- Zod for runtime schemas; Anthropic and OpenAI-compatible LLM providers.
- A server-owned, filesystem-backed Markdown vault exposed to the browser through
  local Next.js API routes.
- Sigma.js, Graphology, and D3 for derived research visualizations; pdf.js and
  DOMPurify for the reader.

# Essential Commands

- `npm install` — install dependencies.
- `npm run dev` — run the local Next.js development server.
- `npm run build` — create a production build.
- `npm run start` — serve the production build.
- `npm test` — run the full Vitest suite once.
- `npm run test:watch` — run Vitest in watch mode.
- `npm run lint` — run ESLint.
- `npx tsc --noEmit` — type-check without emitting files.

Real-money live LLM tests are environment-gated and must not be run as ordinary
CI/unit tests. See `CLAUDE.md` and the relevant milestone plan for the exact gate.

# Engineering Conventions

- Read the relevant guide under `node_modules/next/dist/docs/` before changing
  Next.js code; this installed version has breaking API and file-layout changes.
- Preserve the browser/server boundary: client code talks to the local runtime
  through API clients and must not import server-only filesystem or secret code.
- Keep LLM skills pure and storage-free; orchestrators own persistence, filtering,
  degradation behavior, cost metering, and atomic changesets.
- Mutations to the research vault must be schema-validated, atomic, and undoable.
- Use the `@/*` alias for `src/*`, follow the local file's formatting, and add
  focused regression tests for behavior changes.
- Use semantic CSS tokens; raw color literals in components are guarded by tests.
- Any `dangerouslySetInnerHTML` wrapper must have stable object identity under
  React 19.2. Never perform side effects inside JSX expressions; compute keys and
  values before rendering.
- Do not expose stored LLM keys to the client. The settings API redacts key values,
  and the generic vault-file API must keep `.scispark/settings.json` inaccessible.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
