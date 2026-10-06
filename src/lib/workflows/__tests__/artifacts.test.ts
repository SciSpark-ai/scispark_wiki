import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { workflowFixture } from "./fixtures"
import { writeRun, readRun } from "../store"
import { publishArtifact, readArtifact } from "../artifacts"
import { saveRunToWiki, submitWikiProposal } from "../wiki-save"
import { applyChangeset, ChangesetRecoveryConflictError, revertPersistedChangeset, loadChangeset } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import { claimRunLease, actionOnRun } from "../journal"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
const input = (kind: "markdown" | "papers" | "bibtex" | "file" = "markdown") => ({ kind, title: "Evidence", mediaType: kind === "bibtex" ? "application/x-bibtex" : "text/markdown", sourceRefs: ["https://doi.org/10.1234/example"], bytes: new TextEncoder().encode(kind === "bibtex" ? "@article{e, title={Evidence}}" : "# Report\n\nSource-linked evidence.") })
afterEach(() => vi.restoreAllMocks())
async function fixture() { const f = workflowFixture(); await writeRun(f.ctx, f.run); return f }
describe("workflow artifact storage and wiki authorization", () => {
  it.each(["markdown", "papers", "bibtex"] as const)("round trips a source-linked %s, allocates paths and verifies hashes", async kind => {
    const f = await fixture(), value = input(kind)
    const artifact = await publishArtifact(f.ctx, f.run.id, value)
    expect((await readArtifact(f.ctx, f.run.id, artifact.id)).bytes).toEqual(value.bytes)
    expect(artifact.sourceRefs).toEqual(value.sourceRefs)
    expect((await readRun(f.ctx, f.run.id))?.artifacts).toEqual([artifact])
    expect(await publishArtifact(f.ctx, f.run.id, value)).toEqual(artifact)
    await f.ctx.storage.writeBinary(artifact.path, new Uint8Array([1]))
    await expect(readArtifact(f.ctx, f.run.id, artifact.id)).rejects.toThrow(/hash/i)
  })
  it("recovers metadata committed before the run mirror and rejects forged metadata paths", async () => {
    const f = await fixture(), write = f.ctx.storage.write.bind(f.ctx.storage)
    const crash = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => { if (path.endsWith("/run.json")) throw new Error("lost mirror"); await write(path, text) })
    await expect(publishArtifact(f.ctx, f.run.id, input())).rejects.toThrow("lost mirror")
    crash.mockRestore()
    const a = await publishArtifact(f.ctx, f.run.id, input())
    expect((await readRun(f.ctx, f.run.id))?.artifacts).toEqual([a])
    await f.ctx.storage.write(a.path.replace(/\.bin$/, ".json"), JSON.stringify({ ...a, path: "wiki/papers/original.md" }))
    await expect(readArtifact(f.ctx, f.run.id, a.id)).rejects.toThrow(/identity/)
  })
  it("fences owner publication when durable cancellation is pending", async () => {
    const f = await fixture(), lease = (await claimRunLease(f.ctx, f.run.id))!
    await actionOnRun(f.ctx, f.run.id, randomUUID(), "cancel")
    await expect(publishArtifact(f.ctx, f.run.id, input(), lease)).rejects.toThrow(/owned/)
  })
  it("honors custom note routing and requires exact proposal artifact selection", async () => {
    const f = await fixture(); await f.ctx.storage.write("schema.md", "## Page Types\n| Type | Directory |\n| note | wiki/research-notes |")
    const a = await publishArtifact(f.ctx, f.run.id, input()), b = await publishArtifact(f.ctx, f.run.id, { ...input(), title: "Second" })
    const after = serializeDocument({ type: "note", title: "Proposal", created: "2026-10-05", updated: "2026-10-05", tags: [], related: [], sources: input().sourceRefs }, "Evidence")
    await submitWikiProposal(f.ctx, f.run.id, { artifactIds: [a.id, b.id], changes: [{ path: "wiki/research-notes/proposal.md", before: null, after }] })
    await expect(saveRunToWiki(f.ctx, f.run.id, [a.id], randomUUID())).rejects.toThrow(/exactly/)
    await saveRunToWiki(f.ctx, f.run.id, [b.id, a.id], randomUUID())
    expect(await f.ctx.storage.read("wiki/research-notes/proposal.md")).toBe(after)
    const g = await fixture(); await g.ctx.storage.write("schema.md", "## Page Types\n| Type | Directory |\n| note | wiki/research-notes |")
    const c = await publishArtifact(g.ctx, g.run.id, input())
    await saveRunToWiki(g.ctx, g.run.id, [c.id], randomUUID())
    expect(await g.ctx.storage.list("wiki/research-notes/")).toHaveLength(1)
  })
  it("rejects traversal, supplied paths, oversize input and foreign ownership", async () => {
    const f = await fixture(), a = await publishArtifact(f.ctx, f.run.id, input())
    await expect(readArtifact(f.ctx, f.run.id, "../../settings")).rejects.toThrow()
    await expect(publishArtifact(f.ctx, f.run.id, { ...input(), path: "wiki/overwrite.md" } as never)).rejects.toThrow()
    await expect(publishArtifact(f.ctx, f.run.id, { ...input(), bytes: new Uint8Array(25 * 1024 * 1024 + 1) })).rejects.toThrow()
    await expect(readArtifact({ ...f.other, storage: f.ctx.storage }, f.run.id, a.id)).rejects.toThrow(/owner/i)
    await expect(readArtifact(f.other, f.run.id, a.id)).rejects.toThrow()
  })
  it("rejects symlink directories and artifact leaves", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-links-"))
    try {
      const f = await fixture(); f.ctx.storage = new NodeFsVaultStorage(root); await writeRun(f.ctx, f.run)
      const a = await publishArtifact(f.ctx, f.run.id, input())
      await rm(join(root, a.path)); await symlink(join(root, ".scispark", "settings.json"), join(root, a.path))
      await expect(readArtifact(f.ctx, f.run.id, a.id)).rejects.toThrow(/symlink/i)
      await rm(join(root, `.scispark/tool-runs/${f.run.id}/artifacts`), { recursive: true })
      await mkdir(join(root, "outside")); await symlink(join(root, "outside"), join(root, `.scispark/tool-runs/${f.run.id}/artifacts`))
      await expect(publishArtifact(f.ctx, f.run.id, input())).rejects.toThrow(/symlink/i)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("keeps HTML/SVG payloads inert and refuses automatic text-note conversion", async () => {
    const f = await fixture()
    for (const mediaType of ["text/html", "image/svg+xml"]) {
      const a = await publishArtifact(f.ctx, f.run.id, { ...input("file"), mediaType, bytes: new TextEncoder().encode('<script>alert("x")</script>') })
      expect((await readArtifact(f.ctx, f.run.id, a.id)).metadata.mediaType).toBe(mediaType)
      await expect(saveRunToWiki(f.ctx, f.run.id, [a.id], randomUUID())).rejects.toThrow(/proposal|text/i)
    }
  })
  it("saves once, preserves original papers and provides divergence-aware persisted undo", async () => {
    const f = await fixture(); await f.ctx.storage.write("wiki/papers/original.md", "Original")
    const a = await publishArtifact(f.ctx, f.run.id, input()), op = randomUUID()
    const first = await saveRunToWiki(f.ctx, f.run.id, [a.id], op)
    expect(await saveRunToWiki(f.ctx, f.run.id, [a.id], op)).toEqual(first)
    expect(await f.ctx.storage.read("wiki/papers/original.md")).toBe("Original")
    const cs = (await loadChangeset(f.ctx.storage, first.changesetId))!
    await f.ctx.storage.write(cs.changes[0].path, "User revision")
    await expect(revertPersistedChangeset(f.ctx.storage, cs.id)).rejects.toThrow(/diverged/)
    await f.ctx.storage.write(cs.changes[0].path, cs.changes[0].after!)
    await revertPersistedChangeset(f.ctx.storage, cs.id)
    expect(await f.ctx.storage.read(cs.changes[0].path)).toBeNull()
    expect(await saveRunToWiki(f.ctx, f.run.id, [a.id], op)).toEqual(first)
    expect(await f.ctx.storage.read(cs.changes[0].path)).toBeNull()
  })
  it("reconciles a crash after changeset apply before journal settlement using the preallocated ID", async () => {
    const f = await fixture(), a = await publishArtifact(f.ctx, f.run.id, input()), op = randomUUID()
    const write = f.ctx.storage.write.bind(f.ctx.storage)
    const crash = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
      if (path.endsWith("/outputs.json") && content.includes('"state":"saved"')) throw new Error("crash at settlement")
      await write(path, content)
    })
    await expect(saveRunToWiki(f.ctx, f.run.id, [a.id], op)).rejects.toThrow("crash at settlement")
    const records = await f.ctx.storage.list(".scispark/changesets/"); expect(records).toHaveLength(1)
    crash.mockRestore()
    const saved = await saveRunToWiki(f.ctx, f.run.id, [a.id], op)
    expect(records[0]).toContain(saved.changesetId)
    expect(await f.ctx.storage.list(".scispark/changesets/")).toEqual(records)
  })
  it("validates an immutable wiki proposal before any write and rejects changed save operations", async () => {
    const f = await fixture(), a = await publishArtifact(f.ctx, f.run.id, input())
    await expect(submitWikiProposal(f.ctx, f.run.id, { artifactIds: [a.id], changes: [{ path: ".scispark/settings.json", before: null, after: "bad" }] })).rejects.toThrow()
    const op = randomUUID(); await saveRunToWiki(f.ctx, f.run.id, [a.id], op)
    const b = await publishArtifact(f.ctx, f.run.id, { ...input(), title: "Other" })
    await expect(saveRunToWiki(f.ctx, f.run.id, [b.id], op)).rejects.toThrow(/conflict/)
  })
})

const pageDocument = (title: string) => serializeDocument({ type: "note", title, created: "2026-10-05", updated: "2026-10-05", tags: [], related: [], sources: input().sourceRefs }, title)
async function diskSaveFixture() {
  const root = await mkdtemp(join(tmpdir(), "workflow-save-transaction-"))
  const f = workflowFixture(); f.ctx.storage = new NodeFsVaultStorage(root)
  await writeRun(f.ctx, f.run)
  const artifact = await publishArtifact(f.ctx, f.run.id, input())
  const changes = ["one", "two"].map(name => ({ path: `wiki/notes/${name}.md`, before: pageDocument(`Before ${name}`), after: pageDocument(`After ${name}`) }))
  for (const change of changes) await f.ctx.storage.write(change.path, change.before)
  await submitWikiProposal(f.ctx, f.run.id, { artifactIds: [artifact.id], changes })
  return { ...f, artifact, changes, root, reopen: () => ({ ...f.ctx, storage: new NodeFsVaultStorage(root) }) }
}
describe("recoverable vault mutation transaction", () => {
  it.each(["mixed", "all-after"] as const)("reopens %s pages without an audit and restores normal persisted undo", async interruption => {
    const f = await diskSaveFixture(), operationId = randomUUID()
    try {
      const original = f.ctx.storage.write.bind(f.ctx.storage)
      let crashed = false
      const failure = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
        if (crashed && f.changes.some(c => c.path === path)) throw new Error("process unavailable during rollback")
        if ((interruption === "mixed" && path === f.changes[1].path && content === f.changes[1].after)
          || (interruption === "all-after" && path.startsWith(".scispark/changesets/"))) {
          crashed = true; throw new Error("interrupted application")
        }
        await original(path, content)
      })
      await expect(saveRunToWiki(f.ctx, f.run.id, [f.artifact.id], operationId)).rejects.toThrow()
      failure.mockRestore()
      expect(await f.ctx.storage.list(".scispark/changesets/")).toEqual([])
      expect(await f.ctx.storage.read(f.changes[0].path)).toBe(f.changes[0].after)
      expect(await f.ctx.storage.read(f.changes[1].path)).toBe(interruption === "mixed" ? f.changes[1].before : f.changes[1].after)
      const reopened = f.reopen(), result = await saveRunToWiki(reopened, f.run.id, [f.artifact.id], operationId)
      expect(await loadChangeset(reopened.storage, result.changesetId)).toMatchObject({ changes: f.changes })
      for (const change of f.changes) expect(await reopened.storage.read(change.path)).toBe(change.after)
      await revertPersistedChangeset(reopened.storage, result.changesetId)
      for (const change of f.changes) expect(await reopened.storage.read(change.path)).toBe(change.before)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it("preserves third-state user edits and exposes the owned recovery identity", async () => {
    const f = await diskSaveFixture(), operationId = randomUUID()
    try {
      const write = f.ctx.storage.write.bind(f.ctx.storage)
      let interrupted = false
      const failure = vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
        if (path === f.changes[1].path || (interrupted && path === f.changes[0].path)) { interrupted = true; throw new Error("interrupted") }
        await write(path, content)
      })
      await expect(saveRunToWiki(f.ctx, f.run.id, [f.artifact.id], operationId)).rejects.toThrow()
      failure.mockRestore()
      const pending = await f.ctx.storage.read(".scispark/changeset-transactions/pending.json")
      expect(pending).not.toBeNull()
      await f.ctx.storage.write(f.changes[0].path, "User's distinct revision")
      const reopened = f.reopen()
      const error = await saveRunToWiki(reopened, f.run.id, [f.artifact.id], operationId).catch(error => error)
      expect(error).toBeInstanceOf(ChangesetRecoveryConflictError)
      expect(error).toMatchObject({ code: "changeset_recovery_conflict", runId: f.run.id, conflicts: [f.changes[0].path] })
      expect(await reopened.storage.read(f.changes[0].path)).toBe("User's distinct revision")
      expect(await reopened.storage.read(f.changes[1].path)).toBe(f.changes[1].before)
      expect(await reopened.storage.read(".scispark/changeset-transactions/pending.json")).toBe(pending)
      // After an explicit repair back to its known image, normal persisted undo
      // can finish recovery and undo without needing the workflow save endpoint.
      await reopened.storage.write(f.changes[0].path, f.changes[0].after)
      await revertPersistedChangeset(reopened.storage, error.changesetId)
      for (const c of f.changes) expect(await reopened.storage.read(c.path)).toBe(c.before)
      expect(await reopened.storage.read(".scispark/changeset-transactions/pending.json")).toBeNull()
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  it("never treats another writer's matching after-image as owned without a vault intent", async () => {
    const f = await diskSaveFixture()
    try {
      await f.ctx.storage.write(f.changes[0].path, f.changes[0].after)
      await expect(saveRunToWiki(f.ctx, f.run.id, [f.artifact.id], randomUUID())).rejects.toThrow(/conflict/)
      expect(await f.ctx.storage.read(f.changes[1].path)).toBe(f.changes[1].before)
      expect(await f.ctx.storage.read(".scispark/changeset-transactions/pending.json")).toBeNull()
      expect(await f.ctx.storage.list(".scispark/changesets/")).toEqual([])
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  it.each(["workflow save", "ordinary changeset"])("serializes a %s against another run across storage instances for the same vault", async caller => {
    const f = await diskSaveFixture()
    let release!: () => void
    try {
      const other = f.reopen(), run = { ...f.run, id: randomUUID(), operationId: randomUUID() }
      await writeRun(other, run)
      const artifact = await publishArtifact(other, run.id, input())
      const otherChange = { ...f.changes[0], after: pageDocument("Other authorized change") }
      await submitWikiProposal(other, run.id, { artifactIds: [artifact.id], changes: [otherChange] })
      let entered!: () => void
      const ready = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
      const write = f.ctx.storage.write.bind(f.ctx.storage)
      vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, content) => {
        if (path === f.changes[0].path && content === f.changes[0].after) { entered(); await gate }
        await write(path, content)
      })
      const first = saveRunToWiki(f.ctx, f.run.id, [f.artifact.id], randomUUID())
      await ready
      const second = caller === "workflow save" ? saveRunToWiki(other, run.id, [artifact.id], randomUUID())
        : applyChangeset(other.storage, { id: randomUUID(), skill: "ordinary", model: "fixture", timestamp: new Date().toISOString(), changes: [otherChange] })
      await Promise.race([second.catch(() => {}), new Promise(resolve => setTimeout(resolve, 150))])
      release()
      const outcomes = await Promise.allSettled([first, second])
      expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "rejected"])
      expect(await other.storage.read(f.changes[0].path)).toBe(f.changes[0].after)
      expect(await other.storage.list(".scispark/changesets/")).toHaveLength(1)
    } finally { release?.(); await rm(f.root, { recursive: true, force: true }) }
  })
})

it("projects new-only save selections with disjoint changesets and independent undo", async () => {
  const f = await fixture(), { projectWorkflowSaves } = await import("../wiki-save")
  const a = await publishArtifact(f.ctx, f.run.id, input())
  const first = await saveRunToWiki(f.ctx, f.run.id, [a.id], randomUUID()), old = (await loadChangeset(f.ctx.storage, first.changesetId))!
  const b = await publishArtifact(f.ctx, f.run.id, { ...input(), title: "New evidence" })
  const projected = await projectWorkflowSaves(f.ctx, f.run.id)
  expect(projected.saveableArtifactIds.sort()).toEqual([a.id, b.id].sort()); expect(projected.nextSaveArtifactIds).toEqual([b.id])
  const second = await saveRunToWiki(f.ctx, f.run.id, projected.nextSaveArtifactIds, randomUUID()), latest = (await loadChangeset(f.ctx.storage, second.changesetId))!
  expect(latest.changes.map(change => change.path).some(path => old.changes.some(change => change.path === path))).toBe(false)
  await revertPersistedChangeset(f.ctx.storage, second.changesetId)
  expect(await f.ctx.storage.read(old.changes[0].path)).toBe(old.changes[0].after)
  expect(await f.ctx.storage.read(latest.changes[0].path)).toBeNull()
})
it("keeps pending exact selections ahead of newly arrived artifacts and preserves proposal exactness", async () => {
  const f = await fixture(), { projectWorkflowSaves } = await import("../wiki-save")
  const a = await publishArtifact(f.ctx, f.run.id, input()), write = f.ctx.storage.write.bind(f.ctx.storage)
  let fail = true
  f.ctx.storage.write = async (path, text) => { await write(path, text); if (fail && path.endsWith("/outputs.json") && JSON.parse(text).saves?.[0]?.state === "pending") { fail = false; throw new Error("lost pending publication") } }
  const operation = randomUUID(); await expect(saveRunToWiki(f.ctx, f.run.id, [a.id], operation)).rejects.toThrow("lost pending publication")
  const b = await publishArtifact(f.ctx, f.run.id, { ...input(), title: "New evidence" })
  expect((await projectWorkflowSaves(f.ctx, f.run.id)).nextSaveArtifactIds).toEqual([a.id])
  await saveRunToWiki(f.ctx, f.run.id, [a.id], operation)
  expect((await projectWorkflowSaves(f.ctx, f.run.id)).nextSaveArtifactIds).toEqual([b.id])
  const g = await fixture(), c = await publishArtifact(g.ctx, g.run.id, input()), d = await publishArtifact(g.ctx, g.run.id, { ...input(), title: "Outside proposal" })
  const after = serializeDocument({ type: "note", title: "Proposal", created: "2026-10-05", updated: "2026-10-05", tags: [], related: [], sources: input().sourceRefs }, "Evidence")
  await submitWikiProposal(g.ctx, g.run.id, { artifactIds: [c.id], changes: [{ path: "wiki/notes/proposal.md", before: null, after }] })
  expect((await projectWorkflowSaves(g.ctx, g.run.id)).nextSaveArtifactIds).toEqual([c.id])
  await expect(saveRunToWiki(g.ctx, g.run.id, [d.id], randomUUID())).rejects.toThrow(/exactly/)
})
