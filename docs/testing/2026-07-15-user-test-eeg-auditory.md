# SciSpark Paper Manager — User Test Report

**Persona:** First-year PhD student entering *EEG for auditory neuroscience* (topics: cortical tracking of speech / TRF–mTRF, the frequency-following response, auditory attention decoding for hearing aids & BCIs, EEG denoising).
**Date:** 2026-07-15 → 2026-07-16
**Tester:** Claude (simulated new user, adversarial QA)
**Build:** local Next.js runtime (M11 model), `main` at test start; three parallel fixes merged mid-test.

---

## 1. Bottom line

The **core product loop works end to end with live LLMs**: discover (personalized feed) → read (in-app reader + select-to-ask) → understand (digest) → retain (agent-maintained wiki) → visualize (knowledge graph) → ideate (Spark). A brand-new user went from an empty vault to a personalized feed, an 11-page interlinked knowledge base, a derived graph, vault-grounded idea seeds, and a grounded Q&A on a paper — for **~$0.85 of real API spend**.

But the app was **dead on arrival in the browser** before this test: the very first page threw a fetch error, and two settings/personalization surfaces were fully broken. These had never been caught because the browser-manual checklists had never been hand-driven. The test found and drove fixes for **7 issues** — 4 already merged to `main`, 1 new page shipped (`/settings`), and 2 left as tracked follow-ups (plus one minor untracked).

Overall verdict: **the product's identity and core value are real and working**; the gaps are in browser-path polish and a few LLM surfaces (trending survey, reader highlight re-paint) — none of them core-loop blockers anymore.

---

## 2. Environment & method

| | |
|---|---|
| Vault (on disk) | `~/SciSpark/eeg-auditory-vault` — fresh/empty at start (real first-user simulation) |
| LLM (BYOK) | GMI Cloud, `anthropic/claude-sonnet-5` (OpenAI-compatible), entered via `/settings` → **Other** |
| Paper metadata | OpenAlex (free key), arXiv, plus S2/PubMed available |
| Browser | Real Chromium driven by Playwright; every step screenshotted → two `.mp4` walkthroughs |
| Recording | Part 1 (12 frames, deterministic surfaces) · Part 2 (14 frames, live AI loop incl. reader) |

The test was run in two halves: **Part 1** exercised every surface that does *not* need an LLM key (onboarding, search, settings, profile, trending charts, viz), which is also how the app-breaking bugs were found. **Part 2** ran the live AI loop after a key was connected.

---

## 3. Lifecycle results

| Stage | Surface | Result | Cost |
|---|---|---|---|
| Onboarding | `/onboarding` | ✅ 4-question flow → real user model written to disk (`profile.md`, `interests.md`, `feedback.md`, event log) | $0 (deterministic) |
| Paper search | `/papers` | ✅ OpenAlex returns the canonical AAD literature; arXiv was broken (see F3), fixed mid-test | $0 |
| Digest | `/papers` | ✅ accurate structured summary + key points for the mTRF Toolbox paper | $0.03 |
| Personalized feed | `/` | ✅ 12 papers, relevance-scored, with **why-this/why-you/why-now** that referenced *both* the onboarded profile and my earlier searches | $0.42 |
| Add to Knowledge Base | ingest → `/wiki` | ✅ one paper → **11 interlinked wiki pages** (1 paper, 2 concepts, 2 methods, 5 authors, 1 topic) + one-click Undo | $0.15 |
| Knowledge graph | `/viz` | ✅ derived live: **11 nodes · 55 edges · 2 communities** | $0 |
| Spark | `/spark` | ✅ Quick Spark → 3 vault-grounded idea seeds, each citing ingested concepts | $0.02 |
| Trending | `/trending` | ⚠️ 3-field split + real metrics/charts/top-movers work; **LLM survey null** (see F6) | $0.15 |
| Reader | `/reader` | ✅ full arXiv HTML + **select-to-ask** grounded answer; ⚠️ highlight re-paint broken (see F7) | $0.04 |
| Settings / spend | `/settings`, `/debug/llm` | ✅ new BYOK page (shipped this session) + spend panel | — |

**Companion (Ember):** greeted on open, celebrated context, and *proactively* noticed the 2 review-inbox items while reading — contextual, not Clippy-ish.

---

## 4. Findings

Severity: **S1** app-breaking · **S2** major surface broken · **S3** degraded/quality · **S4** minor/cosmetic.
Status: **Merged** (fixed & on `main`) · **Shipped** (new, on `main`) · **Open** (tracked chip) · **Noted** (untracked).

| # | Sev | Finding | Status |
|---|---|---|---|
| F1 | S1 | **Home page (and all browser vault I/O) crashed** — `RemoteVaultStorage` stored global `fetch` as an instance field and called `this.fetchFn(...)`, so the browser threw *"Failed to execute 'fetch' on 'Window': Illegal invocation."* Missed by unit tests (they inject a `this`-agnostic mock). | **Merged** (PR #1) |
| F2 | S2 | **`/debug/llm` hung on "loading…" and `/trending` was fully broken** — both read `.scispark/settings.json` via the generic vault route, which M11 intentionally 403s; the throw was uncaught. `/debug/llm` was the *only* key-entry surface, so a keyless user was stuck. | **Merged** (PR #1 migrated companion/trending settings to `/api/settings`) |
| F3 | S2 | **arXiv multi-word search returned irrelevant newest papers** (watermark forensics, vision transformers) — query built as `all:<words>` + sort-by-date, so common ML tokens dominated. OpenAlex handled the same query fine. Re-verified fixed interactively. | **Merged** (PR #4, Search-Intent skill) |
| F4 | S3 | **Trending field mis-seeded** — the entire free-text interests answer became one ~300-char field slug → 0 papers. Now correctly split into 3 subfields with real metrics. | **Merged** (PR #3) |
| F5 | S3 | **BYOK front door was a raw debug page** — `/debug/llm` (monospace "LLM harness debug", all providers at once, manual base-URL/model strings). New guided `/settings` page: provider presets + an **Other** tab (Server URL + Model) for any OpenAI-compatible service, masked key, Save & test connection. | **Shipped** (PR #2) |
| F6 | S3 | **Trending survey always `null` + manual Refresh doesn't persist** — each Refresh runs the survey skill and bills $0.02–0.05, but the panel shows "Couldn't generate the trend summary," `survey: null` on every panel, and `dashboard.json` is never rewritten (mtime frozen). Spends money without saving. | **Open** (`task_6913a421`) |
| F7 | S3 | **Reader highlights persist to disk but don't re-render on reload** — a highlight saves with a valid anchor (`exact`/`prefix`/`suffix`/offsets), the anchored text is present after reload, but `HighlightLayer` paints nothing. Likely a race between HTML-ready and highlights-loaded. Data is safe; the repaint path is broken. | **Open** (`task_14f37c03`) |
| F8 | S4 | **Author page duplication** — "Edmund C. Lalor" got two pages (one OpenAlex-ID `a50…`, one name-slug `edmund-c-lalor`). Dedup gap between ID-keyed and slug-keyed author creation. | **Noted** (untracked) |
| F9 | S4 | **`/profile` "Preferences" showed fork-mock clinical data** (Psychiatry / Psychedelic therapy / PubMed alerts) unrelated to the onboarded profile; sidebar user + "Recent Chats" were hardcoded clinical mock. Recent-chats mock cleaned up post-merge; the Preferences card was part of the trending/profile task. | **Merged/partial** (PR #3 — re-verify Preferences card) |
| F10 | S4 | **Full-text fetch failed for the Frontiers paper** — `/api/fetch` relay 403 on the PDF + `/api/resolve` (Unpaywall) 503 → correctly degraded to the abstract (which has no select-to-ask). External/infra; graceful. | **Noted** |
| F11 | S4 | **arXiv HTML leaks minor LaTeX artifacts** in the reader (`\addbibresource`, raw citation keys like `[cherry1953some]`, `††thanks`). Cosmetic. | **Noted** |
| F12 | Info | Benign console 404s — existence probes for `profile.md` / feed / highlights before those files are first created. Not errors. | Info |

---

## 5. What shipped during this test

Four PRs merged to `main` while testing (three were background tasks spun off from findings, one was hands-on):

- **PR #1** — settings-write migration to `/api/settings` + `RemoteVaultStorage` fetch-receiver fix → resolves **F1, F2**.
- **PR #2** — the new user-facing **`/settings`** page (this session's hands-on work) → addresses **F5**. Two commits + a CLAUDE.md doc update; rebased onto the concurrent PR #1 (dropped my redundant fetch fix, rewired the companion card to the new `/api/settings` remote client).
- **PR #3** — trending field split + profile wiring → resolves **F4** (and partially **F9**).
- **PR #4** — arXiv relevance / Search-Intent skill → resolves **F3**.

**Verification before merge (PR #2):** 1,325 tests pass, `tsc --noEmit` clean, lint clean on changed files, browser-driven (preset auto-fill, masked entry, Save & test hitting a real provider error, the Other tab round-tripping and inferring "Other" on reload).

---

## 6. Cost

Total live spend for the full loop: **$0.85** (GMI `claude-sonnet-5`).

| Skill | $ | Note |
|---|---|---|
| feed (rank + rerank + strategy) | 0.42 | multi-stage agent; rank ran several candidate batches |
| trending | 0.15 | **inflated by F6** — repeated non-persisting refreshes |
| ingest | 0.15 | one paper → 11 pages |
| reading-companion (ask) | 0.04 | grounded select-to-ask answer |
| companion (Ember utterances) | 0.04 | greetings / proactive nudges |
| digest | 0.03 | |
| spark-quick | 0.02 | 3 grounded seeds |
| search-intent | 0.002 | arXiv query planning |
| debug-ping | 0.0002 | key validation |

A clean single pass (no F6 waste, no duplicate refreshes) would land around **$0.60**.

---

## 7. Recommendations / next

1. **F6 (trending survey + refresh persistence)** — highest priority of the open items: it silently bills for output it discards.
2. **F7 (reader highlight re-paint)** — persistence is fine; fix the repaint race so highlights survive reload visually.
3. **F8 (author dedup)** — small but visible in both `/wiki` and the graph; worth a dedup pass keyed on OpenAlex ID with name-slug fallback. *(Not yet tracked — recommend spinning off.)*
4. **F9** — re-verify the `/profile` Preferences card now shows the real user model (not clinical mock).
5. **Reader full-text robustness (F10)** — the `/api/fetch` 403 on a legitimate OA PDF and Unpaywall 503 suggest the relay allowlist / retry story needs hardening; arXiv HTML worked well.
6. **Reader polish (F11)** — strip LaTeX-source artifacts from arXiv HTML.

**Not yet driven:** `Capture idea` in the reader (→ `note` changeset) and PDF-surface reading (pdf.js) — the HTML surface + Ask + Highlight were exercised; these two remain.

---

## 8. Artifacts

- **Recordings:** `scispark-usertest-eeg-part1.mp4` (deterministic surfaces) · `scispark-usertest-eeg-part2.mp4` (live AI loop incl. reader).
- **Real knowledge base:** `~/SciSpark/eeg-auditory-vault` — 11 wiki pages, 1 highlight, user model, trending dashboard, run/usage logs.
- **Open task chips:** `task_6913a421` (trending survey/refresh), `task_14f37c03` (reader highlight repaint).
- **Merged PRs:** #1 (settings migration + fetch fix), #2 (`/settings` page), #3 (trending/profile), #4 (arXiv search).
