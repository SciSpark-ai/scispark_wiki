import { expect, it } from "vitest"
import { deduplicateReviewPapers, interleaveEvidenceBatches } from "../evidence"
import type { PaperRecord } from "../../papers/types"
const paper = (ids: PaperRecord["ids"], title = "Study"): PaperRecord => ({ ids, title, authors: [], fields: [], source: "s2" })
it("merges arXiv DOI aliases and bridge identities without title-only guesses", () => {
  const results = deduplicateReviewPapers([
    paper({ arxiv: "2602.19395v2" }), paper({ doi: "10.48550/arXiv.2602.19395", s2: "abc" }),
    paper({ pmid: "123" }), paper({ s2: "abc", pmid: "123" }),
    paper({ doi: "10.1234/independent" }),
  ])
  expect(results).toHaveLength(2)
  expect(results[0].ids).toMatchObject({ s2: "abc", pmid: "123" })
})
it("gives later source/query batches an early slot", () => {
  const result = interleaveEvidenceBatches([[paper({}, "A"), paper({}, "B")], [paper({}, "C")]])
  expect(result.map((p) => p.title)).toEqual(["A", "C", "B"])
})
