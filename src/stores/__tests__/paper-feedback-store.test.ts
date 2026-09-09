import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedFeedback } from "@/lib/recommendation/client"

const load = vi.hoisted(() => vi.fn())
vi.mock("@/lib/recommendation/client", () => ({ loadRecommendationFeedback: load }))

describe("shared paper feedback state", () => {
  beforeEach(() => { vi.resetModules(); load.mockReset() })

  it.each(["resolved", "rejected"])("does not let a stale %s reload replace a successful vote", async (outcome) => {
    let resolve!: (value: { entries: SavedFeedback[] }) => void
    let reject!: (error: Error) => void
    load.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const { usePaperFeedbackStore: store } = await import("../paper-feedback-store")
    store.setState({ ready: true })
    const pending = store.getState().reload()
    expect(store.getState().reload()).toBe(pending)
    const vote = { paperKey: "doi:10.1234/example", reason: "more_like_this", revision: "new-revision" } as SavedFeedback
    store.getState().setEntry(vote.paperKey, vote)
    if (outcome === "resolved") resolve({ entries: [] })
    else reject(new Error("Old request failed"))
    await pending
    expect(store.getState().entries[vote.paperKey]).toBe(vote)
    expect(store.getState().ready).toBe(true)
    expect(store.getState().error).toBeNull()
  })
})
