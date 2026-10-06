# SciSpark managed host binding
Selected mode: full protocol, two strands, local Markdown artifacts, single fresh-context review. Original procedures below govern research steps. No GitHub orchestration, LaTeX export, PDF-to-PNG review, arbitrary shell, canonical/DOI lookup, other source engines or enhanced conversion is adapted. Disclose these limitations, and stop for setup when they are essential. OpenCite supports Semantic Scholar keyword search, observed public PDF retrieval, local conversion and BibTeX only. Missing full text remains abstract-only or missing. OpenCite unavailable-download causes are not distinguished; never invent a reason.
Use typed named dependencies from inventory; human names map to their captured refs. Never install host agents or change models. Both model tiers/roles are captured by the root. Instructions asking for local files map to publish_artifact outputs with original logical paths in titles; no research-vault writes without explicit user intent and coordinator changeset authorization. Source refs must point to observed corpus sources. Persist briefs, cards, sources, metadata, bibliography, synthesis, direction, review and final prose artifacts. Cite exact passages plus source IDs; explicitly disclose missing sources, contradictory evidence and unsupported requested comparisons. Self-review and JSON validity do not prove scientific correctness.
All original source resources are byte-preserved at their original skill-relative paths. the selected procedure text in this entrypoint has already been loaded. Page additional resources with read_resource. Original example paths denote output artifact names, not package dependencies.

Single independent reviewer: input is draft, sources and review framing only. No authoring rationale or conversation. Follow full Markdown review procedure. Managed opencite:opencite may check references; canonical mode is unavailable and must be disclosed. Return explicit citation/coverage issues, never a scientific-success certification.

## Original resource: paper-review/SKILL.md
---
name: paper-review
description: "Use this skill for \"review this paper\", \"review this manuscript\", \"peer review\", \"review my paper\", \"critique this manuscript\", \"review this submission\", \"give me feedback on my paper\", \"check my methods\", \"review my statistics\", \"review as a peer reviewer\", \"evaluate this manuscript\", \"review this PDF\", or mentions manuscript review, peer review, paper critique, or methodological review."
version: 0.1.1
---

# Academic Manuscript Review

Routes a manuscript to an **independent, fresh-context reviewer** that evaluates it for methodological soundness, statistical validity, logical consistency, and reproducibility, and returns a structured peer review. This skill is a thin dispatcher: it decides how to run the reviewer and in which mode. The review procedure, checklists, statistical and figure guides, principles, and output template all live in `references/` and are loaded by the reviewer, not duplicated here.

## When to use

Activate when the user wants peer-review feedback on a manuscript (journal article, conference paper, preprint).

## Why a fresh-context reviewer

Review validity depends on independence: a reviewer that shares the conversation that produced the manuscript is biased toward it. Run the reviewer in a separate context and pass only **framing** (manuscript path, target journal, manuscript type, revision status), never the authoring rationale. This is why the reviewer is a subagent on tools that support one, and an inline procedure where they do not.

## Modes (user decides each run)

- **Single (default):** one independent reviewer applies the full procedure end to end.
- **Panel (opt-in):** spawn independent reviewers in parallel on complementary lenses, then a synthesis pass. Trigger on "review panel", "multiple reviewers", or an explicit request. Lenses: **methods/design**, **statistics**, and **novelty/significance** (add **reproducibility** for methods-heavy or hardware papers). Each reviewer reads the whole manuscript but weights its lens and scores independently from `references/`; a final synthesis pass merges them into one Critical/Major/Minor review and surfaces genuine disagreement rather than averaging it away.

## Dispatch

Pick the branch for the current tool. In every branch the reviewer follows `references/review-procedure.md`.

- **Claude Code:** `Agent(subagent_type: "manuscript:paper-review", ...)` passing the manuscript path, target journal/type, and mode. For panel mode, issue one `Agent` call per lens in a single message so they run in parallel, then a final synthesis `Agent` call.
- **Codex CLI:** plugin installation exposes this skill, not a Codex subagent. To use a fresh-context Codex reviewer, first copy `agents/templates/paper-review.toml` to `~/.codex/agents/` or `.codex/agents/`, then invoke that configured agent if the current Codex surface supports `/agent`. For panel mode, ensure `max_threads` covers the lens count. If no Codex subagent is configured or available, use the fallback branch.
- **Copilot CLI:** plugin installation exposes this skill and, through `.github/plugin/plugin.json`, the `.agent.md` reviewer in `agents/templates/`. Invoke that configured agent when the current Copilot surface supports custom agents; use `/fleet` for panel mode when available. If running outside a plugin install, copy `agents/templates/paper-review.agent.md` to `.github/agents/` or `~/.copilot/agents/`. If no custom agent is available, use the fallback branch.
- **Fallback** (no subagent support, or the user wants an interactive in-thread review): first locate the rubric (`$CLAUDE_PLUGIN_ROOT/skills/paper-review/references`, else `find . -type d -path '*/skills/paper-review/references' | head -1`); if it cannot be found, stop and tell the user to install the manuscript plugin rather than reviewing from memory. Then follow `references/review-procedure.md` directly in this context.

## The brain (do not duplicate into dispatch or agent shells)

- `references/review-procedure.md` -- step-by-step procedure: intake, read, methodology, logic, literature, reproducibility, figures, writing, output.
- `references/methodology-checklist.md`, `references/statistical-review-guide.md`, `references/figure-review-guide.md` -- the assessment checklists and guides.
- `references/review-principles.md` -- review philosophy and severity calibration.
- `references/review-output-template.md` -- the Synopsis / Critical / Major / Minor / References / Editor Note format.
- `examples/sample-manuscript-review.md` -- worked review for calibration; `examples/sample-manuscript-excerpt.md` -- sample manuscript input for testing.
- Sister skill `manuscript:humanizer` (invoke through the host's skill-invocation mechanism) -- AI-writing patterns to flag in the prose-quality pass.


## Original resource: paper-review/references/figure-review-guide.md
# Figure Review Guide

Criteria for evaluating figures in academic manuscripts. Figures are often where misleading presentations hide; scrutinize them carefully.

## General Quality

- **Axes:** Both axes must be labeled with units. Font must be readable at print size.
- **Legends:** All elements (colors, symbols, line styles) must be defined.
- **Consistency:** Style (fonts, colors, line weights) should be consistent across all figures.
- **Self-contained:** A reader should be able to understand the figure from its caption alone without reading the main text.
- **Accessibility:** Color choices should be distinguishable to colorblind readers. Prefer colorblind-safe palettes; avoid red-green-only encoding.

## Data Representation

### Bar Plots and Error Bars
- For N >= 10: bar plots with error bars are acceptable if the error measure is defined (SD, SEM, 95% CI).
- For N = 5-9: strongly prefer showing individual data points overlaid on the bar or using box plots.
- For N < 5: bar plots are unacceptable. Show individual data points. For paired data, connect points with lines. The mean and error bars of 2-4 points create a false impression of a distribution.

### Scatter Plots
- Should show individual data points, not just regression lines.
- If a regression line is shown, report R-squared and p-value.
- Check if the apparent trend is driven by a few outlier points.

### Spectral Plots (ERSP, power spectra, coherence)
- For event-related spectral analysis (ERSP), must show baseline-corrected data (change from pre-event baseline), not absolute values. For resting-state or continuous analyses, absolute spectral values may be appropriate.
- Color scale must be defined with a legend showing the units (e.g., dB, percent change).
- Frequency and time axes must be labeled with appropriate resolution.
- Statistical masking (significance overlay) should be described in the caption.

### Heatmaps
- Color bar with defined scale is mandatory.
- The color palette should not obscure or exaggerate differences (avoid jet colormap; prefer perceptually uniform colormaps like viridis).

### Time Series
- Time scale must be in appropriate units (do not use milliseconds for data spanning minutes).
- If multiple traces are overlaid, they must be distinguishable (different colors, offsets, or panels).
- If artifact rejection was performed, the figure should not show obvious artifacts that contradict the described preprocessing.

## Common Figure Issues

1. **Figure contradicts the text:** The figure shows something different from what the methods or results describe. For example, "filtered data" that still shows obvious artifacts, or "baseline-corrected" spectra that clearly have not been baseline-corrected.

2. **Redundant figures:** Two figures showing the same information in different formats. Recommend removing the less informative one.

3. **Missing statistical annotations:** If the text discusses significant differences, the figure should indicate them (brackets, stars, or shading). If significance annotations are present, they must be defined in the caption.

4. **Inappropriate scale:** Axes that exaggerate or minimize effects. Check if the y-axis starts at zero (or if a non-zero start is justified). Check if the time/frequency range is appropriate for the phenomenon being shown.

5. **Undeclared processing:** Figures showing "raw" data that appears too clean (likely filtered or processed), or figures showing processed data described as raw.

## Figure Captions

A complete figure caption should include:
- What the figure shows (not just "Results of experiment 1" but "Mean response time across conditions for N=20 participants")
- Definition of all visual elements (colors, symbols, error bars)
- Statistical details (tests used, significance thresholds)
- Sample size
- Abbreviation definitions (if not defined in the main text)

## Questions to Ask for Each Figure

1. Does this figure accurately represent the data as described in the text?
2. Could a reader be misled by the presentation choice?
3. Is this the most appropriate visualization for this data?
4. Would a different visualization reveal something the current one hides?
5. Is the figure necessary, or does it duplicate information from another figure or table?


## Original resource: paper-review/references/methodology-checklist.md
# Methodology Assessment Checklist

Systematic checklist for evaluating the methodological soundness of a manuscript. Not all items apply to every paper; use the relevant sections.

## Experimental Design

- [ ] Research question or hypothesis is clearly stated
- [ ] Study design is appropriate for the research question
- [ ] Controls or comparison conditions are adequate
- [ ] Sample size is justified (power analysis, prior work, or acknowledged as a limitation)
- [ ] Inclusion/exclusion criteria are clearly stated and justified
- [ ] Participant demographics are reported (age, sex/gender, relevant clinical characteristics)
- [ ] If only one sex/gender was studied, this limitation is acknowledged
- [ ] Randomization or counterbalancing is described (if applicable)
- [ ] Potential confounds are identified and addressed or acknowledged

## Data Collection

- [ ] Equipment and software versions are specified
- [ ] Acquisition parameters (sampling rates, resolution, calibration) are reported
- [ ] Data collection protocol is described in sufficient detail to replicate
- [ ] For human subjects: IRB/ethics approval and informed consent are reported
- [ ] For clinical populations: diagnostic criteria and staging are specified

## Signal Processing (EEG/EMG/physiological data)

- [ ] Filtering parameters are appropriate (check Nyquist: analysis bandwidth must not exceed the Nyquist frequency, i.e., half the sampling rate, or the low-pass filter cutoff)
- [ ] Artifact rejection/correction method is described and validated for the data type
- [ ] For movement data: movement-specific artifact handling is addressed
- [ ] Re-referencing scheme is stated (if applicable)
- [ ] Epoch/trial selection criteria are stated
- [ ] Number of trials/epochs retained per condition is reported
- [ ] Baseline correction method and period are specified
- [ ] For source estimation: number of electrodes is adequate (>64 for high-density claims)
- [ ] No "double-dipping": features used for clustering/selection are independent of analysis targets

## Statistical Analysis

- [ ] Statistical tests are named and justified
- [ ] Assumptions are tested (normality, homogeneity of variance)
- [ ] Correct test variant is used (paired vs. unpaired, parametric vs. non-parametric)
- [ ] Main effects are tested before post-hoc comparisons
- [ ] Multiple comparison correction is applied (and named: Bonferroni, FDR, etc.)
- [ ] Effect sizes are reported alongside p-values
- [ ] Degrees of freedom are reported
- [ ] For regression: independence of predictors is assessed (multicollinearity, VIF)
- [ ] For correlation: the type is appropriate (Pearson for linear, Spearman for monotonic)
- [ ] Lack of significant correlation is not equated with lack of association
- [ ] PCA components are not interpreted as independent factors (PCA gives orthogonal, not independent)
- [ ] Sample sizes per group are adequate for the statistical test used
- [ ] Confidence intervals are reported where appropriate
- [ ] Statistical software and version are specified

## Figures and Visualizations

- [ ] Axes are labeled with units
- [ ] Legends are present and complete
- [ ] Error bars are defined (standard deviation, standard error, confidence interval)
- [ ] For small N (<5): individual data points are shown (not just bar plots)
- [ ] Color maps are defined with scale bars
- [ ] Time/frequency scales are appropriate (not in milliseconds when showing minutes)
- [ ] Spectral plots show baseline-corrected data (not biased by average activity)
- [ ] Figures match what is described in the text
- [ ] No figure duplicates information already in another figure or table

## Reproducibility

- [ ] Methods are detailed enough for independent replication
- [ ] Custom code is shared or code availability is addressed
- [ ] Data are shared or data availability is addressed
- [ ] For hardware papers: schematics, block diagrams, or component lists are provided
- [ ] Software versions and key parameters are specified
- [ ] Any custom tools or pipelines are described or referenced

## Conflicts of Interest and Transparency

- [ ] Author affiliations are consistent with the work presented
- [ ] Funding sources are disclosed
- [ ] Conflicts of interest are declared (or explicitly stated as none)
- [ ] If authors are evaluating their own tool/product, this relationship is transparent
- [ ] Patents related to the work are disclosed

## Literature and Context

- [ ] Literature review includes recent work (last 2-3 years)
- [ ] Competing methods or interpretations are cited
- [ ] Cited papers actually support the claims they are attached to
- [ ] The paper positions itself relative to existing work (novelty claim is supported)
- [ ] Limitations are discussed honestly

Use opencite to search for relevant literature when verifying whether key references are missing:
```bash
uvx opencite search "topic keywords" --max 10 --sort citations
uvx opencite canonical "field or method" --max 5
```


## Original resource: paper-review/references/review-output-template.md
# Review Output Template

## Standard Review Format

```
[PARTIAL REVIEW -- include this line ONLY when manuscript sections are missing. Bold
"PARTIAL REVIEW", list the missing sections, and state that the assessment is based on the
provided material only and is not a complete peer review. Place it above the Synopsis.]

## Synopsis

[1 paragraph: What the paper does, what methods it uses, what the main findings are, what the
strengths of the work are, and an overall assessment of whether the paper achieves its goals.
End with a clear statement of the paper's overall readiness for publication and what level of
revision is needed.]

## Critical Issues

[Issues that would prevent publication in their current form. These are fundamental
methodological flaws, invalid statistical approaches, or claims that cannot be supported
by the presented methods.]

1. [Cite location: page/line/figure/section] [Clear description of the problem, why it
   matters, and a constructive suggestion for how to address it. Cite references if arguing
   a methodological point.]

2. [...]

## Major Concerns

[Issues requiring significant revision. These are incomplete analyses, missing comparisons,
overreached conclusions, or gaps that weaken the paper's contributions but do not
fundamentally invalidate it.]

1. [Cite location] [Description + suggestion + references if applicable]

2. [...]

## Minor Concerns

[Issues that improve clarity, polish, and completeness. Writing quality, figure improvements,
missing definitions, reference gaps.]

1. [Cite location] [Description + suggestion]

2. [...]

## References

[References cited in the review to support methodological arguments]

1. [Author et al. Year. "Title." Journal. DOI.]
2. [...]
```

## Editor Note Format (optional, appended after the review)

```
Dear Editor,

[1-2 sentence summary of the paper's topic and contribution.]
[1-2 sentences on the main issues found.]
[Clear recommendation: accept, minor revision, major revision, or reject.]

[Brief justification for the recommendation.]
```

## Guidelines

### Synopsis writing
- Lead with what the paper does, not what it claims
- Acknowledge genuine strengths before transitioning to concerns
- Use phrases like "However, the study suffers from..." or "Nevertheless, the methods..." for the transition
- End with a calibrated overall assessment: "requires major revision," "needs minor revisions," or "is not suitable for publication in its current form"

### Severity calibration

**Critical Issues** (would prevent publication):
- Fundamental methodological flaw (design cannot test the hypothesis)
- Invalid statistical approach (wrong test, violated assumptions, double-dipping)
- Claims unsupported by the methods used
- Undisclosed conflicts of interest
- Lack of reproducibility (insufficient detail, no data/code sharing for computational work)

**Major Concerns** (require significant revision):
- Incomplete analysis (missing controls, missing comparisons)
- Overreached conclusions (discussion exceeds what results show)
- Missing relevant literature that changes interpretation
- Inadequate sample size without acknowledgment
- Figures that misrepresent the data
- Important methodological details missing

**Minor Concerns** (improve quality):
- Writing clarity and consistency
- Missing definitions or inconsistent terminology
- Redundant text or figures
- Citation formatting or completeness
- Axis labels, legends, or figure annotations
- Minor statistical reporting issues (missing effect sizes, degrees of freedom)

### Citation format in reviews
When citing literature to support a review argument, use inline format: `(Author et al. Year)` or `Author et al. Year - Journal` and include the full reference at the end of the review. This allows the authors to verify the reviewer's claims.

## Worked example

For a complete filled-in review demonstrating tone, depth, severity calibration, and the PARTIAL REVIEW banner, see `../examples/sample-manuscript-review.md` (a review of `../examples/sample-manuscript-excerpt.md`).


## Original resource: paper-review/references/review-principles.md
# Review Principles

This document describes the review philosophy underlying the paper-review skill. The principles are opinionated and reflect a specific reviewer's priorities. Adapt them to your own standards.

## Core Philosophy

A good review serves two purposes: it helps the editor make an informed decision, and it helps the authors improve their work. Both require honesty, specificity, and constructiveness.

## Principle 1: Methods Must Test the Hypothesis

The most common critical flaw in manuscripts is a disconnect between what the introduction promises and what the methods deliver. If the introduction frames a question, the methods must be designed to answer that exact question. If they cannot, the paper has a fundamental problem.

**How to apply:** Trace the logical chain: hypothesis -> experimental design -> analysis -> results -> conclusions. Break at any point means the chain is invalid. A paper that asks about mechanism X but only measures correlate Y cannot conclude about X.

## Principle 2: Statistical Validity is Non-Negotiable

Wrong statistics invalidate conclusions regardless of how interesting the hypothesis is. Common issues include:
- Using parametric tests on non-normal data without testing assumptions
- Using paired tests for unpaired comparisons (or vice versa)
- Performing multiple comparisons without correction
- Drawing population-level conclusions from N=2 or N=3 groups
- Using bar plots with error bars when individual data points would reveal the actual distribution
- Confusing lack of statistical significance with lack of effect
- Confusing correlation with independence (lack of linear correlation does not imply independence)

**How to apply:** For every statistical test in the paper, ask: Is this the right test? Are the assumptions met? Is the sample size adequate? Could the conclusion change with a different (more appropriate) test?

## Principle 3: Claims Must Not Exceed the Data

The discussion section is where overreaching typically happens. Authors may:
- Generalize from a specific population to a broader one
- Attribute causal mechanisms from correlational data
- Draw conclusions about brain regions from scalp recordings without source localization
- Suggest clinical applications from basic science findings without clinical validation

**How to apply:** For every claim in the discussion, check: Is there a result in this paper that directly supports this claim? If the support comes only from cited literature, flag it as speculation, not a finding of this study.

## Principle 4: Be Evidence-Based in Criticism

When challenging a method or claim, cite the literature. Do not rely on "it is well known" or "this is standard practice." The authors deserve to see the evidence behind a reviewer's argument, just as the reviewer demands evidence from the authors.

**How to apply:** If you argue that a method is flawed, cite the paper that demonstrates the flaw. If you argue that a relevant paper is missing, provide the reference. If you argue that a different analysis is more appropriate, cite examples where it was used successfully.

## Principle 5: Acknowledge Strengths Genuinely

A review that only lists weaknesses is not helpful. Genuine acknowledgment of strengths:
- Calibrates the review (shows the reviewer understands what is good)
- Motivates the authors (they know what to preserve during revision)
- Helps the editor weigh the overall contribution

**How to apply:** In the synopsis, explicitly state what the paper does well before transitioning to concerns. Do not manufacture compliments, but do not omit genuine ones either.

## Principle 6: Reproducibility is a Publication Requirement

A paper that cannot be reproduced has limited scientific value. This applies to:
- Experimental methods (sufficient detail for replication)
- Computational methods (code, parameters, software versions)
- Hardware papers (schematics, component specifications, or commercial availability)
- Data (shared or sharing plan addressed)

**How to apply:** Ask: "Could I (or someone in my lab) reproduce this work based solely on what is written here?" If not, identify what is missing.

## Principle 7: Check Conflicts of Interest

Financial and non-financial conflicts must be disclosed. Authors evaluating their own commercial products, patented methods, or institutional tools should disclose these relationships. A paper that is effectively a product validation by the product's creators, without disclosure, has a transparency problem.

**How to apply:** Check author affiliations, acknowledgments, and the relationship between the methods/tools used and the authors' commercial or patent interests. If the connection is not disclosed, flag it.

## Principle 8: Literature Must Be Current and Complete

Missing relevant literature suggests either incomplete scholarship or selective citation. Key checks:
- Are papers from the last 2-3 years included?
- Are competing methods or alternative interpretations cited?
- Do the cited papers actually support the claims they are attached to? (Sometimes a cited paper argues the opposite of what the authors claim.)
- For review papers used as sole references for broad claims, check if more specific primary sources exist.

## Principle 9: Figures Must Not Mislead

Figures are often where misleading presentations hide. Common issues:
- Bar plots with error bars for very small N (N<5), hiding the actual data distribution
- Time or frequency scales that obscure or exaggerate effects
- Missing color legends, axis labels, or units
- Figures that show raw data when the text discusses processed results (or vice versa)
- ERSP or heatmap plots without baseline removal, biasing interpretation

**How to apply:** For every figure, ask: Does this figure accurately represent the data as described in the text? Could a reader be misled by the presentation choice?

## Principle 10: Writing Serves the Science

Clear writing is not optional. Technical terms must be defined before use. Terminology must be consistent (do not introduce synonyms mid-paper). The abstract must accurately reflect the findings. The methods must be complete per the journal's requirements. Redundancy wastes the reader's time and page space.

**How to apply:** Flag instances where unclear writing obscures the science or where inconsistent terminology creates ambiguity about what was actually done.


## Original resource: paper-review/references/review-procedure.md
# Manuscript Review Procedure

The step-by-step procedure for peer-reviewing an academic manuscript with priority on methodological soundness, statistical validity, logical consistency, and reproducibility. This is the procedural brain loaded by the `paper-review` skill (inline mode) and by the per-tool reviewer subagents. The checklists, statistical guide, figure guide, principles, and output template referenced below live alongside this file in the same `references/` directory.

**Calibration.** This is an opinionated, direct, evidence-based review style that holds manuscripts to high standards. Severity follows a strict hierarchy: **Critical** issues block publication; **Major** issues require significant revision; **Minor** issues improve polish. Adapt tone and depth to the target journal's expectations (transactions vs. letters vs. conference proceedings differ).

## 0. Partial or incomplete manuscripts

If only part of the manuscript is provided (for example, methods and results without the introduction, or an abstract alone), review what is present rather than refusing, but make the partial scope unmistakable: begin the output with a bold **PARTIAL REVIEW** banner, above the synopsis, that lists the missing sections and warns that the assessment is based on the provided material only and is not a complete peer review. Do not infer the content of missing sections.

## 1. Manuscript intake

**PDF (most common):** convert to both markdown and PNG. Markdown gives efficient searchable text for content analysis; PNG preserves exact page layout, line numbers, and figure positions for precise citations.

Convert to markdown:
```bash
uvx opencite convert manuscript.pdf -o manuscript.md
```
If opencite is unavailable or the conversion fails (non-zero exit or empty output), fall back to reading the PDF natively with the Read tool (page ranges for large PDFs) and note in the review intake that markdown conversion was not run, so exact page/line citations may be imprecise. Do not proceed silently on a degraded input.

Convert to PNG for page/line references and figure inspection:
```bash
uv run --with pdf2image --with pillow python -c "
from pdf2image import convert_from_path
pages = convert_from_path('manuscript.pdf', dpi=200)
for i, page in enumerate(pages):
    page.save(f'manuscript_page_{i+1}.png', 'PNG')
"
```
Requires poppler (`brew install poppler` on macOS, `apt install poppler-utils` on Linux). Alternatively use `pdftoppm -png -r 200 manuscript.pdf manuscript_page`, or read the PDF natively with the Read tool. For large PDFs (>10 pages), read PNGs in batches.

**Markdown or LaTeX:** read directly; no conversion needed.

Read all sections including supplementary materials, appendices, and figures. When citing an issue, give the exact page and line from the PNGs (e.g., "p4 l23"). Note the target journal if known.

## 2. Read the full manuscript

Read everything: abstract, introduction, methods, results, discussion, conclusion, figures, tables, supplementary materials. Note the stated hypothesis, the methods used to test it, the statistical approach and sample size, the claims in discussion/conclusion, and whether figures and tables support the narrative.

## 3. Assess methodological soundness

The core of the review. Use `methodology-checklist.md`. Key areas:

**Experimental design:** appropriate design for the question; adequate controls; justified (or at least acknowledged) sample size; clear inclusion/exclusion criteria; unaddressed confounds.

**Signal processing and data analysis (when applicable):** appropriate filtering (check Nyquist: analysis bandwidth must not exceed half the sampling rate and should not exceed the low-pass cutoff); validated artifact rejection/correction; justified analysis parameters (window lengths, frequency bands); no "double-dipping" where the features used for selection/clustering are also the analysis target.

**Statistical methods:** use `statistical-review-guide.md`. Appropriate tests for the distribution and design; tested parametric assumptions; correct paired vs. unpaired variant; main effects before post-hoc; multiple-comparison correction; effect sizes, not just p-values; conclusions proportional to sample size; appropriate figures (bar plots with error bars are unacceptable for N<5 and should overlay individual data points for N=5-9; see `figure-review-guide.md` for the full thresholds).

## 4. Check logical consistency

Trace the argument from introduction through methods to results and discussion: do the methods test the stated hypothesis? Do the results support the discussion claims? Are conclusions proportional to the evidence? Are terms and definitions used consistently and operationalized the same way they are introduced? Watch for claims the authors' own methods cannot test and discussion points that exceed the data.

## 5. Evaluate literature coverage

Is the review current (key papers from the last 2-3 years present)? Are claims actually supported by the cited work? Is related work from other groups acknowledged? Are validation/limitation papers for the techniques used cited? Are there results the authors should compare against?

Verify claims and find missing references with opencite:
```bash
uvx opencite search "topic keywords" --max 10 --sort citations
uvx opencite canonical "field or method" --max 5
```
If the `opencite` skill is loaded, you may invoke it instead of running the shell command. If opencite is unavailable entirely, proceed without the automated search: flag literature-coverage concerns from domain knowledge and say the citation check was not run, rather than silently skipping it. When citing a reference to support a methodological argument, include the full citation so the authors can verify it.

## 6. Check reproducibility and transparency

Methods detailed enough to reproduce; data/code/materials shared or sharing addressed; specified tool/software versions and parameters; for hardware papers, schematics/component lists/block diagrams; disclosed conflicts of interest (check affiliations, patents, commercial products).

## 7. Evaluate figures and tables

Use `figure-review-guide.md`. Do figures accurately represent the data? Are axes labeled, legends present, units specified, statistical annotations defined? Are bar plots used appropriately (small N: show individual points)? Is the time/frequency scale appropriate? Do figures match the text? Are color scales defined? If a figure is referenced in the text but not included in the provided material, assess it from its textual description and flag that the figure itself was not available for inspection.

## 8. Assess writing quality

Technical terms defined before or at first use; consistent terminology (no mid-paper synonyms); concise (flag repetition); abbreviations defined once; abstract reflects the content; methods complete per the target journal. Flag pervasive AI-writing tells (significance inflation, em-dash overuse, "evolving landscape" filler, rule-of-three padding, synonym cycling, generic positive conclusions) and point the author to `manuscript:humanizer`. Cite specific pattern numbers (e.g., pattern 1 significance inflation, pattern 14 em-dash overuse) only when the humanizer skill is loaded; otherwise name the pattern by description, since the full pattern list lives in that skill, not in these references.

## 9. Produce the review output

Structure per `review-output-template.md`:

1. **Synopsis** - one paragraph: the paper's goal, methods, findings, strengths, and overall assessment.
2. **Critical Issues** - numbered; would prevent publication (methodological flaws, invalid statistics, unsupported claims).
3. **Major Concerns** - numbered; significant issues requiring revision (incomplete analysis, missing comparisons, overreached conclusions).
4. **Minor Concerns** - numbered; clarity and polish (writing, figures, references).
5. **References** - full citations for any literature cited to support a point, so the authors can verify it.
6. **Editor Note** (optional) - brief summary and recommendation for the editor.

Every concern must cite the specific location (page, line, figure, or section), explain the problem and why it matters, provide a constructive suggestion, and cite supporting references when arguing a methodological point. For a complete worked example, see `../examples/sample-manuscript-review.md`.

## Review principles

Consult `review-principles.md` for the full rationale before finalizing severity. In brief: be direct but constructive (every weakness gets a suggestion); be evidence-based (cite literature, not authority); be proportional (severity tracks impact on validity); acknowledge strengths genuinely; question logical consistency; demand statistical appropriateness; insist on reproducibility; check the literature; scrutinize figures; hold claims to the data.

## Reference index

- `methodology-checklist.md` - detailed methodological assessment checklist
- `statistical-review-guide.md` - common statistical issues and how to identify them
- `figure-review-guide.md` - figure quality assessment criteria
- `review-principles.md` - review philosophy and calibration guidance
- `review-output-template.md` - the review output format with examples
- Sister skill `manuscript:humanizer` - AI-writing patterns to flag in the prose-quality pass


## Original resource: paper-review/references/statistical-review-guide.md
# Statistical Review Guide

Common statistical issues encountered in manuscript review and how to identify them.

## Test Selection Errors

### Parametric vs. Non-parametric
- **Issue:** Using parametric tests (t-test, ANOVA) on data that violates normality assumptions.
- **How to identify:** Check if normality was tested (Shapiro-Wilk, Kolmogorov-Smirnov). For small samples (N<30), normality assumptions become more consequential because the Central Limit Theorem provides less protection; non-parametric alternatives are often more appropriate unless normality can be verified.
- **What to recommend:** Suggest appropriate non-parametric alternatives (Mann-Whitney U, Kruskal-Wallis, Friedman) and request normality testing.

### Paired vs. Unpaired
- **Issue:** Using paired tests for independent samples or unpaired tests for repeated measures.
- **How to identify:** Paired tests (paired t-test, Wilcoxon signed-rank) are for repeated measures on the same subjects. Unpaired tests (independent t-test, Wilcoxon rank-sum/Mann-Whitney U) are for comparing different groups. Check if the comparison involves the same subjects measured twice or different subjects.
- **What to recommend:** Name the correct test variant and explain the distinction.

### Missing Main Effects
- **Issue:** Running post-hoc pairwise comparisons without first testing for a main effect.
- **How to identify:** Multiple t-tests or Wilcoxon tests between groups without a preceding ANOVA or Kruskal-Wallis test.
- **What to recommend:** Suggest testing for the main effect first, then using post-hoc tests with appropriate correction.

## Multiple Comparisons

- **Issue:** Running many statistical tests without correcting for the increased false positive rate.
- **How to identify:** Count the number of tests performed. If multiple comparisons are made on the same dataset, correction is generally needed. The inflation of false positive rate begins with as few as two tests.
- **What to recommend:** Bonferroni (conservative), Holm-Bonferroni (less conservative), or FDR/Benjamini-Hochberg (for many comparisons). State the correction method and adjusted significance threshold.

## Sample Size Issues

### Small N with Bar Plots
- **Issue:** Using bar plots with error bars for groups of N<5. The mean and error bars create an illusion of a distribution that does not exist with 2-4 data points.
- **How to identify:** Check figure legends for N. If N<5, bar plots are inappropriate.
- **What to recommend:** Show individual data points connected with lines (for paired data) or as a strip/jitter plot. The reader can then judge the actual data distribution.

### Subgroup Analysis with Insufficient Power
- **Issue:** Splitting an already small sample into subgroups and drawing statistical conclusions from groups of N=2 or N=3.
- **How to identify:** Check the subgroup sizes in the methods or results. If any group has fewer than 5 participants, conclusions about group differences are questionable.
- **What to recommend:** Acknowledge as a limitation, or use non-parametric tests that do not assume a distribution. Consider whether the subgroup analysis is essential or if the data should be analyzed as a whole.

## Correlation and Regression Pitfalls

### Linear Correlation Does Not Imply Association (or Lack Thereof)
- **Issue:** Reporting no significant Pearson correlation and concluding "no association."
- **How to identify:** Look at scatter plots. If the relationship appears non-linear, a linear correlation test will miss it.
- **What to recommend:** Use Spearman's rank correlation for monotonic relationships, or distance correlation / mutual information for non-linear associations. State clearly that "no significant linear correlation" does not mean "no association."

### PCA Does Not Imply Independence
- **Issue:** Interpreting PCA components as independent factors.
- **How to identify:** PCA produces orthogonal (uncorrelated) components, but orthogonality does not imply statistical independence. Authors who run PCA and then treat components as independent factors for regression are making an unsupported assumption.
- **What to recommend:** Clarify that PCA provides orthogonal decomposition, not independence. If independence is needed, consider Independent Component Analysis (ICA) or explicit independence testing.

### Correlation Driven by Outliers
- **Issue:** A few extreme data points driving the apparent correlation.
- **How to identify:** In scatter plots, check if removing 1-2 points would eliminate the correlation. Look for data clustered in two groups with the correlation driven by the gap between groups.
- **What to recommend:** Report the correlation with and without the suspected outliers. Use robust correlation methods. Show the scatter plot so readers can judge.

## Signal Processing Statistics

### Nyquist Constraint
- **Issue:** Analyzing frequency content above the Nyquist frequency (half the sampling rate) or above half the filter cutoff.
- **How to identify:** The Nyquist frequency is half the sampling rate (fs/2); this is the absolute upper bound of representable frequencies. If a low-pass filter is applied at X Hz, frequencies near and above X Hz are attenuated; the practical analysis range is limited to the filter cutoff (or slightly below it, depending on filter order and roll-off). Both constraints must be satisfied: analysis bandwidth must not exceed fs/2, and should not exceed the filter cutoff.
- **What to recommend:** Either increase the filter cutoff and sampling rate, or restrict the analysis to below both the Nyquist frequency and the filter cutoff.

### Baseline Correction in Spectral Analysis
- **Issue:** Event-related spectral perturbation (ERSP) or coherence plots shown without baseline removal.
- **How to identify:** If the spectral plots show absolute power rather than change from baseline, the interpretation is biased by the average spectral activity.
- **What to recommend:** Apply baseline correction (subtraction or division) and show the change relative to a pre-event baseline period.

### Double-Dipping
- **Issue:** Using the same data features for both selection (e.g., clustering, ROI definition) and analysis.
- **How to identify:** If ICA components are clustered using ERSP features, and then ERSP is analyzed for those clusters, the analysis is circular. Similarly, if electrodes are selected based on activity patterns and then those patterns are reported as findings.
- **What to recommend:** Use independent criteria for selection and analysis. For clustering, use features orthogonal to the analysis target (e.g., cluster by dipole location, analyze by ERSP).

## Reporting Checklist

For each statistical test reported, verify:
- [ ] Test name and variant (paired/unpaired, parametric/non-parametric)
- [ ] Test statistic value
- [ ] Degrees of freedom
- [ ] p-value (exact, not just < 0.05)
- [ ] Effect size (Cohen's d, eta-squared, r, etc.)
- [ ] Correction for multiple comparisons (if applicable)
- [ ] Software and version used
