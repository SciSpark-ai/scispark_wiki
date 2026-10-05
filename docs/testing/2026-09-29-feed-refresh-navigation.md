# Feed refresh across navigation

Leaving Home previously discarded the refresh component's state and callbacks.
The server already owned a single-flight pipeline that could outlive a detached
stream, but the returning page did not subscribe to that pipeline. It showed an
idle refresh button and could remain on the old cache even after work finished.

Home and first-run setup now make a read-only GET to the feed refresh endpoint
when they mount. If work is active in that profile's vault, GET streams the same
promise's current stage, original start time, later progress, and result. It never
starts a provider call. POST remains the explicit start action and still joins an
existing run. Unmounting aborts only the browser observation and suppresses stale
callbacks; the server continues persisting its result.

The client also supplies its loaded feed timestamp. If completion happens between
loading Home's old cache and reconnecting, GET returns the changed saved feed.
An unchanged cache is not replayed, preserving locally filtered dismissed cards.
First-run auto-start waits for this check and does not start extra work if the
check fails. Active work and observers remain scoped to each profile's vault.

This handles navigation, reload, and closing/reopening a browser page while the
local server stays running. It does not add recovery across local-server shutdown.

## Verification

- The new navigation/reconnection regressions failed against the previous UI and
  missing GET route, then passed after implementation.
- Real route tests disconnect the initiating stream, attach through GET, finish
  one provider pipeline, and verify the saved cache. Other cases cover an idle
  GET, profile isolation, unchanged cache, and completion during navigation.
- Component tests verify restored stage/elapsed time, disabled refresh while
  running, one POST after remount, no callback to the departed page, first-run
  attachment, and no automatic paid retry after a reconnect error.
- Browser acceptance starts refresh, navigates to Wiki, returns Home, reloads,
  receives the result, and revisits the completed cached feed with exactly one
  POST. It uses deterministic feed transport responses; route tests separately
  exercise the actual pipeline with mock providers and search.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors and the existing single `ConnectAiCard.tsx`
  exhaustive-deps warning.
- `npx vitest run`: 2,622 passed, 17 skipped.
- Isolated production build `.next-feed-resume`: passed, 63/63 pages generated.
- Browser scenarios: feed navigation/reload, both first-run setup paths, and
  local profile/vault isolation.

All automated verification used disposable vaults and mock providers or transport
responses. No live model call, research-vault refresh, or API key was needed.

## Follow-up: failed refresh disappeared on return

The reported 00:48 feed was a completed ranking of 49 candidates, selecting 12
papers: 2 recent and 10 older. Semantic Scholar was rate limited and timed out on
some searches. The subsequent 01:44 refresh failed in both its Codex planning and
assessment calls; assessment reported a rejected model. The pipeline returned
unranked fallback results, preserved the prior ranked cache, and the route
incorrectly recorded `ok`. Once the page disconnected, the transient outcome was
lost and returning Home showed the prior cache with an idle button.

The route now checks both local model tiers before starting inference or source
searches. Idle read-only attachment also reports unavailable saved selections.
It records actual cache replacement and degraded outcomes in the durable run
ledger. A failed/degraded replacement returns an explanation while retaining the
same saved feed on screen. Reopening Home restores that explanation without
starting another run, including after process-local state has been cleared.
Home also reports how many shown papers are recent versus older.

At the final live-page check, the installed Codex CLI had changed from 0.146.0 to
0.159.0. The old exact-version check blocked it. Support now includes these two
minor versions, retaining rejection of unverified versions. The new CLI's command
help, ChatGPT sign-in and native read-only catalog were checked; its catalog now
includes `gpt-6-astra`, `gpt-6-sol` and `gpt-6-luna`. No live completion was sent.
Legacy `ok` outcomes without cache-replacement metadata are checked against a
bounded set of subsequent assessment records, allowing the existing failed
refresh to be explained without rewriting its ledger or exposing raw errors.

The added `feed-server-background.spec.ts` exercises the actual HTTP endpoint,
pipeline, native CLI subprocess adapter, arXiv parser, ranking and persistence.
Only CLI responses and source HTTP responses are fixtures. Each planning request
is held for 15 seconds while the browser leaves, returns and reloads. The first
run completes; a second run fails assessment and preserves the first feed and its
failure message across further navigation. Neither scenario uses live inference
or public paper-service requests. The fixture source loader is explicitly gated
to the disposable E2E vault and is absent from the normal server command.

Follow-up validation: TypeScript and the production build pass; lint has zero
errors and the same existing warning. The full suite has 2,641 passing tests and
17 gated skips. Five production-browser checks cover real-server feed recovery,
transport reconnection, both onboarding paths and profile/vault isolation.

```sh
SCISPARK_LIVE_GATE_DIST_DIR=.next-feed-resume npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-feed-resume SCISPARK_SCHEDULER=off \
  npm run e2e -- e2e/feed-background.spec.ts e2e/first-run-setup.spec.ts e2e/local-profiles.spec.ts
```
