# Codex and Claude Code engines for SciSpark

Date: 2026-09-08
Status: bounded-completion integration implemented September 10; see
[implementation and validation](../../testing/2026-09-10-local-ai-engines.md).
The original broader agent-task roadmap below is retained; its App Server/SDK
transport choice is superseded for the initial delivery by official CLI adapters.
Agent-directed tools and live acceptance remain follow-up scope.

## Outcome and scope

Users can connect Codex, Claude Code, or existing API providers, select a default
engine, and perform research inside SciSpark. Both local agents are first-class
options; neither requires configuring the other or supplying an unrelated API key.
SciSpark retains its interface, academic retrieval, evidence provenance, durable
jobs, result validation, and undoable vault writes.

Build for the existing local Node runtime first. A hosted browser app cannot
launch a user's local CLI without a separately installed companion service.
Remote hosting and a distributable desktop installer are later deployment work.
Agent inference still sends selected context to the configured provider.

## Verified integration points

- `src/lib/llm/types.ts`: completion interface, streaming snapshots, structured
  output requirements, provider identity and token usage are API-shaped.
- `src/lib/llm/settings.ts`: `buildProvider` requires a key; settings preserve
  sibling sections through `withSettingsWrite`.
- `src/lib/skills/runner.ts`: owns tier resolution, retry and API metering. It
  currently holds the shared `ai-spend` lock for the skill's execution.
- `src/lib/onboarding/service.ts` and
  `src/components/onboarding/FirstRunSetup.tsx`: readiness checks require an API key.
- `src/lib/review/coordinator.ts`: owns leases, cancellation, explicit resume,
  model/context authorization, completion publication, exports and KB insertion.
- `src/lib/review/contracts.ts` and `budget.ts`: briefs require an API provider,
  endpoint, dollar allowance and token prices. Attempts persist results and
  retain uncertain charges rather than blindly replaying work.
- `src/lib/review/pipeline.ts`: existing retrieval, synthesis and source-checking
  workflow is the reference behavior to preserve.
- Settings and chat already have active local changes. Implement against those
  current files; do not revert or wholesale replace them.

## Architecture decisions

Introduce a server-only engine layer alongside the existing provider layer:

```text
SciSpark UI → local APIs → skill/review coordinator → EngineRouter
                                                     ├─ API engine → existing providers
                                                     ├─ Codex → managed App Server
                                                     └─ Claude Code → Agent SDK worker
Agent tool requests → SciSpark tool broker → academic adapters / scoped vault reads
Agent results → schemas + evidence checks → report / undoable changeset
```

Use Codex App Server as the preferred Codex transport because the app needs
authentication, sessions, event handling and interruption. Use the TypeScript
Claude Agent SDK in a managed Node worker. Pin tested runtime/SDK versions and
keep transport details inside adapters. Do not automate either desktop UI.

Separate two capabilities:

1. `complete`: bounded text or structured output, with general-purpose tools
   disabled. Existing pure skills use this capability through a compatibility
   layer; do not make every digest or short companion utterance an open agent loop.
2. `runTask`: a resumable task with a scoped research tool set. Initially used
   for a bounded research pilot, then integrated into deep review.

Proposed modules under `src/lib/engines/`: `contracts.ts`, `settings.ts`,
`router.ts`, `runtime.ts`, `events.ts`, `usage.ts`, `adapters/api.ts`,
`adapters/codex.ts`, `adapters/claude-code.ts`, and `tools/`.

The normalized contract must cover:

- Engine identity (`api`, `codex`, `claude-code`), transport version, model,
  connection profile and auth mode; keep vendor identity distinct from engine.
- Readiness states: missing runtime, unsupported version, signed out, ready,
  limited, unavailable. Status checks must not initiate inference.
- Capabilities: structured output, streaming, interruption, session resume,
  custom tools, usage reporting and available limit controls.
- Task identity, engine session/turn IDs, context and tool-policy fingerprints,
  output schema, abort signal and bounded execution policy.
- Public events: queued, started, text, tool activity, input needed, usage,
  completed, failed and cancelled. Store sequence IDs for reconnect replay;
  do not expose private reasoning or raw credential-bearing transport events.
- Usage with explicit unknown values, billing mode and provenance. Missing usage
  never becomes zero or a fabricated subscription dollar cost.

Do not silently ignore unsupported request options such as token caps or native
structured output. Normalize supported schemas and reject incompatible workflows
before dispatch. Semantic schema validation remains mandatory after generation.

## Connections and user experience

Settings offers three choices: Codex, Claude Code, API key. Both agents can be
connected simultaneously. Pick a default engine, with an optional research
override; engine/model are pinned when a job starts. Existing installs remain on
their current API configuration until the user changes it.

For each local agent, show installation/version, account readiness, chosen model
and billing mode. Codex uses its documented managed login flow. For Claude,
initially guide users through official local Claude Code login and use the
SDK-supported authentication path; verify account reuse and configuration
isolation in the feasibility milestone before promising an embedded login UI.

Store connection metadata separately from vendor credentials. Never scrape token
files into browser state or copy OAuth tokens into vault settings. Disconnecting
SciSpark detaches its connection and stops its jobs; it should not silently log
the user out of their standalone CLI. Avoid inheriting an unrelated API key that
would change subscription-backed execution into API billing.

Replace all key-presence readiness checks with engine readiness, including
onboarding, feed initialization, chat, companion and review launch. Offer a
clearly labelled, user-triggered inference test separately from status checks.

Display the selected engine in the review brief and running task. Users can
change engines for the next run. Moving an interrupted job to another engine
creates a new attempt from validated checkpoints, with explicit updated scope;
never pretend vendor sessions transfer between engines.

## Research tools and execution boundaries

The broker exposes narrow tools such as `search_papers`, `read_source`,
`search_knowledge_base`, `read_knowledge_page`, and `submit_research_draft`.
Use shared Zod input/output schemas; prefer stable MCP transport for Codex and
SDK custom tools for Claude with the same handlers. Codex dynamic tools are
currently experimental and are not the default dependency.

Tool calls are authorized against the active job, vault, selected project,
enabled paper sources and approved context on every invocation. Return stable
source IDs, bounded passages, source hashes and retrieval provenance. Apply
existing acquisition restrictions and source pacing inside the broker.

Agents work in per-job scratch directories. Disable built-in shell, arbitrary
file access, browser/web retrieval, unrelated MCP servers, plugins and inherited
instructions unless explicitly required by the workflow. Working-directory
selection alone is not a filesystem security boundary. Prove the pinned
runtimes can enforce the intended restrictions before enabling vault tools.

Claude `allowedTools` alone is not a deny-by-default boundary. Configure explicit
tool removal/denials and appropriate permission mode; use hooks/broker checks for
rules that must apply to every call. Unexpected permissions fail closed or pause
the job; no automatic permission bypass.

Tool transport receives short-lived job credentials rather than general vault
access. Prevent cross-vault calls, path traversal, symlink escapes and mixed-case
private-path access. Keep model credentials out of PDF/retrieval subprocesses.
Protect local control endpoints with the app's origin/host validation and request
authorization; do not expose the raw engine server to the browser or LAN.

Agent-produced drafts pass through SciSpark's existing claim/source checks.
Citation existence alone is insufficient. Preserve abstract/full-text distinctions,
unresolved evidence labels, limits and contradictions. An agent cannot grant its
own output a checked status. Saving to the KB remains a separately invoked,
schema-validated, atomic and undoable operation.

## Usage, lifecycle and migration

Maintain separate accounting for API dollars and subscription-backed activity.
Subscription UI shows provider-reported limits when available and otherwise
reports their absence. SDK dollar estimates, if available, are not invoices.
Use bounded runtime, concurrency, tool calls and turns where enforceable; token
ceilings can be approximate when the runtime cannot enforce them before a call.
Disclose this capability before execution. Never fall back to paid API calls or
another account automatically after quota exhaustion.

Persist intent before dispatch and results before publication. Dedupe attempts,
tool results and completion events. Reuse the review coordinator's lease and
checkpoint model; add engine session IDs and event cursors. Browser disconnects
do not cancel jobs. Cancellation interrupts the worker, then terminates owned
processes after a grace period, while preserving completed work and usage.

On server restart, mark orphaned jobs interrupted and reconcile metadata only.
Do not restart inference automatically. Resume revalidates account, engine/model,
context and tool policy, then uses a supported session or validated checkpoints.
Uncertain dispatches are not silently retried. Isolate each job's context; do not
reuse a conversation session across vaults, users or unrelated background skills.

Version settings and review manifests. Old API-only settings/briefs/attempt
ledgers remain readable with their original cost meaning. New briefs use a
discriminated execution/budget schema. Leave existing dollar reservations intact.
Keep legacy readers/migrations tested with real-shaped fixtures.

Do not hold an API spending mutex throughout an interactive agent job. Introduce
short atomic reservation/settlement operations and a separate worker-concurrency
lease; broker callbacks must not recursively acquire an already-held lock.

## Delivery milestones and acceptance

| Milestone | Deliverable | Required acceptance |
|---|---|---|
| 0. Prove both transports | Isolated Codex and Claude adapters against pinned versions; capability matrix | Each authenticates through an official path, returns schema-valid output, streams, interrupts, calls one fake research tool, and cannot use forbidden tools. Offline tests first; live smoke tests separately authorized and bounded. |
| 1. Shared engine foundation | Contracts, router, settings migration, runtime supervisor, usage/events | Existing API workflows pass unchanged; old settings load; malformed events, unavailable runtimes and missing usage produce honest states. |
| 2. Connect both engines | Settings cards, readiness API, model selection, onboarding integration | A clean disposable vault can onboard with Codex alone or Claude alone, without an API key; no credentials in browser responses or logs. |
| 3. Existing skill compatibility | Bounded completion for both adapters through the skill runner | Chat, reader/digest, feed, ingest, Spark, lint and companion retain their contracts; structured output, usage and cancellation tests run for all engines. Background calls stay bounded. |
| 4. Research pilot and deep review | Shared tool broker; one-question pilot, then review integration | Both engines retrieve approved sources and produce reports through the same evidence gates; cancel/resume/restart and duplicate completion tests pass; KB save and undo work. |
| 5. Release validation | Version support table, install/auth troubleshooting, full browser acceptance | Both agents and API mode pass desktop/mobile flows; real runtime tests cover sign-out, quota, process crash and unsupported version; no server-only dependencies enter client bundles. |

Milestone 0 is a feasibility gate for both engines, not permission to ship one
and indefinitely defer the other. Adapter internals may land sequentially; the
user-facing release must include both. Release behind an engine feature flag;
rollback disables new selection while preserving manifests and old reports.

Verification: focused Vitest contract and migration suites; fake process/protocol
fixtures for transport failures; existing unit suite, TypeScript, lint and build;
Playwright with a disposable vault and fake engines for deterministic UI checks;
then separately gated real Codex and Claude runs. Compare representative reports
on citation validity, passage support, omissions, latency and reported usage.
No claim of improved research quality until those comparisons exist.

## Remaining feasibility questions

- Exact installed/supported runtime versions and model discovery APIs.
- Claude login reuse while excluding inherited project/user tools and instructions.
- Codex tool restrictions and structured-output parity under the selected auth mode.
- Vendor session retention/deletion controls and available quota telemetry.
- Native cap enforcement versus best-effort local stopping for each runtime.

Resolve these in milestone 0 and record observed behavior. They do not require
the user to choose an engine or redesign SciSpark before work begins.

## Official references checked 2026-09-08

- [Codex App Server](https://developers.openai.com/codex/app-server/): managed
  authentication, sessions and tools. Dynamic tools are currently experimental.
- [Codex SDK](https://developers.openai.com/codex/sdk/): alternative programmatic
  integration for local Codex agents.
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview): agent
  runtime, sessions, tools and supported languages.
- [Claude permissions](https://code.claude.com/docs/en/agent-sdk/permissions):
  allow rules auto-approve tools; they do not by themselves remove other tools.
- [Claude subscription notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan):
  the current June 15 update pauses the announced billing change and says SDK,
  headless CLI and third-party usage still draw from subscription limits. Recheck
  before release; do not implement the superseded monthly-credit section.
