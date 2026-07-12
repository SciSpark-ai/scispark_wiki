# M4: Ingest + Wiki UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product's heart: click "Add to knowledge base" on a real paper → the agent generates/updates wiki pages through the safe changeset path → browse/edit the wiki, work the review queue, undo any ingest. Digest Skill included; live-gated end-to-end with GMI Cloud.

**Architecture:** New framework-free libraries `src/lib/wiki/` (schema routing, authoring helpers, acquisition) and `src/lib/skills/{digest,ingest}.ts` (skills on the M2 runner), plus app UI (`/wiki`, `/papers`, review inbox). All agent writes flow through M1 changesets validated against `schema.md` routing. Spec: docs/design/02-system.md (ingest pipeline, review queue) + 04 (skill roster).

**Tech Stack:** M1 vault + M2 harness + M3 proxy, Milkdown (wiki editor — API drift-guarded), zod schemas for skill outputs, DOMParser for HTML text extraction.

## Global Constraints

- **Scope decisions (controller, from ledger gates + design):** PDF *text extraction* is deferred to M6 (reader milestone) — M4 ingests with HTML full text when available, else abstract-only (`full_text: false` in paper frontmatter). Binary vault storage API lands in Task 1 (gate) but M4 stores only text snapshots. Highlights context = empty array (M6 wires it).
- **Deterministic over generative:** code (never the LLM) writes: frontmatter `created`/`updated` dates, paper-page structured ids (doi/arxiv/openalex/authors/year/venue/projects), author page skeletons, `index.md`, `log.md`. The LLM produces knowledge content only (page bodies, tags, related, types, titles).
- All agent mutations = one atomic changeset via `applyChangeset` (already guards reserved paths + audit namespace). Every ingest is revertable via `revertChangeset`.
- Skill outputs via `ctx.llmStructured` with zod schemas — no delimiter parsing (design decision).
- Prompt lineage: adapt llm_wiki's analysis/generation prompt structure (clone in session scratchpad at `<scratchpad>/llm_wiki/src/lib/ingest.ts` `buildAnalysisPrompt`/`buildGenerationPrompt`; re-clone https://github.com/nashsu/llm_wiki if absent). Keep their section discipline (Key Entities/Concepts/Arguments/Connections/Contradictions/Recommendations; subject-boundary rules); adapt to our 10-type schema and structured output.
- UI pages follow existing app conventions (AppShell already present from M0 fork); no design polish (M11).
- Vitest for libraries; UI verified via dev-server + browser gates. `npm test` green throughout (319 baseline).
- Live tests env-gated exactly like `live-openai-compat.test.ts` (LIVE_LLM_* vars); never in CI.

---

### Task 1: Vault gate upgrades (error kinds, binary storage, locked bootstrap)

**Files:** modify `src/lib/vault/bundle.ts`, `src/lib/vault/storage.ts`, `src/lib/vault/memory-storage.ts`, `src/lib/vault/opfs-storage.ts`, `src/lib/vault/get-vault.ts`, `src/lib/vault/scaffold.ts` (+tests)

**Contracts:**
- `Bundle.errors` entries gain `kind: "parse" | "ambiguity"` (parse failures vs ambiguous-wikilink records). Update producers + tests; additive for consumers.
- `VaultStorage` gains `readBinary(path): Promise<Uint8Array | null>` and `writeBinary(path, data: Uint8Array): Promise<void>`; memory + OPFS implementations; extend `storage-contract.ts` suite (round-trip bytes, missing → null); zip export/import handles binary entries losslessly (fflate already byte-based — add a round-trip test with binary content; text `read()` of a binary path may return mojibake — document: callers know which paths are binary).
- `openVault(storage, opts: {purpose?: string; now?: () => Date}): Promise<void>` in scaffold.ts: idempotent production bootstrap — if `schema.md` missing, createVault; serialized via `navigator.locks.request("scispark-vault-init", ...)` when available, else a module-level promise mutex (Node/tests). Tolerates concurrent callers (10 concurrent `openVault` → exactly one `init` log entry — the M1 review's carried gate).
- `getVault()` keeps returning storage; add `getOpenVault(): Promise<VaultStorage>` that also runs `openVault` once (app entry point uses this).

TDD; commit `feat(vault): error kinds, binary storage, serialized production bootstrap`.

---

### Task 2: schema.md routing parser + changeset schema validation

**Files:** create `src/lib/wiki/schema-routing.ts` (+tests)

**Contracts:**
- `parseSchemaRouting(markdown: string): Record<string, string>` — extracts the "## Page Types" table (type → directory), llm_wiki-style: rows `| type | dir |`, type `[a-z][a-z0-9_-]*`, dir must start `wiki/`; ignores other sections; empty/missing table → `{}`.
- `loadRouting(storage): Promise<Record<string, string>>` — reads `schema.md`, parses; falls back to the built-in 10-type map (export `DEFAULT_ROUTING` mirroring scaffold's TYPE_DIRS) when file/table absent.
- `validateFilesAgainstRouting(files: Array<{path: string; type: string}>, routing): string[]` — returns error strings: unknown type; path's directory ≠ routing[type]; path not ending `.md`; non-kebab final slug (`[a-z0-9][a-z0-9-]*`, CJK allowed per llm_wiki convention — keep simple: reject spaces/uppercase/`..`/leading dots). Empty array = valid.

TDD (scaffold's generated schema.md parses to exactly DEFAULT_ROUTING; custom extra row honored; violation messages precise); commit `feat(wiki): schema.md routing parser and changeset validation`.

---

### Task 3: Full-text acquisition + source snapshots

**Files:** create `src/lib/wiki/acquire.ts` (+tests, fixture HTML)

**Contracts:**
- `acquireFullText(paper: PaperRecord, deps: {fetchFn?: typeof fetch; apiBase?: string}): Promise<{kind: "html" | "abstract"; text: string; html?: string; sourceUrl?: string}>` (caller snapshots via `snapshotSource` — acquisition stays storage-free)
  - Candidate order: arXiv HTML (`https://arxiv.org/html/<id>` when `ids.arxiv`) → `htmlUrl` → `oaUrl` (resolving via `/api/resolve?doi=` when only a DOI, using `oaUrl`/landing) — every remote fetch goes through `/api/fetch?url=` (the relay; `apiBase` prefixes for tests). PDF-only candidates are SKIPPED in M4 (comment: extraction lands M6).
  - HTML → text: DOMParser when available, else regex strip (tests run in Node: implement a small tag-stripper — remove script/style blocks, tags, collapse whitespace; keep paragraph breaks). Guard: extracted text < 500 chars → treat as failure, try next candidate.
  - Success → `{kind: "html", text, sourceUrl}`; all candidates fail → `{kind: "abstract", text: paper.abstract ?? ""}`.
- `snapshotSource(storage, paper, html: string): Promise<string>` — writes raw HTML to `sources/<paperKey-slug>.html` (immutable originals dir per design), returns path. paperKey slug: reuse `paperKey(paper)` sanitized (`[^a-z0-9]+` → `-`).

TDD with stub fetch + a small fixture HTML; commit `feat(wiki): full-text acquisition via relay with source snapshots`.

---

### Task 4: Deterministic authoring helpers

**Files:** create `src/lib/wiki/authoring.ts` (+tests)

**Contracts:**
- `slugifyTitle(title: string): string` (kebab, preserve CJK, strip punctuation, ≤80 chars).
- `paperSlug(paper: PaperRecord): string` — arxiv id (dots→-) > doi tail > slugified title.
- `buildPaperPage(paper, opts: {digest?: DigestResult; fullText: boolean; projects?: string[]; today: string}): {path, frontmatter, body}` — path `wiki/papers/<paperSlug>.md`; frontmatter: full contract + `doi/arxiv/openalex/pmid`, `authors` (names), `year`, `venue`, `projects`, `full_text`; body: title H1, structured Digest section (from DigestResult when present), Abstract section, Links section (oaUrl/pdfUrl/source ids). Pure function.
- `buildAuthorSkeletons(paper, routing, existingIds: Set<string>, today): Array<{path, frontmatter, body}>` — one per author with `openalexId` OR (name when no id — slugified), skipping ids already in `existingIds`; frontmatter type author + `openalex` field; body: name H1 + "Papers" section with wikilink to the paper page.
- `composePage(frontmatter, body): string` via M1 `serializeDocument` (re-export used).

TDD; commit `feat(wiki): deterministic paper/author page authoring`.

---

### Task 5: Digest Skill

**Files:** create `src/lib/skills/digest.ts` (+tests with MockProvider)

**Contracts:**
- `DigestResult` zod schema: `{summary: string; laySummary: string; keyPoints: string[]; methods: string; limitations: string; fieldContext: string}` (export schema + type).
- `digestSkill = defineSkill<{paper: PaperRecord; fullText?: string}, DigestResult>` — one `strong` `llmStructured` call; prompt: paper metadata + abstract + (truncated ≤40k chars) full text; instructions per design (general-audience laySummary, precise summary, concrete keyPoints ≤6).
- `generateDigest(storage, paper, opts: {fullText?: string; settings?; providerOverride?}): Promise<{digest: DigestResult; runId: string} | {cached: DigestResult}>` — checks cache `.scispark/digests/<paperSlug>.json` first; on run, persists cache. Cache read tolerant of corruption (re-generate).

TDD (cache hit short-circuit, cache write, schema shape); commit `feat(skills): digest skill with cache`.

---

### Task 6: Ingest Skill — analysis step

**Files:** create `src/lib/skills/ingest-analysis.ts` (+tests)

**Contracts:**
- `AnalysisResult` zod: `{entities: Array<{name, kind: "author" | "organization" | "tool" | "dataset" | "other", inWiki: boolean}>; concepts: Array<{name, definition, inWiki: boolean}>; findings: Array<{claim, evidence, strength: "strong" | "moderate" | "weak"}>; connections: Array<{pageId, relation}>; contradictions: Array<{pageId, description}>; recommendations: {pagesToCreate: Array<{type, title, rationale}>, pagesToUpdate: Array<{pageId, rationale}>, emphasis: string[]}}`.
- `buildAnalysisContext(storage, paper, digest, opts): Promise<string>` — assembles purpose.md, schema.md page-types table, index.md (or titles list from bundle when index empty), the digest, abstract/full-text excerpt (≤30k chars), user highlights (parameter, `[]` in M4).
- `runAnalysis(ctx: SkillContext, input): Promise<AnalysisResult>` as a step function used by Task 7's skill (strong tier). Prompt adapts llm_wiki `buildAnalysisPrompt` section discipline + subject-boundary rule verbatim-in-spirit.

TDD with MockProvider returning canned AnalysisResult; commit `feat(skills): ingest analysis step`.

---

### Task 7: Ingest Skill — generation, validation, atomic apply

**Files:** create `src/lib/skills/ingest.ts` (+tests)

**Contracts:**
- `GenerationResult` zod: `{files: Array<{path: string; type: string; title: string; tags: string[]; related: string[]; body: string}>; reviews: Array<{kind: "contradiction" | "duplicate" | "missing-page" | "suggestion"; title: string; description: string; pages: string[]}>}` — note NO dates/sources in LLM output; code injects `created/updated` (today) and `sources` (snapshot path or paper id) when composing frontmatter; for files whose path already exists, `created` preserved from the existing page.
- `ingestSkill = defineSkill<IngestInput, IngestOutput>` orchestrating: analysis (Task 6) → generation (strong; prompt adapts llm_wiki `buildGenerationPrompt` rules: schema routing authoritative, wikilinks in body only, don't regenerate index/log, subject boundaries; MUST include the deterministic paper page path as the anchor to link from) → merge: deterministic paper page (Task 4, digest included) + author skeletons + LLM files (LLM may also update the paper page body ONLY below a `<!-- agent:notes -->` marker — simpler: LLM never writes the paper page in M4; its files link to it) → `validateFilesAgainstRouting` + frontmatter completeness → on validation errors, retry generation ONCE with errors appended → still failing → return `{status: "draft"}` with the draft files (review queue material), nothing applied.
- Apply path: build `Changeset` (before = current content via storage.read), `applyChangeset`, then deterministically: rebuild `index.md` (M1 `writeIndex` over fresh bundle), `appendLog` (`ingest | <paper title>`), write review items `.scispark/review/<id>.json` (`{id, createdAt, changesetId, ...review}`), return `IngestOutput {status: "ok"; changesetId; pages: {created: string[]; updated: string[]}; reviews: number; runId}`.
- `undoIngest(storage, changesetId): Promise<void>` — loadChangeset + revertChangeset + appendLog (`undo | <changesetId>`) + rebuild index.

TDD with MockProvider (canned analysis+generation): happy path (pages written, index rebuilt, log entries, reviews filed, changeset recorded); validation-retry path (first generation invalid type → second call receives error text → applies); double-invalid → draft status, vault untouched; undo restores byte-identical vault (snapshot compare); reserved-path attack from LLM output (file path `index.md` or `.scispark/...`) → caught by validation/changeset guard, ingest fails safe. Commit `feat(skills): ingest skill — generation, validation, atomic apply, undo`.

---

### Task 8: Review queue store + ingest history

**Files:** create `src/lib/wiki/review-queue.ts` (+tests)

**Contracts:**
- `listReviews(storage): Promise<ReviewItem[]>` (sorted new→old); `dismissReview(storage, id)` (moves file to `.scispark/review/archived/<id>.json` — keep audit); `reviewCount(storage)`.
- `listIngests(storage): Promise<Array<{changesetId, timestamp, skill, files: number}>>` from `.scispark/changesets/` records (new→old), for the history/undo UI.

TDD; commit `feat(wiki): review queue store and ingest history`.

---

### Task 9: Wiki UI — browse, view, edit (Milkdown)

**Files:** create `src/app/wiki/page.tsx`, `src/app/wiki/[...id]/page.tsx`, `src/components/wiki/*` as needed; add Milkdown deps.

**Contracts:**
- MANDATORY PRE-STEP: verify current Milkdown packages/API via context7 (`@milkdown/kit` vs core/preset-commonmark/react integration) — the fork's AGENTS.md workflow applies; record versions in report.
- `/wiki`: client page; `getOpenVault()` → `loadBundle` → tree grouped by type dir (Papers, Concepts, …) with counts; links to pages; a "Review inbox (n)" link; "Recent ingests" list with per-item Undo button (confirm dialog → `undoIngest` → refresh).
- `/wiki/[...id]`: renders one page: frontmatter chips (type, tags, updated), Milkdown editor with the body; `[[wikilink]]`s rendered as links resolving via bundle (`resolveLink`) — minimum viable: a preprocessing pass mapping `[[slug]]` → markdown link `[slug](/wiki/<resolved id>)` before handing to Milkdown, and the inverse on save; backlinks panel (bundle `backlinks`); Save button → `serializeDocument` with `updated` bumped → `storage.write` (direct user edit — not a changeset; agent-only rule applies to skills) → toast.
- Keep components small; no design work beyond the existing app shell + monospace-ish utilitarian styling.

Verify: `npm test` green (no lib changes), tsc, eslint; dev server: create a page via Task 7's test-path? Instead: a temporary seed script is NOT needed — Task 11's live gate populates; for THIS task verify with a hand-written vault page created via `/debug/vault`-style scaffold (implementer may write one page through a tiny Node script into OPFS is impossible — instead: verify edit/save on `purpose.md`?? purpose.md is reserved-root, not under /wiki routes). Simplest: implementer adds a "New note" button on /wiki (creates `wiki/notes/scratch-<ts>.md` with valid frontmatter via composePage) — small, legitimately in scope (user note creation is v1 IN) — then verifies browse → open → edit → save → backlink flow in the browser. Commit `feat(wiki): browse/view/edit UI with Milkdown and backlinks`.

---

### Task 10: Papers UI — search → digest → Add to Knowledge Base

**Files:** create `src/app/papers/page.tsx`, `src/app/wiki/inbox/page.tsx`, `src/components/papers/*`.

**Contracts:**
- `/papers`: search UI over `/api/search/{source}` (source select + query; unified records list). Selecting a paper opens a detail pane: metadata, abstract, buttons: **Generate digest** (acquireFullText → generateDigest → render DigestResult sections; show cost/runId from run record) and **Add to knowledge base** (runs full flow: acquire → snapshot → digest (cached) → ingestSkill via runSkill → progress states → success panel: pages created/updated links into /wiki, review count, Undo button; error/budget states rendered).
- `/wiki/inbox`: review items list (kind badge, title, description, page links), Dismiss action; empty state.
- Settings dependency: uses the M2 settings (BYOK) — if `MissingKeyError`, render a link to `/debug/llm` to configure. GMI setup (openai provider + baseUrls) must work through this path.
- Verify in browser (no real key needed for UI states; error-state rendering verifiable without key). Commit `feat(papers): search→digest→ingest flow UI and review inbox`.

---

### Task 11: Live end-to-end gate (GMI) + docs

**Files:** create `src/lib/skills/__tests__/live-ingest.test.ts`; update M4 plan status block at completion.

**Contracts:**
- Env-gated like live-openai-compat (same LIVE_LLM_* vars). Flow against MemoryVaultStorage + real proxy-less acquisition (use direct fetch to arxiv HTML — Node has no relay; pass a fetchFn that rewrites `/api/fetch?url=X` → direct fetch of X and `/api/resolve` → skip): pick a small real arXiv paper (e.g. a short recent cs.CL paper id hardcoded); acquireFullText → generateDigest → ingestSkill.
- Asserts: status ok; paper page exists at expected path with correct ids frontmatter + `full_text: true`; ≥1 non-paper page created; every created file passes routing validation; index.md contains the paper; log has ingest entry; reviews ≥ 0 parse; `undoIngest` restores pre-ingest snapshot exactly; total costUsd < $0.50.
- Long timeout (300s). Console-log the created page tree + one concept page body for the report.

Run with GMI env; iterate on prompts until it passes credibly (this is where prompt quality gets real). Commit `test(skills): live ingest gate` + status update.

---

## Self-Review Notes

- **Coverage vs roadmap M4:** Digest Skill ✓(5), Ingest end-to-end ✓(3,4,6,7), wiki browse/edit Milkdown ✓(9), review queue ✓(8,10), undo ✓(7,9,10). Gates: kind discriminator + binary storage + bootstrap serialization ✓(1), schema routing before real consumers ✓(2).
- **Deferred consciously:** PDF text extraction, highlights context, contradiction side-by-side actions (inbox has dismiss only — richer actions with M5+ agent hooks), Milkdown wikilink autocomplete, KB-Chat (roadmap M5-adjacent; design lists it v1 — schedule with M5 feed milestone).
- **Risks:** Milkdown API drift (pre-step); prompt quality only truly testable at Task 11 (budgeted iteration there); OPFS bundle loads on every /wiki visit (fine at v1 scale; note for M8).
