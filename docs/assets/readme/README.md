# README screenshot gallery

These are real SciSpark browser screens captured with illustrative data in a
fresh, disposable vault. They demonstrate the interface, not scientific results.

## Provenance

- Captured September 9, 2026, with Chromium at **1440 × 960**, light theme and
  reduced motion, against application source at commit `893e8c5`.
- All paper records, research notes, project content, ideas, relevance assessments,
  and review text are fixtures. No private research vault was used.
- Feed runs through the real workflow with deterministic mock model responses and
  a fixture search function. Its displayed scores are example product outputs.
- The report is a seeded, user-edited example with source checks outstanding. No
  live literature review was executed, and no scientific conclusion is asserted.
- The graph is computed by the application from the example wiki.
- The E2E harness uses mock services; the capture makes no paid model calls.
  Browser requests outside loopback are blocked during capture.

| Image | View |
|---|---|
| [feed.png](feed.png) | Personalized Feed with six illustrative papers. |
| [deep-research.png](deep-research.png) | Sparky conversation and an example report. |
| [wiki.png](wiki.png) | Rendered concept page with research questions and links. |
| [graph.png](graph.png) | Knowledge graph derived from the example vault. |
| [projects.png](projects.png) | Project overview, linked papers, and a note. |
| [spark.png](spark.png) | Research direction and example idea gallery. |

## Refresh the gallery

From the repository root after installing dependencies and Playwright Chromium:

```bash
SCISPARK_CAPTURE_README=1 SCISPARK_SCHEDULER=off npm run e2e -- e2e/readme-showcase.spec.ts
```

The [capture script](../../../e2e/readme-showcase.spec.ts) is opt-in and skipped
in ordinary E2E runs. Use `npm run e2e` so the harness provisions and cleans up
the temporary vault and local mock services. Do not run it against a personal
vault. The command replaces the six images in this directory.

After capture, inspect each image for loaded content, readable text, and accurate
feature state. Update the date and application revision above when recapturing.
