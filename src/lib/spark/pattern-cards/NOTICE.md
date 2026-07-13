# Notice

This directory bundles the ideation-pattern reference cards from
[microsoft/ResearchStudio](https://github.com/microsoft/ResearchStudio)
(the `ResearchStudio-Idea` component's `skills/idea_spark/references/`
corpus), used unmodified by the SciSpark Spark skill.

- `patterns/` — the 17 top-level ideation-pattern cards (15 named patterns +
  `overview.md` + `companion-combos.md`), copied from
  `skills/idea_spark/references/ideation-patterns/`.
- `sub-patterns/` — the 32 ideation sub-pattern cards (31 clusters `C00`–`C30`
  + `overview.md`), copied from
  `skills/idea_spark/references/ideation-sub-patterns/`.
- `LICENSE` — the upstream project's MIT License text, reproduced verbatim as
  required by the license.

microsoft/ResearchStudio is licensed under the MIT License:

```
Copyright (c) 2026 Happy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

See the full text in `./LICENSE`.

These cards are consumed by `src/lib/spark/pattern-cards.ts` (`loadPatternCards`)
as the ideation-pattern catalog for SciSpark's Spark skill (Quick Spark /
Deep Spark, M9). SciSpark adapts ResearchStudio's disciplines (locked
falsification fields, two-channel scoop-check, corpus-anchored audit) but
does not port its Python orchestrator; the cards themselves are bundled
faithfully, unmodified.
