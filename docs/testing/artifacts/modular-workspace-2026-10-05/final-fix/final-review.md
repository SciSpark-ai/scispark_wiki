# Final whole-branch review

**Verdict: not ready to merge.** One P1 and five P2 findings need one consolidated fix wave, followed by the authorized scoped re-review. Three P3 groups are also actionable. No Critical finding was established. The positive offline/runtime evidence does not close real execution or scientific acceptance.

Reviewed range: `435afcd886d810b66258aaae83734c5868f721cf..96d0785d96ba19f662ca3d8b4a6148f84d24f434`. This is the single broad review requested by the controller, using the supplied complete diff in bounded passes, current source, spec, master and three implementation plans, final handoff/global context, architectural/brand contracts, and retained testing evidence. Controller rulings were considered as decisions with costs, not exemptions from user expectations. No source, index, HEAD, or branch changes were made. Only this report and named reviewer scratch probes/logs were written in the plan workspace. No subagents, live network/provider/source/install calls, human data, or green-suite/build reruns were used.

## What is strong

The branch has substantial defenses at the important trust boundaries: profile/vault ownership checks, consent-bound installed-agent discovery, pinned package/dependency identity, host-owned tool authority, private settings redaction, fail-closed command isolation, bounded broker access, immutable captured run configuration, reservations before paid dispatch, reconciliation of unknown attempts, and explicit artifact selection for undoable wiki saves. Durable event/checkpoint/artifact ownership is much stronger than a browser-held job model. The core shell still presents Home, Sparky, Wiki, Graph, Projects and shared History while optional tools are profile-bound. The four final master images retain the existing cream/orange/type brand; empty Tools is understandable and the final synthetic report is labeled honestly.

The retained checks are valuable: 3,291 passed / 24 skipped, type-check clean, lint clean except the documented baseline warning; production and acceptance builds; modular/core browser checks and the later affected native checks. The production SIGKILL/restart and browser close/relaunch evidence verifies persistence against recorded IDs, hashes and usage. These are retained controller results, not checks rerun by this review.

## Important findings

### F1 — P1: ordinary and curated imported tools cannot consume the normal Tools/Sparky request

**Primary location:** `src/lib/extensions/intent.ts:80–82`.
**Other evidence:** `src/lib/extensions/inspect.ts:292`; `src/lib/extensions/catalog/literature-review.ts:28`; `src/lib/extensions/catalog/opencite.ts:11–16`; `src/lib/workflows/agent.ts:42`.

Every non-native selected tool receives `{ question, sessionId, ...sources }`. This envelope is neither an accepted universal import contract nor the contracts of the two first-party catalog tools. Literature review permits only `question` and rejects `sessionId`; OpenCite requires `query` and rejects both `question` and `sessionId`; an ordinary SKILL import without a custom schema is inferred as an object allowing no properties at all. Once otherwise ready, these tools are rejected by their real input validators before useful execution when started through the public path. Tools selection, explicit Sparky selection and chooser selection share the same builder, so fixture workflows with permissive schemas do not prove the advertised imports can run.

**Evidence:** the scratch probes use the actual `toolRunInput`, catalog schema/graph, and actual local-folder acquisition/inspection for a plain SKILL file. All three expected-success contract checks fail. No provider, source or worker was needed. The ordinary-import reproduction printed `{ type: 'object', additionalProperties: false }` from actual inspection, not a copied test schema.

**Fix:** make the reviewed host input binding agree with these real schemas. Keep conversation/session metadata outside tool-declared arguments; define the accepted human-request input for plain instruction imports; bind OpenCite's public question to its supported query options. Preserve strict tool input and authority validation. A broad schema-form system is not required for this finding. Test normal public starts against the actual plain-import and catalog contracts rather than permissive stand-ins.

### F2 — P2: explicitly naming an unavailable tool can run a different implementation

**Location:** `src/lib/extensions/intent.ts:48–64`, particularly name matching at line 57.

Enable Evidence Atlas and Deep review, make Atlas require setup, and ask “Use Evidence Atlas to review speech.” Named invocation checks only the `ready` subset. Atlas disappears before matching, so the entire request is handed to classification with only Deep review as a candidate. A valid classifier decision can then immediately start Deep review. That violates the user's selected implementation and the spec's named-tool/no-silent-substitution expectation; it can create work and usage for a tool the user did not choose. The explicit-ref path correctly blocks an unavailable selected tool, which makes text selection inconsistent.

**Evidence:** actual resolver with an offline library fixture containing one enabled unready named tool and one ready alternative, plus a legal classifier result selecting its only candidate, returns `kind: run` for the native alternative. This demonstrates an allowed routing outcome, not a claim that a live model was observed making it.

**Fix:** resolve an affirmative exact tool name against known enabled tools before filtering readiness. If the named implementation is unavailable, return its setup/enable action or clarification; never classify the same named request into an alternative automatically. Keep ambiguous matching explicit.

### F3 — P2: visible “Saved papers only” control creates a rejected request for selected tools

**Primary locations:** `src/components/chat/ChatWorkspace.tsx:306` and `:352`.
**Related:** `:77`, `:247–250`; `src/lib/chat/orchestrator.ts:135`.

Select Idea Spark, Trending, or an imported tool. Because only Find papers and Deep review use source-index scope, the composer still exposes the core discussion `SourcesToggle`. Turn on Saved papers only and submit. The client sends both `explicitTool` and `readSourcesOnly: true`; the server correctly rejects this with “Choose a tool or a saved-paper discussion scope.” An ordinary supported UI interaction therefore cannot submit. Selecting a tool initially resets the toggle, but users can turn it back on afterward, in both the empty and existing conversation layouts.

**Evidence:** the focused probe submits that actual UI-produced request through `askChat` and fails at the existing parser guard before any tool/model dispatch. This is a client/server affordance mismatch, not a server authority bypass.

**Fix:** hide/disable the discussion-only scope for selected tools, or make choosing discussion scope explicitly clear the selected tool and visibly return to discussion. Preserve the server guard and the advertised tool research-context authority. Cover both composer layouts.

### F4 — P2: restoring a tool version silently resurrects obsolete allowance/settings

**Locations:** `src/lib/extensions/versions.ts:54–59` and `:330–334`; user action `src/components/tools/ToolSettings.tsx:70`.

Version history keeps the *first* captured override for each digest forever. After v1 is captured with a $5 cap, update to v2, restore v1, deliberately save a $1 cap on v1, switch away and restore v1 again. The restored cap becomes $5. Later explicit settings, including a reduced spending allowance, are silently discarded by a button labeled only “Restore version.” Immutable package retention does not justify treating an obsolete configuration snapshot as the user's current per-version preference without disclosure.

**Evidence:** actual disposable local import, reviewed update, discovery grant, binding mutations and rollback flow; no management helper was mocked. The probe logs the restored cap as 5 and fails the expected cap of 1. This elevates the Task13 deferred minor because it changes enforceable spending/settings semantics.

**Fix:** preserve the latest explicitly saved configuration for a version, or version the configuration snapshots and make restoration of a particular historical configuration an explicit, visible choice. Do not silently increase the effective allowance on package restoration. Retain old immutable snapshots for existing runs and audit/recovery.

### F5 — P2: a command paused before dispatch cannot Continue because its directories already exist

**Location:** `src/lib/extensions/sandbox.ts:207–227`.
**Related:** `src/lib/workflows/journal.ts:171–180,211–215`.

On a host whose real sandbox probe passes, command dispatch creates invocation output/temp directories with `recursive: false` before reserving command/time allowance. If the remaining allowance cannot cover the invocation, `reserveAttempt` throws `WorkflowLimitError` before launch. The journal correctly records this step as `not_started`. Extending the allowance and continuing retries the same invocation identity, but the first `mkdir` now throws `EEXIST` before reservation/launch. The user is stranded or sent into failure/reconciliation even though that command never ran. A normal no-dispatch limit pause must be resumable without acknowledging uncertain execution.

**Evidence:** direct deterministic source ordering: directory allocation at 209–210, reservation at 227, launch at 231; limit reset at journal 211–215 retains identity and does not remove directories. No command cleanup exists in that pre-dispatch failure path. This is a source-proven ordering defect conditional on supported isolation, **not** a claim that a real supported worker was run in this review. macOS isolation remains unsupported in the retained evidence.

**Fix:** make pre-dispatch directory preparation idempotent only for a provably undispatched attempt, or move allocation into a durable preparation/dispatch sequence that can distinguish unused directories from uncertain prior execution. Do not blindly reuse command outputs or turn opaque commands into replay-safe work. Add a focused limit-before-command → extend → Continue test that preserves one eventual dispatch and cumulative accounting.

### F6 — P2: the first-party OpenCite paper artifact has no usable in-app paper preview

**Location:** `src/components/tools/ToolArtifacts.tsx:38–40`.
**Producer:** `src/lib/extensions/catalog/opencite.ts:43–60`.

OpenCite publishes a `papers` artifact containing its normalized array of title, authors, DOI, URL, abstract, access and source references. The renderer accepts only the native SearchResult object or a native message block. The actual first-party array always falls back to “This paper export is available as a download.” Thus a successful OpenCite run/helper result cannot show its recognized papers or their abstract/full-text distinction in Results; users must download JSON. This remains relevant when OpenCite is invoked as a supporting tool after F1 is fixed.

**Evidence:** the real producer's emitted JSON shape and both renderer branches are incompatible. Existing final master screenshot exercises Markdown, not this paper contract. This is a format integration finding, not a claim about live source retrieval.

**Fix:** render the validated OpenCite normalized paper shape, or explicitly normalize it to a shared supported presentation DTO while preserving per-paper access/source information. Do not force invented native search scores/plans into the data. Add one producer-to-renderer test using the actual normalized output.

## Minor findings and complete deferred-item dispositions

**M1 — P3: expose human tool names and concise, actionable setup/usage copy.** `ToolRunView.tsx:102–103` and `HistoryPageClient.tsx:203` display `skillId`, so distinct imported runs are all titled `SKILL.md` despite retained human names. The active/completed master images reproduce it. Resolve the captured manifest's safe display name (with a fallback if missing), retaining immutable identity in details. Subscription runs should say that dollar cost is not reported by that engine and that call/time limits still apply; “Dollar usage unavailable” alone is unhelpful. Catalog/import/setup summary text should use supporting-tool names, place technical IDs/protocol detail behind disclosure, and expose a safe specific next step instead of a circular “Review required setup in Manage.” `extensions/observation.ts:31–37` currently erases the blocker category. Do not expose raw secret-bearing errors. The chooser should have one prompt rather than repeating the same sentence at message/card levels.

**M2 — P3: report why requested full text is unavailable without increasing the transport cap casually.** The bounded wrapper (`catalog/opencite/scispark-opencite-v1.py:53–68`) and normalized document envelope (`catalog/opencite.ts:39,52–58`) collapse absent location, broker/policy denial, size, retrieval and conversion outcomes. A paper can retain a valid PDF when conversion fails; preserve that distinction instead of inventing text. Use a bounded safe reason enum and display it. The 512 KiB PDF limit is intentionally coupled to base64 expansion and the 2 MiB command envelope; changing it requires validating that whole envelope. No arbitrary cap increase is requested.

**M3 — P3: correct the Tools-origin conversation-History claim.** `docs/FEATURE_GUIDE.md:121–126` says the question, brief, sources, progress and reports remain in conversation History automatically after either Sparky or Tools start. A standalone Tools-origin native review can lack `sessionId`; shared History/run history is the durable destination, with an optional conversation link. Make that distinction. This does not require manufacturing a conversation for every run.

| Deferred item | Final disposition |
|---|---|
| Task8 dense sandbox journal/probe ordering | Real ordering issue elevated to F5. Other density is maintainability debt; no wholesale sandbox refactor requested in this fix wave. |
| Task11 collapsed full-text reasons and 512 KiB bound | M2. Keep the bounded transport unless the complete envelope is deliberately revalidated. Live retrieval quality remains open. |
| Task13 first-captured overrides | Elevated to F4 based on actual restored allowance, not accepted as an innocuous snapshot convention. |
| Task14 dense native continuation/recovery transitions | Maintainability debt. Existing durable/native fixes and retained gates provide useful evidence; no additional concrete defect established in this pass. Keep any fix wave local to findings. |
| Task15 technical catalog/setup/dependency copy | M1. Actual generated identifiers dominate the phone import summary; replace summaries with human names and disclose technical details. |
| Task15 phone orphan/wrapping | Residual visual polish under M1. Inspected retained disposable `supporting-import-phone.png`: contained/no horizontal overflow, but long identifier wraps and “Supporting tool: Literature connection / helper” leaves an avoidable trailing word. Use available width/intentional wrapping and inspect the affected phone view after the narrow copy change. No redesign. |
| Task15 dense ToolSettings/import mutations | Maintainability debt; no independently reproduced mutation-loss defect apart from the separately reported restore semantics. |
| Task15 absent-preference legacy-favorites assertion | Test-evidence gap, not a proven migration regression. Add a focused missing-preference assertion if that code is touched; do not claim this case specifically tested from present coverage. |
| Task16 dense authority/accounting/helper logic | Maintainability debt; F1/F2 capture concrete integration issues. The already fixed empty/pending query concern is closed and is not reopened. |
| Task17 raw root/History titles and subscription copy | M1, both remain visible/current. |
| Task18 verbose catalog and prerequisite/import desktop/phone copy | M1. Current catalog source and retained phone import corroborate the summary concern; original prerequisite-specific captures are retained controller evidence, not a newly run browser check. No horizontal-overflow defect asserted. |
| Task19 duplicate chooser prompt/generated IDs/raw title | M1, confirmed in chooser/master images and source. |
| Task20 FEATURE_GUIDE conversation-History assertion | M3. |
| Closed Task1→5 history reads, Task5 null-DTO→17, Task16 empty query, Task17 legacy brief dedup, Task18 duplicate claim fixture | Remain closed on current evidence; no finding resurrected from superseded reports. |

M1–M3 do not independently justify blocking merge at P1/P2 severity, but should be explicitly resolved or consciously retained by the controller, not silently marked complete. The substantive F findings already require changes.

## Focused review evidence

All reviewer files are retained under `/Users/tongshan/Documents/SciSpark_paper_manager/.superpowers/sdd/2026-10-05-modular-workspace/`. From `/Users/tongshan/Documents/SciSpark_paper_manager`, the exact executed commands were:

```sh
./node_modules/.bin/vitest run --config .superpowers/sdd/2026-10-05-modular-workspace/final-review-repro.config.mts > .superpowers/sdd/2026-10-05-modular-workspace/final-review-repro.log 2>&1
./node_modules/.bin/vitest run --config .superpowers/sdd/2026-10-05-modular-workspace/final-review-repro.config.mts -t 'ordinary SKILL' > .superpowers/sdd/2026-10-05-modular-workspace/final-review-ordinary-import.log 2>&1
```

Both exited 1 as expected for reviewer red probes. The first ran before the ordinary-import case was appended; the second ran only that newly added case. Their exact results are distinguished below.

- `final-review-repro.test.ts` and `final-review-repro.config.mts` are review-only scratch, not new project tests.
- `final-review-repro.log`: five deliberately red expectations, covering the two curated F1 contracts and F2/F3/F4. 231 ms test execution; no live calls. F3 fails at the real parser (not by silently bypassing tool selection); the probe's initial title says “discard,” but the observed defect is the explicit server rejection documented above.
- `final-review-ordinary-import.log`: actual plain SKILL inspection/contract probe fails, 33 ms. Five other scratch tests were filtered out in this second targeted run; those skips are not the project's 24 gated skips.
- F5/F6 are source-traced contract/order findings, not falsely labeled live runtime repros.
- Four final master images were inspected. One retained disposable supporting-import phone image was additionally inspected for the deferred copy concern. No user vault, settings, key or installed-agent home was opened.
- `git status --short` was empty after the probes; scratch is ignored. No green suites/builds were rerun.

## Declined to judge

This list records every considered behavior set aside from an additional defect/acceptance claim, with the reason. It is not an assertion that untested behavior works.

1. **Actual Linux/Windows/macOS command compatibility and descendant termination:** only retained macOS evidence is available and it fails closed as unsupported; Linux/Windows were not executed. F5 is still actionable source ordering conditional on readiness. No worker success is inferred from mocks or CI configuration.
2. **Real managed installation, Codex/Claude CLI model behavior, authenticated connection broker, live OpenCite/full-text/source/provider/private-GitHub access:** not authorized and not run. Pinned bundles and offline fixtures are not proof. These are open acceptance obligations, not silently waived scope.
3. **Real installed-agent discovery compatibility:** consent/lifetime/ownership code was reviewed and disposable fixtures used; no human agent home was scanned. Actual host layouts and agent integrations remain unverified.
4. **Scientific/clinical validity of generated literature claims:** synthetic source/provider outputs and claim fixtures establish orchestration and bounded evidence availability only. No real-source factual/claim audit or human acceptance occurred; no scientific success is asserted.
5. **Absolute absence of secret leaks, filesystem races or sandbox escapes:** reviewed guards are substantial, but no adversarial platform campaign or concurrent hostile filesystem mutation test was authorized/performed. No speculative escape is reported as a defect; no security certification is implied.
6. **Physical cancellation of remote paid requests after dispatch:** durable stopping/unknown usage behavior and retained accounting evidence are useful. A cancelled observer or acknowledged local owner cannot prove the remote service stopped billing; no live cancellation/billing experiment was run.
7. **Conservative process-owner/PID-reuse and unknown-attempt recovery:** fail-closed reconciliation can require human attention. Without evidence of a normal reproducible permanent lockup beyond F5, this is not promoted to another defect and must not be “fixed” with unsafe automatic replay.
8. **Ordinary native readiness versus full provider/model preflight:** some observation paths return ready after model resolution and later admission/setup can still fail. This review reports the demonstrable routing/control mismatches; it does not infer a working live provider from a ready label. Specific safe setup copy is M1. No separate P2 was established.
9. **Very large vault inventory/model-context admission:** bounded context may reject an unusually large inventory, but no concrete supported input or user scenario was reproduced. No unbounded-context redesign is requested.
10. **Every removal/disable plus pending native-review approval/revision permutation:** captured runs and current authority checks were inspected, but this review did not establish all permutations by execution. No new “let tasks finish” regression is asserted without a concrete contradiction; retained native browser evidence covers its specified cases only.
11. **Exact platform/phone behavior outside the retained captures:** the inspected captures support preserved brand and the copy issues, not universal responsive/accessibility acceptance. Task18 prerequisite screenshots are controller evidence; no new screenshot execution was performed. No speculative overflow finding.
12. **Absent-preference legacy favorites migration:** noted test gap above; no failing migration reproduced. Existing explicitly closed legacy fixes were not re-litigated.
13. **Dense implementations in Tasks8/14/15/16:** considered maintainability risks; only concrete boundary/order defects are elevated. Broad refactoring would exceed the focused corrective wave and risk the verified durability behavior.
14. **Retention/no garbage collection of package/environment/import staging and old run data:** current intentional retention favors audit/recovery. No storage-exhaustion event was reproduced, and destructive cleanup is not an appropriate review fix.
15. **Larger PDFs or successful text conversion for every downloaded PDF:** transport limit is deliberate; valid PDF availability differs from converted text and model-read evidence. M2 requests truthful reasons, not a speculative promise or bound increase.
16. **Exactly two upstream R53 trailing spaces and R59 index cleanup:** accepted provenance-preservation exceptions based on the supplied exact artifacts/rulings; not actionable whitespace or data-loss defects. No trimming/reindexing/source mutation was performed. This review did not rerun a broad diff check or independently decompress every archive.
17. **Other retained green suite/build/browser and live-harness gates:** audited as supplied evidence, not independently rerun. Configured gates/CI are not executed results; skipped live gates remain skipped.

## Merge and acceptance decision

Do not merge this HEAD as complete: F1 blocks the central imported-tool product path even without a real worker, and F2–F6 expose independent intent, scope, settings, continuation and output integration defects. Fix these narrowly together and scope the single re-review to those changes and relevant regressions. Do not erase schema/authority checks, relax isolation, replay uncertain commands, or broaden into an independent overhaul.

Even after those fixes, actual supported-host execution, managed installation, CLI/broker/OpenCite/provider/source compatibility and human scientific acceptance remain **OPEN**. The existing evidence supports a substantial offline-tested implementation and real durable-runtime behavior with fixture model/source results. It does not support declaring the full imports/execution/live research phases accepted. Keep the R31 cost and platform limitations visible in the release/phase decision.
