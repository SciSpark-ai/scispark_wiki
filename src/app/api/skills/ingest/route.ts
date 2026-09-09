import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { acquireFullText, snapshotSource } from "@/lib/wiki/acquire"
import { generateDigest } from "@/lib/skills/digest"
import { ingestSkill, type IngestOutput } from "@/lib/skills/ingest"
import { runSkill } from "@/lib/skills/runner"
import { serverRelayFetch } from "@/lib/server/relay-fetch"
import { listHighlights, formatHighlightsForPrompt } from "@/lib/highlights/store"
import { paperKey, type PaperRecord } from "@/lib/papers/types"

export interface IngestRouteResult {
  output: IngestOutput
  costUsd: number | null
}

/**
 * POST /api/skills/ingest — body `{paper}`, NDJSON progress
 * (`{type:"progress", phase}`) mirroring the papers page's own former
 * client-side phase transitions — "acquiring" -> "snapshotting" (only when
 * the acquired full text is HTML) -> "digesting" -> "ingesting" — terminal
 * result `{output, costUsd}`.
 *
 * Runs the WHOLE former client-side orchestration server-side (M11): full-
 * text acquisition (via `serverRelayFetch`, see that file), the optional
 * source snapshot, the Digest Skill (same cache path as /api/skills/digest,
 * so a prior "Generate digest" click on this paper is reused here for
 * free), reading the user's own highlights on this paper as emphasis
 * signals, and finally the Ingest Skill itself.
 *
 * A skill run failure (`run.status !== "ok"` — LLM error, budget exceeded)
 * throws, so `ndjsonSkillRoute` emits a terminal error line instead of a
 * result — this is the same distinction the page used to draw itself
 * (`ingestState.phase = "error"`). A `"draft"` `IngestOutput` (generation
 * failed validation twice — nothing was written to the vault) is, in
 * contrast, a completely normal successful skill run and IS returned as the
 * result, exactly as it was rendered client-side before this move.
 */
export const POST = ndjsonSkillRoute<{ paper: PaperRecord }>(async ({ paper }, vault, emit) => {
  const overrides = getSkillTestOverrides()
  const fetchFn = overrides.fetchFn ?? serverRelayFetch("server-ingest")
  const settings = await loadSettings(vault)

  emit({ type: "progress", phase: "acquiring" })
  const acquired = await acquireFullText(paper, { fetchFn })

  let snapshotPath: string | undefined
  if (acquired.kind === "html" && acquired.html !== undefined) {
    emit({ type: "progress", phase: "snapshotting" })
    snapshotPath = await snapshotSource(vault, paper, acquired.html)
  }

  emit({ type: "progress", phase: "digesting" })
  const { digest } = await generateDigest(vault, paper, {
    fullText: acquired.kind === "html" ? acquired.text : undefined,
    settings,
    providerOverride: overrides.providerOverride,
  })

  emit({ type: "progress", phase: "ingesting" })
  const highlights = formatHighlightsForPrompt(await listHighlights(vault, paperKey(paper)))
  const today = new Date().toISOString().slice(0, 10)
  const run = await runSkill({
    skill: ingestSkill,
    input: {
      storage: vault,
      paper,
      digest,
      fullText: { kind: acquired.kind, text: acquired.text, snapshotPath },
      highlights,
      today,
    },
    storage: vault,
    settings,
    providerOverride: overrides.providerOverride,
  })

  if (run.status !== "ok" || run.output === undefined) {
    throw new Error(run.error ?? `ingest run finished with unexpected status "${run.status}"`)
  }

  const result: IngestRouteResult = { output: run.output, costUsd: run.costUsd }
  return result
})
