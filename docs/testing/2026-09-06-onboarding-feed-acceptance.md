# BYOK-first onboarding and recommendation UX acceptance

## Scope and design

Implement the September 6 discussion, not a scripted substitute for AI onboarding.
Keep the existing SciSpark Halant/Geist typography and semantic warm/light and
dark palettes. Use existing method/evidence/review/dataset colors only to classify
content; never imply unverified importance. Paper titles lead, explanations read
as short sentences, and actions use persistent filled states. Preserve the user's
short-copy wrapping preference, keyboard access and fixed-height conversation.

Journey: Welcome → connect/test provider → streamed adaptive conversation →
editable confirmation → save confirmed profile → automatic first feed.
No onboarding AI work before BYOK; no feed before confirmation. Keep original answers
alongside confirmed interpretations, with no credentials in model context.

## Required evidence (pending until checked)

- [x] Publication types preserved; referee/supplementary records excluded before
  ranking and from cached feeds; genuine reviews/preprints/conference papers kept.
- [x] BYOK-first routing; adaptive streamed onboarding, name first, free text,
  conversational diversity/learning, correction/confirmation and recoverable errors.
- [x] Confirmed local profile plus original answers persist and feed reads them.
- [x] Personalized Home greeting; human-readable evidence-grounded explanations;
  category labels; developer scoring retained outside ordinary cards.
- [x] Shared Home/detail Save and thumbs state; reload/navigation/Undo consistency;
  toggle/switch/clear; no Feedback menu or success clutter; optional Sparky reasons.
- [x] Feedback works for server-resolved search/trending/saved papers.
- [x] Unknown pricing remains unknown in UI and budget accounting.
- [x] Unit tests, TypeScript, ESLint, production build and production E2E pass.
- [ ] Visible real-provider walkthrough on that production build with fresh vault,
  user-selected Gemini, both themes, and separate automated mobile coverage;
  precise limits recorded. Only the user's native live-Undo confirmation remains.

The existing missing-ID fix and its two regression tests remain part of this
worktree. No commit/push/release is authorized by this implementation request.

## Implementation and deterministic evidence — September 6 continuation

The worktree now contains BYOK-first routing, a server-owned adaptive onboarding
skill with live response streaming, revision-checked durable turns and editable
atomic profile confirmation. Original answers and the model's interpretation
remain separate from the confirmed profile. A premature model invitation to
review an incomplete draft is rejected and repaired before committing the reply.

Paper eligibility, shared filled Save/thumb controls, optional Sparky reasons,
plain-language explanations and personalized greetings are implemented.
Unknown prices propagate through run results, usage summaries, budget coverage
and upfront estimates; estimates use the configured model rather than a default.
An old failed feedback reload cannot overwrite a successful newer vote.

Verification on the current worktree:

- TypeScript: passed, `npx tsc --noEmit`.
- Unit/component tests: 2,236 passed, 15 gated tests skipped across 232 files.
- ESLint: passed, `npm run lint -- --quiet`.
- Whitespace/conflict check: passed, `git diff --check`.
- Updated Playwright specs cover the actual onboarding API/stream, confirmation
  before first-feed generation, five viewport sizes, both themes, optional
  feedback reasons, server-side learning effects, Home/detail persistence,
  switch/clear/Save and History Undo. All 16 updated specs passed against the
  Webpack production artifact (1.2 minutes), not a development server.

Additional first-run checks found and fixed the old fast-only BYOK ping.
`/api/settings/test-connection` now checks both configured tiers, reusing one
successful call only when provider and model are identical. A stored key alone
is labeled as unverified, provider switching does not carry another provider's
saved-key state, and configuration fields are frozen during testing. The route
rejects unsafe origins/forged input and never reflects raw provider errors.
New tests cover strong-only and fast-only failure, shared-model metering,
onboarding API secrecy/validation/stale replay, atomic confirmation rollback and
derived-refresh warnings without duplicate profile creation.

The initial Turbopack attempts failed. Both the ordinary attempt and the
permission-enabled attempt terminated with Turbopack's CSS worker error:
`binding to a port: Operation not permitted (os error 1)`.
The failed build directory is `.next-onboarding-acceptance`; it is not a release
artifact. The second error log is
`/var/folders/0w/f8xqj5c94mn10yt1h51zr99r0000gp/T/next-panic-9cda34f97744c05571f95ca066198313.log`.
Do not treat the existing dev-server walkthrough as production acceptance.

After the user's explicit approval, Next's supported Webpack production build
passed with `npm run build -- --webpack` and
`SCISPARK_LIVE_GATE_DIST_DIR=.next-onboarding-acceptance-webpack`.
The retained build ID is `99NSNYvSUWYo73P5rjkGf`. Production E2E used
`SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-onboarding-acceptance-webpack npm run e2e`.

The visible real-provider walkthrough on port 3113 completed onboarding, a
nine-paper first feed and a twelve-paper learned refresh using
`/tmp/scispark-production-walkthrough-kafjXM/vault` and the requested Gemini model.
The live run caught a category fallback issue; explicit abstract self-descriptions
now identify datasets/reviews/methods despite generic source types. Two regression
tests were added, the build rerun into `.next-onboarding-acceptance-final` (build
ID `3fdcbq7gYHW1KZVY4oaxV`) and all 16 production E2Es passed again in 1.3 minutes.
The visible server now runs that final artifact. Only the native confirmation
click for the optional live Undo check is pending; automated Undo passed.
See `2026-09-06-production-onboarding-walkthrough.md` for exact evidence and
coverage limits. The original user vault is untouched.
