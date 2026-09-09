# Live onboarding, feed and feedback walkthrough

## Environment and scope

- September 5–6, 2026, America/Los_Angeles.
- Base commit: `ee7127b8737069d5fd43e97f121b856af42fe39c`, plus the
  missing-identifier fix and two regression tests described below.
- Visible Codex in-app browser, development server at `http://127.0.0.1:3112/`.
- Disposable vault: `/tmp/scispark-browser-walkthrough-FU8pgd/vault`.
  The existing user vault was not modified.
- The user approved reuse of their configured provider credentials and paid
  calls. After the original model's connection tests hit a rate limit, the user
  selected `google/gemini-3.8-flash`, accessed through the existing
  OpenAI-compatible GMI endpoint. Both fast and strong model settings used it.
- Onboarding, provider setup, feed generation, feedback, Settings inspection,
  refresh and Undo were exercised through the product UI. Local vault reads
  supplemented the UI assertions; no fixture responses replaced the live calls.
- Synthetic profile: Alex — walkthrough, postdoctoral researcher in auditory
  neuroscience, interested in child speech tracking, EEG/auditory attention,
  speech-in-noise perception and autism. Balanced diversity; learning enabled.

## Results

1. Fresh Home → conversational onboarding → BYOK setup succeeded. Enter submitted
   answers; the long transcript stayed within the chat panel.
2. Initial feed generation exposed a real crash: source adapters retain optional
   ID keys with `undefined` values, and `interleaveCandidates` passed them to
   `toLowerCase()` while constructing exclusion aliases. The user approved a fix.
3. Added failing regression tests for interleaving and the complete `runFeed`
   path, then skipped absent/empty aliases while preserving valid-ID exclusions.
   Retried initialization in the same browser session successfully.
4. First successful feed: 27 candidates retrieved/ranked, eight cards displayed,
   generated at `2026-09-06T06:57:49.345Z`, no saved preference memories.
5. Liked “Neural tracking of surprisal in Spanish-English bilingual children
   during naturalistic heritage language listening”
   (`doi:10.1016/j.bandl.2026.105833`).
6. Disliked the ambient-odor/listening-comprehension study
   (`doi:10.1016/j.bandc.2026.106475`). Sparky asked “What missed the mark?”;
   selected “Not my topic” and saved a note requesting fewer olfactory-context
   studies while retaining EEG, auditory attention and child speech tracking.
7. Both cards remained visible after reload. Settings → Recommendations showed
   both memories, the selected reason and the exact saved note.
8. One feedback-informed refresh completed at `2026-09-06T07:02:09.963Z`:
   21 candidates retrieved/ranked, 12 displayed, both memory IDs supplied,
   `memoryStatus: checked`. The profile hash stayed unchanged.
9. “Bringing Attention to Education: Revisiting the Neural Mechanisms of
   Selective Attention in Naturalistic Learning”
   (`doi:10.64898/2026.08.26.747092`) rose from 87.6 to 95.6. Its displayed
   recommendation details recorded a +8 positive-memory adjustment with paired
   saved-paper and candidate excerpts. This explanation persisted on navigation.
10. History → Changes → preview → Undo reverted the added negative reason.
    Browser automation could not handle the native confirmation; the user
    clicked OK. History showed REVERTED and Settings then showed the original
    bare “Less like this” vote alongside the unchanged “More like this” vote.
    The existing generated feed remained unchanged. No third refresh was run.

## Remaining findings and limits

- **Document types / duplicate parent work:** three eLife public peer-review
  reports appeared as separate highly ranked papers and each received a +4
  related-memory boost. Distinct report DOIs defeat ordinary paper-ID deduping.
  Add source document-type filtering and/or parent-work grouping before ranking;
  do not exclude genuine research review articles by a broad “review” keyword.
- **Unknown model pricing:** this model is absent from the pricing table. The
  unknown estimate is accumulated as zero, and the UI displays approximately
  $0.00. This is not evidence of free calls; actual charges require provider
  billing. Unknown costs need an explicit UI/budget-accounting state.
- **Partial source coverage:** Semantic Scholar was unavailable; a PubMed query
  also failed during the second run. The feed disclosed the warnings and used
  real OpenAlex/arXiv results. This was not an all-sources pass.
- **Negative-learning evidence:** persistence and delivery of the negative memory
  were verified. The second candidate pool did not contain the odor study and
  showed no negative score adjustments. Its absence does not prove causal
  suppression; an isolated live negative-ranking check remains open.
- This demonstrates a working feedback loop, not calibrated recommendation
  quality or production/release acceptance. Venue standing stayed unknown and
  neutral; no venue dataset was connected during this work.

## Validation and handoff

- Full Vitest suite: **2,200 passed; 15 environment-gated tests skipped**.
- TypeScript, ESLint on all three changed code/test files, and `git diff --check`
  passed. Both new regression tests failed on the original code before passing.
- This session did not rerun the production build or automated Playwright suite.
  The browser walkthrough used the development server and real provider.
- No commit, push, merge or release was performed for this fix. The server and
  disposable vault were left available for the user, with the feed's learned
  ranking explanation open. Provider secrets are not included in this report.
