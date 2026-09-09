import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import {
  listReviews,
  dismissReview,
  reviewCount,
  listIngests,
  parseUndoneChangesetIds,
  type ReviewItem,
} from "../review-queue"
import type { Changeset } from "../../vault/types"

describe("review-queue", () => {
  describe("listReviews", () => {
    it("returns empty array when no reviews exist", async () => {
      const storage = new MemoryVaultStorage()
      const reviews = await listReviews(storage)
      expect(reviews).toEqual([])
    })

    it("lists reviews sorted by createdAt desc then id", async () => {
      const storage = new MemoryVaultStorage()
      // Write three reviews with different timestamps
      const review1: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }
      const review2: ReviewItem = {
        id: "cs-2-0",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "duplicate",
        title: "Review 2",
        description: "Second review",
        pages: ["page2"],
      }
      const review3: ReviewItem = {
        id: "cs-2-1",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "suggestion",
        title: "Review 3",
        description: "Third review",
        pages: ["page3"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review1))
      await storage.write(".scispark/review/cs-2-0.json", JSON.stringify(review2))
      await storage.write(".scispark/review/cs-2-1.json", JSON.stringify(review3))

      const reviews = await listReviews(storage)
      expect(reviews).toHaveLength(3)
      // review2 and review3 have the same createdAt, so they should be sorted by id desc
      // Actually, looking at the sort, it's b.id.localeCompare(a.id) which sorts lexicographically
      // cs-2-1 > cs-2-0, so cs-2-1 comes first
      expect(reviews[0].id).toBe("cs-2-1") // newest by timestamp, then by id desc
      expect(reviews[1].id).toBe("cs-2-0") // same timestamp as review3, but id is less
      expect(reviews[2].id).toBe("cs-1-0") // oldest
    })

    it("skips archived reviews", async () => {
      const storage = new MemoryVaultStorage()
      const review: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }
      const archivedReview: ReviewItem = {
        id: "cs-2-0",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "duplicate",
        title: "Archived Review",
        description: "Archived",
        pages: ["page2"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review))
      await storage.write(".scispark/review/archived/cs-2-0.json", JSON.stringify(archivedReview))

      const reviews = await listReviews(storage)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].id).toBe("cs-1-0")
    })

    it("skips corrupt/unparseable files", async () => {
      const storage = new MemoryVaultStorage()
      const review: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review))
      await storage.write(".scispark/review/corrupt.json", "not valid json {]")

      const reviews = await listReviews(storage)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].id).toBe("cs-1-0")
    })
  })

  describe("dismissReview", () => {
    it("moves review file to archived directory", async () => {
      const storage = new MemoryVaultStorage()
      const review: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review))

      // Before dismissal
      let reviews = await listReviews(storage)
      expect(reviews).toHaveLength(1)

      // Dismiss the review
      await dismissReview(storage, "cs-1-0")

      // After dismissal
      reviews = await listReviews(storage)
      expect(reviews).toHaveLength(0)

      // Check that it's in the archived directory
      const archived = await storage.read(".scispark/review/archived/cs-1-0.json")
      expect(archived).not.toBeNull()
      const archivedReview = JSON.parse(archived!) as ReviewItem
      expect(archivedReview.id).toBe("cs-1-0")
    })

    it("is a no-op for missing review id", async () => {
      const storage = new MemoryVaultStorage()
      // Should not throw
      await expect(dismissReview(storage, "nonexistent-id")).resolves.not.toThrow()
    })

    it("handles missing-id as no-op without throwing", async () => {
      const storage = new MemoryVaultStorage()
      const review: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review))

      // Dismiss a different id that doesn't exist
      await dismissReview(storage, "cs-2-0")

      // Original review should still be there
      const reviews = await listReviews(storage)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].id).toBe("cs-1-0")
    })
  })

  describe("reviewCount", () => {
    it("returns 0 when no reviews exist", async () => {
      const storage = new MemoryVaultStorage()
      const count = await reviewCount(storage)
      expect(count).toBe(0)
    })

    it("returns count of active reviews", async () => {
      const storage = new MemoryVaultStorage()
      const review1: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }
      const review2: ReviewItem = {
        id: "cs-2-0",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "duplicate",
        title: "Review 2",
        description: "Second review",
        pages: ["page2"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review1))
      await storage.write(".scispark/review/cs-2-0.json", JSON.stringify(review2))

      const count = await reviewCount(storage)
      expect(count).toBe(2)
    })

    it("excludes archived reviews from count", async () => {
      const storage = new MemoryVaultStorage()
      const review: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }
      const archivedReview: ReviewItem = {
        id: "cs-2-0",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "duplicate",
        title: "Archived Review",
        description: "Archived",
        pages: ["page2"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review))
      await storage.write(".scispark/review/archived/cs-2-0.json", JSON.stringify(archivedReview))

      const count = await reviewCount(storage)
      expect(count).toBe(1)
    })
  })

  describe("listIngests", () => {
    it("returns empty array when no changesets exist", async () => {
      const storage = new MemoryVaultStorage()
      const ingests = await listIngests(storage)
      expect(ingests).toEqual([])
    })

    it("lists ingests sorted by timestamp desc", async () => {
      const storage = new MemoryVaultStorage()
      const cs1: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }
      const cs2: Changeset = {
        id: "cs-2",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-02T10:00:00Z",
        changes: [
          { path: "wiki/papers/paper2.md", before: null, after: "content" },
          { path: "wiki/concepts/concept1.md", before: null, after: "content" },
        ],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs1))
      await storage.write(".scispark/changesets/cs-2.json", JSON.stringify(cs2))

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(2)
      // cs-2 is newer, so it should come first
      expect(ingests[0].changesetId).toBe("cs-2")
      expect(ingests[0].timestamp).toBe("2026-01-02T10:00:00Z")
      expect(ingests[0].files).toBe(2)
      expect(ingests[1].changesetId).toBe("cs-1")
      expect(ingests[1].files).toBe(1)
    })

    it("counts files as the number of changes in the changeset", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [
          { path: "wiki/papers/paper1.md", before: null, after: "content" },
          { path: "wiki/concepts/concept1.md", before: null, after: "content" },
          { path: "wiki/authors/author1.md", before: null, after: "content" },
        ],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(1)
      expect(ingests[0].files).toBe(3)
    })

    it("detects reverted ingests from log.md", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))
      await storage.write("log.md", "# Log\n\n## [2026-01-01] undo | cs-1\n")

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(1)
      expect(ingests[0].reverted).toBe(true)
    })

    it("does not mark ingests as reverted if no undo entry in log", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))
      await storage.write("log.md", "# Log\n\n## [2026-01-01] ingest | Some Paper\n")

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(1)
      expect(ingests[0].reverted).toBeUndefined()
    })

    it("handles missing log.md gracefully", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(1)
      expect(ingests[0].reverted).toBeUndefined()
    })

    it("skips corrupt/unparseable changesets", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))
      await storage.write(".scispark/changesets/corrupt.json", "not valid json {]")

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(1)
      expect(ingests[0].changesetId).toBe("cs-1")
    })

    it("detects multiple reverted ingests", async () => {
      const storage = new MemoryVaultStorage()
      const cs1: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }
      const cs2: Changeset = {
        id: "cs-2",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-02T10:00:00Z",
        changes: [{ path: "wiki/papers/paper2.md", before: null, after: "content" }],
      }
      const cs3: Changeset = {
        id: "cs-3",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-03T10:00:00Z",
        changes: [{ path: "wiki/papers/paper3.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs1))
      await storage.write(".scispark/changesets/cs-2.json", JSON.stringify(cs2))
      await storage.write(".scispark/changesets/cs-3.json", JSON.stringify(cs3))
      await storage.write(
        "log.md",
        "# Log\n\n## [2026-01-01] undo | cs-1\n\n## [2026-01-03] undo | cs-3\n",
      )

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(3)
      expect(ingests[0].reverted).toBe(true) // cs-3 (newest) is reverted
      expect(ingests[1].reverted).toBeUndefined() // cs-2 is not reverted
      expect(ingests[2].reverted).toBe(true) // cs-1 is reverted
    })

    it("sorts correctly with reverted ingests mixed in", async () => {
      const storage = new MemoryVaultStorage()
      const cs1: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }
      const cs2: Changeset = {
        id: "cs-2",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-02T10:00:00Z",
        changes: [{ path: "wiki/papers/paper2.md", before: null, after: "content" }],
      }

      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs1))
      await storage.write(".scispark/changesets/cs-2.json", JSON.stringify(cs2))
      await storage.write("log.md", "# Log\n\n## [2026-01-01] undo | cs-1\n")

      const ingests = await listIngests(storage)
      expect(ingests).toHaveLength(2)
      // Still sorted by timestamp, regardless of reverted status
      expect(ingests[0].changesetId).toBe("cs-2")
      expect(ingests[1].changesetId).toBe("cs-1")
      expect(ingests[1].reverted).toBe(true)
    })
  })

  describe("parseUndoneChangesetIds", () => {
    it("extracts changeset ids from 'undo | {id}' log.md entries", () => {
      const logMd = "# Log\n\n## [2026-01-01] undo | cs-1\n\n## [2026-01-03] undo | cs-3\n"
      expect(parseUndoneChangesetIds(logMd)).toEqual(new Set(["cs-1", "cs-3"]))
    })

    it("ignores non-undo entries", () => {
      const logMd = "# Log\n\n## [2026-01-01] ingest | Some Paper\n"
      expect(parseUndoneChangesetIds(logMd)).toEqual(new Set())
    })

    it("returns an empty set for empty input", () => {
      expect(parseUndoneChangesetIds("")).toEqual(new Set())
    })

    it("round-trips: listIngests keeps using the same extraction", async () => {
      const storage = new MemoryVaultStorage()
      const cs: Changeset = {
        id: "cs-1",
        skill: "ingest",
        model: "tier:strong",
        timestamp: "2026-01-01T10:00:00Z",
        changes: [{ path: "wiki/papers/paper1.md", before: null, after: "content" }],
      }
      await storage.write(".scispark/changesets/cs-1.json", JSON.stringify(cs))
      const logMd = "# Log\n\n## [2026-01-01] undo | cs-1\n"
      await storage.write("log.md", logMd)

      expect(parseUndoneChangesetIds(logMd).has("cs-1")).toBe(true)
      const ingests = await listIngests(storage)
      expect(ingests[0].reverted).toBe(true)
    })
  })

  describe("integration: dismiss then list", () => {
    it("maintains proper state after dismissing a review", async () => {
      const storage = new MemoryVaultStorage()
      const review1: ReviewItem = {
        id: "cs-1-0",
        createdAt: "2026-01-01T10:00:00Z",
        changesetId: "cs-1",
        kind: "contradiction",
        title: "Review 1",
        description: "First review",
        pages: ["page1"],
      }
      const review2: ReviewItem = {
        id: "cs-2-0",
        createdAt: "2026-01-02T10:00:00Z",
        changesetId: "cs-2",
        kind: "duplicate",
        title: "Review 2",
        description: "Second review",
        pages: ["page2"],
      }

      await storage.write(".scispark/review/cs-1-0.json", JSON.stringify(review1))
      await storage.write(".scispark/review/cs-2-0.json", JSON.stringify(review2))

      let count = await reviewCount(storage)
      expect(count).toBe(2)

      await dismissReview(storage, "cs-1-0")

      count = await reviewCount(storage)
      expect(count).toBe(1)

      const reviews = await listReviews(storage)
      expect(reviews[0].id).toBe("cs-2-0")

      // Original review is now archived
      const archived = await storage.read(".scispark/review/archived/cs-1-0.json")
      expect(archived).not.toBeNull()
    })
  })
})
