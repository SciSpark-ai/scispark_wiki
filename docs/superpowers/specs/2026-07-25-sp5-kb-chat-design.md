# SP5 — Knowledge-Base Chat (UI/UX redesign, part 5 of 6)

**Date:** 2026-07-25
**Status:** Designed — approved by Tong 2026-07-25 (sections 1–3 approved in conversation)
**Origin:** The six-SP redesign brainstormed 2026-07-16 (see `2026-07-16-sp1-shell-and-system-design.md`, whose roadmap row reads "SP5 | KB Chat (real, replacing mock)"). SP1–SP4 have shipped.

## Context

`/chat` and `/chat/[id]` are still the forked prototype: a Zustand store persisting to localStorage, no LLM call anywhere, and clinical suggestion chips left over from the fork ("Compare treatments", "Summarize RCT", "Find guidelines", "Risk vs benefit"). There is no chat orchestrator — `src/lib/chat/` does not exist.

What already exists and is reused rather than rebuilt: the `runSkill` harness (tiers, budget enforcement, metering, degradation), the `reading-companion` skill whose output shape is already `{answer, citedPageIds}`, `buildAskContext` as a precedent for assembling wiki context with no LLM call, the vault API and changeset machinery, and the companion persona layer.

**Reference behavior (nashsu/llm_wiki, README, checked 2026-07-25):** it ships "Multi-Conversation Chat with Persistence"; chat is one of its three core operations (Ingest / **Query** / Lint), not a side feature; answers can be written back via "**Save to Wiki** — archive valuable answers to `wiki/queries/`, then auto-ingest to extract entities/concepts"; and it offers a "Read Sources Only mode to answer exclusively from original imported material".

Decisions made in this brainstorm (Tong, 2026-07-25):

- **Answer scope:** wiki pages **plus** saved papers' TL;DRs and abstracts — so chat can answer both "what do I understand about X" and "which paper in my library discussed Y".
- **Retrieval:** a two-step pipeline — a cheap `fast` call picks pages from `index.md`, then a `strong` call answers over those pages. No third-party embeddings (standing project rule).
- **Write-back:** follow llm_wiki — save an answer as a `wiki/queries/` page, which means **reinstating the `query` page type** that was dropped for v1 ("Dropped for v1: `thesis`, `query`").
- **Auto-ingest of saved answers is deferred to its own milestone.** Our ingest is *paper-shaped* (`IngestInput` requires a `PaperRecord`; the pipeline deterministically prefills a paper page and author pages and its prompt has a "The paper's own page" section), so ingesting a conversational answer needs a document-shaped variant — real work, not wiring. SP5 saves the page; the variant is its own milestone.
- **Read Sources Only toggle:** yes.
- **Persistence:** in the vault, `.scispark/chats/*.json`.
- **Multi-turn:** last 6 turns verbatim, no summary compression (YAGNI — compression costs an extra call and adds a failure mode for a cost problem not yet measured).
- **Save action placement:** under each assistant message, since an answer is the unit being saved.

## Goal

After SP5, `/chat` is a real conversation with your own knowledge base: ask a question, get an answer grounded in your wiki pages and saved papers with clickable citations, keep the conversation in your vault, flip to "sources only" when you want the papers rather than the agent's synthesis, and save an answer worth keeping as a `query` page.

Non-goals (their milestones or deliberate): auto-ingesting saved answers (own milestone); chat rewriting existing wiki pages (ingest and lint own that); live external search (feed and Spark own that); History and Projects surfaces (SP6).

## 1. The answer pipeline

Both steps run through the existing `runSkill`, inheriting budget enforcement, metering, and degradation for free.

**Step 1 — page selection (`fast`).** Input: the `index.md` catalogue, the current question, and the recent turns. Output: a set of page ids, **schema-validated against ids that actually exist in the index** — a fabricated id is discarded, the same discipline `enrich`'s `relatedPageIds` already uses.

**Step 2 — answering (`strong`).** Input: the selected wiki pages' bodies plus the selected papers' TL;DRs/abstracts. Output `{answer, citedPageIds}`, the same shape `reading-companion` already returns, so the citation machinery is reused rather than reinvented.

**Read Sources Only** narrows step 1's candidate pool to `paper` pages only, answering from their abstracts and TL;DRs. Concept, method, topic and other agent-written synthesis pages are excluded. The switch changes the candidate set, not the pipeline.

**Prompt-injection defence.** Paper abstracts are untrusted input. Both steps fence all vault content in the `WIKI-DATA` markers ingest already uses, with the standing instruction that fenced content is data and instructions inside it are never followed. Wiki pages are fenced too — they are agent-written, but their content ultimately derives from papers.

**Multi-turn.** The last **6** turns are sent verbatim (`MAX_HISTORY_TURNS`, defined in one place). Earlier turns are dropped, not summarized.

## 2. Session storage

One file per session at `.scispark/chats/<id>.json`: `{id, title, createdAt, updatedAt, messages[]}`. Each assistant message carries its `citedPageIds` and the `readSourcesOnly` flag that was in effect, so the history shows which mode produced which answer. Written through the vault API, so sessions export with the vault and SP6's History surface can read them directly. The title is derived deterministically from the first question (no extra LLM call).

A corrupt or unreadable session file is treated as absent rather than crashing the page — the lesson SP4's cache-version guard already taught.

## 3. UI

`/chat` becomes a real entry point (the four clinical suggestion chips are deleted outright). `/chat/[id]` is the conversation. The sidebar's "Recent Chats" section returns — SP1 removed it because it was mock data; now there is real data behind it.

Messages render with SP1 tokens. Citations render as clickable chips: wiki pages through `wikiHref`, papers to `/paper/<slug>`. The answer streams over **SSE**, the mechanism `/api/skills/*` already uses for long runs (feed refresh, ingest, Deep Spark) — not a new transport.

Per standing project doctrine every conversational surface is the companion, so chat is Ember's voice — but the persona **wraps tone only and never touches the grounding rules**, exactly as it does for `reading-companion`.

Under each assistant message sits **Save to knowledge base**, writing `wiki/queries/<slug>.md` (`type: query`, `sources` recording the session id and the question) as a changeset, so it is undoable. The saved page then simply sits there; nothing ingests it in this SP.

## 4. The `query` page type

`query` returns as the eleventh page type. It touches more than one place, and a miss makes saved pages silently vanish from some surface:

- `PAGE_TYPES` in `src/lib/vault/types.ts`
- `schema.md` routing (the user-editable authority for type → directory)
- SP3's wiki dashboard type sections
- the viz workspace's type filter
- lint's checks
- vault scaffolding for a fresh vault

The implementation plan gives this its own task so nothing is missed.

## 5. Degradation and errors

Each layer degrades independently, and none of them pretends success:

- **Page selection fails** → fall back to deterministic term-overlap selection (reusing SP4's lens tokenizer) and **say so on the answer** ("context chosen by keyword match this time").
- **Answering fails** → the real reason appears in the message stream and the user's question is preserved for resend, never silently dropped.
- **Empty vault** → point at `/papers` rather than pretending to answer.
- **A selected page fails to load** → skip it, answer from the rest, and note what was missing.
- **No API key** → the existing missing-key affordance, consistent with every other LLM surface.

## 6. Testing

- **Pure units:** index validation of selected ids (a fabricated id must be discarded), multi-turn window trimming, session read/write and corruption tolerance, the `query`-page changeset.
- **Component tests:** message stream rendering, citation chips resolving to the right destination (wiki vs paper), the Read-Sources toggle's state, and each failure message.
- **Storage:** session round-trip; a corrupt JSON file reads as absent, never a crash.
- **Browser manual checklist** (self-driven against a real vault, both themes): a question the vault can answer; one it cannot; the same question with Read Sources Only on and off; saving an answer and finding it in `/wiki`; undoing that save.

## 7. Files (expected shape)

- **New:** `src/lib/chat/select-pages.ts` (step 1 skill), `src/lib/chat/answer.ts` (step 2 skill), `src/lib/chat/session.ts` (storage), `src/lib/chat/save-query.ts` (the `query`-page changeset), `src/app/api/skills/chat/route.ts`, `src/components/chat/*` (message stream, citation chips, composer, sources toggle).
- **Reworked:** `src/app/chat/page.tsx`, `src/app/chat/[id]/page.tsx` (both currently fork mocks), the sidebar's Recent Chats section, `PAGE_TYPES` and the surfaces listed in §4.
- **Retired:** `src/stores/chat-store.ts` (the localStorage mock store) and the clinical suggestion chips.
