# SciSpark Paper Manager — Product Design (Layer 1)

*Status: approved in design review with Tong, 2026-07-11. Companion docs: [02-system](02-system.md), [03-backend](03-backend.md), [04-agent-harness](04-agent-harness.md), [05-frontend](05-frontend.md).*

## One-sentence definition

An AI-agent-driven research radar and personal knowledge base: a personalized paper feed that flows into an agent-maintained wiki, with an in-app reading companion and rich visualizations, for researchers tracking the fields they care about.

## Positioning

Generalizes SciSpark from clinical evidence to **all research fields** (biomedical remains the seed domain and first-priority content vertical). Runs as a **parallel exploration** alongside the clinical SciSpark app — not a replacement.

The product covers the full research-tracking loop, which no existing tool does end to end:

| Stage | What we do | Who else does it |
|---|---|---|
| **Discover** | agentic personalized feed + daily field trends | Google Scholar alerts (dumb), Doximity/QxMD (generic) |
| **Read** | in-app reader, persistent highlights, select-to-ask-AI | nobody pairs this with the rest |
| **Understand** | LLM digest per paper, grounded Q&A with citations | Elicit/scite partially |
| **Retain** | LLM-wiki: agent-maintained, cross-linked, compounding knowledge base | llm_wiki (no discovery, no reading), Obsidian (manual) |
| **See** | knowledge graph, field timeline, citation flow, author networks | Connected Papers (papers only, not *your* knowledge) |
| **Spark** | idea generation grounded in *your* vault + literature, with scoop-checking — this is the "Spark" in SciSpark | ResearchStudio-Idea (cold-start only — no personal knowledge base behind it) |

Key differentiators vs. llm_wiki (our closest architectural relative, verified from its source):
1. llm_wiki starts *after* you found a paper; we own discovery (the feed is SciSpark's identity).
2. llm_wiki never renders the original document; we make reading a first-class in-app experience.
3. Our reading signals (highlights, questions, dwell time) personalize both the feed and what the wiki emphasizes — a data moat that compounds.

## Target user

Researchers and research-adjacent professionals who need to stay current in one or more fields. Seed persona: Tong herself (biomedical/AI researcher). MVP success = Tong and a handful of Stanford-adjacent researchers use it weekly for real field-tracking.

## Entry flow

**v1 (reframed 2026-07-14):** there is no public/anonymous trending page or marketing-capture step in v1 — trending was reframed from a public funnel to a per-user personalized dashboard, which needs an onboarded local profile to have any fields to show. The steps below describe the original public-landing/marketing-capture design, kept as the documented **v2 path** (see `docs/design/03-backend.md` and `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md`) for once a real backend + accounts exist:

1. **[v2, deferred]** **Anonymous visitor** → lands on the **Trending page**: daily agent-written trend surveys per major field. Real content, zero setup — this is the live demo and the top of the funnel.
2. Click **"Personalized home"** → conversational, agent-style onboarding (a few questions: fields, topics, role, reading habits) → creates a **local profile** as vault files on the user's own machine, owned by the local-runtime server (M11, 2026-07-14) — this is "registration"; there is no SciSpark server account, and the vault is real files on disk, not browser-internal storage.
3. **[v2, deferred]** Final onboarding step **optionally** offers a real account (email via Supabase) purely for marketing contact and future tiers. Never required; gates nothing in v1.
4. Onboarded users get: **For You** feed (personalized), **Trending** tab (v1: personalized "what's big in your field" dashboard, scoped to the user's own fixed sub-fields — not public content), and the full app.

## The core loop

1. **Feed** — daily agentic recommendations with personal "why this, why you, why now" explanations. Learns continuously from behavior (all locally).
2. **Digest** — click a card → LLM-generated digest: summary, lay summary ↔ abstract toggle, key methods/results, figure digest, related papers.
3. **Read** — open the paper itself in-app (HTML full text or PDF). Highlight anything; select text → ask the AI or capture your own idea as a note.
4. **Ingest** — "Add to knowledge base" → the agent integrates the paper across your wiki: pages created/updated, cross-linked, tagged, contradictions flagged. One-click undo per ingest.
5. **Explore** — wiki browsing/editing, knowledge-base chat with citations, and the visualization dashboard (graph / timeline / citation flow / author network).
6. **Spark** — generate research ideas grounded in your vault, in two modes: **Quick Spark** (cheap, fast, vault-only brainstorm → 2–3 idea seeds; the companion offers these freely) and **Deep Spark** (the full pipeline: fresh retrieval → bottleneck diagnosis → pattern-guided ideation → scoop-check → reviewer-defensible idea card with mini lit-review; always user-confirmed with a cost estimate). Promising seeds graduate: "develop this fully" turns a Quick Spark seed into a Deep Spark run.

## The Research Companion

**September 7, 2026 implementation update:** Search and Chat share one Sparky
conversation workspace. Quick searches persist complete paper-result snapshots
in conversation History automatically, including failed turns and source warnings.
The composer stays visible while conversation content scrolls. Source Settings
opens in place. Deep literature review is now integrated as a distinct,
explicitly approved preview mode with selective personal context, durable local
jobs, bounded evidence search/checks and a versioned report beside the chat.
See the [implementation plan](../superpowers/plans/2026-09-07-personalized-literature-review.md)
and [verification record](../testing/2026-09-07-deep-review-integration.md).
Live scientific-quality acceptance is still separate from feature integration.
Retention in History and selective use as personal memory are separate permissions.

A persistent, cute, **proactive** AI companion is the personality of the whole product (think "Codex pet") — the thing that makes SciSpark feel alive where other research tools feel like databases. It is text-only (no audio/voice): a small character floating in the shell, available to chat, occasionally popping a speech bubble to encourage action.

**The companion IS the interface to the agent system.** Every conversation in the product — onboarding, knowledge-base chat, select-to-ask while reading, review-queue discussions, spark sessions — is a conversation *with the companion*. Skills are the invisible backend; the user only ever talks to one character, in one persona, with one continuous memory. (Architecturally: skills produce content; the companion persona layer renders every conversational surface.)

It is the *voice of the skill system*, not a separate intelligence:

- After an ingest: links to the paper's Wiki page, when that page still exists.
- For a new review item: names what needs attention and offers the review inbox.
- For recent papers sharing a concept: offers to explore a grounded idea, unless that theme already has an idea page.
- App opens, idle moments, and cached feeds alone are not notification events. Visiting an action's destination consumes the corresponding events quietly.

Anti-Clippy rules (product-level commitments): never modal, never blocks, always dismissible; a persisted per-vault budget spans tabs/reloads/restarts (default two messages per rolling day, 30 minutes apart). Once claimed, an event is not repeated, even after dismissal or delivery failure. Messages expire after 60 seconds and clear on navigation, Settings, typing or hidden tabs; onboarding and Chat stay quiet. Chattiness is configurable, including Off. Dismissals/actions remain Tier-1 events. User-initiated feedback questions are separate. The companion suggests expensive actions (e.g., a Spark run) but never starts them without a click.

## v1 scope

**IN:** conversational onboarding → local profile; personalized agentic feed; personalized trending dashboard (fixed fields from `interests.md`, deterministic metrics + charts + LLM survey, staleness-refreshed, BYOK via the local runtime server — reframed 2026-07-14 from a public trending page, and from client-side to local-server execution by the M11 local-runtime pivot, also 2026-07-14); LLM digest; in-app reader (HTML + pdf.js) with persistent highlights and select-to-ask; add-to-KB two-step agent ingest; wiki browse/edit (Milkdown); projects as virtual indexes; KB chat with citations; visualization dashboard with **all four views** (graph, timeline, citation flow, author network); wiki lint; slim async review queue; per-ingest changeset undo; vault zip export; AI spend meter + daily budget; **the Research Companion** (proactive, always-present); **the Spark Skill** (vault-grounded idea generation with scoop-check, adapted from MIT-licensed ResearchStudio-Idea).

**OUT (v1.5+):** Tauri desktop wrapper; cloud sync (paid tier); SciSpark-managed LLM keys (paid tier); mobile apps; general web search / deep research for agents; Ollama/local models; collaborative filtering; multi-user/team features; **public/anonymous trending page + server cron + Vercel Blob + optional marketing account capture (`/api/register`/Supabase)** — the original M10 public-landing model, documented as a v2 growth path (see `docs/design/03-backend.md`).

## Business model hooks (built now, monetized later)

- **Free tier (v1):** local-first, BYOK, no account needed — the app runs as a local server on the user's own machine (M11 local-runtime pivot, 2026-07-14: vault on disk, harness, and keys all owned by that local server), so SciSpark bears zero hosting cost per user in v1. "Server cost per user ≈ static hosting + API relay only" describes the future hosted tier, not v1.
- **Paid tier (v2):** cloud vault sync (multi-device/mobile), SciSpark-managed LLM (no API key needed), possibly team features. The `VaultStorage` and `LLMProvider` interfaces are designed so these are additive implementations, not migrations.
- Optional account capture at onboarding builds the marketing channel now.

## Non-negotiable product principles

1. The home experience is a feed — SciSpark's identity.
2. No third-party knowledge apps (no Obsidian/Zotero); SciSpark owns the renderer and reader.
3. The user's research data never touches SciSpark servers in the free tier ("we know who you are — if you opt in — but we can't see your research").
4. The user model is transparent: the pages that drive personalization are readable and editable by the user.
5. Everything the agent does is attributable (provenance) and undoable (changesets).
