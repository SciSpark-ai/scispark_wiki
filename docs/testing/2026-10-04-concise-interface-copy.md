# Concise interface copy — October 4, 2026

User request: remove Sparky's redundant context explanation and stop making the
interface explain implementation details by default.

## Changes

- Floating Sparky keeps one opening heading and the current paper title. Removed
  the tagline, context-policy paragraph, History reminder and pre-request source
  explanation. Known source coverage remains a short label after a response.
- Saved chats show their paper or project context without narrating persistence
  or adding a generic subtitle. Paper links and source coverage remain available.
- Paper digests combine saved/generated state and source coverage into one
  metadata line, preserving abstract-only and excerpt limits. Per the user's
  follow-up, older digests without source metadata show no status label.
- Trending keeps its share-growth labels. Calculation details now live in the
  existing collapsed explanation. Legacy-cache guidance gives a short next action
  without repeating it in both the banner and empty state.
- `design.md` records this copy principle for future interface changes.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors, one pre-existing ConnectAiCard exhaustive-deps warning.
- `npx vitest run`: 2685 passed, 19 skipped.
- Production build in `.next-concise-ui`: passed.
- Production Playwright: quick chat, paper context, paper digest layout, Trending
  layout and field coverage — all five passed in 19.1 seconds. Uses a disposable
  vault and mock AI service; no live model calls or user research edits.
- Reviewed empty paper-chat screenshots at 1440px and 390px and Trending on phone.
  Source disclosure, keyboard controls, History continuation and paper scope
  isolation are covered by the existing behavioral tests.

Screenshots (synthetic test content):
`/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/concise-ui-2026-10-04/`.

Logs: `/tmp/scispark-concise-{tsc,lint,vitest,build,e2e}.log`.
