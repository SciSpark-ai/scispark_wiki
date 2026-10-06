# SciSpark managed host binding
Selected mode: full protocol, two strands, local Markdown artifacts, single fresh-context review. Original procedures below govern research steps. No GitHub orchestration, LaTeX export, PDF-to-PNG review, arbitrary shell, canonical/DOI lookup, other source engines or enhanced conversion is adapted. Disclose these limitations, and stop for setup when they are essential. OpenCite supports Semantic Scholar keyword search, observed public PDF retrieval, local conversion and BibTeX only. Missing full text remains abstract-only or missing. OpenCite unavailable-download causes are not distinguished; never invent a reason.
Use typed named dependencies from inventory; human names map to their captured refs. Never install host agents or change models. Both model tiers/roles are captured by the root. Instructions asking for local files map to publish_artifact outputs with original logical paths in titles; no research-vault writes without explicit user intent and coordinator changeset authorization. Source refs must point to observed corpus sources. Persist briefs, cards, sources, metadata, bibliography, synthesis, direction, review and final prose artifacts. Cite exact passages plus source IDs; explicitly disclose missing sources, contradictory evidence and unsupported requested comparisons. Self-review and JSON validity do not prove scientific correctness.
All original source resources are byte-preserved at their original skill-relative paths. the selected procedure text in this entrypoint has already been loaded. Page additional resources with read_resource. Original example paths denote output artifact names, not package dependencies.

Root full protocol. First create strand briefs. Use parallel for exactly two collection nodes with independent briefs. Then integrate whole corpus, call manuscript-writing for direction prose, paper-review for independent review, and humanizer for final prose. Retain unsupported comparison statements and citation links through revisions. Do not call native Deep review.

## Original resource: lit-review/SKILL.md
---
name: lit-review
description: "Use this skill for \"literature review workflow\", \"multi-phase lit review\", \"direction paper\", \"review paper protocol\", \"strand-based literature review\", \"citation-grounded review\", \"systematic lit review with paper cards\", \"build a lit review corpus\", \"lit review pipeline\", \"orchestrate a literature review\", \"research directions document\", \"write a literature review\", \"synthesize papers\", \"thematic review\", \"narrative review\", \"systematic review\", \"scoping review\", \"gap analysis\", or when the user wants either a rigorous multi-phase citation-traceable lit review or a single-pass thematic synthesis for an Introduction/Background section."
version: 0.2.2
---

# Multi-Phase Literature Review Workflow

Orchestrate a rigorous, citation-grounded literature review across phases: angles to briefs, parallel paper collection, taxonomic synthesis, direction papers, and self-review loops. Every claim in a final document is traceable back to a paper-card.

## When to Use

- Building a corpus-grounded review paper or a set of direction documents
- Multi-strand reviews where breadth + depth must be coordinated across distinct angles (e.g. tools strand, data strand, science strand)
- Reviews where claim-to-evidence traceability matters (grant lit reviews, position papers, white papers)
- Iterative reviews where new papers, refined angles, or updated synthesis must roll forward without losing prior work

## When NOT to Use

- Original research IMRAD writing. Use `manuscript:manuscript-writing`.
- Peer review of a submitted manuscript. Use `manuscript:paper-review`.
- Journal formatting. Use `manuscript:manuscript-formatting`.

## Two modes

This skill covers two workflows:

- **Express mode (single-pass synthesis)**: thematic synthesis for an Introduction, Background section, or quick standalone review. See [references/single-pass-synthesis.md](../../lit-review/references/single-pass-synthesis.md). Pair with [references/review-frameworks.md](../../lit-review/references/review-frameworks.md) for PRISMA, PICO, SPIDER, scoping protocol, and risk-of-bias tools.
- **Full protocol (multi-phase)**: citation-traceable corpus reviews and direction papers. Use the Phase 0-4 workflow below.

When in doubt: if the user wants flowing prose for one section, use express mode; if they want a corpus with claim-to-card traceability, use the full protocol.

## Workflow Phases

```
Phase 0: Briefs            -> _briefs/strand-*.md (one brief per strand)
Phase 1: Collection        -> research/collection/<strand>/<slug>/{card.md, source.{pdf,md}, meta.json}
                              + INDEX.md + <strand>.bib per strand
Phase 2: Synthesis         -> research/synthesis/{<strand>-ontology, gap-analysis, scope-diagram, <domain>-map}.md
Phase 3: Direction papers  -> direction-papers/<topic>-direction.md
Phase 4: Review loop       -> revised direction; may reopen Phase 1 with new gaps
```

Each angle is realized as a strand; the brief is the strand's dispatch document. Iteration is expected: loop back from any phase. The directory layout is the persistence layer; treat it as the source of truth between sessions.

### Phase 0: Define angles and write briefs

Inputs: prior work, gap statement, epic-dev findings (if any), grant call or thesis question.

Output: one brief per strand in `_briefs/strand-<name>.md`.

Each brief defines:
- Goal (one sentence)
- Scope categories (numbered list, breadth first)
- Per-entry deliverable (cards + source + bib + index)
- Seed material (existing prior-work documents to import)
- Acceptance criteria (count thresholds, breadth thresholds, completeness gates)
- Out-of-scope items
- Sister skills to use (`opencite:opencite`, `manuscript:manuscript-writing`)

See [references/brief-template.md](../../lit-review/references/brief-template.md) for the full structure.

If the user names a project domain (neuro tools, clinical trials, ML methods, etc.), generate strands by partitioning the topic on dimensions that *cannot be merged later without information loss*. Common partitions: methods vs. infrastructure vs. application; tools vs. data vs. theory; modality A vs. modality B.

### Phase 1: Collection (parallel strand agents)

For each strand, build a corpus of paper-cards under `research/collection/<strand>/`. Each entry is a folder with `card.md` plus `source.md` plus `meta.json`, and `source.pdf` only when redistributable. Per-strand aggregates are `INDEX.md` and `<strand>.bib`. Use `opencite:opencite` for all paper operations.

Schema and storage rules: [references/paper-card-schema.md](../../lit-review/references/paper-card-schema.md). License-to-redistribution policy and CI rule: [references/license-rules.md](../../lit-review/references/license-rules.md).

When parallelizing strands, dispatch one agent per strand. Use the brief as the agent's full context. Do not let strand agents synthesize across strands; that is Phase 2's job.

### Phase 2: Synthesis (whole-corpus integration)

Inputs: full collection across all strands.

Outputs (in `research/synthesis/`):
- `<strand>-ontology.md` per strand: hierarchical category tree of corpus entries
- `<domain>-map.md` (e.g. `science-map.md`): theme-by-theme inventory of analytic / methodological themes
- `<data>-hierarchy.md` (e.g. `dataset-hierarchy.md`): the data layer, when applicable
- `gap-analysis.md`: three-column comparison of what is covered by prior efforts vs. what the synthesis reveals as uncovered. The third column is the input to Phase 3
- `scope-diagram.md`: prose plus optional Mermaid/ASCII diagram of corpus boundaries

Bias rules (enforced):
- Gap analysis must list *what the corpus does NOT support*, not just what it does
- Inter-strand contradictions must be named, not papered over
- Frequency-of-mention is not evidence weight; cite single primary sources where appropriate

See [references/synthesis-templates.md](../../lit-review/references/synthesis-templates.md).

### Phase 3: Direction papers (citation-grounded essays)

Output: `direction-papers/<topic>-direction.md` per direction (typically one per strand or per gap cluster).

Each direction paper:
- Defends a thesis grounded in the corpus
- Cites every claim back to a specific card path: `[<slug>](../research/collection/<strand>/<slug>/card.md)`
- Closes with a flat references section keyed to BibTeX in the strand `.bib`
- Follows review-paper IMRAD structure and prose discipline (delegate to `manuscript:manuscript-writing`): no em-dashes, abbreviations defined on first use, descriptive voice not exhortatory

The cite-card cross-link is the load-bearing convention. A claim that does not link to a card is a claim that has not yet been grounded; either ground it (add the card) or remove the claim.

See [references/direction-paper-template.md](../../lit-review/references/direction-paper-template.md).

For LaTeX export of a direction paper to a journal review template, delegate to `manuscript:manuscript-formatting`. The base format is markdown.

### Phase 4: Review loop

Self-review the direction paper using `manuscript:paper-review`. Treat it as a peer review of one's own draft.

Common loop-back triggers:
- Reviewer (self or other) names a claim as ungrounded -> Phase 1 (add cards) or Phase 3 (drop claim)
- Reviewer flags a missing theme -> Phase 0 (new strand or expanded scope) -> Phase 1 (collect)
- Reviewer flags a contradiction in synthesis -> Phase 2 (revise gap analysis or ontology)
- Reviewer flags storyline incoherence -> Phase 3 (restructure with `manuscript:manuscript-writing`)

Apply [references/rigor-checklist.md](../../lit-review/references/rigor-checklist.md) before declaring a direction paper done.

## Bootstrapping a new lit review

When the user starts fresh, propose a top-level layout in the working directory or a subdirectory:

```
<root>/
├── _briefs/
├── research/
│   ├── collection/
│   │   ├── _schema/paper-card.md
│   │   └── <strand>/
│   └── synthesis/
└── direction-papers/
```

Create directories on demand as work progresses; do not pre-create empty trees. The `_schema/paper-card.md` should be a copy of [references/paper-card-schema.md](../../lit-review/references/paper-card-schema.md) so that strand agents have a local reference.

## Formalize phases with `project:epic-dev`

The Phase 0-4 workflow maps cleanly onto the epic/sprint model. When the lit review lives in a git repository with a GitHub remote, delegate phase orchestration (issues, sub-issues, branches, worktrees, state file) to `project:epic-dev` so the review has the same tracking discipline as feature work. This is opt-in; skip it for non-git note folders or solo scratch reviews.

Recommended mapping:

| Lit-review artifact | epic-dev artifact |
|---|---|
| The lit review itself | Epic issue + epic branch (`feature/issue-{N}-epic-litreview-{slug}`) |
| Phase 0 (briefs) | Sub-issue, single phase branch; output `_briefs/strand-*.md` |
| Phase 1 (collection) | One sub-issue + worktree per strand for parallel agents; outputs under `research/collection/<strand>/` |
| Phase 2 (synthesis) | Sub-issue depending on all Phase 1 phases; outputs under `research/synthesis/` |
| Phase 3 (direction papers) | One sub-issue per direction paper, can run in parallel; outputs under `direction-papers/` |
| Phase 4 (review loop) | Sub-issue per review pass; loop-back triggers reopen earlier-phase issues rather than mutating closed ones |
| `.claude/epic.local.md` | Phase tracker that survives sessions; complements the directory-as-source-of-truth convention |

When to invoke epic-dev:

- At the start of a fresh multi-strand lit review, after the user agrees on the strand list. Delegate epic + sub-issue creation to `project:epic-dev`; it will produce the issue tree, worktrees, and state file. Continue Phase 0 brief drafting inside the resulting epic worktree.
- When a Phase 4 review loop spawns new gaps that justify reopening Phase 1 with new strands, create new sub-issues under the existing epic via `project:epic-dev --next-phase` rather than starting a parallel epic.
- When resuming a stalled review across sessions, `project:epic-dev --resume` reads `.claude/epic.local.md` and routes back to the active phase worktree.

When NOT to invoke epic-dev:

- The review is express-mode (single-pass synthesis); the overhead exceeds the value.
- The output lives in a non-git directory (private notes, OneDrive, Notion export staging).
- The user declines GitHub issue tracking for the review.

The cite-card cross-link convention from Phase 3 still applies regardless of whether phases are tracked as epic-dev sub-issues; epic-dev tracks the *process*, not the *traceability*.

## Sister skills

Invoke each installed skill by its fully qualified `<plugin>:<skill>` name through the host's skill-invocation mechanism. Keep host-specific command or tool syntax in the host adapter, not in shared skill instructions.

| Skill | Used for |
|---|---|
| `opencite:opencite` | DOI lookup, PDF retrieval, PDF -> markdown, BibTeX export |
| `manuscript:manuscript-writing` | IMRAD / review-paper structure plus prose discipline (abbreviations, voice, transitions) |
| `manuscript:manuscript-formatting` | Journal formatting / LaTeX export |
| `manuscript:paper-review` | Self-review loops on direction-paper drafts |
| `manuscript:humanizer` | Final natural-writing pass on synthesized prose. Lit-review synthesis sections are particularly prone to "evolving landscape", "growing body of work", and significance-inflation patterns; run humanizer before declaring a direction paper or Phase 2 synthesis complete. |
| `project:epic-dev` | Formalize the lit-review phases (epic + sub-issues + worktrees + state file); also an upstream source of research angles when reviewing one's own project |

## References

- [references/paper-card-schema.md](../../lit-review/references/paper-card-schema.md): card.md frontmatter + sections, meta.json schema, license vocabulary, storage rules
- [references/brief-template.md](../../lit-review/references/brief-template.md): per-strand dispatch brief structure
- [references/synthesis-templates.md](../../lit-review/references/synthesis-templates.md): ontology, gap-analysis, map, scope-diagram patterns
- [references/direction-paper-template.md](../../lit-review/references/direction-paper-template.md): essay structure with cite-card cross-link convention
- [references/license-rules.md](../../lit-review/references/license-rules.md): redistribution discipline and CI rules
- [references/rigor-checklist.md](../../lit-review/references/rigor-checklist.md): cohesion, storyline, bias-neutrality, traceability acceptance criteria
- [references/single-pass-synthesis.md](../../lit-review/references/single-pass-synthesis.md): express-mode thematic synthesis pipeline for Introduction/Background sections
- [references/review-frameworks.md](../../lit-review/references/review-frameworks.md): PRISMA, PICO, SPIDER, scoping protocol, risk-of-bias tools


## Original resource: lit-review/references/brief-template.md
# Strand Brief Template

A brief is the dispatch document for a single strand. It is the only context a parallel collection agent should need.

## File location

`_briefs/strand-<short-name>.md`, e.g. `_briefs/strand-A-tools.md`.

## Structure

```markdown
# Strand <X>, <Strand Title> (Phase 1 brief)

**Goal:** populate `research/collection/<strand>/` with at least <N> paper-cards covering <topic>.

## Scope

Cover <K> categories. Aim for breadth first, depth where it matters for the thesis.

### 1. <Category 1>
- <Bullet seed list of canonical works, tools, datasets, or standards>
- <Include explicit names, version pins where helpful>

### 2. <Category 2>
- ...

### <K>. <Category K>
- ...

## Per-entry deliverable

Create folder `research/collection/<strand>/<slug>/` containing:
- `card.md` from the schema (`type` ∈ {paper, dataset, tool, platform, standard}; `strand: <strand>`)
- `source.pdf` only if redistributable (open access, preprint, repo copy)
- `source.md` always required; markdown extraction or canonical README
- `meta.json` with provenance (DOI / URL, retrieved_at, license, sha256 if PDF archived, redistribution_ok)
- BibTeX entry appended to `research/collection/<strand>/<strand>.bib`
- One-line entry in `research/collection/<strand>/INDEX.md` under the right category heading

Use `opencite:opencite` for DOI lookup, PDF retrieval (where licensing permits), and PDF -> markdown conversion.

## Seed material

<Point to existing prior-work documents the agent should mine for entries, e.g.>
- `<path/to/existing-lit-review.md>`
- `<path/to/grant-strategy.tex>`

Imported entries must set `imported_from: <relative path>` in card.md.

## Skills to use

- `opencite:opencite` for paper retrieval, DOI lookup, BibTeX export
- `manuscript:manuscript-writing` for prose discipline (no em-dashes, abbreviations on first use)

## Acceptance criteria

- [ ] >= <N> entries across all <K> categories
- [ ] Each category has >= <M> entries
- [ ] Every entry folder has `card.md`, `source.md`, and `meta.json`
- [ ] All entries have BibTeX in <strand>.bib
- [ ] INDEX.md fully populated with categorized one-liners
- [ ] No prose synthesis in this phase; that is Phase 2

## Out of scope

- <Topics adjacent but outside the thesis>
- Drafting the direction paper or other synthesis prose
- Comparing or ranking entries; collection only
```

## Authoring notes

- The brief is opinionated. Vague briefs produce vague corpora.
- Numerical thresholds (>= N entries, >= M per category) should be set high enough to force breadth and low enough to ship in one parallel agent run. Typical: N = 20-40, M = 3-6.
- Sanity-check (not an acceptance criterion): a healthy strand archives `source.pdf` for a meaningful share of entries with redistributable papers. If almost no PDFs are archived, the corpus may have skewed toward paywalled-only sources; consider preprint or AAM alternatives.
- Seed material is critical. If no prior-work documents exist, the brief must enumerate canonical entries explicitly, otherwise the agent will return a generic survey rather than a thesis-aligned corpus.
- "Out of scope" lines save more wasted work than any other section. Be specific.


## Original resource: lit-review/references/synthesis-templates.md
# Synthesis Templates

Phase 2 outputs live in `research/synthesis/`. Each document integrates the full corpus across strands. Synthesis is bias-disciplined: gaps are stated explicitly, contradictions are named, frequency is not weight.

## File set

| File | Purpose | Required? |
|---|---|---|
| `<strand>-ontology.md` | Hierarchical category tree per strand (one file per strand) | Yes |
| `<domain>-map.md` | Theme-by-theme inventory of analytic / methodological themes | Yes |
| `<data>-hierarchy.md` | The data layer (datasets, modalities, sample sizes); rename per domain | Iff strand has data |
| `gap-analysis.md` | Three-column accounting: prior-effort coverage, current-thesis coverage, uncovered scope | Yes |
| `scope-diagram.md` | Prose plus optional Mermaid/ASCII diagram of corpus boundaries | Yes |

## Ontology template

```markdown
# <Strand> Ontology

A hierarchical view of the <strand> corpus. Each entry links to its paper-card.

## Top-level categories

### Category A: <name>
- Sub-category A.1: <name>
  - [<slug>](../collection/<strand>/<slug>/card.md): one-line role statement
  - ...
- Sub-category A.2: <name>
  - ...

### Category B: <name>
- ...

## Cross-cutting tags

Tags that apply across categories (e.g. open-source, deprecated, paywalled, GPU-required):
- `<tag>`: [<slug>](../collection/<strand>/<slug>/card.md), ...
```

Sub-category leaves should not duplicate the brief's category headings; the ontology is allowed to refactor categories as the corpus reveals natural joints.

## Map template (theme-by-theme inventory)

```markdown
# <Domain> Map

Theme-by-theme inventory of the analytic and methodological themes the corpus addresses. Each theme cites the establishing paper-cards.

## Theme 1: <name>

**Defining works**: [<slug>](../collection/<strand>/<slug>/card.md), [<slug>](...).

<2-4 sentence prose summary of the theme: what it studies, what method, what scope.>

**Open questions**: <named questions the corpus surfaces but does not answer. These feed gap-analysis.>

## Theme 2: <name>

...
```

The map is the connective tissue between collection and direction papers. A direction paper that does not draw on the map is probably ungrounded; a theme in the map that no direction paper draws on is probably noise.

## Gap analysis template

Three-column structure. The third column is the load-bearing one.

```markdown
# Gap Analysis

| Topic | <Prior effort A> covers | <Prior effort B> covers | Uncovered, our distinctive scope |
|---|---|---|---|
| <Topic 1> | <coverage> | <coverage> | <gap> |
| <Topic 2> | <coverage> | <coverage> | <gap> |
| ... | ... | ... | ... |

## Concrete gap list

### Gap 1: <name>

**Established by**: [<slug>](../collection/<strand>/<slug>/card.md), [<slug>](...).

<2-3 sentence prose: what the corpus reveals as missing, why it matters.>

**Proposed Phase 3 commitment**: <what the direction paper will say about this gap.>

### Gap 2: <name>

...
```

Bias rules:

1. **Gaps are about absence, not preference.** "We could do X" is not a gap; "the corpus does not contain a single entry that does X" is a gap.
2. **Cite the absence.** A gap is established by listing the cards that establish the boundary; the gap itself is the negative space those cards collectively define.
3. **Acceptance bar exceeds the brief.** If the brief asked for >= 5 gaps, the synthesis should return >= 6-8. Phase 3 will prioritize.
4. **Contradictions are not gaps.** When two corpus entries disagree, name the contradiction in the map under "Open questions"; do not flatten it into a gap.

## Scope diagram template

```markdown
# Scope Diagram

A prose-plus-diagram statement of what this corpus covers and what it deliberately excludes.

## In scope

- <Topic>: covered by <N> entries across <strand A> and <strand B>
- ...

## Adjacent but out of scope

- <Topic>: explicitly out of scope per [brief A](../_briefs/strand-A.md) and [brief B](../_briefs/strand-B.md). Rationale: <why>.
- ...

## Boundaries diagram

```
<ASCII or Mermaid diagram showing nested or overlapping scopes>
```
```

If using Mermaid, prefer `flowchart TD` or `mindmap`. Keep it under 30 nodes; otherwise the diagram has stopped being a summary.

## Authoring discipline

- Synthesis prose follows `manuscript:manuscript-writing` discipline: no em-dashes, abbreviations defined on first use, descriptive voice not exhortatory.
- Every concrete claim cites a card path. The synthesis is a summary of the corpus, not a summary of the author's prior knowledge.
- If a synthesis claim cannot be cited to a card, it is a hint that a card is missing from the corpus. Either add the card (loop to Phase 1) or drop the claim.


## Original resource: lit-review/references/direction-paper-template.md
# Direction Paper Template

A direction paper is a focused, citation-rich essay that defends a thesis, surveys the landscape, and proposes a roadmap. One per strand or per gap cluster.

## File location

`direction-papers/<topic>-direction.md`.

## Structure

```markdown
# <Strand or Topic> Direction, <Headline Thesis>

A focused review on the <strand> strand of <project>. <One-paragraph thesis statement that names what is missing in the literature and what this paper argues should fill the gap.> The argument was first articulated in <upstream issue or prior-work pointer>; this paper develops it into a literature-grounded position by surveying the <K> themes catalogued in the Phase 1 corpus and the Phase 2 [`<domain>-map`](../research/synthesis/<domain>-map.md).

Abbreviations: <Define every abbreviation on first use, comma-separated, in this paragraph.>

## 1. Introduction

### 1.1 The arc

<2-4 paragraphs locating the topic historically. Cite the establishing works:>
[<slug>](../research/collection/<strand>/<slug>/card.md), [<slug>](...).

### 1.2 Gap statement

<1-2 paragraphs naming what is missing. Anchor the gap with citations to corpus cards. Mirror the gap as it appears in `../research/synthesis/gap-analysis.md`, do not invent a new framing.>

### 1.3 Thesis

<1 paragraph articulating the direction this paper argues for. State the structure of the remainder.>

## 2. Background, the <K> themes

The Phase 1 corpus organizes <N> entries into <K> themes; the Phase 2 [`<domain>-map`](../research/synthesis/<domain>-map.md) inventories each theme. This section summarizes the prior-work landscape that the rest of the paper draws on.

**Theme 1, <name>.** <2-4 sentence summary citing card paths: [<slug>](../research/collection/<strand>/<slug>/card.md).>

**Theme 2, <name>.** <...>

...

## 3. <Argument body>

### 3.1 <Argument node 1>

<Each subsection advances one beat of the thesis. Every claim cites a card path. Counter-evidence is named, not omitted.>

### 3.2 <Argument node 2>

...

## 4. <Existence proof or anchor case>

<One concrete case from the corpus that demonstrates the thesis is buildable. Cite the card.>

## 5. Roadmap

<Phased commitments derived from `../research/synthesis/gap-analysis.md`. Each commitment names the artifacts it would produce.>

## 6. Coordination with adjacent efforts

<How this direction relates to sister grants, parallel labs, or adjacent efforts. Cite cards or external pointers.>

## 7. Discussion

### 7.1 Interpretation

<What the direction paper changes about the field if adopted.>

### 7.2 Limitations

<Honest limitations. What corpus entries do not support this thesis? Name them.>

### 7.3 Counterarguments

<Steelman the strongest objection. Cite the cards that ground the objection. Then respond.>

## 8. Conclusion

<1-2 paragraphs.>

## References

<Flat list keyed to the strand .bib. One entry per BibTeX key, in the order first cited or alphabetical, by convention.>
```

## The cite-card cross-link convention

Every concrete claim in a direction paper must include a cross-link of the form:

```markdown
[<slug>](../research/collection/<strand>/<slug>/card.md)
```

This is the load-bearing convention. It serves three purposes:

1. **Traceability**: a reader (or a later self) can land on the card and check the claim against `source.md`.
2. **Falsifiability**: a claim that does not link to a card has not yet been grounded. Either ground it (add a card) or drop it.
3. **Bias hygiene**: links force engagement with the actual corpus instead of the author's prior beliefs.

A direction paper is *complete* when every paragraph contains at least one cross-link to a card, and every cited card actually supports the claim.

## Style discipline

Apply `manuscript:manuscript-writing`:

- No em-dashes; commas or semicolons.
- Abbreviations defined on first use within the document. The Abbreviations paragraph after the thesis is the canonical first-use site.
- Descriptive voice, not exhortatory. "<Project> argues" rather than "<Project> must"; "the corpus reveals" rather than "we should".
- Active voice for actions the paper takes. Past tense for what prior work did.
- One idea per sentence. Topic sentence then evidence then interpretation per paragraph.

## Length guide

| Section | Target |
|---|---|
| Introduction (1) | 1.5-3 pages |
| Background (2) | 2-4 pages |
| Argument (3) | 4-7 pages |
| Anchor case (4) | 1-2 pages |
| Roadmap (5) | 1-2 pages |
| Coordination (6) | 1 page |
| Discussion (7) | 2-3 pages |
| Conclusion (8) | 0.5 page |

Total target: 12-22 pages of dense markdown, before the References section.

## When the paper feels unfinished

Diagnostic checklist:

- A section reads as opinion rather than synthesis -> add card cross-links to ground each beat.
- The argument cites the same 3-4 cards repeatedly -> corpus is too narrow; loop to Phase 1.
- Counterarguments section is generic -> read the cards tagged as contrary; the strongest objection is in there.
- Roadmap reads as wish list -> tie each commitment to a specific gap from gap-analysis.md.
- Storyline does not flow -> apply `manuscript:manuscript-writing` revision pass focused on transitions and topic sentences.

## Export to LaTeX

Markdown is the base format. To export for a journal review template, delegate to `manuscript:manuscript-formatting` with the target journal. Cite-card cross-links typically convert to footnotes or in-text citations against the strand `.bib`.


## Original resource: lit-review/references/rigor-checklist.md
# Rigor Checklist

Apply before declaring a phase done. The checklist is per-phase; do not skip ahead.

## Phase 0: Briefs

- [ ] One brief per strand, in `_briefs/strand-<name>.md`.
- [ ] Strands partition the topic on a dimension that cannot be merged later (methods vs. data, tools vs. theory, modality vs. modality).
- [ ] Each brief has explicit scope categories (numbered list), per-entry deliverable, seed material, acceptance criteria, and out-of-scope items.
- [ ] Acceptance criteria are quantified: minimum entry count overall and per category.
- [ ] No prose synthesis is implied by the brief; collection only.

## Phase 1: Collection

- [ ] Per-entry artifact set complete: `card.md`, `source.md`, `meta.json`. `source.pdf` iff `redistribution_ok: true`.
- [ ] Every entry's `card.md` has all required frontmatter fields populated, no nulls except where allowed.
- [ ] `relevance` is calibrated: less than ~40% of entries are `high`.
- [ ] `INDEX.md` per strand is fully populated, grouped by category.
- [ ] `<strand>.bib` has a BibTeX record for every entry.
- [ ] License rules are not violated: no `source.pdf` exists where `redistribution_ok: false`.
- [ ] Acceptance thresholds from the brief are met (entry count overall and per category).
- [ ] No cross-strand synthesis has crept in; cards summarize one work each.

## Phase 2: Synthesis

- [ ] One ontology per strand in `research/synthesis/<strand>-ontology.md`. Each leaf links to a card.
- [ ] Domain map (`<domain>-map.md`) inventories themes; each theme cites establishing cards and lists open questions.
- [ ] Data hierarchy or domain equivalent if applicable.
- [ ] `gap-analysis.md` is three-column with the third column as the load-bearing one. Gap count exceeds the brief's bar.
- [ ] Each gap is established by listing the cards that collectively define the negative space.
- [ ] Inter-strand contradictions are named in the map under "Open questions", not flattened into gaps.
- [ ] `scope-diagram.md` states in-scope and adjacent-out-of-scope explicitly, with rationale for exclusions.
- [ ] Every concrete claim in synthesis prose cites a card path. No ungrounded assertions.

## Phase 3: Direction papers

- [ ] One direction paper per strand or per gap cluster, in `direction-papers/<topic>-direction.md`.
- [ ] Headline thesis is articulated in the opening paragraph and the Introduction.
- [ ] Every concrete claim includes a cite-card cross-link of the form `[<slug>](../research/collection/<strand>/<slug>/card.md)`.
- [ ] Every paragraph in argument sections (3, 4, 5) contains at least one cite-card cross-link.
- [ ] Every cited card actually supports the claim. Spot-check by clicking through and reading the card's TL;DR and Notable details sections.
- [ ] Counterargument section is corpus-grounded, not generic. The strongest objection is named with cite-card links.
- [ ] Roadmap commitments tie to specific gaps in `gap-analysis.md`.
- [ ] Style discipline is enforced: no em-dashes; abbreviations defined on first use in the Abbreviations paragraph; descriptive voice not exhortatory.
- [ ] References section is keyed to the strand `.bib`.

## Phase 4: Review loop

- [ ] Self-review pass via `manuscript:paper-review` is recorded as comments or a sibling review document.
- [ ] Each reviewer concern is dispositioned: ground (Phase 1), restructure (Phase 2 or 3), or drop (Phase 3 with explicit removal).
- [ ] Loop-backs are atomic: a single concern produces a single revision pass; do not bundle revisions across concerns until the final polish.
- [ ] After the final revision pass, re-run Phase 3 checklist completely.

## Whole-project quality gates

These are the gates that distinguish a rigorous review from a pretty one.

### Traceability

Pick five claims at random from the direction paper. For each:

- [ ] Click the cite-card link. Does the card load?
- [ ] Does the card's TL;DR or Summary support the claim?
- [ ] Does `source.md` (or `source.pdf` if redistributable) actually contain the supporting text?

If any of the three fails, the claim is ungrounded. Fix it.

### Storyline cohesion

Read the direction paper section openings only (Section 1.1, 1.2, ..., 7.1, 7.2, 8). 

- [ ] Do the section openings, read in order, narrate a coherent argument?
- [ ] Does each section's opening reference what the prior section established?
- [ ] Is there a single thesis sentence that the whole paper drives toward, recoverable from reading openings only?

If reading openings only yields fragments rather than an argument, restructure with `manuscript:manuscript-writing`.

### Bias balance

- [ ] Counterargument section names the strongest objection, not a strawman.
- [ ] Limitations section names corpus entries that do not support the thesis (not just generic methodological caveats).
- [ ] Gap analysis lists what the corpus does NOT support. Frequency-of-mention is not weight.
- [ ] If results favor the thesis on every dimension, the corpus is probably too small or too aligned. Loop to Phase 1 and add adversarial entries.

### Reproducibility

- [ ] A reader who clones the corpus and reads `_briefs/`, `research/collection/<strand>/INDEX.md`, `research/synthesis/`, and `direction-papers/` in order can reconstruct the argument without further context.
- [ ] No load-bearing claims live only in conversation history or scratch notes. Persist them to the layout.

## Final acceptance

The review is done when:

- All Phase 3 checks pass.
- All whole-project quality gates pass.
- The user (or self) has read the direction paper end to end and would defend each cite-card link in a hostile review.

Anything less is a draft, not a release.
