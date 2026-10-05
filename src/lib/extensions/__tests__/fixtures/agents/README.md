# Agent discovery fixtures

`discovery.test.ts` creates and removes every agent/config/source/vault/runtime
folder under the OS temporary directory. These are synthetic filesystem fixtures,
not copies of a developer's installed agents. They exercise actual files, internal
and escaping symlinks, cache metadata, expired/revoked permissions, API guards,
profile isolation, and Task 7 review/commit boundaries. No agent or skill command
is executed, and no provider or human vault is accessed.

## Format evidence (read-only, checked 2026-10-05)

The local project/dependency docs were checked first for OpenAI format documentation;
no installed OpenAI package documentation was available. Official references:

- [OpenAI skill locations](https://learn.chatgpt.com/docs/build-skills):
  `.agents/skills`, `SKILL.md` frontmatter, and symlinked skill directories.
  `.codex/skills` remains an explicit legacy adapter required by this task.
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins):
  `.codex-plugin/plugin.json`, relative `skills` paths, and the installed
  `plugins/cache/<market>/<plugin>/<version>` layout (including `local`).
- [Claude skills](https://code.claude.com/docs/en/skills): selected config-root
  `skills/<name>/SKILL.md` layout.
- [Claude plugin manifests](https://code.claude.com/docs/en/plugins-reference):
  `.claude-plugin/plugin.json`, default `skills/` and additional relative skill
  directories. Paths, hook declarations and dependencies are inert input.

The bounded version-2 `plugins/installed_plugins.json` inventory adapter is covered
by fixture metadata (`plugins` maps identifiers to arrays with `installPath`).
The public manifest documentation does not specify that inventory schema; unknown
versions fail closed rather than guessing or crawling fallback caches. A selected
config's installation inventory chooses recorded versions only. Absolute external
install paths require their own explicitly selected content root. Without inventory,
Codex may enumerate its documented cache layout, to depth three, as discoverable
packages. Claude never substitutes unreferenced stale cache versions for inventory.

R28: installed/discovered does not mean enabled or active in the source agent.
We never read `settings.json`, `config.toml`, authentication or session files to
infer source-agent activation. Every import still requires SciSpark selection and
Task 7 human review; command readiness remains governed by the existing platform
isolation and setup checks.

## Supported selections and boundaries

A selection declares `agent` (`codex`, `claude`, `custom`), `layout` (`config`,
`skills`, `plugin-cache`, `package`), and one absolute folder. Grant creation only
canonicalizes selected roots; it does not enumerate them. No home discovery,
parent crawl, config/environment root inference, external fetch, or source write
occurs. Root aliases resolve at consent time. Child aliases must remain within
the selected skill collection/plugin content root; broad config consent does not
authorize sibling config content. A plugin pointer outside the known cache needs
an explicit content selection even when it is below the granted config root.

The scan uses the normal Task 7 inert acquisition/inspection pipeline on filtered
session snapshots. All referenced sibling helpers must be inside that snapshot;
missing/outside/protected references fail. Complete resolved files and immutable
dependency refs participate in content identity, excluding only origin/entry
aliases. No helper path grants new authority. Discovered source identity is hashed;
public candidates contain opaque UUIDs and relative origin labels, no host source
paths. Agent source files are never modified.
