import { describe, it, expect, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { applyChangeset } from "../../vault/changesets"
import { savePaper } from "../save-client"
import { paperSlug } from "../../wiki/authoring"
import type { PaperRecord } from "../types"
import type { Changeset } from "../../vault/types"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

const TODAY = "2026-07-17"

function fakes(storage: MemoryVaultStorage) {
  const applyFn = vi.fn(async (cs: Changeset) => {
    await applyChangeset(storage, cs)
  })
  const enrichFn = vi.fn(async () => ({ applied: true }))
  const logFn = vi.fn(async () => {})
  return { applyFn, enrichFn, logFn }
}

describe("savePaper", () => {
  it("applies the tier-1 stub, logs a save event, and fires enrich in the background", async () => {
    const storage = new MemoryVaultStorage()
    const { applyFn, enrichFn, logFn } = fakes(storage)

    const result = await savePaper(storage, PAPER, { today: TODAY, applyFn, enrichFn, logFn })

    expect(result).toEqual({ saved: true, slug: paperSlug(PAPER) })
    expect(applyFn).toHaveBeenCalledTimes(1)
    expect(logFn).toHaveBeenCalledTimes(1)
    expect(logFn).toHaveBeenCalledWith(
      storage,
      expect.objectContaining({ type: "feed_save", title: PAPER.title }),
    )
    expect(enrichFn).toHaveBeenCalledTimes(1)
    expect(enrichFn).toHaveBeenCalledWith(paperSlug(PAPER))
  })

  it("is a no-op (saved:false) on a second save of the same paper, and does not error or re-enrich", async () => {
    const storage = new MemoryVaultStorage()
    const first = fakes(storage)
    await savePaper(storage, PAPER, { today: TODAY, ...first })

    const second = fakes(storage)
    const result = await savePaper(storage, PAPER, { today: TODAY, ...second })

    expect(result).toEqual({ saved: false, slug: paperSlug(PAPER) })
    expect(second.applyFn).not.toHaveBeenCalled()
    expect(second.logFn).not.toHaveBeenCalled()
    expect(second.enrichFn).not.toHaveBeenCalled()
  })

  it("never rejects when the background enrich call throws (fire-and-forget)", async () => {
    const storage = new MemoryVaultStorage()
    const { applyFn, logFn } = fakes(storage)
    const enrichFn = vi.fn(async () => {
      throw new Error("enrich blew up")
    })

    await expect(
      savePaper(storage, PAPER, { today: TODAY, applyFn, enrichFn, logFn }),
    ).resolves.toEqual({ saved: true, slug: paperSlug(PAPER) })
    expect(enrichFn).toHaveBeenCalledTimes(1)
  })

  it("defaults today from an injected now() when today isn't passed", async () => {
    const storage = new MemoryVaultStorage()
    const { applyFn, enrichFn, logFn } = fakes(storage)
    const now = () => new Date("2026-07-17T12:00:00.000Z")

    await savePaper(storage, PAPER, { now, applyFn, enrichFn, logFn })

    const [changeset] = applyFn.mock.calls[0] as [Changeset]
    expect(changeset.timestamp.startsWith("2026-07-17")).toBe(true)
  })
})
