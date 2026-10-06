# Modular workspace live-check protocol

Status: **NOT RUN / NOT AUTHORIZED**. This is the gate contract, not permission to
install, spend, retrieve real sources or use human research. Current macOS command
isolation is unsupported; Linux/Windows and real API/Codex/Claude Code imported
execution remain unverified. Keep [current acceptance evidence](2026-10-05-modular-workspace.md)
open until separately authorized checks pass on a supported host.

## Exact harness and prerequisites

Both retrieval-only and provider synthesis use:

```sh
npx vitest run src/lib/extensions/__tests__/live-workflow.test.ts
```

The implementation is [live-workflow.test.ts](../../src/lib/extensions/__tests__/live-workflow.test.ts)
and its [test-owned harness](../../src/lib/extensions/__tests__/live-workflow-harness.ts).
Ordinary tests keep all real gates off. The separate `SCISPARK_TOOL_REAL_WORKER=1`
probe must establish actual supported-host isolation before setup/network/model
work. A fake readiness result, venv, fixture command or configured CI job cannot
pass this gate. Require Node>=22.12, the exact sandbox runtime0.0.78, successful
managed Python3.12/hash-locked preparation, Semantic Scholar connection, and for
provider synthesis the explicitly selected engine's real connection. CLI engines
require installed signed-in Codex/Claude Code; they never fall back to paid API.

The harness rejects normal vault/profile overrides (`SCISPARK_VAULT`,
`SCISPARK_VAULT_PATH`, `SCISPARK_PROFILE_REGISTRY_ROOT`, `SCISPARK_PROFILES_DIR`).
Do not inherit them from a development shell. Do not use the human vault, profile,
agent home, live server or real research files. The only research content here is
acquired into the marked disposable evaluation root after explicit source approval.

## Disposable identity and pinned graph

Require `SCISPARK_TOOL_EVAL_ROOT` to be an absolute, **canonical direct child of
realpath(os.tmpdir())**, named `scispark-tool-eval-*`. `/tmp` may be an alias and
is not a portable canonical root; on macOS os.tmpdir() may be a per-user T folder.
Create a new empty root only for a newly authorized evaluation. The harness writes
`acceptance-root.json` and separate `source/acceptance-marker.json` and
`provider/acceptance-marker.json`. Markers retain exact profile UUID, operation UUID,
source run UUID, connection UUID and nonsecret contract. They reject aliases,
unmarked nonempty roots and changed root/model/caps before probe/setup/network.

Within each gate, use the same profile, operation, run and ledger on every retry.
Source and provider modes have distinct retained ledgers under the **same** root;
a source-first check does not overwrite provider identity or reset spending.
Do not delete markers/journals, move to a fresh root or raise/change caps to disguise
a failed run. Resolve uncertainty with its existing actions; completed responses
stay cached. Stop and seek a separately authorized contract if a change is needed.

Both catalog packages use research-skills revision
`f0219bde233abb44d8a0c5d73f41ea27073e1493`; no floating main update. The exact graph
comes from [literature-review.lock.json](../../src/lib/extensions/catalog/literature-review.lock.json)
and [opencite.lock.json](../../src/lib/extensions/catalog/opencite.lock.json).

| Package | Skill | Version | Immutable manifest digest |
| --- | --- | --- | --- |
| `neuromechanist.opencite` | `SKILL.md` | `0.5.4-scispark.1` | `a58a9f6e1524fed39aa47e90bbd5f8307b155ce45aaef3f1c75cd5fd72a58285` |
| `neuromechanist.literature-review` | `host/humanizer/SKILL.md` | `0.2.2-scispark.1` | `d7d789b47df9dabd8904bad2f3abe19314fa12d2c75d3f7df53aba49871fe3a0` |
| `neuromechanist.literature-review` | `host/manuscript-writing/SKILL.md` | `0.2.2-scispark.1` | `ed47d124bd9917118d73bb9bca4c3d4adb954fbbff06ff71581465b0a56b8f57` |
| `neuromechanist.literature-review` | `host/paper-review/SKILL.md` | `0.2.2-scispark.1` | `69197f9da56796729c19e6e5274df9ed6997fa8ec83cf29cb7a581a462f2cb37` |
| `neuromechanist.literature-review` | `host/collection/SKILL.md` | `0.2.2-scispark.1` | `ef8e5ef0814a596c7c279ac493e4f0770e30c79e1030c631c4ac8b9d90a77df7` |
| `neuromechanist.literature-review` | `host/lit-review/SKILL.md` | `0.2.2-scispark.1` | `60e9fe2416cb769b0a0fc88a631edbb662f4a1488051b1582b64de4b71fe9ed4` |

Review bundle SHA256: `6db6871c94cdf44516df78325629b26b714f0446ce5838275dc02558b99fe4a5`.
OpenCite bundle SHA256: `46c13b76713b36b6ec68a790d3dbd9945a839b18b48bc887e2ae7ce2f2a2580c`.
OpenCite released wheel0.5.4 SHA256: `4c8266dc371cd30b894ffbfb78ea642271762cce008f783af63ac884a0dbad84`;
requirements SHA256: `bdc55065ec93f52f8f53dda16faec3dd8ae444134fedee5884267bb41d52e0b9`;
Python3.12, manylinux_2_28_x86_64 resolution. Inspect exact CLI help/config and
real managed execution on the supported host; source-text inspection did not
execute `--help`. Catalog preparation imports OpenCite first, then the five
manuscript nodes, with only `host/lit-review/SKILL.md` enabled as the root.
Dependencies retain their exact refs and share the root model/usage envelope.

## Retrieval-only gate

Authorize real worker/install/broker and public retrieval **separately** from
provider synthesis. Required nonsecret gates:

| Variable | Required value / meaning |
| --- | --- |
| `SCISPARK_TOOL_REAL_WORKER` | `1`, separate actual isolation authorization |
| `SCISPARK_TOOL_SOURCE_SMOKE` | `1`, explicit source-only authorization |
| `SCISPARK_TOOL_EVAL_ROOT` | Canonical marked disposable root above |
| `SCISPARK_TOOL_LIVE_APPROVED` | Unset or `0` for this invocation |

Bind `SCISPARK_TOOL_SOURCE_KEY` in memory to the authorized source credential;
never place its value in a command string or file. No model/provider key is needed.
Exact query: **Attention Is All You Need**, `limit:2`, `fullText:true`.
Allowance: **0 model calls**,60command calls,1800active seconds, dollar cost null.
The internal `source-only-no-model` snapshot is bookkeeping, not a Codex call.

The harness must use the actual OpenCite worker, managed environment and production
connection broker, retain papers and BibTeX, and assert zero model attempts.
For real retrieval acceptance also inspect an accessible full-text artifact and
its validated public-source provenance/conversion. The harness's papers/BibTeX
assertions alone do not prove full-text success. Preserve unavailable/access
reasons if no source is accessible; do not relabel the gate passed.

## Provider synthesis gate

No provider/model is approved by this document. The proposed bounded API envelope
is engine `api`, provider `openai`, model `gpt-5.4-mini`, both fast/strong tiers,
maximum30model calls and **$2 total per retained run** (also constrained by its
daily budget). This is the harness's existing exact scoped-price path, not a
current vendor price/quality recommendation. Before execution the user must
approve that exact envelope or supply an explicit different supported selection.
The selected nonsecret values are then frozen in the marker before any network.
The synthetic26model+2command fixture is calibration, not a guarantee real work
fits the allowance.

| Variable | Required value / meaning |
| --- | --- |
| `SCISPARK_TOOL_REAL_WORKER` | `1` |
| `SCISPARK_TOOL_LIVE_APPROVED` | `1`, explicit provider-run authorization |
| `SCISPARK_TOOL_LIVE_ENGINE` | Explicit `api`, `codex`, or `claude-code` |
| `SCISPARK_TOOL_LIVE_PROVIDER` | API only: explicit `openai`, `anthropic`, `google`, or `openrouter` |
| `SCISPARK_TOOL_LIVE_MODEL` | Explicit approved model, captured for both tiers |
| `SCISPARK_TOOL_LIVE_MAX_CALLS` | Positive safe integer, e.g.30 only after approval |
| `SCISPARK_TOOL_LIVE_MAX_USD` | API only: finite positive approved cumulative cap, e.g.2; unknown scoped price rejects before setup |
| `SCISPARK_TOOL_EVAL_ROOT` | Same retained canonical evaluation root |
| `SCISPARK_TOOL_SOURCE_SMOKE` | Unset or `0` for this invocation; source-mode evidence stays retained |

API mode binds `SCISPARK_TOOL_LIVE_API_KEY` and `SCISPARK_TOOL_SOURCE_KEY` **in
memory only**, through the test-owned exact private-settings read overlay. Disk
settings stay key-free; secret-bearing writes/artifacts/binary output are refused
with generic errors. The test uses real credential loaders/provider/broker code,
not a mocked readiness response. Do not echo environment variables or capture
secrets in fixtures, command arguments, logs, reports, commits or screenshots.
Subscription modes have explicit model/call caps, provider inferred from the
chosen engine (Codex/openai, Claude Code/anthropic), dollars null; no API key/cap
is substituted. Real subscription activity still needs separate approval.

Exact requested question (current harness; the EEG question in the interview
spec remains a broader unrun follow-up, not silently substituted acceptance):

> Compare accuracy and computational cost of Transformers and recurrent sequence
> models using at most six papers in two strands. Explicitly assess whether the
> corpus supports a comparison of clinical performance.

Start `outputs_only`, no personal context, one pinned imported review root and
its captured graph. The harness retains `acceptance/provider-run.json`, requires
completed status within cumulative model/cost limits, then requires a human audit.
A missing audit can fail after work finishes; retry with the **same contract**
reuses the same root rather than starting a fresh paid run. Paused/uncertain work
must be resolved through existing recovery controls, not hidden automatic replay.

## Outputs, human passage audit and evidence handoff

| Path relative to evaluation root | Meaning |
| --- | --- |
| `acceptance-root.json` | Canonical root owner |
| `source/acceptance-marker.json`, `provider/acceptance-marker.json` | Distinct fixed gate contracts/profile/operation/connection identities |
| `<mode>/vault/.scispark/tool-runs/<run UUID>/run.json` | Captured root, graph/model, cumulative allowance/status/artifacts |
| `<mode>/vault/.scispark/tool-runs/<run UUID>/usage.json`, `steps/`, `events/` | Retained accounting, uncertainty and checkpoint receipts |
| `<mode>/vault/.scispark/tool-runs/<run UUID>/artifacts/` | Validated source/report/paper/BibTeX bytes and hashes |
| `provider/vault/acceptance/provider-run.json` | Bounded provider result record |
| `provider/claim-audit.json` | Human audit supplied after inspecting the exact retained artifacts |
| `<mode>/runtime/` | Profile-owned package snapshots/environments, not shareable research evidence |

A human must enumerate **every scientific claim** in this small report, inspect
its cited exact passage and identify abstract-only/full-text limits, contradictory
findings, and accuracy/cost coverage. Do not infer accuracy from structured JSON,
reviewer-model approval, a source link or a completed status. Audit schema requires
`runId`, human `reviewedBy`, `method:"human-passage-review"`,
`everyClaimSampled:true`, `reportArtifactId`, exact `reportSha256`, and each
`claim`, `sourceArtifactId`, exact `passage`, `supported:true`. Set
`comparisonCoverage.accuracy` and `comparisonCoverage["computational cost"]` to
`supported`, `partial`, or `unsupported`; `clinical performance` must be
`unsupported`. Report that limitation explicitly. The harness reads every audited
report/source through owner/hash validation and fatal UTF8 decoding; changed bytes
invalidate acceptance. The human's completeness/adequacy judgment remains a
separate requirement beyond those mechanical checks.

Retain the same original ledger and outputs across retries. Report actual usage,
remaining allowance, uncertain holds and status without calling a partial review
complete. Copy only bounded validated nonsecret evidence with SHA256 labels into
a new project artifact folder before any authorized scratch cleanup; never copy
vault settings, session cookies, credentials or an entire human/runtime directory.
No automatic cleanup resets a failed gate. No wiki write, push, merge, PR or
publication is included. Gate success remains separated into actual isolation,
install/CLI/broker, source acquisition, provider compatibility and human scientific
acceptance; none has been run by Task20.
