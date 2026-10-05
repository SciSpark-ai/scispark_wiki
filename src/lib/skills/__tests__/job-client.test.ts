import { describe, expect, it, vi } from "vitest"
import { observeSkillJob } from "../job-client"

const job = { id: "job", key: "ingest:paper", startedAt: "now", updatedAt: "now", ownerPid: null }

describe("skill job observation", () => {
  it("reconnects with GET only and stops after delivering a durable result", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: { ...job, status: "completed", result: { changesetId: "undo-me" } } }))
    const update = vi.fn()
    await observeSkillJob(job.key, update, new AbortController().signal, fetchFn)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ result: { changesetId: "undo-me" } }))
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith("/api/skills/jobs?key=ingest%3Apaper", expect.objectContaining({ cache: "no-store" }))
  })

  it("detaches an observer without a cancellation request or another poll", async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: { ...job, status: "running" } }))
    await observeSkillJob(job.key, () => controller.abort(), controller.signal, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("ignores a late response after the page has gone away", async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      return Response.json({ result: { ...job, status: "failed", error: "Provider unavailable" } })
    })
    const update = vi.fn()
    await observeSkillJob(job.key, update, controller.signal, fetchFn)
    expect(update).not.toHaveBeenCalled()
  })
})
