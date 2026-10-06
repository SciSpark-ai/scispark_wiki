# Modular workspace validation evidence

Status: All 20 task commits have been reviewed. The single broad final review found F1–F6 and M1–M3; the consolidated fix wave is implemented. The single scoped re-review **passed** on `fbb86dd093dee2af9fb3aaf9b452e4aa3244a8ce`; the later amend is documentation/evidence only. Real imported-command, platform/provider/source and scientific acceptance remain **OPEN**. No release, push, merge or PR is claimed.

Branch: `codex/modular-research-workspace`. Reviewed base: `435afcd886d810b66258aaae83734c5868f721cf`. Fix-wave parent: `96d0785d96ba19f662ca3d8b4a6148f84d24f434`; all 20 task commits remain intact. The additional commit is identified by the exact subject `fix: close modular workspace integration gaps`.

[Passing scoped review and finalization summary](artifacts/modular-workspace-2026-10-05/final-fix/review-summary.md) links the exact review, recovery ledger and mechanical docs-only proof. Historical pending-review statements in earlier reports remain unchanged.

## Consolidated fix wave

[Final broad review](artifacts/modular-workspace-2026-10-05/final-fix/final-review.md), [fix report](artifacts/modular-workspace-2026-10-05/final-fix/final-fix-report.md), and [R1–R79 decisions and costs](artifacts/modular-workspace-2026-10-05/decisions.md) record the findings, implementation, verification and remaining limits.

- Plain instruction imports declare a strict human `question` input and compatibility with the host's API/Codex/Claude Code instruction adapters. Reviewed custom schemas and explicit engine restrictions remain authoritative. Direct selection, named selection and chooser starts bind actual catalog/import inputs before run admission. Session/source metadata stays outside imported arguments. OpenCite binds `query` with its existing `limit: 10`, `fullText: false` defaults; explicit typed helper/API options remain supported. Unsupported custom schemas require explicit adapter review; no paid argument parsing or silent request discard is added.
- Named unavailable tools stop before classification can choose an alternative. Selected-tool composers omit discussion-only Saved papers scope in both layouts while preserving the server guard.
- Version restoration uses the latest saved per-version preferences. Original history entries and already captured run/tool/model/allowance snapshots remain unchanged.
- Command allowance is reserved before fresh invocation directories are allocated. The offline supported-readiness/worker fixture proves limit → extend → Continue dispatches once with cumulative counters; existing uncertain output directories are never reused. This is not platform acceptance.
- Captured human names appear in run and shared History views; subscription cost meaning, safe setup actions, supporting names and a single chooser prompt replace opaque/repeated summaries. OpenCite producer papers render in Results with DOI/URL/access distinctions. Bounded reasons distinguish no location, policy denial, size limit, retrieval, invalid PDF and conversion failure; a retained valid PDF is preserved when text conversion fails. The 512 KiB PDF and 2 MiB command bounds remain unchanged.

| Gate | Current evidence |
| --- | --- |
| Typecheck | Exit0, 4.73s; final production builds also typechecked |
| Lint | Exit0, 18.46s; only the baseline ConnectAiCard hook warning |
| Full Vitest | **3316 passed / 24 skipped**, 311 passed /8 skipped files; 37.89s suite /38.80s wrapper |
| Final chooser regression | **40/40**, 1.47s, after strengthening the hash-version case |
| Regular build | Exit0, **28.26s**, `.next-modular-final-fix-regular-v3` |
| Acceptance build | Exit0, **25.43s**, `.next-modular-final-fix-acceptance-v3` |
| Modular six-spec coverage | v2 suite **12 passed/1 locator failure**, then affected import handoff **1/1** (4.2s); final v3 chooser **1/1** (14.6s) |
| Core six production specs | **6/6**, 49.1s; Markdown, paper context, selection, feed, review and restart |

The last change only removes an opaque version from the collapsed chooser summary. Its strengthened40-test component suite, fresh regular/acceptance builds and production chooser rerun pass. The full offline suite and remaining v2 browser scopes are reused because their product behavior is unchanged; these are not represented as a single fresh full-suite run on v3. All earlier failures and build variants remain retained.

Current raw [gate metadata](artifacts/modular-workspace-2026-10-05/final-fix/verification/results.json), [full Vitest](artifacts/modular-workspace-2026-10-05/final-fix/verification/vitest.log.gz), [regular build](artifacts/modular-workspace-2026-10-05/final-fix/verification/build-regular/build-result.json), [acceptance build](artifacts/modular-workspace-2026-10-05/final-fix/verification/build-acceptance/build-result.json), [modular six-spec log](artifacts/modular-workspace-2026-10-05/final-fix/verification/browser-modular-final-suite.log.gz), [import correction](artifacts/modular-workspace-2026-10-05/final-fix/verification/browser-modular-targeted.log.gz), [final chooser](artifacts/modular-workspace-2026-10-05/final-fix/verification/browser-choice-final.log.gz) and [core six](artifacts/modular-workspace-2026-10-05/final-fix/verification/browser-core.log.gz) preserve exact scopes. R78 fixes truly-empty fixture registration ordering; R79 preserves ordinary explain routing for the synthetic Markdown marker. No product readiness override or live command is used.

Current visually inspected production captures:

| Capture | Evidence |
| --- | --- |
| Empty profile Tools | [Empty Tools](artifacts/modular-workspace-2026-10-05/final-fix/screens/empty-tools.png) |
| Single chooser prompt, human summaries | [Chooser](artifacts/modular-workspace-2026-10-05/final-fix/screens/chooser.png) |
| Active run after navigation, human title | [Active](artifacts/modular-workspace-2026-10-05/final-fix/screens/active-after-leave.png) |
| Completed source-linked result | [Completed](artifacts/modular-workspace-2026-10-05/final-fix/screens/completed-source-linked.png) |
| Supporting names and setup on phone | [Import](artifacts/modular-workspace-2026-10-05/final-fix/screens/supporting-import-phone.png), [Manage](artifacts/modular-workspace-2026-10-05/final-fix/screens/supporting-manage-phone.png) |
| Selected-tool composer on phone | [Composer](artifacts/modular-workspace-2026-10-05/final-fix/screens/selected-tool-composer-phone.png) |
| Actual normalized OpenCite fixture | [Desktop](artifacts/modular-workspace-2026-10-05/final-fix/screens/opencite-preview-desktop.png), [phone access/reasons](artifacts/modular-workspace-2026-10-05/final-fix/screens/opencite-preview-phone-access.png) |

The captures retain rounded content surfaces and existing research interactions. Phone content is contained without horizontal overflow; supporting names use separate label/name lines. OpenCite presentation uses the real normalizer with synthetic source/PDF data, not actual command execution. Previous Task19/20 gates below are historical.


## Historical Task19/20 gates and provenance

| Gate | Baseline (before Task1) | Final code evidence |
| --- | --- | --- |
| `npx tsc --noEmit` | Exit0 | Exit0, 3.30s |
| `npm run lint` | Exit0; one existing ConnectAiCard dependency warning | Exit0, 18.21s; same warning, no new errors/warnings; generated-card Babel size note retained |
| `npx vitest run` | 2710 passed /19 gated skips; 275 passed /7 skipped files | **3291 passed /24 gated skips**, 308 passed /8 skipped files; 37.40s suite, 38.57s wrapper |
| Regular `npm run build` | Exit0, `.next-modular-baseline` | Exit0, **27.55s**, `.next-modular-task-19` |
| Acceptance `npm run build` | Not applicable | Exit0, **27.18s**, `.next-modular-e2e` |
| Modular production Chromium | Not applicable | **11/11**, 1.3m, after R57; real production UI/runtime with deterministic model/GitHub/source fixtures |
| Core production Chromium | Not applicable | **6/6**, 1.3m, after R57; paper context, selection, Markdown, feed background, native review, native restart |
| R58 affected native production Chromium | Not applicable | **2/2**, 14.1s, fresh R58 build; native review and native restart |
| macOS actual sandbox probe | No compatibility pass | **unsupported**: descendants survived supervisor exit/cancel/IPC loss; no command execution readiness |
| Linux / Windows | Unrun | **unrun**; CI configuration does not prove a CI/platform pass |

Final raw [gate outputs](artifacts/modular-workspace-2026-10-05/final-gates/results.json), [Vitest](artifacts/modular-workspace-2026-10-05/final-gates/vitest.log.gz), [lint](artifacts/modular-workspace-2026-10-05/final-gates/lint.log.gz), [typecheck](artifacts/modular-workspace-2026-10-05/final-gates/tsc.log.gz), [regular build result](artifacts/modular-workspace-2026-10-05/build-regular/build-result.json) and [acceptance build result](artifacts/modular-workspace-2026-10-05/build-acceptance/build-result.json) are retained losslessly as gzip files (original byte hashes in the [raw-output index](artifacts/modular-workspace-2026-10-05/raw-output-index.json)), with build logs and exact before/after/diff configuration proof. Both builds restore `tsconfig.json` SHA256 `3696b0511f5b817eefd35d07dffc3c659b14d17e1207a66e96bc89c9f76484c0` and `next-env.d.ts` SHA256 `8cbc590bb64cc54d760ec9f67367fa949aca86a4798214bd34353f4102f70a34`. Builds used fresh disposable roots, scheduler off and isolated dist directories; the human server/vault/build were not used. [Baseline logs](artifacts/modular-workspace-2026-10-05/baseline/vitest.log.gz) retain the measured baseline, including the initially stalled restricted build and successful isolated retry.

R58 changes generic native admission only; it does not change imported execution or UI. The earlier modular11/core6 and four master screens remain applicable for those scopes. The fresh native2 gate covers the R58 explicit approval/resume/revise bridge. Counts from earlier candidates in the [historical appendix](artifacts/modular-workspace-2026-10-05/historical-evidence.md) are superseded, not additional final passes. Task20 changes documentation/evidence only, so these completed gates are reused without new test/build claims.


Final commands (recorded, not rerun by Task20):

```sh
npx tsc --noEmit
npm run lint
npx vitest run
# Each build set SCISPARK_VAULT=<fresh-disposable-root>/vault,
# SCISPARK_PROFILES_DIR=<fresh-disposable-root>/profiles, SCISPARK_SCHEDULER=off.
SCISPARK_LIVE_GATE_DIST_DIR=.next-modular-task-19 npm run build
SCISPARK_LIVE_GATE_DIST_DIR=.next-modular-e2e npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-modular-e2e SCISPARK_E2E_ARTIFACT_DIR=/tmp/scispark-modular-evidence npm run e2e -- e2e/tools-library.spec.ts e2e/tool-choice.spec.ts e2e/tool-background.spec.ts e2e/tool-restart.spec.ts e2e/tool-profile-isolation.spec.ts e2e/tool-review.spec.ts
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-modular-e2e SCISPARK_E2E_ARTIFACT_DIR=/tmp/scispark-modular-evidence npm run e2e -- e2e/paper-chat-context.spec.ts e2e/selection-sparky.spec.ts e2e/chat-markdown.spec.ts e2e/feed-background.spec.ts e2e/literature-review.spec.ts e2e/review-restart.spec.ts
# Fresh R58 affected-browser gate:
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-modular-e2e SCISPARK_E2E_ARTIFACT_DIR=/tmp/scispark-modular-evidence npm run e2e -- e2e/literature-review.spec.ts e2e/review-restart.spec.ts
```

The recorded build wrapper retained generated configuration edits, validated only
its own dist-path additions, then restored the exact prebuild bytes. The raw logs
are lossless gzip artifacts; inspect with `gzip -dc <artifact.log.gz>`. Their
[original byte hashes](artifacts/modular-workspace-2026-10-05/raw-output-index.json)
and compressed-artifact manifest distinguish stored bytes from decompressed bytes.

## Requirement map

Each confirmed decision in spec §2 is mapped below; spec §3–8 architecture, acceptance and interface constraints retain their broader live limits. Source links point to the current service or exact calling consumer, not a proposed interface.

| Spec requirement / acceptance | Tasks and current caller | Evidence / remaining limit |
| --- | --- | --- |
| Core-only fresh profiles; migrated users preserve tools/data (§1, §2, §7; cycle10) | 2,14,15,19: [profile initialization](../../src/lib/extensions/profile-state.ts), [local profile creation/bootstrap](../../src/lib/server/local-profiles.ts), [Sidebar](../../src/components/layout/Sidebar.tsx) | profile-state/local-profiles regressions; tools-library configured-empty/default and restart legacy/disabled-retention production checks. No human migration performed. |
| Tools and Sparky entry; sidebar pins (§2; cycle4) | 15–17: [ToolsLibrary](../../src/components/tools/ToolsLibrary.tsx), [chat dispatch](../../src/lib/chat/orchestrator.ts), [ToolRunBlock](../../src/components/chat/ToolRunBlock.tsx) | Tools UI tests, tool-choice/tool-background/tool-review; same root observable from both entry points. |
| Explicit naming/direct selection; automatic clear intent; contextual relevance does not start (§2–3) | 16: [intent resolution](../../src/lib/extensions/intent.ts), chat `routeToolQuestion` | intent/chat/workflow-api regressions; tool-choice has one classification, zero pre-choice roots and one chosen synthesis. Empty registry preserves ordinary chat. |
| Equal built-in/imported candidates; top-level/helper ambiguity; one root (§2–3; cycle3) | 10,16,18: [choice store](../../src/lib/extensions/choice-store.ts), [host actions](../../src/lib/workflows/host-tools.ts) | intent/helper choice races and R39 captured candidate/branch identity tests. Production chooser uses two fixture tools; builtin/imported parity is unit/API-covered, not a live mixed-engine result. |
| Supporting skills share authorization/limits (§2–4) | 3,10,18: [agent loop](../../src/lib/workflows/agent.ts), [usage](../../src/lib/workflows/usage.ts) | same-root immutable graph, two parallel strands, no nested batch;26-model+2-command scripted review fits30-call default. **Not real command/scientific acceptance.** |
| GitHub/folder/ZIP inspection and reviewed adaptation (§2–4; cycle1–2) | 7,11,15,18,19: [acquire](../../src/lib/extensions/acquire.ts), [inspect](../../src/lib/extensions/inspect.ts), [imports API](../../src/app/api/tools/imports/route.ts) | adversarial bounded archives/resources, actual validators plus exact fail-closed fixture GitHub transports; real public/private GitHub transport acceptance **OPEN**. |
| Opt-in installed-agent discovery; selected immutable snapshot; no execution (§2–3; cycle2) | 12,15,19: [discovery](../../src/lib/extensions/discovery.ts), [agent locations](../../src/lib/extensions/agent-locations.ts) | Codex/Claude/custom fixtures, consent/revocation/expiry/duplicate origins; production selected fixture import. Actual user agent homes not scanned. |
| Managed dependencies/external accounts; readiness differs from import (§2–4) | 8–9,11,15: [setup](../../src/lib/extensions/setup.ts), [connections](../../src/lib/extensions/connections.ts), [broker](../../src/lib/extensions/network-broker.ts) | lock/secret/profile/redirect and interrupted setup fixtures; production needs-setup/unsupported display. Actual install/CLI/broker on supported host **OPEN**. |
| Full active-profile research read, other profiles/secrets excluded (§2, §4; cycle9) | 1–2,8,10,19: [research view](../../src/lib/workflows/research-view.ts), [canonical context](../../src/lib/workflows/context.ts), [vault boundary](../../src/lib/server/vault.ts) | sanitized research/chat/project projection; symlink/private path/read guards; actual authenticated profile switch gives foreign404/stale409. Runtime ownership remains captured. |
| Automatic run outputs, source types/links, safe downloads (§2–3; cycle8) | 6,11,17–19: [artifacts](../../src/lib/workflows/artifacts.ts), [ToolArtifacts](../../src/components/tools/ToolArtifacts.tsx) | hash/owner/media/path validation; native reports/papers/BibTeX; synthetic linked result. Real acquisition/full-text/bibliography correctness **OPEN**. |
| Explicit wiki intent, atomic validated changesets and Undo (§2–4; cycle8) | 6,14,17,19: [wiki-save](../../src/lib/workflows/wiki-save.ts), coordinator completion trigger | outputs_only inert; authorized update/save journals and response-loss reconciliation; new-only artifact selections R46; actual save/read/History Undo routes. No human wiki writes. |
| Local runtime continues without observers; no cloud (§2–4; cycle5) | 4–5,17,19: [coordinator](../../src/lib/workflows/coordinator.ts), [observation client](../../src/lib/workflows/client.ts), [instrumentation](../../src/instrumentation.ts) | actual browser close/relaunch, leave/return and streamed production partial text; no duplicate synthesis. Runtime must stay running. |
| Captured model/tier overrides; incompatible/unknown-price setup; no silent provider change (§2–4) | 3,9,14–19: [model capture](../../src/lib/workflows/model.ts), [native adapters](../../src/lib/extensions/native-adapters.ts), [ToolSettings](../../src/components/tools/ToolSettings.tsx) | API and subscription accounting adapters exercised with fixtures; foreign-profile overrides and missing provider blocked; real API/Codex/Claude Code compatibility **OPEN**. CLI dollars remain null. |
| Manual updates/notification, rollback, immutable active versions (§2–4; cycle9) | 7,13,15,19: [version management](../../src/lib/extensions/versions.ts) | update/check/consent/publication rollback tests; actual manual update during observed run preserves old package/ticket. Latest per-version preferences restore separately from immutable History/run captures (F4). |
| Profile enabled/settings/model separation (§2; cycle9–10) | 2,13,15,19: profile-state, ToolSettings, [profile-isolation E2E](../../e2e/tool-profile-isolation.spec.ts) | authenticated session/routes, captured fast/strong roles and run allowance; disabled tools preserve History/core functionality. |
| Curated catalog/user imports; no auto import/enable from browsing (§2–3) | 11,15,18: [native catalog](../../src/lib/extensions/native-catalog.ts), [pinned review catalog](../../src/lib/extensions/catalog/literature-review.ts) | imported-literature-review production catalog test proves exact OpenCite prerequisite and only root enablement. Marketplace/ratings/publishing deferred. |
| Safe restart; no uncertain replay; explicit recovery (§2–4; cycle6,9) | 4,14,17,19: coordinator, [journal](../../src/lib/workflows/journal.ts), [native bridge](../../src/lib/server/native-workflow.ts) | actual owned Next SIGKILL/restart preserves completed input/response hashes and entire completed usage journal; uncertain synthesis holds three tickets without new invocation. Opaque native wording revisions require Stop/reconcile/new explicit revision (R41–45), not generic retry. |
| Cumulative limits/extensions, root/helpers/daily control (§2–4; cycle7) | 3–4,17–19: usage, coordinator, [recovery-actions](../../src/app/api/tools/runs/[id]/actions/route.ts) | actual positive allowance extension31 with3 cumulative attempts; retry-generation/receipt-loss concurrency tests R42. New chat does not reset allowance; unknown API price blocks monetary enforcement. |
| Failure/cancellation/missing dependency/unavailable model (§3–4; cycle9) | 8–10,13–14,17–19: sandbox/setup/host/coordinator | fail-closed command readiness, missing provider zero dispatch, owner/cancellation/reconciliation regressions. Local executor termination does not prove a non-cooperative remote provider stopped (R49). |
| Native workflows preserve source checks/reservations/results/routes (§1,§6) | 14,17,19: native adapters, [legacyReviewAction](../../src/lib/server/native-workflow.ts) | core6 then fresh native2; explicit new top-level brief approval before any model/research call; shared native controls without duplicate blocks. Generic `startRun` rejects action/reviewId; only validated server bridge calls `startPreparedNativeReview` (R57–58). Helpers retain parent authority. |
| First OpenCite and multi-skill scientific cycle (§5–6) | 11,18–20: OpenCite adapter, review graph, [live harness](../../src/lib/extensions/__tests__/live-workflow.test.ts) | locked originals/host binding and invented six-paper/two-strand claim/passage/coverage fixtures. Supported-host worker/install/CLI/broker, real OpenCite/source and provider/human claim audit **OPEN**; entire phase acceptance is not complete (R31). |
| Current design/rounded content, Markdown/streaming/citations/accessibility (§8) | 15–19: existing components/tokens, [design contract](../../design.md) | settled desktop/phone production screens and core browser regressions; no redesign. F1–F6/M1–M3 are addressed in the consolidated fix wave above; the single scoped re-review passed. |

## Task commits and reviewed validation

Actual Git history from the base through Task19 has exactly one amended commit per task. The per-task final full-suite counts below are passed/skipped, not live passes. Source/test links identify the task-owned integration surface; later corrections are described in the [historical evidence](artifacts/modular-workspace-2026-10-05/historical-evidence.md), [review ledger](artifacts/modular-workspace-2026-10-05/task-review-summary.md), and complete [R1–R79 decisions with costs](artifacts/modular-workspace-2026-10-05/decisions.md).

| Task | Reviewed final commit | Deliverable / primary regression | Final full suite |
| --- | --- | --- | --- |
| 1 | `7ca670eac66e81dbb7c6561f76c5473ce303313c` | contracts/private state; [store.ts](../../src/lib/workflows/store.ts), [store.test.ts](../../src/lib/workflows/__tests__/store.test.ts) | 2737/19 |
| 2 | `ba2fb4fc89c5afabfc8670bcc676719e7094983e` | new/legacy profile migration; [profile-state.ts](../../src/lib/extensions/profile-state.ts), [profile-state.test.ts](../../src/lib/extensions/__tests__/profile-state.test.ts) | 2750/19 |
| 3 | `5abbd9a0e6e6f4fc8d922f97cbb41f561849c662` | captured tiers/reservations; [usage.ts](../../src/lib/workflows/usage.ts), [usage.test.ts](../../src/lib/workflows/__tests__/usage.test.ts) | 2767/19 |
| 4 | `64e50f6b9e94feb0f1a3d328e12bfdcc6e55033e` | coordinator/journal recovery; [coordinator.ts](../../src/lib/workflows/coordinator.ts), [recovery.test.ts](../../src/lib/workflows/__tests__/recovery.test.ts) | 2808/19 |
| 5 | `ad84279dcb8c0483198a7a3dba6e56e746e6c3d8` | authenticated observation/actions; [workflow-api.ts](../../src/lib/server/workflow-api.ts), [workflow-api.test.ts](../../src/lib/server/__tests__/workflow-api.test.ts) | 2833/19 |
| 6 | `da1d4bf20cb17b4258547cce0da1e9a77505f3a8` | artifact ownership/wiki save/Undo; [wiki-save.ts](../../src/lib/workflows/wiki-save.ts), [artifacts.test.ts](../../src/lib/workflows/__tests__/artifacts.test.ts) | 2866/19 |
| 7 | `4acddfb6e4295829d1c014649fe3e647aa46ce56` | bounded immutable import/resource closure; [inspect.ts](../../src/lib/extensions/inspect.ts), [imports.test.ts](../../src/lib/extensions/__tests__/imports.test.ts) | 2927/19 |
| 8 | `288b061cf618468c6ce6c0a92b9aead5ddb48b91` | command isolation fail-closed; [sandbox.ts](../../src/lib/extensions/sandbox.ts), [sandbox-platform.test.ts](../../src/lib/extensions/__tests__/sandbox-platform.test.ts) | 2948/20 |
| 9 | `8872473a01d96e31a314a0988586fa9b451dac64` | locked environments/connections; [setup.ts](../../src/lib/extensions/setup.ts), [setup.test.ts](../../src/lib/extensions/__tests__/setup.test.ts) | 2968/20 |
| 10 | `a07cc2dfefa26f2f7362790ba135ecfe8cebcff6` | host-controlled root/helpers; [host-tools.ts](../../src/lib/workflows/host-tools.ts), [agent.test.ts](../../src/lib/workflows/__tests__/agent.test.ts) | 2990/20 |
| 11 | `a6854958ef9b87f44f03dcb12abd92cd8958e68a` | OpenCite adapter/normalization; [opencite-adapter.ts](../../src/lib/extensions/catalog/opencite-adapter.ts), [opencite.test.ts](../../src/lib/extensions/__tests__/opencite.test.ts) | 3003/21 |
| 12 | `dad810fda99d5f98fea728d179414591c36ab6ec` | consented discovery; [discovery.ts](../../src/lib/extensions/discovery.ts), [discovery.test.ts](../../src/lib/extensions/__tests__/discovery.test.ts) | 3026/21 |
| 13 | `cffa77d10bdd9fe4ccb6fbdaf7af17a6efad0453` | updates/pins/rollback/removal; [versions.ts](../../src/lib/extensions/versions.ts), [versions.test.ts](../../src/lib/extensions/__tests__/versions.test.ts) | 3051/21 |
| 14 | `de814c378fecf1af8422c3401f8667cac68a9a5a` | native adapters/entry guards; [native-adapters.ts](../../src/lib/extensions/native-adapters.ts), [native-adapters.test.ts](../../src/lib/extensions/__tests__/native-adapters.test.ts) | 3101/21 |
| 15 | `a615d46bf01918fa26b187e2e139e7cf1a86565e` | Tools/import/settings/sidebar; [ToolsLibrary.tsx](../../src/components/tools/ToolsLibrary.tsx), [ToolsLibrary.test.tsx](../../src/components/tools/__tests__/ToolsLibrary.test.tsx) | 3123/21 |
| 16 | `06a5de89968e717e00c5e7642684a905bca96d1f` | intent/chooser idempotency; [choice-store.ts](../../src/lib/extensions/choice-store.ts), [intent.test.ts](../../src/lib/extensions/__tests__/intent.test.ts) | 3165/21 |
| 17 | `13ce70fac5f9b4dc6c6b3fa67a53fc460bcf1a99` | shared run/History/native report/recovery; [ToolRunView.tsx](../../src/components/tools/ToolRunView.tsx), [ToolRunView.test.tsx](../../src/components/tools/__tests__/ToolRunView.test.tsx) | 3239/21 |
| 18 | `74dfba3c0de4740bba2eb506b143358820d423e8` | pinned multi-skill review/parallel/artifact reads; [literature-review.ts](../../src/lib/extensions/catalog/literature-review.ts), [literature-review.test.ts](../../src/lib/extensions/__tests__/literature-review.test.ts) | 3270/24 |
| 19 | `d1a4e1c8994ed411b2b7a9373bde4757fceeebd7` | production navigation/restart/native approval; [run-playwright.mjs](../../scripts/run-playwright.mjs), [tool-restart.spec.ts](../../e2e/tool-restart.spec.ts) | 3291/24 |
| 20 | `96d0785d96ba19f662ca3d8b4a6148f84d24f434` | Documentation, requirement map, gates and durable evidence; local links/whitespace/hash inspection | Reuses 3291/24; no code changes |

Task20 committed as `96d0785d96ba19f662ca3d8b4a6148f84d24f434` and its task review is preserved in the consolidated evidence. The broad final review completed with F1–F6/M1–M3; the single scoped re-review of code commit `fbb86dd093dee2af9fb3aaf9b452e4aa3244a8ce` passed; the later amendment changes documentation/evidence only.

## Setup, platform and transport limits

Node>=22.12 is required by the exact-pinned sandbox runtime0.0.78; the validation host used Node24.3.0 and Next16.3.2/React19.2.4. Native/core research uses existing provider connections. Imported commands require a successful **actual** isolation probe plus prepared locked environment and explicit connections. OpenCite uses managed Python3.12 and its hash lock; its executable wheel targets manylinux_2_28_x86_64. A successful metadata import, virtualenv, fake probe or fixture process does not establish portability.

The [current macOS probe](artifacts/modular-workspace-2026-10-05/platform/macos-sandbox.json) passed several filesystem/network/argv bounds but failed child-tree cancellation, parent IPC loss, detached-child ownership and normal-exit descendants. It reports unsupported, including unavailable kernel process ownership. Imported commands remain unavailable on this Mac. Linux and Windows have not been run. Codex and Claude Code are first-class code paths with explicit engine setup/sign-in; their real worker/model executions were not accepted here. No silent paid API substitution is permitted.

The real production Next kill/restart is distinct from command isolation: [process actions](artifacts/modular-workspace-2026-10-05/runtime/restart-process.jsonl), [server log](artifacts/modular-workspace-2026-10-05/runtime/restart-server.log.gz), [exact retained checkpoint/usage hashes](artifacts/modular-workspace-2026-10-05/runtime/restart-integrity.json), [provider invocation fixture log](artifacts/modular-workspace-2026-10-05/runtime/provider.jsonl), [source/GitHub fixture log](artifacts/modular-workspace-2026-10-05/runtime/source.jsonl), and [fresh profile no-start evidence](artifacts/modular-workspace-2026-10-05/runtime/fresh-profile.json) retain the distinction. Fixture transport matches exact test-owned requests and rejects unmatched traffic. No live provider, actual installed-agent scan, real research source, human profile/vault/key, install, push/merge/PR occurred. No fixture settings or session cookies are archived.

## Historical Task19 production screenshots

These four copied originals were visually inspected after preservation. They show settled real production UI with synthetic evidence, not real scientific sources. The old chooser duplication, import IDs and SKILL.md headings show the pre-fix state; current captures appear in the consolidated section above.

| Required capture | Evidence |
| --- | --- |
| Empty profile Tools | [Empty Tools](artifacts/modular-workspace-2026-10-05/screens/empty-tools.png) |
| Ambiguous Sparky choice | [Chooser](artifacts/modular-workspace-2026-10-05/screens/chooser.png) |
| Active run after leave/return | [Active after navigation](artifacts/modular-workspace-2026-10-05/screens/active-after-leave.png) |
| Completed source-linked results | [Completed result](artifacts/modular-workspace-2026-10-05/screens/completed-source-linked.png) |

[Modular11 log](artifacts/modular-workspace-2026-10-05/browser-logs/browser-r57.log.gz), [core6 log](artifacts/modular-workspace-2026-10-05/browser-logs/core-r57.log.gz), [fresh native2 log](artifacts/modular-workspace-2026-10-05/browser-logs/fix1-native-browser.log.gz) and their [acceptance metadata](artifacts/modular-workspace-2026-10-05/acceptance/modular.json), [core metadata](artifacts/modular-workspace-2026-10-05/acceptance/core.json), [native metadata](artifacts/modular-workspace-2026-10-05/acceptance/native-fix1.json) retain current scopes. Initial core/setup failure logs are retained to explain R56/R57 fixture/approval corrections; they are superseded by passing current gates.

## Remaining acceptance and review handoff

1. **OPEN supported-host execution:** actual isolated command lifetime ownership, install, locked OpenCite CLI and authenticated broker; Linux/Windows compatibility unrun, macOS unavailable. No unrestricted fallback.
2. **OPEN real retrieval:** real OpenCite search, accessible full text/conversion and BibTeX with zero model attempts; separate from model synthesis and from deterministic GitHub/source fixtures. Additional OpenCite sources, DOI/canonical lookup, enhanced conversion/PDF figure review and optional GitHub/LaTeX are unadapted.
3. **OPEN engine/provider acceptance:** explicitly selected API/Codex/Claude Code with captured models, real setup/authentication and cumulative allowance. No paid/provider live call is authorized by this report.
4. **OPEN scientific acceptance:** every claim in the small real imported review checked by a human against exact validated source passages; requested accuracy/cost comparison coverage and unsupported clinical comparison disclosed. The 26-model+2-command pinned fixture calibrates orchestration only.
5. **OPEN real remote import transport:** public/private GitHub success with current exact revision/authentication; fixture validators/redirect guards do not prove live transport or human installed-skill compatibility.
6. **PASSED single scoped re-review:** F1–F6/M1–M3 fixes, regressions and evidence passed at the code-reviewed commit. The original [review handoff](artifacts/modular-workspace-2026-10-05/review-handoff.md) is historical; R60–R79 explicitly adjudicate declined items and costs. The subsequent amend only records the completed review and finalizes evidence.

The [live-check protocol](modular-workspace-live-check.md) defines exact opt-in gates, canonical disposable roots, pinned graph, selected engine/provider/model, nonsecret allowance and key-in-memory-only binding, retained ledger and human audit. Preserve the same root/operation/model/caps across retries; never reset an allowance to manufacture acceptance. All 79 chronological rulings/costs, including superseded R21 and R56–58, survive in [decisions](artifacts/modular-workspace-2026-10-05/decisions.md). [SHA256 manifest](artifacts/modular-workspace-2026-10-05/SHA256SUMS) binds preserved artifact bytes; scratch removal is controller-owned after final review.

Task20 local Markdown links, copied JSON/logs/images and manifest are checked; documentation-only `git diff --check` is clean. The unfiltered final staged branch comparison has only R53's two verbatim upstream trailing spaces: `src/lib/extensions/catalog/literature-review/lit-review/references/rigor-checklist.md:70` and `src/lib/extensions/catalog/literature-review/host/lit-review/protocol.md:625`. No broad whitespace ignores are added.

R59 preserves all 19 accidentally tracked Task12 controller report/log files losslessly under [task12-scratch](artifacts/modular-workspace-2026-10-05/task12-scratch/task-12-report.md.gz), with original repository paths, byte sizes and SHA256 in the [raw-output index](artifacts/modular-workspace-2026-10-05/raw-output-index.json). Only those exact index entries are removed from the delivered tree; their unchanged local originals remain in the controller workspace until final-review cleanup. Other plan workspaces are untouched. The [pre-cleanup raw output](artifacts/modular-workspace-2026-10-05/branch-diff-check-before-r59.txt.gz) retains the original 29 scratch diagnostics plus two R53 lines. The **unfiltered** [final raw whole-branch check](artifacts/modular-workspace-2026-10-05/branch-diff-check.txt.gz), comparing the staged delivery tree against the base, reports exactly the two R53 occurrences. No filtered comparison replaces the final raw check; no broad ignore or source edit is used.

Local preservation checks resolve every local Markdown/image link, parse all copied JSON records, verify every compressed raw-output hash and the full artifact manifest; all four PNGs were visually inspected. Exact amended counts are recorded in the Task20 report. The manifest covers every durable artifact except itself.
