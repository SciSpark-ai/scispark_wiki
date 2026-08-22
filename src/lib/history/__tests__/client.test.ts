import { describe, expect, it } from "vitest"
import {
  getChangePreviewRemote,
  HistoryApiError,
  listChangesRemote,
  undoChangeRemote,
} from "../client"

describe("History API client", () => {
  it("lists summaries, loads encoded previews, and undoes by id only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === "/api/history/changes" && init?.method === "POST") {
        return Response.json({ changesetId: "cs-safe", warnings: [] })
      }
      if (url.startsWith("/api/history/changes/")) {
        return Response.json({ changesetId: "cs-safe", changes: [] })
      }
      return Response.json({ changes: [] })
    }

    await expect(listChangesRemote(fetchFn as typeof fetch)).resolves.toEqual([])
    await expect(getChangePreviewRemote("cs-safe", fetchFn as typeof fetch)).resolves.toMatchObject({ changesetId: "cs-safe" })
    await expect(undoChangeRemote("cs-safe", fetchFn as typeof fetch)).resolves.toEqual({ changesetId: "cs-safe", warnings: [] })

    expect(calls[1].url).toBe("/api/history/changes/cs-safe")
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ changesetId: "cs-safe" })
  })

  it("surfaces conflict paths from a failed undo", async () => {
    const fetchFn = async () => Response.json(
      { error: "diverged", divergedPaths: ["wiki/notes/x.md"] },
      { status: 409 },
    )

    try {
      await undoChangeRemote("cs-diverged", fetchFn as typeof fetch)
      throw new Error("expected undo to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryApiError)
      expect((error as HistoryApiError).status).toBe(409)
      expect((error as HistoryApiError).divergedPaths).toEqual(["wiki/notes/x.md"])
    }
  })
})
