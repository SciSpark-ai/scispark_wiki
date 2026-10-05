import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { readSkillJob, runSkillJob, skillJobPath } from "../skill-jobs"

describe("server-owned skill jobs", () => {
  it("shares running work, preserves progress and restores its result without running again", async () => {
    const storage = new MemoryVaultStorage()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const work = vi.fn(async (emit: (event: object) => void) => {
      emit({ type: "progress", phase: "ingesting" })
      await gate
      return { changesetId: "one-undoable-change" }
    })
    const first = runSkillJob(storage, "ingest:paper", work)
    await vi.waitFor(async () => expect((await readSkillJob(storage, "ingest:paper"))?.progress).toMatchObject({ phase: "ingesting" }))
    const second = runSkillJob(storage, "ingest:paper", work)
    release()
    expect(await second).toEqual(await first)
    expect(work).toHaveBeenCalledTimes(1)
    expect(await readSkillJob(storage, "ingest:paper")).toMatchObject({ status: "completed", result: { changesetId: "one-undoable-change" } })
    expect(work).toHaveBeenCalledTimes(1)
  })

  it("joins jobs across separate vault instances and refuses a different concurrent chat turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "scispark-job-test-"))
    const firstVault = new NodeFsVaultStorage(root)
    const secondVault = new NodeFsVaultStorage(root)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const work = vi.fn(async (emit: (event: object) => void) => {
      emit({ type: "progress", stage: "answering" })
      emit({ type: "text", text: "partial token" })
      await gate
      return { answer: "done" }
    })
    const first = runSkillJob(firstVault, "chat:one", work, undefined, { signature: "first question" })
    let second: Promise<unknown> | undefined
    try {
      await vi.waitFor(async () => expect((await readSkillJob(secondVault, "chat:one"))?.progress).toMatchObject({ stage: "answering", text: "partial token" }))
      await expect(runSkillJob(secondVault, "chat:one", work, undefined, { signature: "different question" })).rejects.toThrow("still running")
      const joined = vi.fn()
      second = runSkillJob(secondVault, "chat:one", work, joined, { signature: "first question" })
      await vi.waitFor(() => expect(joined).toHaveBeenCalled())
      release()
      expect(await second).toEqual(await first)
      expect(work).toHaveBeenCalledTimes(1)
      expect((await readSkillJob(secondVault, "chat:one"))?.status).toBe("completed")
    } finally {
      release()
      await Promise.allSettled([first, second])
      await rm(root, { recursive: true, force: true })
    }
  })

  it("a broken observer cannot cancel work or prevent durable completion", async () => {
    const storage = new MemoryVaultStorage()
    await expect(runSkillJob(storage, "digest:paper", async emit => {
      emit({ type: "progress", phase: "digesting" })
      return { summary: "Saved" }
    }, () => { throw new Error("Browser disconnected") })).resolves.toEqual({ summary: "Saved" })
    expect((await readSkillJob(storage, "digest:paper"))?.status).toBe("completed")
  })

  it("persists failures and never retries on a status read", async () => {
    const storage = new MemoryVaultStorage()
    const work = vi.fn(async () => { throw new Error("Provider unavailable") })
    await expect(runSkillJob(storage, "trending", work)).rejects.toThrow("Provider unavailable")
    expect(await readSkillJob(storage, "trending")).toMatchObject({ status: "failed", error: "Provider unavailable" })
    expect(work).toHaveBeenCalledTimes(1)
    expect(await readSkillJob(new MemoryVaultStorage(), "trending")).toBeNull()
  })

  it("reports an orphan as interrupted instead of leaving a permanent spinner or replaying it", async () => {
    const storage = new MemoryVaultStorage()
    await runSkillJob(storage, "ingest:paper", async () => ({ ok: true }))
    const path = skillJobPath("ingest:paper")
    const job = JSON.parse((await storage.read(path))!)
    await storage.write(path, JSON.stringify({ ...job, status: "running", ownerPid: null, result: undefined }))
    expect(await readSkillJob(storage, "ingest:paper")).toMatchObject({ status: "interrupted" })
    expect((await readSkillJob(storage, "ingest:paper"))?.error).toContain("not retried")
  })
})
