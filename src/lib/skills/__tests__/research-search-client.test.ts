import { describe, expect, it, vi } from "vitest"
import { researchSearchRemote } from "../research-search-client"

function streamResponse(lines: unknown[]): Response {
  const body = lines.map((line) => `${JSON.stringify(line)}\n`).join("")
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } })
}

describe("researchSearchRemote", () => {
  it("posts the natural-language question and reports streamed stages", async () => {
    const result = {
      query: "attention decoding",
      plan: { interpretation: "Attention decoding", sort: "relevance", fromDate: null, queries: [] },
      items: [],
      stats: { retrieved: 0, deduplicated: 0 },
      costUsd: 0,
      warnings: [],
    }
    const fetchFn = vi.fn(async () => streamResponse([
      { type: "progress", stage: "planning" },
      { type: "progress", stage: "searching" },
      { type: "progress", stage: "ranking" },
      { type: "result", payload: result },
    ])) as unknown as typeof fetch
    const stages: string[] = []

    await expect(researchSearchRemote(
      { query: "attention decoding", sources: ["arxiv", "openalex"] },
      (stage) => stages.push(stage),
      fetchFn,
    )).resolves.toEqual(result)

    expect(stages).toEqual(["planning", "searching", "ranking"])
    expect(fetchFn).toHaveBeenCalledWith("/api/skills/research-search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "attention decoding", sources: ["arxiv", "openalex"] }),
    }))
  })
})
