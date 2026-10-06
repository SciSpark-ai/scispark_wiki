# SciSpark managed host binding
Selected mode: full protocol, two strands, local Markdown artifacts, single fresh-context review. Original procedures below govern research steps. No GitHub orchestration, LaTeX export, PDF-to-PNG review, arbitrary shell, canonical/DOI lookup, other source engines or enhanced conversion is adapted. Disclose these limitations, and stop for setup when they are essential. OpenCite supports Semantic Scholar keyword search, observed public PDF retrieval, local conversion and BibTeX only. Missing full text remains abstract-only or missing. OpenCite unavailable-download causes are not distinguished; never invent a reason.
Use typed named dependencies from inventory; human names map to their captured refs. Never install host agents or change models. Both model tiers/roles are captured by the root. Instructions asking for local files map to publish_artifact outputs with original logical paths in titles; no research-vault writes without explicit user intent and coordinator changeset authorization. Source refs must point to observed corpus sources. Persist briefs, cards, sources, metadata, bibliography, synthesis, direction, review and final prose artifacts. Cite exact passages plus source IDs; explicitly disclose missing sources, contradictory evidence and unsupported requested comparisons. Self-review and JSON validity do not prove scientific correctness.
All original source resources are byte-preserved at their original skill-relative paths. the selected procedure text in this entrypoint has already been loaded. Page additional resources with read_resource. Original example paths denote output artifact names, not package dependencies.

Draft only from passed corpus evidence and comparison coverage. Invoke manuscript:humanizer before returning the draft for review.

## Original resource: manuscript-writing/SKILL.md
---
name: manuscript-writing
description: "Use this skill for \"write a paper\", \"draft manuscript\", \"write introduction\", \"write methods section\", \"write results\", \"write discussion\", \"write abstract\", \"structure a paper\", \"academic writing\", \"write for journal\", or when the user wants to draft or revise sections of an academic manuscript."
version: 0.2.1
---

# Academic Manuscript Writing

Guide the drafting and revision of academic manuscripts following journal conventions and scientific writing best practices.

## When to Use

- Drafting a new manuscript from scratch
- Writing or revising specific sections (Introduction, Methods, Results, Discussion)
- Structuring a paper from experimental results
- Converting a conference paper to a journal submission
- Responding to reviewer comments with revised text

## Manuscript Structure

### Standard IMRAD Format

| Section | Purpose | Tense | Length Guide |
|---------|---------|-------|-------------|
| Title | Convey main finding | N/A | 10-15 words |
| Abstract | Self-contained summary | Past (methods/results), Present (conclusions) | 150-300 words |
| Introduction | Context, gap, hypothesis | Present (known facts), Past (prior work) | 3-5 paragraphs |
| Methods | Reproducibility | Past | As needed |
| Results | Report findings | Past | Parallel to Methods |
| Discussion | Interpret findings | Present (interpretation), Past (what was found) | 4-6 paragraphs |
| Conclusion | Key takeaways | Present | 1-2 paragraphs |

### Section-by-Section Guidance

#### Introduction
Structure as a funnel:
1. **Broad context** - Establish the field and importance (1-2 paragraphs)
2. **Narrow focus** - What is known about the specific topic (1-2 paragraphs)
3. **Gap statement** - What remains unknown or problematic
4. **Objective/hypothesis** - What this paper addresses and how

#### Methods
- Enough detail for replication
- Subsections mirror Results sections
- Include: participants/subjects, materials, procedures, analysis
- Statistical methods: specify tests, software, significance thresholds
- Ethics: IRB/IACUC approval statement

#### Results
- Present findings without interpretation
- Start each subsection with the analysis performed, then the outcome
- Report effect sizes, confidence intervals (not just p-values)
- Reference figures and tables in order
- Use "significant" only for statistical significance

#### Discussion
Structure:
1. **Summary of key findings** (1 paragraph)
2. **Interpretation in context** of prior literature (2-3 paragraphs)
3. **Limitations** (1 paragraph, honest but not self-defeating)
4. **Future directions** (1 paragraph)
5. **Conclusion** (1 paragraph)

## Writing Principles

### Clarity
- One idea per sentence
- Active voice preferred ("We measured..." not "Measurements were taken...")
- Define abbreviations on first use
- Avoid jargon unless writing for a specialist audience

### Precision
- Quantify claims ("increased by 23%" not "significantly increased")
- Cite sources for factual claims
- Distinguish correlation from causation
- Use hedging appropriately ("suggests" vs "proves")

### Flow
- Each paragraph: topic sentence, evidence, interpretation
- Transitions between paragraphs connect ideas
- Logical progression within and across sections
- Consistent terminology (don't alternate between synonyms for key concepts)

### Citations
- Cite primary sources, not reviews (when possible)
- Recent citations show awareness of current literature
- Cite competing or contradictory findings
- Self-citation should be relevant, not gratuitous

## Revision Checklist

After drafting, check:
- [ ] Abstract accurately reflects the paper content
- [ ] Introduction gap statement matches the study objective
- [ ] Methods are sufficient for replication
- [ ] Results match Methods (parallel structure)
- [ ] Discussion addresses all major findings
- [ ] Figures are referenced in text in order
- [ ] All abbreviations defined on first use
- [ ] References complete and consistently formatted
- [ ] Word/page count within journal limits
- [ ] Run `manuscript:humanizer` as a final natural-writing pass (strips AI tells like significance inflation, em-dashes, "evolving landscape" filler, rule-of-three padding) before review

## Additional Resources

- Reference: [references/section-templates.md](../../manuscript-writing/references/section-templates.md) - Templates for each manuscript section
- Reference: [references/revision-response.md](../../manuscript-writing/references/revision-response.md) - How to write point-by-point responses to reviewers
- Sister skill: `manuscript:humanizer` (invoke through the host's skill-invocation mechanism) - Removes 29 categories of AI-writing tells while respecting academic conventions (e.g., passive voice in Methods, hedging in Discussion). Run after drafting and before peer review.


## Original resource: manuscript-writing/references/section-templates.md
# Manuscript Section Templates

## Abstract Template

```
[BACKGROUND] {Field context and importance in 1-2 sentences}
[OBJECTIVE] {What this study aimed to do}
[METHODS] {Key methods in 2-3 sentences}
[RESULTS] {Main findings with key numbers}
[CONCLUSION] {Interpretation and significance}
```

## Introduction Template

### Paragraph 1: Broad Context
"{Topic} is a {growing/critical/fundamental} area in {field}. {Known fact with citation}. {Another established finding}."

### Paragraph 2: Specific Background
"Recent work has shown that {specific relevant findings} [refs]. {Another line of evidence} [refs]. However, {contrasting finding or gap}."

### Paragraph 3: Gap and Motivation
"Despite these advances, {what remains unknown/problematic}. This gap is significant because {why it matters}. {Optional: prior attempts and their limitations}."

### Paragraph 4: Objective
"In this study, we {investigated/developed/tested} {specific approach}. We hypothesized that {hypothesis if applicable}. Our approach {brief method description} allows us to {what it enables}."

## Methods Template

### Participants/Subjects
"N = {number} participants ({age range}, {demographics}) were recruited from {source}. Inclusion criteria: {list}. Exclusion criteria: {list}. The study was approved by {IRB} (protocol #{number}). All participants provided informed consent."

### Data Acquisition
"{Instrument/system} was used to record {data type} at {sampling rate/resolution}. {Configuration details}. {Electrode/sensor placement using standard system}."

### Data Processing
"Data were preprocessed using {software} (version {X}). {Step 1}. {Step 2}. {Artifact rejection criteria}. {Final dataset: N trials/epochs per condition}."

### Statistical Analysis
"Statistical analyses were performed using {software}. {Test name} was used to compare {conditions/groups}. Effect sizes are reported as {Cohen's d / eta-squared / etc.}. Significance threshold was set at p < {0.05}. {Multiple comparison correction method if applicable}."

## Results Template

### For Each Analysis
"To examine {research question}, we performed {analysis}. {Main finding} (statistic = {value}, p = {value}, effect size = {value}; Figure {N}). Post-hoc comparisons revealed {specific comparisons}. {Secondary findings}."

## Discussion Template

### Paragraph 1: Summary
"This study {investigated/demonstrated} {main objective}. Our principal finding is that {key result}. {Secondary findings in 1-2 sentences}."

### Paragraphs 2-3: Interpretation
"The finding that {result} is consistent with {prior work} [refs], which showed {related finding}. {Mechanistic interpretation}. {Alternative explanations and why primary interpretation is preferred}."

### Paragraph 4: Limitations
"Several limitations should be considered. First, {limitation 1 and its potential impact}. Second, {limitation 2}. {How future work could address these}."

### Paragraph 5: Future Directions
"{What the findings open up}. Future studies should {specific next steps}. {Broader applications or implications}."

### Paragraph 6: Conclusion
"In conclusion, {restate main finding without copy-pasting}. {Significance for the field}. {Broader impact}."
