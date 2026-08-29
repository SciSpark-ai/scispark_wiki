# SciSpark developer preview

SciSpark is currently a source-checkout developer preview candidate. The app is
local-first: a loopback-only Next.js process owns a plain-file Markdown vault,
LLM calls, provider keys, and all mutations. This document describes the source
preview; it is not a desktop installer, npm package, hosted service, or public
release announcement.

## Install and run

Requirements:

- Node.js 20 or newer;
- npm;
- GitHub access to the repository;
- an LLM provider key for AI features (ordinary vault browsing and deterministic
  tests do not need one).

```bash
git clone https://github.com/SciSpark-ai/scispark_wiki.git
cd scispark_wiki
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. Add provider credentials through Settings in the
app; stored key values do not round-trip back to the browser.

For a production-mode local preview:

```bash
npm run build
npm run preview
```

Both development and production-preview commands bind to `127.0.0.1`. Do not
change that binding to a LAN or public interface: this preview has no account or
local authentication layer.

## Vault location and backup

The default vault is `~/SciSpark/vault`. Override it with an absolute path when
starting the process:

```bash
SCISPARK_VAULT=/absolute/path/to/vault npm run dev
```

The vault contains normal Markdown, JSON/JSONL metadata, and binary source
assets. `.scispark/settings.json` stores provider credentials in plaintext and
must be treated as a secret.

For the most complete backup, stop SciSpark and copy the entire vault directory
to another protected location. A ZIP export/import library path is also covered
by automated round-trip tests: it restores project, chat, wiki, History, and
binary state, but deliberately excludes `.scispark/settings.json`. There is not
yet an end-user ZIP import screen, so filesystem backup is the recommended
developer-preview recovery path.

Before pointing a newer checkout at an important vault, make a stopped-process
backup. Never test import or recovery against the only copy of a research vault.

## Security model

- The supplied `dev`, `start`, and `preview` scripts bind only to loopback.
- Mutating `/api/**` requests require a loopback `Host`. Browser mutations must
  also carry a matching same-origin `Origin`/fetch-site signal.
- The settings API redacts stored key values. Generic vault-file access cannot
  read, write, or delete `.scispark/settings.json`.
- Generic vault-file clients cannot write or delete persisted changeset audit
  records; undo resolves a validated server-owned `changesetId` only.
- Generic file and ZIP-import paths reject absolute paths, traversal segments,
  backslashes, control characters, and malformed relative paths.
- Applied changes can be undone through History. Diverged changes are never
  overwritten automatically, and there is no force-revert API or UI.

Loopback reduces exposure; it is not a substitute for authentication on an
untrusted machine. Anyone who can read the local vault or act as the local OS
user may be able to read research content and provider credentials.

## Verification

Install the Chromium test runtime once, then run the deterministic gate:

```bash
npx playwright install chromium
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run e2e
```

`npm run e2e` creates a new temporary vault and isolated Next build for every
run, assigns free loopback ports, uses a local no-cost OpenAI-compatible fake,
and removes its temporary state afterward. It covers the SP6 project/recovery
journey, unsafe request rejection, stale edits, corrupt records, legacy-data
dismissal, and export/import restoration without touching the normal vault.

## Known limits and release gates

- This is a source checkout, not a signed desktop application or npm package.
- The complete local human product walkthrough has not yet been accepted. Human
  testing must target one exact Git SHA; any source, dependency, or
  configuration change creates a new candidate.
- There are no accounts, cloud sync, collaboration, hosted multi-user runtime,
  or local auth token.
- LLM features are BYOK and can incur provider charges. The E2E fake does not
  make a new claim about real-provider quality or availability.
- Chromium is the automated browser target for this preview.
- PDF selection/highlight behavior still requires the explicit physical reader
  acceptance gate documented in the M6 plan.
- Corrupt records are isolated so list pages continue rendering, but repairing
  the corrupt source file remains a manual developer task.
- ZIP import is currently a tested library operation rather than a user-facing
  workflow.
- Real-provider project chat, PDF-reader acceptance, release tagging, and the
  GitHub prerelease remain explicit approval gates against one exact commit.
- Desktop packaging and npm-registry publication are intentionally deferred.
