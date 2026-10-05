# Modular Workspace Imports and Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import and execute real research skills, including OpenCite, with isolated dependencies, explicit discovery consent, stable versions and recoverable outputs.

**Architecture:** An importer produces immutable package snapshots and a resolved dependency graph. A trusted host interprets instructions through existing model providers and dispatches typed operations; separate supervised processes execute commands under an enforced filesystem/network policy.

**Tech Stack:** Existing Zod/YAML/fflate, Node processes, managed Python 3.12, exact-pinned sandbox runtime, Vitest and real disposable-process probes.

**Spec:** [Design](../specs/2026-10-05-modular-workspace-design.md); [master contracts](2026-10-05-modular-workspace.md). Requires Tasks 1–6.

## Global Constraints

Master constraints and gates apply. "Ask permission to discover and load relevant
skills already installed in Codex, Claude Code, or another agent." "Keep active
runs on their original version." Import/inspection must not execute package code.
The runtime library is an implementation choice to validate, not evidence that
third-party code is already safely supported.

## Review Focus

Archive/symlink escape (7); real process escape (8); setup-time execution (9);
undeclared tool calls and lost model responses (10); duplicate origins and new
permissions during updates (12/13). Exercise each with independent fixtures.

---

### Task 7: Bounded acquisition, manifests and dependency resolution

**Create:** `src/lib/extensions/import-contract.ts`, `src/lib/extensions/acquire.ts`, `src/lib/extensions/inspect.ts`, `src/lib/extensions/dependencies.ts`, `src/lib/extensions/__tests__/imports.test.ts`, `src/lib/extensions/__tests__/fixtures/packages/README.md`.
**Modify:** `src/lib/extensions/store.ts`; add pure import contracts to browser-purity guard.

**Interfaces:** `acquirePackage(ctx,source:ImportSource): Promise<StagedPackage>`; `inspectPackage(ctx,stage): Promise<ImportPreview>`; `resolveDependencies(manifests:ToolManifest[],selected:ToolRef[]): ResolvedPackageGraph`; `commitImport(ctx,previewId:string,selected:ToolRef[]): Promise<ToolRef[]>`. Define these schemas in `import-contract.ts`: source discriminant `github|local-folder|zip|agent`, previews with requirements/compatibility states, graph with exact refs and edges, and a setup recipe with explicit executables/argv/network requirements. Installation recipes are separate from model-facing instructions.

- [ ] Test a fixture repo with two skills, shared resources, a dependency cycle, same names from different origins, and a repo without SKILL.md:
  ```ts
  expect(preview.tools).toHaveLength(2)
  expect(resolveDependencies(cyclic, [root])).toMatchObject({ status: "blocked", reason: "dependency-cycle" })
  await expect(acquirePackage(ctx, traversalZip)).rejects.toThrow("archive path")
  expect(executedCommands).toEqual([])
  ```
  Fixtures include nested archives, drive/UNC paths, duplicate and case-folded filenames, decompression overflow, and symlinks outside the consented source root.
- [ ] Run `npx vitest run src/lib/extensions/__tests__/imports.test.ts`; expect failure.
- [ ] Implement streaming size checks and path canonicalization before extraction; preserve safe internal symlink targets as copied regular content. Recognize `SKILL.md`, `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, and `.claude-plugin/plugin.json`; preserve required relative resources. GitHub URLs resolve to a commit SHA and authenticated archive download when needed; no `git clone` hooks/submodules. Revalidate every redirect and reject private/loopback destinations. Snapshot only the selected package's reference closure, preserve notices, and hash content plus dependency locks. A user-picked package ID cannot impersonate `scispark.builtin`.
- [ ] For repos without recognized metadata, produce an editable inferred adapter proposal using the same bounded schemas; require review of its capabilities/setup plan before readiness. Unsupported requirements remain explicit. Validate schema input with bounded size/depth and Zod `fromJSONSchema`; reject external `$ref`/unsupported constructs instead of evaluating arbitrary validators. Run focused/master checks.
- [ ] Commit `feat: inspect and import versioned research packages`.

**Execution clarification:** R3: Only declared dependency capability slots with immutable eligible candidate refs can require helper choice. Genuinely undeclared helper calls reject or need setup. Persist the chosen candidate against its parent step; new installations never enter an active run graph.

### Task 8: Enforced command isolation and process ownership

**Create:** `src/lib/extensions/sandbox.ts`, `src/lib/extensions/sandbox-policy.ts`, `scripts/tool-command-worker.mjs`, `src/lib/extensions/__tests__/sandbox.test.ts`, `src/lib/extensions/__tests__/sandbox-platform.test.ts`.
**Modify:** `package.json`, `package-lock.json`, `next.config.ts` (trace this worker and pinned runtime assets), `.github/workflows/ci.yml` (separate real-platform probe job).

**Interfaces:** `probeSandbox(): Promise<SandboxReadiness>`; `runIsolatedCommand(ctx,runId,invocation:CommandInvocation,signal:AbortSignal): Promise<CommandResult>`. Define readiness as ready/needs-setup/unsupported plus probe evidence; invocation carries executable ID, argv, relative cwd, approved resource IDs and connection IDs, never raw host paths. Result includes exit status, bounded/redacted output, termination reason and reconciliation reference. Export public types in `import-contract.ts`.

- [ ] Test policy construction, child-tree cancellation, output limits, missing backend and cross-run separation. Real-process test plants sentinel files in another vault, host config and a sibling run:
  ```ts
  expect(await probeRead("other-profile-sentinel")).toBe("denied")
  expect(await probeWrite("research-snapshot/paper.md")).toBe("denied")
  expect(await probeWrite("run-output/result.md")).toBe("allowed")
  expect(await probeNetwork("loopback-app")).toBe("denied")
  ```
  The probe helpers launch the actual worker; an injected fake sandbox cannot pass this suite.
- [ ] Run `npx vitest run src/lib/extensions/__tests__/sandbox.test.ts`; expect failure before implementation.
- [ ] Verify the candidate 0.0.78 published package and integrity, pin the exact verified release, and use Node >=22.12 for this worker. If the candidate cannot be resolved, report the dependency failure; do not replace it with a floating release. Execute the runtime in one dedicated trusted worker per invocation, avoiding shared singleton policy across profiles. Implement deny-by-default research/home reads with explicit system-runtime, immutable-package and projected-research read roots; permit writes only to this invocation's output/temp roots. Keep all sockets, local app endpoints, private networks and metadata endpoints unavailable except the worker's private control channel. Require both filesystem and network probe success. Do not enable weaker isolation modes.
- [ ] Spawn argv without an application shell; any runtime-required quoting is centralized and tested. Environment construction is allowlisted, with task-specific HOME/cache paths and no inherited secrets/proxy/config variables. Commands and descendants terminate on cancellation, timeout or parent IPC disconnect; never kill an unrelated recycled PID. Add traced worker assets to the production build. Run mocked and real disposable probes, master checks and build. Unsupported/unproven OS results remain unavailable and visible; do not call a skipped probe a pass.
- [ ] Commit `feat: isolate imported tool commands by profile and run`.

**Execution clarification:** R2: Command isolation accepts a host-created run or setup scope. Setup has a durable setup ID, writes only its staged environment and scratch roots, has no research projection, and has separately allowlisted registry network access. Permit only a specifically authenticated broker/control channel; never general localhost. R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Additional Modify: src/lib/extensions/import-contract.ts.

### Task 9: Managed environments and scoped connections

**Create:** `src/lib/extensions/setup.ts`, `src/lib/extensions/toolchains.ts`, `src/lib/extensions/connections.ts`, `src/lib/extensions/network-broker.ts`, `src/lib/extensions/__tests__/setup.test.ts`, `src/lib/extensions/__tests__/connections.test.ts`.
**Modify:** `src/lib/extensions/import-contract.ts`, `src/lib/workflows/contracts.ts` (setup references only).

**Interfaces:** `ensureToolEnvironment(ctx,ref:ToolRef,recipe:SetupRecipe): Promise<EnvironmentRecord>`; `checkToolReadiness(ctx,ref): Promise<CompatibilityReport>`; `resolveCommandConnections(ctx,connectionIds:string[]): Promise<CommandConnections>`; `bindToolConnection(ctx,key:ToolKey,binding:ConnectionBinding): Promise<void>`. Records hold toolchain/dependency lock hashes, installation state and opaque credential handles; credentials are not serialized into package snapshots, run journals or artifacts. New connections use the existing server-only settings boundary; reuse credentials by reference rather than copying them into tool files.

`createConnectionBroker(ctx,runId,bindings): Promise<ConnectionBroker>` returns
run-scoped proxy handles plus `close()`. The broker validates destination/method
and inserts source-service credentials host-side; an imported process receives
no real credential. Credential insertion requires an inspected request, not an
opaque CONNECT tunnel. A CLI that cannot use this adapter is not declared ready
for that authenticated service. Model traffic always uses Task-3 model calls.

- [ ] Test interrupted setup, successful retry, two concurrent setup requests, exact locks, missing credentials, profile-separated caches, and secret redaction:
  ```ts
  expect((await checkToolReadiness(ctx, tool.ref)).status).toBe("needs-setup")
  expect(await installWithMissingIsolation()).toMatchObject({ executed: false })
  expect(serializedRunAndLogs).not.toContain(fakeSecret)
  ```
- [ ] Run `npx vitest run src/lib/extensions/__tests__/setup.test.ts`; expect failure.
- [ ] Reuse or install verified runtime toolchains into managed roots; resolve official release checksums and persist exact versions before installing dependencies. Use Python 3.12 virtual environments with a hash-locked dependency set and isolated Node projects with lockfile-based installs. The general Node path uses `npm ci --ignore-scripts`; required build/install scripts execute only as reviewed setup steps inside Task-8 isolation, without a research projection or model secrets. Setup runs use separate package-registry network rules and an atomic ready marker. Pre-existing user environments/global agent installations are never modified.
- [ ] Bind only selected source services through the host credential broker, using per-run non-secret handles. Test command environments and artifacts contain no real secret, a forged/cross-profile handle is rejected, and a redirect cannot carry authentication to another origin. Packages that call models internally need a metered broker adapter or remain unsupported for that operation. Pin effective engine/model compatibility and report required provider changes instead of switching automatically. Run both focused test files and master checks.
- [ ] Commit `feat: prepare managed tool environments and connections`.

**Execution clarification:** R2: Command isolation accepts a host-created run or setup scope. Setup has a durable setup ID, writes only its staged environment and scratch roots, has no research projection, and has separately allowlisted registry network access. Permit only a specifically authenticated broker/control channel; never general localhost. R11: Run contracts capture immutable prepared environment/lock refs and non-secret connection configuration revisions. Task 9 resolves these, Task 13 retains them for active/recoverable runs. Real credentials stay server-side and may rotate without copying secrets into run state.

### Task 10: Host-controlled instruction execution and supporting skills

**Create:** `src/lib/workflows/agent.ts`, `src/lib/workflows/host-tools.ts`, `src/lib/workflows/research-view.ts`, `src/lib/workflows/__tests__/agent.test.ts`.
**Modify:** `src/lib/workflows/adapters.ts`, `src/lib/extensions/import-contract.ts`.

**Interfaces:** `executeInstructionWorkflow(ctx,run:ToolRun,io:WorkflowIO): Promise<void>`; `buildResearchView(ctx,runId): Promise<ResearchView>`; `dispatchHostAction(ctx,runId,action:HostAction): Promise<HostActionResult>`. Define strict actions: `read_resource`, `read_research`, `run_command`, `invoke_skill`, `publish_artifact`, `propose_wiki_change`, `finish`. Resource/command IDs reference the approved snapshot/recipe, not arbitrary host paths. Model decisions use existing structured providers with `singleAttempt`, captured settings and Task-3 reservations. Define `WorkflowIO` in Task-4 adapters and add its exported type there.

- [ ] Test named helper invocation, ambiguous capability helper, missing dependency, unavailable model, malicious permission instructions, an instruction-context overflow, and correct plain-text streaming:
  ```ts
  expect(await dispatchHostAction(ctx, id, declaredAmbiguousHelper)).toMatchObject({ status: "needs-choice" })
  expect(allAttempts.map(a => a.rootRunId)).toEqual([id, id, id])
  expect(await projectedSettingsFile()).toBeNull()
  expect(publicEvents.some(e => e.type === "text")).toBe(true)
  ```
  Fixture model outputs must exercise JSON decisions and a separate streamed final answer; never fake streaming by splitting a completed answer.
- [ ] Run `npx vitest run src/lib/workflows/__tests__/agent.test.ts`; expect failure.
- [ ] Implement the bounded action loop, stable action IDs and a durable call stack for supporting skills. Every model/command step is journaled/reserved before dispatch. Read active-profile research through typed host readers; expose a readonly projection to commands, including sanitized chat/project exports but no settings/private operational records. Required skill resources are paged by reference and never silently omitted. Runtime permissions/writeIntent originate in the user's request/setup, never in imported instructions or model output.
- [ ] Persist schema-validated decisions and resumable public text snapshots. A final answer uses a dedicated streaming model step when synthesis is needed; already-persisted artifacts can finish without another model call. Helper calls cannot exceed root scope, evade budget via child runs, create their own unmetered model engine, or pick an alternative tool silently. Run focused/master checks.
- [ ] Commit `feat: execute imported skills through controlled host tools`.

**Execution clarification:** R3: Only declared dependency capability slots with immutable eligible candidate refs can require helper choice. Genuinely undeclared helper calls reject or need setup. Persist the chosen candidate against its parent step; new installations never enter an active run graph. R7: Coordinator owns typed idempotent action transitions and journal records; the host owns persisted helper continuations. Task 17 extends coordinator/journal/agent/usage services with resolveUncertain and chooseHelper, backend race/crash tests, then routes/UI. Routes never invoke adapters directly. R10: Task 6 owns the durable server-side authorized save step and coordinator completion trigger. Task 10/14 submit validated proposals or completed artifacts to it. outputs_only never automatically writes. Task 17 only observes or requests an explicit save. Define durable helper continuation state and reject undeclared helpers separately from declared ambiguous capability slots.

### Task 11: OpenCite vertical slice

**Create:** `src/lib/extensions/catalog/opencite.ts`, `src/lib/extensions/catalog/opencite.lock.json`, `src/lib/extensions/__tests__/opencite.test.ts`, `src/lib/extensions/__tests__/fixtures/opencite-output.json`, `e2e/fixtures/tools/opencite.mjs`.
**Modify:** `src/lib/extensions/import-contract.ts` (CatalogEntry/OpenCiteResult schemas), `src/lib/extensions/native-catalog.ts` (catalog aggregation only), `src/lib/extensions/connections.ts` (source-service bindings).

**Interfaces:** `openciteCatalogEntry(): CatalogEntry`; `normalizeOpenCiteOutput(value:unknown): OpenCiteResult`; `CatalogEntry` includes source/ref, locked recipe, required connections and expected capabilities. Result contains validated paper snapshots, source access status and artifact candidates; original DOI/URL provenance survives normalization.

- [ ] Add typed CLI fixtures for search, a successful PDF/Markdown/BibTeX bundle, no accessible PDF, rate limiting, changed output schema and no results:
  ```ts
  expect(normalizeOpenCiteOutput(fixture).papers[0].doi).toBe(fixtureDoi)
  expect(normalizeOpenCiteOutput(noPdf).papers[0].access).toBe("abstract")
  expect(run.artifacts.map(a => a.kind)).toEqual(expect.arrayContaining(["papers", "bibtex"]))
  ```
- [ ] Run `npx vitest run src/lib/extensions/__tests__/opencite.test.ts`; expect failure.
- [ ] Pin the research-skills Git SHA and independently resolve a released `opencite[pdf]` dependency into the hash lock. Preserve both packages' notices. Inspect that exact CLI's help/config/output formats in the isolated environment; select its machine-readable output path and use a per-run config/cache directory. Use source APIs and permitted document hosts from the reviewed recipe. Additional publisher domains discovered in returned source records go through a host-validated public-document retrieval capability; rejected/private redirects never gain network access. Enhanced remote PDF conversion is off unless its connection is explicitly configured.
- [ ] Use the real command worker and deterministic source/CLI fixtures for offline assertions; label fixture transport clearly. An opt-in public-source smoke checks one search, one accessible full text and BibTeX without model calls in a disposable profile. If network access is unavailable, retain that live gate as unverified. Run focused/master checks and production build.
- [ ] Commit `feat: add the OpenCite research tool integration`.

**Execution clarification:** R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Additional Modify: src/lib/workflows/adapters.ts and src/instrumentation.ts as needed to register the command adapter before the phase gate.

### Task 12: Consented discovery from installed agents

**Create:** `src/lib/extensions/discovery.ts`, `src/lib/extensions/agent-locations.ts`, `src/app/api/tools/discovery/route.ts`, `src/lib/extensions/__tests__/discovery.test.ts`, `src/lib/extensions/__tests__/fixtures/agents/README.md`.

**Interfaces:** `grantDiscovery(ctx, roots:DiscoveryRoot[]): Promise<DiscoveryGrant>`; `discoverAgentSkills(ctx, grantId:string): Promise<DiscoveredSkill[]>`; `stageDiscoveredSkill(ctx,grantId,candidateId): Promise<ImportPreview>`. Define these schemas in `import-contract.ts`; grant scope includes profile, canonical chosen roots and expiry (one scan/import session, 30 minutes). Candidate IDs are server-issued opaque IDs, not client-supplied file paths. POST discovery takes a consented selection, GET only reads already-produced results.

- [ ] Test Codex/Claude fixtures, custom agent folder, symlinked duplicate origins, sibling helpers, expired grants and same-named different packages:
  ```ts
  await expect(discoverAgentSkills(ctx, "missing-grant")).rejects.toThrow("permission")
  expect(sameContent.origins).toHaveLength(2)
  expect(differentContentCandidates).toHaveLength(2)
  expect(executedCommands).toEqual([])
  ```
- [ ] Run `npx vitest run src/lib/extensions/__tests__/discovery.test.ts`; expect failure.
- [ ] Scan only selected roots. Codex adapter recognizes `.agents/skills`, `.codex/skills`, and installed plugin metadata/cache roots; Claude recognizes its selected config root's `skills` and active plugin metadata. Resolve custom config roots from user selection, not a home-directory crawl. Verify formats with fixture metadata and read-only agent documentation; never read authentication/session files as discovery input. Rank likely research skills from metadata locally and allow viewing other discovered skills. Deduplicate by complete resolved content/dependency identity, retaining origins; materialize selected imports through Task 7. No scan/import executes the skill or modifies the source agent.
- [ ] Verify native API/profile guards and that revocation prevents further inspection while already imported snapshots remain independently usable. Run focused/master checks.
- [ ] Commit `feat: import agent-installed skills with explicit consent`.

**Execution clarification:** R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. R9: Task 12 defines strict grant/revoke/discover/stage action DTOs. Task 13 defines binding/update/rollback/removal DTOs with operation IDs and active-run disposition finish or cancel; an unspecified disposition returns decision-required. Task 15 consumes these same schemas. Additional Modify: src/lib/extensions/import-contract.ts. Add revokeDiscovery(ctx, grantId), POST grant/discover/stage/revoke actions, and GET saved results; all requests use shared strict schemas.

### Task 13: Manual updates, version retention and rollback

**Create:** `src/lib/extensions/versions.ts`, `src/app/api/tools/[key]/route.ts`, `src/app/api/tools/[key]/versions/route.ts`, `src/lib/extensions/__tests__/versions.test.ts`.
**Modify:** `src/lib/extensions/store.ts`, `src/lib/extensions/profile-state.ts`.

**Interfaces:** `checkToolUpdate(ctx,key): Promise<UpdatePreview|null>`; `applyToolUpdate(ctx,key,previewId,operationId): Promise<ToolRef>`; `rollbackTool(ctx,key,digest,operationId): Promise<ToolRef>`; `removeTool(ctx,key): Promise<void>`. Update preview identifies changed resources, dependency versions and newly required connections/capabilities. Retain active/recoverable run references and at least the current/previous successful install.

- [ ] Test upstream content changes with unchanged version text, failed setup, two profiles on different versions, active run pinning and removal:
  ```ts
  await applyToolUpdate(ctx, key, preview.id, op)
  expect((await readRun(ctx, active.id))!.tool.digest).toBe(oldDigest)
  expect((await listEnabledTools(other))[0].ref.digest).toBe(oldDigest)
  expect(await readArtifact(ctx, finished.id, artifact.id)).toBeDefined()
  ```
- [ ] Run `npx vitest run src/lib/extensions/__tests__/versions.test.ts`; expect failure.
- [ ] Check remote update metadata when Tools opens, at most once per 24 hours for previously approved remote origins; provide Check updates for an explicit refresh. Local/agent sources require a user-triggered check limited to the original package path, renewing scoped read consent when needed. Metadata checking can notify but never installs an update. Stage/install/probe the new snapshot before atomically changing the profile binding; failure retains the previous version. Present added access/setup requirements in the update action. Rollback selects retained compatible package/configuration, never rewinds vault data. Disabling/removing prevents new runs; ask how to handle any active run before removal completes. Unused environments can be collected only after reference checks.
- [ ] Run focused/master checks and `npm run build`. Phase gate: an imported fixture and OpenCite command adapter execute through real supervision; discovery requires consent; an active run remains reproducible across an update.
- [ ] Commit `feat: manage tool updates and rollback per profile`.

**Execution clarification:** R9: Task 12 defines strict grant/revoke/discover/stage action DTOs. Task 13 defines binding/update/rollback/removal DTOs with operation IDs and active-run disposition finish or cancel; an unspecified disposition returns decision-required. Task 15 consumes these same schemas. R11: Run contracts capture immutable prepared environment/lock refs and non-secret connection configuration revisions. Task 9 resolves these, Task 13 retains them for active/recoverable runs. Real credentials stay server-side and may rotate without copying secrets into run state. Additional Modify: src/lib/extensions/import-contract.ts. removeTool accepts operationId and optional activeRunDisposition (finish|cancel); return a typed decision-required result when needed.
