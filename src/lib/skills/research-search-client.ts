import { readNdjson } from "../server/ndjson"
import type { ResearchSearchInput, ResearchSearchResult, ResearchSearchStage } from "./research-search-contract"

export async function researchSearchRemote(
  input: ResearchSearchInput,
  onStage?: (stage: ResearchSearchStage) => void,
  fetchFn: typeof fetch = fetch,
): Promise<ResearchSearchResult> {
  const res = await fetchFn("/api/skills/research-search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && ["planning", "searching", "ranking"].includes(String(event.stage))) {
      onStage?.(event.stage as ResearchSearchStage)
    }
  }) as Promise<ResearchSearchResult>
}
