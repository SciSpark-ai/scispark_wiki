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

1. **Anonymous visitor** → lands on the **Trending page**: daily agent-written trend surveys per major field. Real content, zero setup — this is the live demo and the top of the funnel.
2. Click **"Personalized home"** → conversational, agent-style onboarding (a few questions: fields, topics, role, reading habits) → creates a **local profile** (this is "registration" — no server account).
3. Final onboarding step **optionally** offers a real account (email via Supabase) purely for marketing contact and future tiers. Never required; gates nothing in v1.
4. Onboarded users get: **For You** feed (personalized), **Trending** tab (public content), and the full app.

## The core loop

1. **Feed** — daily agentic recommendations with personal "why this, why you, why now" explanations. Learns continuously from behavior (all locally).
2. **Digest** — click a card → LLM-generated digest: summary, lay summary ↔ abstract toggle, key methods/results, figure digest, related papers.
3. **Read** — open the paper itself in-app (HTML full text or PDF). Highlight anything; select text → ask the AI or capture your own idea as a note.
4. **Ingest** — "Add to knowledge base" → the agent integrates the paper across your wiki: pages created/updated, cross-linked, tagged, contradictions flagged. One-click undo per ingest.
5. **Explore** — wiki browsing/editing, knowledge-base chat with citations, and the visualization dashboard (graph / timeline / citation flow / author network).
6. **Spark** — generate research ideas grounded in your vault + fresh literature: bottleneck diagnosis → pattern-guided ideation → scoop-check → a reviewer-defensible idea card saved into your wiki, with a literature-review section attached.

## The Research Companion

A persistent, cute, **proactive** AI companion is the personality of the whole product (think "Codex pet") — the thing that makes SciSpark feel alive where other research tools feel like databases. It is the *voice of the skill system*, not a separate intelligence:

- On app open: greets you and nudges toward what's new ("3 new papers in your feed look strong today — want a look?").
- While reading a digest: proactively observes ("this looks related to [[closed-loop DBS]] in your wiki — import it?").
- After an ingest: celebrates progress, surfaces flagged review items conversationally.
- Ambiently: notices sparkable clusters ("your last 4 papers circle one unsolved problem… want me to spark ideas on it?") and idle moments.

Anti-Clippy rules (product-level commitments): never modal, never blocks, always dismissible; proactivity budget (max interventions per session + cooldowns); chattiness setting (quiet / normal / chatty); dismissals are Tier-1 events the memory system learns from, so the companion gets less annoying over time, not more. The companion suggests expensive actions (e.g., a Spark run) but never auto-spends meaningful budget.

## v1 scope

**IN:** conversational onboarding → local profile; personalized agentic feed; trending page (public + tab); LLM digest; in-app reader (HTML + pdf.js) with persistent highlights and select-to-ask; add-to-KB two-step agent ingest; wiki browse/edit (Milkdown); projects as virtual indexes; KB chat with citations; visualization dashboard with **all four views** (graph, timeline, citation flow, author network); wiki lint; slim async review queue; per-ingest changeset undo; vault zip export; AI spend meter + daily budget; optional marketing account capture; **the Research Companion** (proactive, always-present); **the Spark Skill** (vault-grounded idea generation with scoop-check, adapted from MIT-licensed ResearchStudio-Idea).

**OUT (v1.5+):** Tauri desktop wrapper; cloud sync (paid tier); SciSpark-managed LLM keys (paid tier); mobile apps; general web search / deep research for agents; Ollama/local models; collaborative filtering; multi-user/team features.

## Business model hooks (built now, monetized later)

- **Free tier (v1):** local-first, BYOK, no account needed. Server cost per user ≈ static hosting + API relay only.
- **Paid tier (v2):** cloud vault sync (multi-device/mobile), SciSpark-managed LLM (no API key needed), possibly team features. The `VaultStorage` and `LLMProvider` interfaces are designed so these are additive implementations, not migrations.
- Optional account capture at onboarding builds the marketing channel now.

## Non-negotiable product principles

1. The home experience is a feed — SciSpark's identity.
2. No third-party knowledge apps (no Obsidian/Zotero); SciSpark owns the renderer and reader.
3. The user's research data never touches SciSpark servers in the free tier ("we know who you are — if you opt in — but we can't see your research").
4. The user model is transparent: the pages that drive personalization are readable and editable by the user.
5. Everything the agent does is attributable (provenance) and undoable (changesets).
