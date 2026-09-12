# Local Codex and Claude Code integration

Implemented September 10, 2026, against the current SciSpark UI and research
pipeline. Automated tests use disposable storage. The feed-failure repair below
also corrected the user's saved Codex fast-model setting through the settings API;
research content and stored API credentials were preserved.

## Delivered behavior

Settings → Connect your AI now offers API key, Codex and Claude Code. Both local
engine model configurations persist independently. Selecting API mode retains
existing API keys and model mappings; choosing an agent does not require an API
key. A connection check inspects installation and subscription login only. The
separate model test consumes plan usage and is explicitly labelled.

Onboarding, ordinary skills and the existing deep-review pipeline resolve the
selected engine. The same Zod output contracts, academic retrieval adapters,
evidence checks, version history and undoable saves remain authoritative.
Engines receive supplied context; they are not given the research vault path.

The supported initial transports are the official `codex exec --json` and
`claude --print --output-format stream-json` interfaces. This revises the earlier
App Server / Agent SDK transport proposal: the installed versions expose the
needed bounded completion and isolation controls without a new SDK dependency.
The adapter boundary permits a future transport replacement.

This delivery implements bounded completion through SciSpark's existing
orchestrators. The separate proposed `runTask` interface, agent-directed tool
broker, embedded OAuth login and portable vendor sessions are not implemented.
Deep review already uses both engines through its existing staged pipeline;
those future capabilities are not required to run that workflow.

## Runtime and accounting boundaries

- Initially support Codex CLI 0.146.x and Claude Code 2.1.210+ within 2.1.x.
  Other versions fail with an actionable version message.
- Sign in through `codex login` or `claude auth login`. SciSpark neither copies
  OAuth credentials into settings nor logs out the standalone CLIs.
- Child environments are allowlisted: API keys, endpoint overrides, nested agent
  state, Node injection options and provider customizations are not inherited.
- Codex uses an ephemeral scratch directory, read-only sandbox, ignored user
  config/rules, zero project-document budget and disabled shell, apps, hooks,
  plugins, memories, browser and delegation features. Claude uses safe mode,
  an empty built-in tool set, no persisted sessions and no inherited MCP config.
  Unexpected tool events fail the adapter. Installed-runtime enforcement still
  requires separately gated live verification; fixture assertions alone do not
  establish native tool-boundary acceptance.
- Prompts use stdin, not command-line arguments. Raw stderr, reasoning and
  credential-bearing transport messages never become browser errors.
- Codex uses native output schemas when compatible with strict structured output.
  Optional fields/open records use the original schema in the prompt, followed by
  the same Zod validation. This choice happens before dispatch, without another
  request or changing optional evidence fields into required values.
- Each request has a configurable 30–600 second deadline (180 by default),
  bounded output and owned-process termination. Token limits are approximate.
  CLI-internal transport retries are vendor behavior; SciSpark does not start
  another call after an uncertain failure. Local structured validation failures
  do not automatically issue a second completion.
- Subscription usage records carry engine and billing-mode metadata, with
  unknown usage explicitly marked. They are excluded from API dollar budgets
  and charts and summarized separately. No API fallback is performed.
- Local review calls use a separate attempt journal and lock, with a 120-call
  limit per review. Intent is saved before dispatch and results before reuse.
  Uncertain calls require acknowledgement; completed attempts replay from disk.
  The existing coordinator marks orphaned work interrupted and resumes only on
  an explicit action. Cancellation is observed during an in-flight local call.
- Old API-only settings, review briefs and dollar reservations stay readable and
  retain their meaning. New optional settings/model fields are additive.

## Validation

- Unit suite after the feed repair: 2,603 passed, 19 skipped. Engine coverage
  includes both subprocess transports, status/version checking, schema output,
  usage accounting, stderr redaction, forbidden events, cancellation/deadlines,
  settings preservation and complete source-checked reviews with fictional papers.
- TypeScript passed. ESLint: no errors; existing ConnectAiCard effect-dependency
  warning remains. Production webpack build passed for the initial integration;
  the feed repair passed TypeScript, targeted lint and the running development
  server's compilation (HTTP 200).
- Chromium production checks use a disposable vault and executable fixtures:
  both engine selections, no API keys, both model tiers, reload persistence,
  desktop/phone rendering, separate subscription accounting, the first onboarding
  reply and dark/phone controls passed. The existing deep-review browser check
  also passed. Both saved-search/layout regression tests passed on rerun, for
  five passing Chromium scenarios across the final runs. Legacy regression
  selectors were aligned with the current standalone Papers route, chat start
  page, review start action and Saved papers only label.
- Initial read-only real CLI inspection: Codex 0.146.0 reported ChatGPT login
  ready; Claude Code 2.1.210 reported signed out, including outside the sandbox.
- Subsequent live Codex feed verification is recorded below. Claude inference,
  broad quality acceptance and adversarial native tool restrictions remain
  unverified. Do not describe fixture results as live acceptance.

## Feed failure repair and real Codex verification

The first user feed refresh exposed three gaps missed by the original fixtures:
nonfatal `item.completed` error diagnostics were rejected as tool calls; the
initial fast default `gpt-5.4-mini` was unsupported by ChatGPT Codex; and the native
strict schema dialect rejected the optional ranking fields. Diagnostics are now
accepted without exposing their raw text, actual failures remain failures, the
fast default is `gpt-5.6-luna`, and incompatible schemas use validated prompt JSON.
Both fixtures and regression tests now cover these cases. Feed results/cache
carry subscription metadata so the refresh message distinguishes Codex plan usage
from unknown API pricing and labels unranked results explicitly.

Live diagnostics used only synthetic inputs: one rejected-model request, one
successful simple structured request, then two two-call feed runs. The first
feed run planned successfully but reproduced schema rejection during ranking;
the final run passed both stages (`gpt-5.6-sol` planning, `gpt-5.6-luna` assessment)
and ranked the single fictional paper. Final-run usage: 26,864 input and 396
output tokens. Six CLI attempts were dispatched in total across this diagnosis;
the final-run token count is not a cumulative total. No automatic retry was used.
The user's actual feed was not regenerated by these tests.

Reproduce the real Codex feed smoke test only intentionally: it consumes plan
usage, uses an in-memory fictional profile/paper, and makes two bounded calls.

```sh
SCISPARK_CODEX_FEED_SMOKE=1 npx vitest run src/lib/engines/__tests__/installed-feed.test.ts
```

Reproduce offline engine tests:

```sh
npx vitest run src/lib/engines/__tests__
```

Read-only installed-runtime inspection (no inference; writes sanitized status to
`/tmp/scispark-engine-status.json`):

```sh
SCISPARK_ENGINE_STATUS_CHECK=1 npx vitest run src/lib/engines/__tests__/installed-status.test.ts
```

Production browser fixture checks (after building `.next-engines-webpack`):

```sh
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-engines-webpack \
SCISPARK_CODEX_PATH="$PWD/e2e/fixtures/engines/codex.mjs" \
SCISPARK_CLAUDE_PATH="$PWD/e2e/fixtures/engines/claude.mjs" \
npm run e2e -- e2e/local-engines.spec.ts
```

`SCISPARK_CODEX_PATH` and `SCISPARK_CLAUDE_PATH` are trusted, absolute executable
paths supplied only when starting the server, never by a browser request. Do not
point a personal-use server at fixture executables. Normal use discovers the
installed CLIs through PATH and standard macOS installation locations.
