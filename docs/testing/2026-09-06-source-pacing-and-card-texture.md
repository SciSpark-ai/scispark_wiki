# Source pacing and card texture — September 6, 2026

## Scope and diagnostic evidence

User approved removing the heavy card-header rule, restoring the earlier texture,
and sending the two previously identified saved queries to Semantic Scholar and
PubMed for source-only diagnostics. No AI calls or feed regeneration were made.

- Semantic Scholar's saved query returned HTTP 429 in 296 ms. The response had
  no `Retry-After` header and identified rate limiting.
- PubMed's saved query, with the wider publication window beginning June 8,
  returned HTTP 200 from ESearch in 422 ms (two IDs). EFetch returned HTTP 200
  in 164 ms (two articles).
- The earlier cached feed lost its error details, so the historical PubMed
  failure cannot be identified conclusively. Concurrent unpaced calls were a
  verified implementation gap, not proof that its earlier error was a 429.
- Neither `S2_API_KEY` nor `NCBI_API_KEY` was configured. These source keys are
  separate from AI BYOK. Queries/credentials are intentionally omitted here.

## Changes

- Reused `GrainOverlay` and the original local `/textures/grain.png` asset with
  light opacity in the category header. Removed the 3 px top rule. Texture is
  clipped, decorative and noninteractive; text sits above it.
- Shared per-source search HTTP queues beneath the adapters cover both the
  direct feed and Search API paths. S2 starts are at least 1000 ms apart; PubMed
  starts are at least 350 ms apart, counting ESearch and EFetch separately.
  Queues are shared within the server process, including route bundles.
- A 429/503 applies a source-wide cooldown and at most one retry per HTTP call.
  Numeric/date `Retry-After` is honored; absent/invalid values use 5 seconds.
  Authentication failures are not retried.
- Each S2/PubMed logical search has a 20-second budget that includes queueing,
  retries and body parsing. Feed cancellation reaches the transport, preventing
  queued searches from starting after the caller's deadline.
- Newly generated feed warnings distinguish rate limiting, access denial,
  timeout and other failures without exposing upstream URLs or credentials.
  Cached warnings were preserved rather than rewritten as successful runs.

## Verification

- Reproduced the old header rule and missing deadline cancellation with failing
  regressions before implementation.
- `npm test`: 2,251 passed, 15 gated skips (233 test files).
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; one pre-existing hook-dependency warning in
  `ConnectAiCard.tsx` (`applyPreset`).
- `git diff --check`: passed.
- Production Webpack build passed: `.next-source-pacing`, build ID
  `srQ6kCJ4uWHzHWcvsv-mU`.
- All 16 Playwright tests passed against that production build and disposable
  vaults. Header tests assert no top border, clipped local texture and inert
  pointer behavior, including the dark theme. Existing feedback/History,
  onboarding layouts, streaming and project flows remain covered.
- In-app browser: reloaded the actual human-test Home page on port 3113 and
  visually verified the textured light headers without the dark top rule.
  Dark/mobile verification uses the production Playwright screenshots.
- Restarted port 3113 with the same disposable vault as a detached loopback-only
  process. Home and the grain asset both returned HTTP 200; server PID 85097
  had parent PID 1 at verification. No vault reset, commit, push or release.

## Follow-up: Home still showed the saved warnings

The user's 3:08 PM screenshot still displayed the feed generated at 3:22 AM.
Its two warning strings exactly matched the saved cache; this was not a new
feed run. Merely adding pacing did not fix that misleading presentation.

- Rechecked the same two approved queries through the actual paced adapters,
  without AI calls: PubMed returned two articles in 694 ms; Semantic Scholar
  still returned HTTP 429 after its sole paced retry (5,399 ms total).
  Semantic Scholar availability therefore remains unresolved, not “fixed.”
- Home no longer shows the diversity preference or edit-preferences link.
  Settings → Recommendations still owns those controls.
- The saved failures now appear under a closed-by-default “Some searches were
  incomplete on the last refresh” disclosure, with the feed timestamp and
  human-readable source names. Completed searches are acknowledged alongside
  incomplete ones. Arbitrary upstream strings/queries are not rendered, and
  critical assessment/unranked-result warnings remain prominent.
- Four Home-level regressions failed against the old UI and passed after the
  change. Full suite: 2,255 tests passed, 15 gated skips. TypeScript, focused
  ESLint and diff check passed. All 16 production Playwright tests passed,
  including a replay of the exact legacy warnings and Settings editing.
- New build: `.next-home-notices`, ID `a-_ulQ5oeS5yCnAbsXxi9`. Port 3113 was
  restarted as detached PID 90003 on the unchanged disposable vault. In-app
  browser verified zero preference links/old raw warning lines, readable
  expanded historical notes, and collapsed Home layout. HTTP 200 verified.
  The diagnostic script was removed after use. No AI calls, feed regeneration,
  vault reset, commit, push or release.

## Remaining limits

These queues cannot control other programs/processes on the same IP or guarantee
availability in Semantic Scholar's shared unauthenticated pool. Public endpoints
were probed directly; pacing/retry timing and cancellation were verified with
controlled transports, including the adapters' default production transport.
Production E2E replaces external paper retrieval and paid AI with fixtures.
The existing feed warnings remain historical until the next feed refresh.

Sources: [Semantic Scholar usage guidance](https://webflow.semanticscholar.org/product/api/tutorial),
[NCBI request limits](https://eutilities.github.io/site/API_Key/usageandkey/).
