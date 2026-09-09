# Trending layout — September 6, 2026

## Design direction

The screenshot exposed detached field labels, unexplained statistics, tiny
unlabeled charts and truncated research titles. Frontend-design guided a
research overview with clear scope, explicit measurement and readable papers.
The existing brand stays intact: page cream #fefaf5, light surface #faf6f2,
espresso #2b180a, secondary text #3e2407, orange #f97316 and border #e8d3c0.
Components use semantic tokens, including their existing dark-theme variants.
Halant remains the heading face; Geist remains the interface/body face.

All content is left-aligned except the numeric comparison columns. Three equal
statistic cards were rejected because they gave a duplicate top-topic headline
the same visual importance as the date window. A compact publication overview
now precedes the controls; highly cited papers are a separate reading area.

```text
Trending in your fields                          Edit fields  Refresh
Publication window + comparison                  Board-wide counts
All fields | Neuroscience | Computer Science | Medicine
Fields and subfields included (expandable)
Topic activity                                   Highly cited papers
Topic / papers / share growth                     Full title + citations
Expanded comparison, summary and paper links
```

On phones the header stacks, field buttons wrap, counts sit below each topic,
and the paper section follows the list. Short explanatory sentences each fit
one line at 390px; long source titles wrap rather than truncate. Comparison
bars only appear with their labels in expanded details. No new animation or
color system was introduced.

## Behavior and boundaries

- Field buttons filter the existing cached topic selection without requests,
  preference writes or re-ranking. Edit fields remains a separate Settings action.
- The backend still selects at most ten topics across all fields. A missing
  field is explained as absent from that selection, not as having no activity.
- Counts and highly cited papers remain explicitly scoped to all selected
  fields, even while the topic list is filtered.
- Growth is labeled as change in publication share, not raw paper counts.
  Expanded rows preserve both dated counts, share values, summaries and links.
  Limited baselines show new, not an invented percentage or zero-activity claim.
- Both topic comparison windows and the highly cited papers' publication range
  derive from the cached board's generation time and existing retrieval rules.
- Existing retrieval, ranking, settings, cache format and failure behavior are
  unchanged. README documents the new presentation and local-filter boundary.

## Verification

- 2,379 unit tests passed; 15 gated skips.
- TypeScript and focused ESLint passed. Repository ESLint has zero errors and
  the existing ConnectAiCard applyPreset dependency warning.
- Production Webpack build passed: .next-trending-ui-final,
  build rLrsCoDCvfHIG9oGomerf.
- Initial focused production browser suite: four tests passed, including field
  filtering, keyboard expansion, readable full titles, counts, scopes, settings
  access and existing paper/digest/reading/refresh-failure behavior.
- Desktop light/dark and phone screenshots inspected; the phone explanation
  was shortened into two complete sentences after the first visual review.
- All 22 browser tests passed against the final production artifact in a
  disposable vault, using controlled source/AI fixtures. No live recommendation
  quality claim is made. A final screenshot-only test adjustment scrolls the
  expanded comparison fully into view; the same-artifact focused rerun passed.
- Final desktop light/dark and phone light/dark views inspected, including the
  expanded comparison and full paper links. No horizontal overflow; both short
  explanation sentences are asserted to occupy one line each at phone width.
- git diff --check passed.

## Local handoff

Port 3113 serves .next-trending-ui-final as detached PID 37982, preserving
/tmp/scispark-production-walkthrough-kafjXM/vault. Trending returned 200 with the
expected build ID, and the settings API returned 200. Reload /trending to view
the redesign; generating another board is not needed to update its layout.

No human profile, photo, keys, field selections or cached recommendations were
edited. No paid AI calls, live literature requests, commit, push or release.
