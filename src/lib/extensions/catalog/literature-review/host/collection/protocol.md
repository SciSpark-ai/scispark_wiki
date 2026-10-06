# SciSpark managed host binding
Selected mode: full protocol, two strands, local Markdown artifacts, single fresh-context review. Original procedures below govern research steps. No GitHub orchestration, LaTeX export, PDF-to-PNG review, arbitrary shell, canonical/DOI lookup, other source engines or enhanced conversion is adapted. Disclose these limitations, and stop for setup when they are essential. OpenCite supports Semantic Scholar keyword search, observed public PDF retrieval, local conversion and BibTeX only. Missing full text remains abstract-only or missing. OpenCite unavailable-download causes are not distinguished; never invent a reason.
Use typed named dependencies from inventory; human names map to their captured refs. Never install host agents or change models. Both model tiers/roles are captured by the root. Instructions asking for local files map to publish_artifact outputs with original logical paths in titles; no research-vault writes without explicit user intent and coordinator changeset authorization. Source refs must point to observed corpus sources. Persist briefs, cards, sources, metadata, bibliography, synthesis, direction, review and final prose artifacts. Cite exact passages plus source IDs; explicitly disclose missing sources, contradictory evidence and unsupported requested comparisons. Self-review and JSON validity do not prove scientific correctness.
All original source resources are byte-preserved at their original skill-relative paths. the selected procedure text in this entrypoint has already been loaded. Page additional resources with read_resource. Original example paths denote output artifact names, not package dependencies.

Internal Phase 1 strand node. Read only the passed strand brief. Invoke opencite:opencite once for its bounded query. Persist paper cards, source text, metadata, strand index and bibliography; do not integrate across strands. No extra root run. Missing evidence is a finding, never fabricate content.

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


## Original resource: lit-review/references/paper-card-schema.md
# Paper-Card Schema

Each entry lives in its own folder under the strand:

```
research/collection/<strand>/<slug>/
├── card.md         this paper-card; required
├── source.pdf      full PDF; only when redistributable
├── source.md       markdown extraction or canonical README; always required
└── meta.json       provenance: source URL, retrieval date, license, hash, redistribution flag
```

Rationale: synthesis and direction-paper drafting must be able to re-read primary text without re-fetching. Summaries are derived; sources are persisted.

## card.md template

```yaml
---
slug: <kebab-case-short-id>             # matches folder name
type: paper | dataset | tool | platform | standard
strand: <strand-name>                   # matches the parent folder
year: <YYYY>
authors: [<surname1>, <surname2>, ...]
venue: <journal / conference / org>
doi: <doi or null>
url: <canonical url or null>
license: <license or null>
modalities: [<domain-specific tags>]
tags: [<5-12 short tags>]
relevance: high | medium | low
imported_from: <relative path or null>
added: <YYYY-MM-DD>

# Archival fields
pdf_status: archived | not-redistributable | not-available | not-applicable
pdf_path: source.pdf | null
md_path: source.md | null
md_quality: clean | rough | partial | abstract-only
---
```

### relevance calibration anchors

To keep the field discriminative for downstream filtering:

- **high**: direct dependency for the project's deliverables. The thing the work is built on or against.
- **medium**: standard within scope but not a direct dependency. Context that informs but does not constrain.
- **low**: tangential or background. Reference-only.

If more than ~40% of entries land in `high`, the field has lost discriminative power. Rebalance.

### Sections

- **TL;DR**: one or two sentences capturing the *thesis*, not duplicating the Summary opening.
- **Summary**: 3-6 sentences covering core contribution, method, scope, key numbers.
- **Relevance to the review**: concrete connection to the project / thesis. Cite specific mechanisms or claims. Avoid generic prose.
- **Notable details**: bullet list of facts worth pulling forward to synthesis.
- **Open questions / limitations**: paper-specific only. Phase 2 gap analysis depends on this; generic boilerplate is harmful.
- **Citations**: primary BibTeX key plus up to 5 related works as one-liners.

## meta.json template

```json
{
  "doi": "10.xxxx/xxxxx",
  "source_url": "https://...",
  "retrieved_at": "YYYY-MM-DD",
  "pdf_sha256": "<sha256 hex if archived; null otherwise>",
  "pdf_license": "<see vocabulary below>",
  "redistribution_ok": true,
  "notes": "<retrieval notes, e.g. 'arXiv preprint used; published version paywalled'>"
}
```

### pdf_license vocabulary

- `CC-BY`, `CC-BY-2.0`, `CC-BY-3.0`, `CC-BY-4.0`, `CC-BY-NC`, `CC0`
- `preprint-cc-arxiv`, `preprint-cc-biorxiv`, `preprint-cc-osf`
- `author-accepted-manuscript` (institutional repository copy)
- `publisher-paywall`
- `not-applicable` (e.g. tool with only a README)
- `unknown`

Values may include a parenthetical qualifier when needed, e.g. `publisher-paywall (NeuroImage); university repository copy archived`.

`redistribution_ok` must align with the license. Any `*-paywall` value implies `redistribution_ok: false`.

## Storage rules

The `pdf_status` enum semantics are:

- `archived`: `source.pdf` is committed; `pdf_sha256` populated. Used when `redistribution_ok: true` and a PDF is available.
- `not-redistributable`: paywalled or otherwise non-redistributable. `pdf_path: null`, `pdf_sha256: null`. `source.md` is still committed.
- `not-applicable`: no paper exists (tool / dataset / standard with only a README). `source.md` is the snapshot.
- `not-available`: download failed. Document the failure mode in `meta.json.notes` and re-attempt later.

The `redistribution_ok` field is the single source of truth for whether `source.pdf` may exist in the repo. License-to-redistribution policy and the CI rule live in [license-rules.md](../../lit-review/references/license-rules.md).

## INDEX.md per strand

Plain markdown index, grouped by category, one line per entry:

```markdown
# <Strand name> Collection Index

## Category 1
- [<slug>](./<slug>/card.md): one-line description (`relevance: high`, year)

## Category 2
- ...
```

## .bib per strand

Append the BibTeX returned by `opencite` for each entry:

```bibtex
@article{slug2024key,
  ...
}
```

Keep the citation key consistent with the slug where possible.

## Tooling

Use `opencite:opencite` to:

1. Resolve DOI / canonical URL
2. Download PDF where licensing permits
3. Convert PDF to markdown (`source.md`)
4. Export BibTeX

For tools or platforms without papers, snapshot the canonical README / docs landing as `source.md`. Link the repo URL in `meta.json.source_url`.


## Original resource: lit-review/references/license-rules.md
# License-Aware Archival Rules

The lit-review corpus must be redistributable. PDFs are committed only when the license permits. Markdown extractions are typically committed under research-note fair use.

## The single source of truth

`meta.json.redistribution_ok` (boolean) is the authoritative flag. Every other rule derives from it.

| `redistribution_ok` | `source.pdf` allowed in repo? | `source.md` allowed in repo? |
|---|---|---|
| `true`  | yes; populate `pdf_sha256`         | yes |
| `false` | no; `pdf_path: null`, `pdf_sha256: null` | yes; flag uncertainty in `notes` if extraction is borderline |

## License vocabulary and redistribution mapping

| `pdf_license` value | `redistribution_ok` |
|---|---|
| `CC-BY`, `CC-BY-2.0`, `CC-BY-3.0`, `CC-BY-4.0` | true |
| `CC0` | true |
| `CC-BY-NC` | true (research use; document non-commercial in `notes`) |
| `preprint-cc-arxiv`, `preprint-cc-biorxiv`, `preprint-cc-osf` | true |
| `author-accepted-manuscript` | true; document the institutional repository in `notes` |
| `publisher-paywall` | false |
| `publisher-paywall (<journal>); university repository copy archived` | true (the AAM is what is archived; document in `notes`) |
| `not-applicable` | true (no PDF; tool/dataset card) |
| `unknown` | false (default deny) |

When in doubt, default to `false`. Re-archiving is cheap; takedown notices are not.

## Source preference order

For each entry, prefer in order:

1. **Open-access publisher copy** (CC-BY journal, eLife, PLOS, Frontiers).
2. **Preprint** (arXiv, bioRxiv, OSF). Note the relationship to the published version in `notes`.
3. **Author Accepted Manuscript** in an institutional repository.
4. **Markdown extraction only**, no PDF (paywalled with no preprint).

If the only available copy is paywalled with no preprint or AAM, set `pdf_status: not-redistributable`, `pdf_path: null`, and store the markdown extraction.

## Markdown extractions of paywalled papers

Storing a markdown extraction (text only, no figures, no original layout) of a paywalled paper is generally accepted under research-note fair use across US, EU, and UK academic norms. However:

- Document the source in `meta.json.notes`: "extracted from paywalled <journal> PDF, used as research notes only".
- Do not commit the original PDF.
- Do not reproduce figures from the paywalled paper. Reference them by figure number and citation.
- If the rights holder requests removal, comply. Track such requests in a top-level `LICENSE-NOTES.md` if they accumulate.
- For papers under aggressive paywalls (e.g. publisher with active anti-circumvention enforcement), consider linking to the publisher landing page and citing without storing the markdown.

## Storage rules summary

- **Open-access PDF available**: commit `source.pdf` and `source.md`. `redistribution_ok: true`. Populate `pdf_sha256`.
- **Preprint available, no published OA**: commit the preprint as `source.pdf` and `source.md`. Note the relationship in `notes`.
- **AAM in institutional repository**: commit the AAM as `source.pdf` and `source.md`. Document the repository URL in `notes`.
- **Paywalled with no OA / preprint / AAM**: do NOT commit PDF. Commit `source.md`. `redistribution_ok: false`.
- **Tool / dataset / standard with no paper**: snapshot README or canonical landing as `source.md`. `pdf_status: not-applicable`. `redistribution_ok: true` (READMEs are typically permissively licensed; document in `notes`).
- **Failed download**: set `pdf_status: not-available`. Document failure mode (Cloudflare, broken DOI, reCAPTCHA, etc.) in `notes`. Re-attempt later.

## CI rule

Recommended invariant for the corpus repository (enforce in CI):

> If `meta.json.redistribution_ok == false`, then no `source.pdf` file may exist in the entry folder.

A simple shell check:

```bash
for entry in research/collection/*/*/; do
  redistribution_ok=$(jq -r '.redistribution_ok' "$entry/meta.json" 2>/dev/null)
  if [[ "$redistribution_ok" == "false" && -f "$entry/source.pdf" ]]; then
    echo "VIOLATION: $entry has source.pdf but redistribution_ok=false"
    exit 1
  fi
done
```

Add this to the pre-commit hook or CI workflow if the corpus is on GitHub.

## When a license changes

Open-access publishers occasionally re-license content. Preprint servers do not. If a previously open-access journal becomes paywalled retroactively for old content (rare), the existing committed PDFs are protected by the license active at retrieval time. Document `retrieved_at` in `meta.json` so the licensing context is preserved.

## When in doubt

Ask the rights holder (publisher, repository, author). If the answer is unclear, store the markdown only and set `redistribution_ok: false`.
