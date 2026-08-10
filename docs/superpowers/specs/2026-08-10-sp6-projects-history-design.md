# SP6: Vault-backed Projects, scoped chat, and recoverable History

**Status:** Approved for implementation

**Release target:** GitHub developer preview (`v0.1.0-preview.1`)

**Non-goals:** Desktop packaging, npm publication, cloud sync, force-revert

## Product outcome

SP6 removes the last primary mock-backed surfaces. A researcher can create a
project, attach saved papers and other wiki pages, write project notes, chat
only with that project's material, inspect every conversation and vault
mutation, and safely undo an applied change.

The Markdown vault remains the source of truth. Projects, notes, membership,
chat sessions, and changeset audit records must survive export/import without a
separate database.

## Invariants

1. A project has a stable slug ID. Renaming changes its title, never its path,
   URL, membership key, or chat scope.
2. The project page stores project metadata. Member pages are authoritative for
   membership through `projects: [project-slug]`.
3. Every multi-file project mutation is one validated, atomic, persisted
   changeset. Revision/content conflicts fail with `409` before any write.
4. Undo resolves an immutable audit record by `changesetId`; callers never send
   `before`, `after`, paths, or a force flag.
5. Changeset status is derived from current content:
   - `applied`: every file equals `after`;
   - `reverted`: every file equals `before`;
   - `diverged`: any other mixed or independently edited state.
6. A diverged changeset is never overwritten automatically. History names the
   paths that block recovery.
7. Project chat may narrow context but can never broaden it. It retrieves only
   direct members; Read Sources Only narrows those members to papers.
8. Project instructions guide answer style and priorities but cannot weaken
   citation, grounding, or prompt-injection defenses.
9. Stored LLM keys and all `.scispark/` private files remain inaccessible from
   generic file, changeset, preview, and History APIs.
10. Corrupt project, chat, or changeset records are skipped or surfaced as an
    isolated error; list pages still render.

## Vault model

### Project page

Project pages use the `project` route in `schema.md` (default
`wiki/projects/<slug>.md`). The initial collision-safe slug is generated at
creation and never changes.

```yaml
---
type: project
title: Reliable ABR Biomarkers
created: 2026-08-10
updated: 2026-08-10
tags: []
related: []
sources: []
description: A focused review of repeatable ABR biomarkers.
instructions: Prefer clinically validated findings and call out sample sizes.
---
```

The page body is user-authored project overview content. `description` and
`instructions` are project metadata. The API's `revision` is a deterministic
hash of the complete serialized project page.

### Membership

Every member page carries a `projects` frontmatter array of stable project
slugs. Membership changes parse and reserialize the current page while
preserving unrelated frontmatter and body content. A malformed or stale member
page fails the entire requested mutation.

### Project notes

Notes are ordinary schema-routed `note` pages (default `wiki/notes/`) with:

- `projects: [project-slug]`;
- source provenance in `sources`;
- normal created/updated dates and revision checks.

The editor uses explicit Save/Cancel. One Save produces one changeset.

### Chat sessions

`ChatSession` gains optional `projectId` and `projectTitle`. Old sessions remain
valid global conversations. The title is a historical snapshot; `projectId` is
the stable scope key.

If a project is later deleted, its transcripts remain readable. Continuing the
conversation is disabled until the user explicitly chooses a valid scope; the
runtime must never fall back to global retrieval.

### Changeset audit records

Audit records remain under `.scispark/changesets/<safe-id>.json`. Runtime
validation is exact: unknown fields, duplicate paths, path traversal, absolute
paths, reserved files, and every `.scispark/` target are rejected both on apply
and on persisted-record load.

History returns metadata and file operations, never file bodies:

```ts
interface ChangesetHistoryRecord {
  changesetId: string
  timestamp: string
  skill: string
  model: string
  status: "applied" | "reverted" | "diverged"
  files: Array<{ path: string; operation: "create" | "update" | "delete" }>
  divergedPaths: string[]
}
```

## Server boundaries

### Mutation coordinator

Vault changesets are serialized per server vault. A coordinated mutation:

1. validates and applies or safely reverts the changeset atomically;
2. rebuilds `index.md` from the current bundle;
3. appends an operation to `log.md` through a serialized log writer;
4. returns `{changesetId, warnings}`.

If step 2 or 3 fails after the primary mutation commits, the response remains a
success with an explicit warning. The UI tells the user the mutation succeeded
and must not offer a blind retry.

### Project API

- `GET/POST /api/projects` — list and create.
- `GET/PATCH/DELETE /api/projects/[id]` — detail, revision-checked update, and
  deletion preview/commit.
- `POST/DELETE /api/projects/[id]/members` — revision-checked membership.
- `GET/POST /api/projects/[id]/notes` — list and create notes.
- `PATCH/DELETE /api/projects/[id]/notes/[noteId]` — revision-checked note
  mutation.

`ProjectSummary` and `ProjectDetail` expose stable ID, title, description,
instructions, revision, members, conversations, and counts. Mutation responses
are `{result, changesetId, warnings}`. Invalid input uses `400`, missing
entities `404`, and revision/content conflicts `409`.

Delete first returns a preview of the project page and every member page that
will change. Confirmation atomically deletes the project page and removes its
slug from every current member. The persisted changeset makes the operation
fully recoverable. Historical chat sessions are not deleted.

### History API

- `GET /api/history/changes` returns safe content-derived summaries.
- `POST /api/history/changes` accepts exactly `{changesetId}`.

Only `applied` records can be undone. `reverted` and `diverged` return `409`;
diverged responses identify the blocking paths.

## Chat context contract

`AskChatInput` gains optional `projectId`. A scoped turn resolves the project,
then the current direct member pages. Read Sources Only filters that set to
`type: paper`; it does not query the whole vault.

Context assembly is deterministic:

- maximum 16,000 characters from one page;
- maximum 64,000 characters across all pages;
- stable ordering before truncation;
- every truncated page ID stored on the assistant message/session turn and
  displayed in the UI.

No matching project or a deleted project is a scope error, not permission to
continue globally.

## UI behavior

- `/projects` and `/projects/[id]` use real APIs with explicit loading, empty,
  error, not-found, and stale-edit states.
- Paper and wiki actions show actual project membership.
- The note editor has Save and Cancel; navigation with an unsaved edit warns.
- Project detail lists scoped conversations and starts a new scoped chat.
- `/history?tab=conversations` and `/history?tab=changes` are linkable.
- Changes rows show operation, time, affected files, derived state, preview,
  and Undo. Diverged rows explain why Undo is disabled.
- Prototype keys `scispark-notes`, `scispark-project-papers`, and
  `scispark-paper-actions` trigger a one-time warning. They are deleted only
  after explicit confirmation and are never migrated as real data.
- `/library` redirects to the saved-paper Wiki shelf. Unsupported mock actions
  and library-only mock state are removed.

## Developer preview security and acceptance

Development and production-preview scripts bind to loopback. Mutating APIs
reject unsafe Host/Origin combinations. Playwright uses a new disposable vault
per run and covers projects, membership, notes, scoped chat, deletion/undo,
History, conflicts, corrupt records, legacy-data dismissal, and export/import.

The deterministic release gate is unit/component tests, TypeScript, ESLint,
production build, and E2E. Real-provider project chat and PDF-reader acceptance
are explicit approval gates against the exact release commit. Only after those
gates may the GitHub prerelease be tagged and published.
