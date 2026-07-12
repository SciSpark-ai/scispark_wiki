### Task 6: Ingest Skill — analysis step — implementer report

**Files added**
- `src/lib/skills/ingest-analysis.ts`
- `src/lib/skills/__tests__/ingest-analysis.test.ts`

**Prompt lineage**

Read `buildAnalysisPrompt` in the llm_wiki reference clone
(`<scratchpad>/llm_wiki/src/lib/ingest.ts:2046`). Adapted its section discipline (Key
Entities / Key Concepts / Main Arguments & Findings / Connections to Existing Wiki /
Contradictions & Tensions / Recommendations) onto our `AnalysisSchema` fields instead of
markdown section output, and carried its subject-boundary sentence forward almost verbatim:
llm_wiki's "Do not transfer claims, limits, or evaluations from one entity/model/product/method
to another just because they share keywords" became our findings-field instruction "Do not
transfer claims, limits, or evaluations from one entity, model, product, or method to another
just because they share keywords or a similar name."

**What was built**

- `AnalysisSchema` (zod) + `type AnalysisResult = z.infer<typeof AnalysisSchema>` matching the
  brief's contract exactly: `entities[]` (name/kind/inWiki, kind enum
  author|organization|tool|dataset|other), `concepts[]` (name/definition/inWiki), `findings[]`
  (claim/evidence/strength enum strong|moderate|weak), `connections[]` (pageId/relation),
  `contradictions[]` (pageId/description), `recommendations` (`pagesToCreate[]`
  type/title/rationale, `pagesToUpdate[]` pageId/rationale, `emphasis: string[]`).
- `buildAnalysisContext(storage, opts: {paper, digest?, fullTextExcerpt?, highlights?}):
  Promise<string>` — assembles labeled sections in order, skipping absent ones:
  - **Purpose**: `purpose.md` content (skipped if missing/blank).
  - **Page Types**: extracts the raw `## Page Types` markdown slice from `schema.md`
    (heading-to-next-heading, verbatim — same table scaffold.ts writes) when present;
    otherwise renders `DEFAULT_ROUTING` (from `wiki/schema-routing.ts`) as the same
    `| type | directory |` table shape. Always present (never skipped).
  - **Existing Wiki Index**: `index.md`'s raw trimmed content when it actually has bullet
    entries (`/^-\s/m` test); when index.md is missing or is still just the bare
    `# Index` header (freshly-scaffolded vault), falls back to a bundle-derived bullet list
    `- <pageId> — <title>` (via `loadBundle`), or an explicit "(the wiki has no pages yet)"
    when the bundle itself is empty. Always present.
  - **Paper**: title/authors/year/venue/ids (doi/arxiv/openalex/pmid)/abstract.
  - **Digest**: only when `opts.digest` is truthy and renders to non-empty prose (reuses
    `DigestLike` from `wiki/authoring.ts` — summary/laySummary/keyPoints/methods/limitations).
  - **Full Text Excerpt**: only when non-blank; truncated to 30,000 chars with a truncation
    note appended only when the text actually exceeds that length (mirrors digest.ts's
    truncation-note pattern).
  - **User Highlights**: only when `opts.highlights` is a non-empty array; framed explicitly as
    "the user highlighted these passages — treat as emphasis signals" per the brief (M4 always
    passes `[]`, so this section is dormant until M6 wires highlights).
- `runAnalysis(ctx: SkillContext, context: string): Promise<AnalysisResult>` — a plain step
  function (not `defineSkill`), matching the brief: "as a step function used by Task 7's skill".
  Task 7's `ingestSkill` will call `runAnalysis` and a generation step against the same
  `SkillContext` inside one skill run, so both LLM calls share one budget check/metering trail —
  wrapping this in its own `defineSkill`/`runSkill` would create a second, separate run record.
  One `ctx.llmStructured("strong", {messages: [system, user]}, AnalysisSchema)` call; system
  message carries the adapted analysis instructions (research-analyst framing, per-field
  meaning, subject-boundary rule, "inWiki: true only when the index... lists a matching page",
  "pageId must be an id copied verbatim from the Existing Wiki Index section"); user message is
  the assembled context, passed through unchanged.

**Tests** (`src/lib/skills/__tests__/ingest-analysis.test.ts`, 15 tests):

- `AnalysisSchema`: accepts a well-formed result; rejects an invalid enum value
  (`strength: "extreme"`); rejects a result missing `recommendations`.
- `buildAnalysisContext` (seeded via `createVault` + a hand-written concept page through
  `composePage`):
  - Purpose/Page Types/Existing Wiki Index/Paper sections all present with expected content.
  - User Highlights section absent when no highlights given; present with "emphasis signals"
    framing and the highlight text when given.
  - Digest section absent without a digest, present with digest prose when one is passed.
  - Index-fallback path: with `createVault`'s default bare `# Index` (verified via a direct
    read/trim assertion) and one seeded concept page, the index section renders
    `wiki/concepts/transformer-architecture — Transformer Architecture` from the bundle.
  - Fully empty wiki (no pages, no index entries) renders the explicit "no pages yet" fallback.
  - Full Text Excerpt: short text has no truncation notice; a 35,000-char excerpt is capped at
    ≤30,000 chars in the emitted section and gets a truncation notice.
- `runAnalysis` (stub `SkillContext` per the brief: `{llm: vi.fn(), llmStructured: vi.fn(...),
  log: () => {}}`):
  - Calls `llmStructured` once at `"strong"` tier with `AnalysisSchema` as the schema argument,
    2 messages (system, user), and returns the mock's result unchanged.
  - The user message equals the exact string passed into `runAnalysis` (round-tripped through a
    real `buildAnalysisContext` call).
  - System prompt contains the subject-boundary sentence verbatim
    (`"Do not transfer claims, limits, or evaluations from one entity, model, product, or
    method to another"`).
  - System prompt contains "existing wiki index" (case-insensitive) and "copied verbatim",
    covering the inWiki/pageId grounding rule.

**Verification**

- `npx vitest run src/lib/skills/__tests__/ingest-analysis.test.ts` — 15/15 pass.
- `npx vitest run` (full suite) — 37 files, 454 passed, 3 skipped (457 total). Baseline was
  439 passed + 3 skipped; net +15 tests, all from this task, zero regressions.
- `npx tsc --noEmit` — clean, exit 0.
- `npx eslint src/lib/skills/ingest-analysis.ts src/lib/skills/__tests__/ingest-analysis.test.ts`
  — clean.

**Design notes / things Task 7 should know**

- `runAnalysis` deliberately is NOT a `defineSkill`/`runSkill` unit — it's a bare function
  taking an already-constructed `SkillContext`. Task 7's `ingestSkill.run(ctx, input)` should
  call `buildAnalysisContext` + `runAnalysis(ctx, context)` directly as its first step, then
  its own generation call as the second step, both against the same `ctx` so `runSkill`'s single
  budget check/metering/run-record wraps both LLM calls as one run.
- `pageId` values the model is instructed to use are full bundle ids (e.g.
  `wiki/concepts/transformer-architecture` — the same shape `loadBundle`'s `pages` map keys on
  and `Bundle.links`/`page.id` use), NOT bare slugs. This was a judgment call: index.md's own
  bullet rendering (`buildIndexMarkdown`) shows `[[slug]] — Title` (bare slug only), but the
  index-fallback path this module adds explicitly renders full ids, and the system prompt
  tells the model to copy an id "verbatim from the Existing Wiki Index section" — so on a vault
  whose index.md already has real entries (the normal case once M4's Task 7 starts rebuilding
  it via `writeIndex`), the model only ever sees bare slugs in that section. Flagging this for
  Task 7/8: if `connections[].pageId`/`contradictions[].pageId`/`recommendations.pagesToUpdate[]
  .pageId` need to resolve against `loadBundle`'s full-id keyspace, either (a) Task 7 should
  resolve a bare slug back to a full id via the bundle's suffix index before using it, or (b)
  this module's index.md-content path should be changed to render full ids too instead of
  passing `index.md`'s bare-slug bullets through verbatim. Left as-is per the brief's literal
  instruction ("index.md content") — surfacing here rather than silently deciding for Task 7.
- Digest rendering here is intentionally lighter/prose-only (no markdown headers) compared to
  `wiki/authoring.ts`'s `buildDigestSection` (which builds the actual paper-page body with `##`/
  `**bold**` markdown) — this is LLM-facing context, not page content, so it stays plain-prose
  consistent with `digest.ts`'s own prompt style.
