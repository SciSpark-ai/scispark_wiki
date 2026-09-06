import type { VaultStorage } from "../vault/storage"
import type { PaperRecord } from "../papers/types"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import { paperSlug, slugifyTitle } from "../wiki/authoring"
import { defineSkill } from "./types"
import { runSkill } from "./runner"
import { DigestSchema, type DigestResult } from "./digest-contract"

export { DigestSchema, type DigestResult } from "./digest-contract"

/** Resolved shape of a `generateDigest` call — cached or freshly generated. */
type DigestOutcome = {
  digest: DigestResult
  fromCache: boolean
  runId?: string
  costUsd?: number
  cacheWriteFailed?: boolean
}

/**
 * Module-level map of in-flight generateDigest calls, keyed by cache path.
 * Ensures concurrent calls for the same paper share a single runSkill call
 * and avoid duplicate LLM charges. Entries are cleared when the promise settles
 * (whether resolved or rejected).
 *
 * Single-flight scope: per module (per tab/session in browser; per process in Node.js).
 */
const inFlightDigests = new Map<string, Promise<DigestOutcome>>()

/** Cap on how much of the paper's full text goes into the prompt (characters, not tokens). */
const MAX_FULL_TEXT_CHARS = 40_000

/**
 * Truncates `text` to at most `limit` characters, preferring to cut at the last run of
 * whitespace within the final 200 characters of the hard cut so the result doesn't end
 * mid-word or mid-number (see m4-task-6-report.md Review finding 4). Falls back to a hard
 * cut exactly at `limit` when no whitespace exists in that trailing window.
 */
function truncateAtWhitespace(text: string, limit: number): string {
  if (text.length <= limit) return text
  const hardCut = text.slice(0, limit)
  const searchFloor = Math.max(0, hardCut.length - 200)
  for (let i = hardCut.length - 1; i >= searchFloor; i--) {
    if (/\s/.test(hardCut[i])) return hardCut.slice(0, i)
  }
  return hardCut
}

const DIGEST_KEYS = new Set<keyof DigestResult>([
  "summary",
  "laySummary",
  "keyPoints",
  "methods",
  "limitations",
  "fieldContext",
])

/**
 * Some OpenAI-compatible structured-output backends wrap a root object in an
 * array, or split that object's fields into an array of small objects. Recover
 * only those unambiguous forms; the original strict DigestSchema still decides
 * whether the reconstructed candidate is valid.
 */
function normalizeDigestCandidate(candidate: unknown): unknown {
  if (!Array.isArray(candidate) || candidate.length === 0) return candidate
  if (candidate.length === 1) return candidate[0]

  const merged: Partial<Record<keyof DigestResult, unknown>> = {}
  for (const part of candidate) {
    if (part === null || typeof part !== "object" || Array.isArray(part)) return candidate
    for (const [key, value] of Object.entries(part)) {
      if (!DIGEST_KEYS.has(key as keyof DigestResult) || Object.hasOwn(merged, key)) return candidate
      merged[key as keyof DigestResult] = value
    }
  }
  return merged
}

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
    const text = isTruncated ? truncateAtWhitespace(fullText, MAX_FULL_TEXT_CHARS) : fullText
    const label = isTruncated
      ? `Full text (truncated to fit the ${MAX_FULL_TEXT_CHARS.toLocaleString("en-US")}-character limit of a longer document):`
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
    'Return exactly one JSON object at the root with the keys "summary", "laySummary", "keyPoints", "methods", "limitations", and "fieldContext". Never return a root array.',
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
        // Digest quality benefits from reasoning, but Qwen's xhigh default is
        // unnecessarily slow and can starve the final JSON. Medium keeps the
        // judgment pass while bounding latency/cost; 8k leaves room for both.
        maxTokens: 8192,
        thinking: "enabled",
        reasoningEffort: "medium",
      },
      DigestSchema,
      { normalizeCandidate: normalizeDigestCandidate },
    )
  },
})

function digestCachePath(paper: PaperRecord): string {
  return `.scispark/digests/${paperSlug(paper)}.json`
}

function digestCachePathFromSlug(slug: string): string {
  return `.scispark/digests/${slug}.json`
}

/**
 * True only for the canonical slug form produced by `paperSlug`/
 * `slugifyTitle`. This keeps a read-only cache lookup from becoming an
 * arbitrary vault-file reader when the slug comes from a URL query.
 */
export function isDigestCacheSlug(slug: string): boolean {
  return slug.length > 0 && slug === slugifyTitle(slug)
}

/**
 * Reads one already-generated digest without ever invoking an LLM. Missing,
 * corrupt, or schema-invalid cache records are treated as a cache miss so a
 * damaged local record cannot crash the paper page.
 */
export async function loadCachedDigestBySlug(storage: VaultStorage, slug: string): Promise<DigestResult | null> {
  if (!isDigestCacheSlug(slug)) return null

  const cachedRaw = await storage.read(digestCachePathFromSlug(slug))
  if (cachedRaw === null) return null

  try {
    const parsed = DigestSchema.safeParse(JSON.parse(cachedRaw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Read-only paper-record convenience wrapper around `loadCachedDigestBySlug`. */
export async function loadCachedDigest(storage: VaultStorage, paper: PaperRecord): Promise<DigestResult | null> {
  return loadCachedDigestBySlug(storage, paperSlug(paper))
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
 *
 * **Concurrency**: concurrent calls for the same paper (same cache path) share a single
 * `runSkill` invocation via module-level single-flight tracking. Only the first call triggers
 * the LLM; subsequent concurrent calls await the same promise and receive the same result.
 * This prevents duplicate LLM charges when multiple requests arrive before the first cache
 * write completes.
 *
 * **Cache write failures**: if `storage.write()` throws after a successful digest generation,
 * the digest is still returned with `cacheWriteFailed: true` — the digest is not lost.
 * Callers can log the error, but the generated digest is usable.
 *
 * **costUsd semantics**: `costUsd` is passed through from `runSkill` and reflects the actual
 * LLM provider cost. For models with no pricing information (e.g., unknown model prefixes),
 * the harness meters them as $0.00; null-priced runs are included but contribute $0.
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
): Promise<DigestOutcome> {
  const path = digestCachePath(paper)

  // Single-flight: if another call for this same paper is already in flight,
  // return that promise instead of issuing another runSkill.
  const existing = inFlightDigests.get(path)
  if (existing) {
    return existing
  }

  // Create the promise for this call and track it immediately.
  let resolvePromise: ((result: DigestOutcome) => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined

  const promise = new Promise<DigestOutcome>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  inFlightDigests.set(path, promise)

  // Execute the actual work asynchronously, but the promise is already tracked.
  ;(async () => {
    try {
      const cachedDigest = await loadCachedDigest(storage, paper)
      if (cachedDigest !== null) {
        resolvePromise!({ digest: cachedDigest, fromCache: true })
        return
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

      // Try to write cache, but don't let write failures lose the digest.
      let cacheWriteFailed = false
      try {
        await storage.write(path, JSON.stringify(run.output, null, 2))
      } catch {
        cacheWriteFailed = true
      }

      resolvePromise!({
        digest: run.output,
        fromCache: false,
        runId: run.runId,
        costUsd: run.costUsd,
        cacheWriteFailed,
      })
    } catch (error) {
      rejectPromise!(error)
    } finally {
      // Always clear the in-flight entry when this promise settles.
      inFlightDigests.delete(path)
    }
  })()

  return promise
}
