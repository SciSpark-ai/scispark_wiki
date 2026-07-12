import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { PaperRecord } from "../papers/types"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import { paperSlug } from "../wiki/authoring"
import { defineSkill } from "./types"
import { runSkill } from "./runner"

/** Cap on how much of the paper's full text goes into the prompt (characters, not tokens). */
const MAX_FULL_TEXT_CHARS = 40_000

export const DigestSchema = z.object({
  /** One precise, technical paragraph summarizing the paper for a researcher in the field. */
  summary: z.string(),
  /** 2-3 sentences a non-specialist can understand. */
  laySummary: z.string(),
  /** Up to 6 concrete findings/contributions — not section names. */
  keyPoints: z.array(z.string()),
  /** How the work was done. */
  methods: z.string(),
  /** Honest limitations and caveats. */
  limitations: z.string(),
  /** Where this work sits within its broader field. */
  fieldContext: z.string(),
})

export type DigestResult = z.infer<typeof DigestSchema>

export interface DigestSkillInput {
  paper: PaperRecord
  fullText?: string
}

/**
 * Builds the system + user messages for the digest LLM call: paper metadata (title,
 * authors, year, venue), abstract, and — when provided — the paper's full text,
 * truncated to MAX_FULL_TEXT_CHARS with an explicit note in the prompt when truncation
 * actually happens (so the model knows the text it's seeing may be incomplete).
 */
function buildPrompt(input: DigestSkillInput): { system: string; user: string } {
  const { paper, fullText } = input

  const authorNames = paper.authors.map((a) => a.name).join(", ")
  const metaLines = [`Title: ${paper.title}`, `Authors: ${authorNames || "Unknown"}`]
  if (paper.year !== undefined) metaLines.push(`Year: ${paper.year}`)
  if (paper.venue !== undefined) metaLines.push(`Venue: ${paper.venue}`)

  const sections: string[] = [metaLines.join("\n")]

  if (paper.abstract && paper.abstract.trim() !== "") {
    sections.push(`Abstract:\n${paper.abstract.trim()}`)
  }

  if (fullText && fullText.trim() !== "") {
    const isTruncated = fullText.length > MAX_FULL_TEXT_CHARS
    const text = isTruncated ? fullText.slice(0, MAX_FULL_TEXT_CHARS) : fullText
    const label = isTruncated
      ? `Full text (truncated to the first ${MAX_FULL_TEXT_CHARS.toLocaleString("en-US")} characters of a longer document):`
      : "Full text:"
    sections.push(`${label}\n${text}`)
  }

  const system = [
    "You are a research assistant producing a structured digest of an academic paper for a personal research wiki.",
    "Write plain prose only in every field — no markdown headers (#, ##, etc.) inside any value.",
    "summary: one precise, technical paragraph summarizing the paper for a researcher already in the field.",
    "laySummary: 2-3 sentences a non-specialist can understand — no jargon.",
    "keyPoints: up to 6 concrete findings or contributions of the work, not section names (never things like 'Introduction' or 'Results').",
    "methods: how the work was done, concretely.",
    "limitations: honest limitations and caveats of the work.",
    "fieldContext: where this work sits within its broader field.",
  ].join("\n")

  const user = sections.join("\n\n")

  return { system, user }
}

/**
 * The Digest Skill: one `strong`-tier structured LLM call that turns a paper's metadata
 * (+ abstract, + optional full text) into a DigestResult. Caching and error handling for
 * product use live in `generateDigest` below — this skill is the pure LLM-calling unit
 * that `runSkill` wraps with budget/retry/metering.
 */
export const digestSkill = defineSkill<DigestSkillInput, DigestResult>({
  name: "digest",
  version: "1",
  async run(ctx, input) {
    const { system, user } = buildPrompt(input)
    return ctx.llmStructured(
      "strong",
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      DigestSchema,
    )
  },
})

function digestCachePath(paper: PaperRecord): string {
  return `.scispark/digests/${paperSlug(paper)}.json`
}

/**
 * Generates (or reuses a cached) digest for a paper.
 *
 * Cache path is `.scispark/digests/<paperSlug(paper)>.json`. A cache hit that parses as
 * valid JSON AND validates against DigestSchema short-circuits with `fromCache: true` and
 * makes zero LLM calls. Missing, corrupt (invalid JSON), or schema-invalid cache content is
 * treated as a miss and regenerated (overwriting the stale file on success).
 *
 * On a miss, runs `digestSkill` through the M2 harness (`runSkill`), which handles budget
 * checks, retries, and metering. A non-"ok" run status (error or budget_exceeded) throws an
 * Error carrying the run's error message, so callers can render it directly.
 */
export async function generateDigest(
  storage: VaultStorage,
  paper: PaperRecord,
  opts?: {
    fullText?: string
    settings?: LLMSettings
    providerOverride?: Partial<Record<Tier, LLMProvider>>
    now?: () => Date
  },
): Promise<{ digest: DigestResult; fromCache: boolean; runId?: string; costUsd?: number }> {
  const path = digestCachePath(paper)
  const cachedRaw = await storage.read(path)

  if (cachedRaw !== null) {
    try {
      const parsed = DigestSchema.safeParse(JSON.parse(cachedRaw))
      if (parsed.success) {
        return { digest: parsed.data, fromCache: true }
      }
    } catch {
      // Corrupt JSON — fall through to regenerate.
    }
  }

  const run = await runSkill({
    skill: digestSkill,
    input: { paper, fullText: opts?.fullText },
    storage,
    settings: opts?.settings,
    providerOverride: opts?.providerOverride,
    now: opts?.now,
  })

  if (run.status !== "ok" || run.output === undefined) {
    throw new Error(run.error ?? `digest skill run finished with unexpected status "${run.status}"`)
  }

  await storage.write(path, JSON.stringify(run.output, null, 2))

  return { digest: run.output, fromCache: false, runId: run.runId, costUsd: run.costUsd }
}
