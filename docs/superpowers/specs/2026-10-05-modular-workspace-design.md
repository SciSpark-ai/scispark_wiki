# SciSpark modular research workspace

Date: 2026-10-05

Status: Confirmed product contract with all 20 task commits reviewed on
`codex/modular-research-workspace`. The single broad review findings F1–F6 and
M1–M3 are implemented and passed the single scoped re-review; see the [review/finalization summary](../../testing/artifacts/modular-workspace-2026-10-05/final-fix/review-summary.md). Offline/unit and production browser gates passed. Real
imported-command, OS/provider/source and scientific acceptance remain OPEN.
The proposal/interview wording retained below records original intent; the
[current requirement/evidence map](../../testing/2026-10-05-modular-workspace.md)
and [R1–R79 rulings with costs](../../testing/artifacts/modular-workspace-2026-10-05/decisions.md)
identify implemented boundaries, superseded proposals and current limits.

Implementation planning: [master plan and three linked delivery plans](../plans/2026-10-05-modular-workspace.md).

## 1. Product direction

SciSpark becomes a research workspace with a permanent foundation and optional
research tools. Users keep one coherent place to read, discuss, and organize
research while choosing which workflows to add.

The foundation includes personalized feed, paper digest/reading, Sparky chat,
and the LLM wiki and graph. Existing profile/vault ownership, source access,
history, project organization, and recovery remain shared infrastructure.
Trending, Find Papers, Deep Literature Review, and Idea Spark become optional
tools. Making Find Papers optional must not remove the retrieval infrastructure
needed by the core feed, paper resolution, or another installed workflow.

The user explicitly permits importing tools containing skill instructions,
Python/Node scripts, and external connections. SciSpark provides shared interfaces
for conversations, papers, reports, and wiki changes. Arbitrary third-party
frontend code and custom plugin pages are deferred.

## 2. Confirmed product decisions

| Area | Decision |
| --- | --- |
| New profile defaults | Start with the core workspace only. Users add optional tools from Tools when wanted. |
| Entry points | A Tools library and Sparky can start the same tools. Users can pin optional tools in the sidebar. |
| Automatic invocation | Run an enabled tool when the user's request clearly calls for its capability and the choice is unambiguous. Mere contextual relevance is not a request to start a task. |
| Overlapping capabilities | If several enabled tools fit an unspecified request, ask which to use. Built-in tools and imported tools are equal candidates. |
| Explicit choice | Naming a tool or selecting it in Tools resolves that choice; avoid another generic Run confirmation. |
| Supporting skills | Run supporting skills automatically within the requested workflow's scope. An ambiguous capability choice still requires selection. |
| One tool per run | Select one top-level tool per run. Another tool produces a separate run; automatic multi-tool comparison is deferred. Supporting skills belong to their parent run. |
| Import sources | GitHub repository URL and local folder/ZIP. Inspect repositories without skill metadata and adapt when feasible; do not equate downloading with compatibility. |
| Installed agent skills | Ask permission to discover and load relevant skills already installed in Codex, Claude Code, or another agent. Let the user select what enters this profile. |
| Setup | SciSpark manages dependencies in separate tool environments. Users provide required external accounts or credentials. |
| Read context | Tools may read the active profile's research vault, including papers, notes, chats, and projects. Other profiles remain separate. |
| Outputs and writes | Save run outputs automatically. Add to wiki and edits to existing knowledge require the user's intent; an explicit request to update the wiki already supplies that intent. |
| Execution | Run locally, with external services where needed. Work continues while the local runtime is running, independent of browser observers. Cloud execution is deferred. |
| Model choice | Inherit SciSpark's selected model, with optional per-tool overrides. Show an incompatible or required provider during setup. |
| Updates | Notify about updates; apply them when the user chooses. Keep rollback available and keep active runs on their original version. |
| Profile settings | Each profile has its own enabled tools, settings, and model overrides. |
| Discovery | A curated catalog plus user imports in the first release. Community publishing, ratings, and a public marketplace are deferred. |
| Restart recovery | Resume unfinished runs from saved progress where safe. Ask before repeating an uncertain action that could consume additional usage or duplicate a change. |
| Usage limits | An adjustable default per-run limit. At the limit, preserve progress and offer Continue. Pausing, resuming, or restarting must preserve cumulative usage. |

Earlier interview wording suggested a Run confirmation for suggested tools. The
later explicit direction to run automatically when intent matches governs the
unambiguous-request case. Unsolicited suggestions remain suggestions.

## 3. Main user flows

### Add a tool

The Tools library offers curated tools, GitHub import, local folder/ZIP import,
and discovery from installed AI agents. A repository can contain several
packages and skills; show the available workflows and their required supporting
components so the user can choose what to add.

An imported item progresses through inspection, setup, and readiness. Show a
short actionable reason when setup is incomplete or compatibility is unsupported.
Do not present a tool as ready merely because its SKILL.md was parsed.

Enabling a tool makes it available for intent matching and explicit invocation
in the current profile. It does not start a research task.

### Reuse skills installed in another agent

Implemented selected-root flow, retaining the user's opt-in requirement:

1. Offer to find research skills installed on this computer.
2. Obtain permission to inspect the selected agents' skill locations, or a
   user-selected directory for an unsupported agent.
3. Present discovered skills with their originating agent, package identity,
   description, and setup requirements. Identical content may show multiple
   origins; skills with the same name but different implementations stay distinct.
4. Let the user select skills for the current profile and include their required
   supporting resources in the import preview.
5. Import and prepare the selected packages without executing their workflows.

Implementation recommendation: create a fixed, managed snapshot of the selected
package and its resources, retaining provenance to the original installation.
Changes in the source agent become available updates. This supports the agreed
manual-update and rollback behavior. Do not inherit unrelated agent hooks,
global instructions, credentials, or connections as part of copying a skill.
Required connections are explicit setup items.

### Ask Sparky to do research

For a request such as "Review auditory attention decoding methods":

- A named tool runs directly when ready.
- One suitable enabled tool runs directly when intent is clear.
- Several suitable enabled tools produce a concise chooser: name, source, and a
  short explanation of the difference. Choosing one starts that run.
- An unclear request produces a clarifying question.
- A missing capability offers relevant tools to add rather than silently
  installing or enabling one.

Keep the selected tool for that run and its follow-ups. Do not silently substitute
another implementation if it fails. Supporting skills explicitly named by a
workflow resolve to their declared identities. If a supporting step names only a
capability and several eligible implementations exist, resolve that choice too.
Installing another tool must not change an active run's bindings.

### Follow long-running work

A run has a durable identity, visible progress, streamed output where available,
and saved results. Navigation, browser reload, or closing the browser detaches
an observer; it is not cancellation. The local runtime must remain available for
execution. A stopped computer cannot perform local work until it starts again.

On runtime restart, recover the saved run and continue from a safe checkpoint.
An uncertain external action requires reconciliation or a user decision before
repetition. The UI must distinguish working, waiting for a choice, reaching a
limit, interrupted, and failed states with concise next actions.

Implemented: retain the shared History entry point for conversations
and related runs, with direct links between a run and its originating conversation.
Tools and Sparky should open the same result rather than creating duplicate
records. Shared History/run links are covered by Tasks17/19; this does not close live research acceptance.

### Use results

Store reports, paper lists, citations, bibliographies, attachments, and other
artifacts with their producing run. Render recognized output types through
SciSpark components; offer safe previews/downloads for other supported files.
Retain source links and distinguish full-text evidence from abstract-only evidence.

Add to wiki applies a validated, atomic, undoable change. When the original
instruction already requests a wiki update, perform the authorized write through
the same mechanism without an extra generic permission prompt. Existing evidence
limits and source-grounding checks remain in force.

## 4. Proposed architecture

### Interview baseline (historical)

Source inspected before implementation; these are not current feature-status claims:

- `src/components/layout/Sidebar.tsx` has fixed navigation groups.
- `src/components/chat/ChatWorkspace.tsx` has fixed chat/search/review modes and
  dedicated review handling.
- `src/lib/skills/types.ts` defines compile-time TypeScript skills with `run`,
  model calls, structured output, and logging; it is not an imported-package host.
- `src/lib/server/skill-jobs.ts` already captures vault ownership and detaches work
  from observers. Its recovery currently marks a dead owner's work interrupted.
- `src/lib/engines/status.ts` checks local CLI installation, version, and sign-in.
- `src/lib/engines/local-provider.ts` and `codex-stream.ts` intentionally restrict
  agent tools/plugins in existing model-completion calls.

The proposed extension therefore needs an execution host, not just new sidebar
items or imported prompts. Preserve the existing completion path while adding an
explicit workflow execution path with controlled capabilities.

### Registry and profile bindings

Separate package identity, exported skill identity, advertised capabilities,
profile enablement, and run identity. Two literature-review packages are distinct
implementations of a similar capability. A capability is not a unique package ID.

A normalized package record should capture provenance, immutable content/version
identity, license, exported skills, supporting resources, dependencies, required
connections, compatible engines, entry points, and output capabilities. Store
inferred metadata separately from author-declared metadata; compatibility checks
must verify requirements instead of trusting prose alone.

Profile bindings capture enabled tools, pins, overrides, and connection bindings.
Immutable package files may be reused physically, while mutable environments,
secrets, caches, and run data require profile isolation. The precise storage
layout is an implementation decision, not permission to share profile data.

### Import and compatibility adapters

Support a native adapter for existing SciSpark workflows, package adapters for
recognized skill/plugin layouts, and discovery adapters for installed agents.
Resolve a selected skill's relative references and required helper skills along
with its instructions. Handle missing dependencies and dependency cycles visibly.

Not every repository is executable and not every skill is portable between
agents. When adaptation cannot provide the required tools, runtime, or output
handling, report what is missing. Do not silently drop required instructions or
claim full compatibility based on a successful import.

Updates produce a new immutable package version. Existing runs retain their
package/dependency versions, effective model, and resolved tool choices. A model
becoming unavailable requires an actionable choice, not silent substitution.
Rollback applies to package/configuration versions; it does not rewind research
data or assume third-party migrations are reversible.

### Managed execution and boundaries

The runtime owns filesystem access, dependency setup, model calls, credentials,
process supervision, checkpoints, usage accounting, and approved vault changes.
The browser remains a client and never receives stored credentials.

The approved read scope covers research content, not hidden settings or secrets.
An imported process must not gain ambient access to other profiles or the user's
home directory. It can write to its run workspace; vault mutations go through
the approved changeset mechanism. A separate Python environment alone does not
enforce these filesystem boundaries.

Before enabling executable imports, select and verify an enforceable execution
boundary for each supported platform. If that boundary cannot be supplied, the
corresponding execution mode is unavailable with a clear setup explanation.
Do not solve this by removing restrictions globally from existing CLI calls.

Use narrowly bound connections for required external services. The importer
should not copy an agent's authentication files into a package. Tools that own
their model calls need an adapter that supports the selected connection and
declares what SciSpark can account for; otherwise they cannot claim to honor the
shared model setting or fully measured budget.

### Durable runs and recovery

Each run captures its original profile/vault identity, input/context references,
tool/dependency versions, effective model, allowance, cumulative usage, step
journal, output artifacts, and owner/lease. Never resolve a running job's vault
from whichever profile happens to be selected later in the browser.

Execution belongs to a supervised local worker, with progress persisted and
observable by any allowed UI entry point. Status reads must not launch work.
Recovery is a coordinator responsibility, not a side effect of opening a page.

Persist step intent before an external side effect and completion afterward.
Reuse completed outputs, reconnect to known external job IDs where supported,
and replay only actions whose safety/idempotency is established. Opaque scripts
without internal checkpoints cannot promise fine-grained recovery: preserve
their outputs and require reconciliation before repeating an uncertain step.

The adjustable run limit applies to the parent workflow and its supporting
skills together. Extending an allowance preserves prior usage; it does not
reset the counter. Unknown usage remains explicit. API monetary accounting and
subscription-plan activity are different: do not present CLI engine calls as
known dollar costs or as the account's remaining subscription capacity.
Exact defaults and provider-specific units need implementation calibration.

## 5. First external acceptance case

Use `neuromechanist/research-skills`:

- [OpenCite](https://github.com/neuromechanist/research-skills/blob/main/plugins/opencite/skills/opencite/SKILL.md)
  for the first working import: command execution, search, retrieval, extraction,
  and bibliography outputs.
- [Literature Review](https://github.com/neuromechanist/research-skills/blob/main/plugins/manuscript/skills/lit-review/SKILL.md)
  for the end-to-end workflow: collection, synthesis, cited writing, and review,
  using its declared supporting skills. Optional GitHub project orchestration is
  not required for a SciSpark-local review.

The imported graph pins research-skills revision
`f0219bde233abb44d8a0c5d73f41ea27073e1493`, OpenCite0.5.4 and reviewed host
bindings. The source links above identify the upstream intent; current bundled
scope is Semantic Scholar, bounded public PDF/Markdown and BibTeX, with one local
Markdown review. Other sources, DOI/canonical lookup, enhanced conversion/PDF
figure review and optional GitHub/LaTeX remain unadapted. Fixture calibration is
26model+2command calls, not live quality. Supported-host install/CLI/broker,
real OpenCite/source, API/Codex/Claude provider and human scientific checks remain
OPEN under the [live protocol](../../testing/modular-workspace-live-check.md).

Proposed bounded acceptance request:

> Review recent EEG-based auditory attention decoding methods. Compare their
> datasets, methods, and limitations, with linked sources.

Verify the complete cycle:

1. Import from GitHub; choose the workflow and prepare required dependencies.
2. Import the same fixture from a local folder/ZIP and, separately, from a
   consented installed-agent fixture. Verify provenance and duplicate handling.
3. Enable both SciSpark Deep Review and the imported review. A generic request
   offers a choice; a named request selects the intended implementation.
4. Launch from Tools and Sparky and verify shared run identity/results.
5. Navigate away, close/reopen the browser, and reconnect to actual progress.
6. Restart a disposable local runtime at safe and uncertain checkpoints. Verify
   automatic safe recovery and no repeated uncertain external action.
7. Reach a low test allowance, extend it, and verify cumulative accounting.
8. Check source-linked outputs and bibliography; apply and undo an authorized
   wiki change.
9. Verify profile isolation, manual updates/rollback, pinned active runs, missing
   dependencies, unavailable models, failed tools, and cancellation.
10. Create a new profile and verify core feed, digest, chat, wiki, and graph remain
    available before optional tools are enabled. Adding a tool enables it only in
    that profile; disabling it preserves its saved results and core functionality.

Use deterministic providers and fixture packages for most regressions. Real
external CLI/provider tests are separate, explicitly gated acceptance work.
Successful UI rendering or schema validation alone is not evidence that a review
is scientifically accurate or adequately covers the requested topic.

## 6. Proposed delivery sequence

1. Define package, capability, profile binding, run, artifact, and recovery
   contracts. Establish executable-tool isolation requirements.
2. Prove one OpenCite import and supervised run end to end in a disposable profile,
   including output rendering, navigation independence, and usage boundaries.
3. Register existing optional workflows as native tools while preserving their
   routes, saved records, source checks, reservations, and undo behavior.
4. Connect Tools, Sparky selection, optional pins, and shared history/results.
5. Add GitHub/local import management, consented installed-agent discovery,
   profile settings, versioned updates, and rollback.
6. Complete restart recovery and the multi-skill literature-review acceptance
   cycle, including actual browser checks and separately gated live verification.

Dependencies may move between phases during implementation planning; the full
first-release acceptance gate includes all confirmed decisions above. Do not
call an initial vertical slice the finished modular workspace.

## 7. New profiles and proposed migration

Confirmed: new profiles begin with the core workspace only. Trending, Deep
Literature Review, Find Papers, and Idea Spark are available to add from Tools
when wanted. Their presence in the catalog does not enable or execute them.
Discovery of skills from another agent remains opt-in.

Implemented idempotent migration (Tasks2/14/19): register the existing built-in workflows as enabled native
tools for existing profiles, preserving access to their current functionality
and saved results. The new-profile choice does not authorize disabling existing workflows or deleting data; no human vault migration was executed during validation.

The initial product interview has no unanswered selection remaining. Before
implementation, turn the architectural proposals into concrete contracts,
platform-specific execution boundaries, calibrated usage defaults, migration
steps, and a task-by-task validation plan.

## 8. Interface constraints

Follow `design.md` and the user's later copy/shape corrections. Keep the current
SciSpark visual identity. Use rounded boxes for content and chooser options;
pill shapes are for action buttons. Show short status text and a meaningful next
action; put setup details and logs behind disclosures. Preserve readable Markdown,
streaming, loading cues, reduced-motion support, paper context, source links, and
accessible interaction. A tools system is not authorization for a brand redesign.

## 9. Current implementation and acceptance boundary

The requirement map covers every confirmed decision, all 20 reviewed task commits,
source callers and the consolidated F1–F6/M1–M3 fix wave. Historical Task19 gates
(3291 passed/24 gated skips, modular11/core6/native2) remain retained separately
from the current checks in the linked evidence. The single scoped re-review passed; its later documentation-only finalization preserves historical review states.
Production browser close/relaunch and owned Next SIGKILL/restart use deterministic
model/GitHub/source fixtures and do not establish live transport. Fresh isolated
builds restore exact configuration bytes.

R31 preserves fail-closed unsupported execution on this Mac: the actual probe
failed descendant lifetime ownership. Linux/Windows are unrun, and real worker,
install, CLI, broker, OpenCite retrieval, provider and scientific gates remain open.
The full phase acceptance described in §5–6 is not complete. R21's Unix-socket
proposal is superseded by R22's inspected authenticated runtime HTTP proxy; all
79 rulings and costs remain chronological in the durable decision ledger.

R41–45 preserve native revision ownership, retained reports and explicit recovery;
R42 preserves retry generations and prior billing; R46 saves only still-unsaved
artifacts. R47–52 add bounded two-strand execution, current-root artifact paging
and per-turn immutable prompts. R54 uses in-memory-only live credential bindings.
R56–58 preserve core browser behavior, explicit brief approval and a server-only
validated native action bridge: generic run admission rejects action/reviewId.

The [original review handoff](../../testing/artifacts/modular-workspace-2026-10-05/review-handoff.md) is preserved as historical evidence. The broad review found F1–F6/M1–M3; R60–R79 adjudicate declined items and costs. The single scoped re-review passed for the implemented fixes; the subsequent amend only finalizes documentation/evidence. These checks do not imply a live or scientific compatibility pass; publication is not authorized.

R59 preserves all 19 accidentally tracked Task12 scratch report/log files as lossless
gzip evidence with original paths and hashes, then removes only their Git index
entries. Local originals remain for controller final review. The final unfiltered
branch whitespace check has only the two R53 upstream occurrences.
