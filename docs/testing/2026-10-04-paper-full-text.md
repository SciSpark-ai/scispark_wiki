# Shared full text for paper digest and Sparky

The reported SGAD paper was accessible, and a PDF was already saved in the user's
vault. The digest route previously used an HTML-only acquisition path and reused
old digests unconditionally. Paper chat supplied metadata, abstract and digest,
but never extracted the available PDF. The DOI-only OpenAlex record also lacked
an explicit arXiv ID, so it missed the arXiv HTML candidate.

## Behavior

- Digest and paper chat now share a server-side source loader: validated text
  cache, saved HTML/PDF, then bounded public HTML/PDF/repository XML retrieval.
  arXiv DOIs supply acquisition candidates without changing paper identity.
- PDF extraction uses the existing bounded subprocess. The chat and digest route
  production traces include that worker and pdf.js dependencies.
- Source metadata distinguishes full text, shortened excerpts and abstract-only
  fallback. Retrieval failure is not described as proof of inaccessibility.
- The first paper question acquires full text; its snapshot persists with History.
  Legacy abstract-only paper conversations upgrade on their next question. The
  full source replaces stale digest context in the prompt. Ordinary older chats
  without a paper association remain unscoped; start from the paper's launcher.
- Legacy and abstract-only digests expose **Update digest from full text**. Reading
  the page remains model-free. An explicit update obtains full text and generates
  a replacement; failed acquisition or generation leaves the old digest intact.
- Full-text digests remain cached without repeat model calls. The digest's 40,000
  character prompt limit and extraction limits are reflected in coverage metadata.
  This is bounded source reading, not a claim that every long/scanned PDF is fully
  readable. Existing source relay and identity checks are preserved.

## Verification

- Test-first source-loader regressions initially failed (module absent).
- Focused tests: 49 passed. Full Vitest: 2,681 passed / 19 gated skips; browser
  purity, semantic-color and source-hygiene guards passed.
- TypeScript passed. ESLint: zero errors, the existing ConnectAiCard
  `react-hooks/exhaustive-deps` warning only. Production build passed.
- Three production Chromium tests passed through `npm run e2e` with a disposable
  vault and local fixture model: full-text digest upgrade, full-text chat prompt,
  source badge, citation save, route isolation, History/reload follow-up, floating
  chat regression, and digest layout at six widths in both themes.
- Desktop (1440 px) and mobile (390 px) chat screenshots were visually inspected.
  Their paper and replies are synthetic fixtures, not a live-model acceptance run.
- A separate read-only real-source diagnostic extracted the user's saved SGAD PDF:
  **5 of 5 pages, 31,046 characters, not shortened**. The actual extracted text,
  including the causal state detector and cache descriptions, reached both digest
  and chat model inputs. The diagnostic used in-memory storage and a MockProvider:
  no user-vault writes and no paid/live model calls.

The original cached SGAD digest is preserved. After refreshing the app, the user
can explicitly update it from full text using their configured model. A new paper
question also loads full text independently of whether the old digest is updated.

Artifacts (logs, diagnostic source and synthetic browser screenshots):
`/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/paper-full-text-2026-10-04/`.
