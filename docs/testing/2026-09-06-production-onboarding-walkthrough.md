# Production onboarding and recommendation acceptance — September 6

## Build and environment

- Branch: `codex/human-test-onboarding-profile-refresh`, uncommitted worktree
  based on `ee7127b8737069d5fd43e97f121b856af42fe39c`.
- The user explicitly approved the supported Webpack builder after Turbopack's
  CSS worker was denied a local port. This is a real `next build` / `next start`
  production test, not a development-server walkthrough.
- Initial production build: `.next-onboarding-acceptance-webpack`, build ID
  `99NSNYvSUWYo73P5rjkGf`.
- Final production build after the live category-label correction:
  `.next-onboarding-acceptance-final`, build ID `3fdcbq7gYHW1KZVY4oaxV`.
- Visible browser: `http://127.0.0.1:3113/`.
- Fresh disposable vault: `/tmp/scispark-production-walkthrough-kafjXM/vault`.
  It began with no profile, feed, papers or provider configuration. The approved
  existing credential was entered through the UI without being printed.
- Both model tiers: `google/gemini-3.8-flash`, using the user's approved
  OpenAI-compatible provider. No model substitution was made.
- The original user vault and the existing development server on 3112 were not
  replaced. No commit, push, merge or release was performed.

## Visible real-provider journey

1. Opened the fresh Home screen and followed its setup link. BYOK appeared
   **before** the AI conversation. Connecting the configured model succeeded and
   opened onboarding; a shared strong/fast model used one connection-test call.
2. Sparky asked the name first. Typed `Call me Tong.` and sent with Enter.
   Gemini then asked for role and research interests, using the supplied name.
3. Answered in free text: postdoc, auditory neuroscience, adult speech-in-noise
   EEG, auditory attention and useful analysis methods. Sparky moved directly to
   diversity rather than repeating fields already supplied.
4. Used no diversity preset: requested mostly auditory neuroscience, occasional
   relevant ML methods, no fixed percentage and no unrelated AI news. Sparky
   reflected that nuance and separately asked about learning from feedback.
5. Explicitly enabled learning and specified that disliked papers should remain
   visible and already-read should not mean topic dislike. The confirmation
   form retained these details in plain language, with focused variety and
   learning enabled. Edited the role to `Postdoctoral researcher in auditory
   neuroscience`, then confirmed using the explicit button.
6. Original conversation and unconfirmed interpretation remain separate from
   confirmed answers in `profile/onboarding-conversation.json`. The confirmed
   role and full nuanced preferences appeared in `profile.md` and Profile UI.
   Both themes were inspected during the live conversation. The composer stayed
   inside the desktop viewport as the conversation grew.
7. Confirmation automatically started the first feed. Visible progress advanced
   through planning/search/ranking to a ready screen with **9 papers**, from 47
   assessed candidates. Home read **Good morning, Tong**. The publication window
   was explicit, and a Semantic Scholar timeout was disclosed.
8. Liked `Intelligible distracting speech disrupts early auditory attention`
   (`doi:10.64898/2026.08.19.745879`). Disliked the fMRI paper `Attention modulates
   auditory representations at different levels of abstraction depending on scene
   structure` (`doi:10.1038/s42003-026-10876-8`). The latter remained visible.
   Sparky alone asked for an optional reason. Selected **Not the method I need**
   and wrote: “For this project I need EEG or MEG methods. Recommend fewer
   fMRI-only studies; the auditory-attention topic itself is still relevant.”
9. Opened the liked paper, verified the shared selected thumb, saved it, and
   fully reloaded. Both Save and thumbs-up remained selected. Home showed the
   same persisted states. The optional explanation used short prose based on
   recorded topic matches, and disclosed title/abstract-only assessment.
10. On a third paper, tested thumbs-down → Skip → thumbs-up → clear. Skip did
    not remove the paper or fabricate a reason; switching replaced the vote and
    clearing removed that test entry. Only the intended positive and method
    preference remained before the second feed.
11. Refreshed through the UI. The second feed assessed 50 candidates and returned
    **12 papers**, with recent and older sections explicitly distinguished.
    Both feedback records were listed in the backend's checked memory set.
    The generated search strategy explicitly favored EEG/MEG over fMRI and
    referred to the liked distractor-speech study. Nine returned papers received
    recorded positive adjustments (six at +8, three at +4), with quoted evidence.
    The disliked fMRI paper did not appear in that refresh; this alone does not
    prove an isolated negative score change, since retrieval also changed.
12. Settings → Recommendations displayed the exact reason and the method-specific
    scope. Settings → Spend & budget showed **Unknown**, warned that unpriced
    calls are outside the local budget's coverage, and did not plot them as zero.
    At the audit snapshot, all 19 metered calls used the requested model and had
    unknown prices (71,543 input tokens, 28,882 output tokens).
13. Restarted the same disposable-vault server with the final build. Verified
    the formerly mislabeled mini-review now renders **Review / synthesis**.
    Opened History and previewed the applied reason-refinement change. The
    native browser confirmation for Undo requires the user's click; final
    post-Undo verification is pending below.

The profile hash was unchanged before and after feedback and the learned refresh:
`b9280735747fded1cf28486a667139bef70f78270794e6ca22141dc3ca449bf6`.
The learned-feed cache hash before Undo was
`8a41a6729ca8f8b988c0414f4b1d7268ca55b6db25637acead0e1e84d82960bc`.

## Live finding corrected

Broad source types (`article` and `preprint`) caused an explicitly described
dataset and mini-review to fall back to Research findings. Added a failing
regression from those cases, then classified explicit abstract self-descriptions
without treating incidental use of existing datasets/methods as new contributions.
Categories remain descriptive, not importance or breakthrough claims.

The final build differs from the first live-onboarding build only by that runtime
classification correction (plus tests and generated build configuration).
The entire automated fresh-vault suite was rerun on the final artifact. Live
onboarding itself was not repeated just for this category-only change.

## Final deterministic and production gates

- `npm test`: **2,236 passed, 15 environment-gated skips**, 232 files.
- `npx tsc --noEmit`: passed.
- `npm run lint -- --quiet`: passed.
- `git diff --check`: passed.
- `SCISPARK_LIVE_GATE_DIST_DIR=.next-onboarding-acceptance-final npm run build -- --webpack`: passed.
- `SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-onboarding-acceptance-final npm run e2e`:
  **16 passed (1.3 minutes)**.

Production E2E covers actual onboarding APIs and streamed UI, confirmation before
autofeed, new/saved connection branches, recovery, five viewport sizes in both
themes, server-owned feedback, reason-specific negative ranking effects,
Home/detail/reload/Save/switch/clear, History Undo, source eligibility, Chat and
reader streaming, projects, conflicts, unsafe requests, corrupt records and
export/import. Paid providers and public source transport are deterministic
fixtures in these tests. The separate visible journey above used the real provider
and real retrieval. Phone/landscape coverage is automated production-browser
coverage, not a real-provider mobile session. Desktop and phone screenshots were
visually inspected under `test-results/`.

## Boundaries and remaining limits

- Source timeouts still occur. They are disclosed and do not erase the last feed.
- Venue metrics were unavailable for this run; the existing neutral fallback was
  used. No journal-impact metric was invented.
- This walkthrough proves a working preference loop, not recommendation-quality
  improvement across users or a controlled live negative-score ablation. The
  isolated method-penalty behavior passed deterministic production E2E.
- Model prices remain unknown until a supported rate is supplied; use the
  provider's spending limit for real enforcement.
- No physical mobile-device acceptance or public release is claimed.
