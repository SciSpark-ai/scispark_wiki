import { describe, expect, it } from "vitest"
import { feedExclusionReason, paperCategory } from "../eligibility"
import type { PaperRecord } from "../types"
import { interleaveCandidates, retrieveRecommendationCandidates } from "../../recommendation/engine"
import { loadFeed, FEED_CACHE_PATH } from "../../skills/feed-cache"
import { MemoryVaultStorage } from "../../vault/memory-storage"

const paper = (title: string, publicationTypes?: string[]): PaperRecord => ({
  ids: { doi: title }, title, publicationTypes, authors: [], fields: [], source: "openalex", date: "2026-09-06",
})
describe("paper recommendation eligibility", () => {
  it("rejects source-identified non-articles without confusing research reviews with referee reports", () => {
    for (const type of ["peer-review", "supplementary-materials", "paratext", "editorial", "retraction", "Published Erratum", "conference-abstract"]) {
      expect(feedExclusionReason(paper("A relevant EEG record", [type]))).not.toBeNull()
    }
    for (const type of ["article", "review", "Systematic Review", "Meta-Analysis", "preprint", "conference-paper", "JournalArticle", "data-paper", "software-paper"]) {
      expect(feedExclusionReason(paper("A relevant EEG record", [type]))).toBeNull()
    }
  })
  it("also recognizes exact referee-report headings in old caches, but preserves genuine review articles", () => {
    for (const n of [1, 2, 3]) expect(feedExclusionReason(paper(`Reviewer #${n} (Public review): Speech tracking`))).not.toBeNull()
    expect(feedExclusionReason(paper("Peer review in neuroscience: a systematic review"))).toBeNull()
    expect(feedExclusionReason(paper("Speech tracking: a review"))).toBeNull()
    expect(paperCategory(paper("Speech tracking: a review", ["review"]))).toBe("Review / synthesis")
  })
  it("filters before the candidate cap, keeping distinct legitimate DOIs", async () => {
    const records = [paper("Reviewer #1 (Public review): Speech tracking"), paper("Speech tracking")]
    const result = await retrieveRecommendationCandidates({ queries: [{ source: "openalex", query: "speech", rationale: "speech" }] }, async () => records, new Set(), new Date("2026-09-06"), { cap: 1 })
    expect(result.candidates.map((c) => c.paper.title)).toEqual(["Speech tracking"])
    expect(interleaveCandidates([records.map((paper) => ({ paper, sources: [paper.source], queries: [] }))], new Set())).toHaveLength(1)
  })
  it("uses explicit abstract self-descriptions when publication metadata is generic", () => {
    expect(paperCategory({ ...paper("LibriBrain100: One Hundred Hours of Broad and Deep MEG Data", ["preprint"]), abstract: "We introduce LibriBrain100, a large-scale MEG dataset for speech decoding designed for reproducible evaluation." })).toBe("Data & tools")
    expect(paperCategory({ ...paper("Auditory neural entrainment", ["article"]), abstract: "Auditory information plays a significant role. This mini review included studies based on speech, music and pure tones." })).toBe("Review / synthesis")
    expect(paperCategory({ ...paper("Cross-subject speech decoding", ["preprint"]), abstract: "We introduce the CPSD framework for neural speech decoding." })).toBe("Methods")
  })
  it("does not reclassify studies merely mentioning prior reviews, datasets, or methods", () => {
    expect(paperCategory({ ...paper("Auditory attention", ["article"]), abstract: "We used an existing MEG dataset to test attention. Previous reviews described this method. We introduce noise into the dataset and compare participants." })).toBe("Research findings")
    expect(paperCategory({ ...paper("Neural speech tracking", ["article"]), abstract: "We review participant records and apply a published framework." })).toBe("Research findings")
  })
  it("removes invalid records from legacy caches on read without rewriting the cache", async () => {
    const storage = new MemoryVaultStorage()
    const raw = JSON.stringify({ generatedAt: "2026-09-06", items: [paper("Reviewer #2 (Public review): EEG"), paper("EEG systematic review", ["review"])].map((paper) => ({ paper, score: 80, whyThis: "", whyYou: "", whyNow: "" })), costUsd: 0, strategy: { queries: [{ source: "openalex", query: "EEG", rationale: "EEG" }] }, stats: { retrieved: 2, ranked: 2 } })
    await storage.write(FEED_CACHE_PATH, raw)
    expect((await loadFeed(storage))?.items.map((item) => item.paper.title)).toEqual(["EEG systematic review"])
    expect((await loadFeed(storage))?.items[0].paper.publicationTypes).toEqual(["review"])
    expect(await storage.read(FEED_CACHE_PATH)).toBe(raw)
  })
})
