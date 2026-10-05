import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { loadPaperText } from "@/lib/papers/full-text"
import { PaperTextInfoSchema, type PaperTextInfo } from "@/lib/papers/text-contract"
import { paperSlug } from "@/lib/wiki/authoring"
import {
  generateDigest,
  isDigestCacheSlug,
  loadCachedDigestEntry,
  type DigestResult,
} from "@/lib/skills/digest"
import type { PaperRecord } from "@/lib/papers/types"

export interface DigestRouteResult {
  digest: DigestResult
  fromCache: boolean
  costUsd?: number | null
  source?: PaperTextInfo
}

export interface CachedDigestRouteResult {
  digest: DigestResult | null
  source?: PaperTextInfo
}

/**
 * GET /api/skills/digest?slug=... — read-only cache lookup used when a paper
 * page opens. A miss returns `{digest:null}` and, critically, never acquires
 * full text, loads provider settings, or invokes the LLM.
 */
export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("slug")
  if (!slug) return Response.json({ error: "slug is required" }, { status: 400 })
  if (!isDigestCacheSlug(slug)) return Response.json({ error: "slug must be a canonical paper slug" }, { status: 400 })

  try {
    const cached = await loadCachedDigestEntry(await getServerVault(), slug)
    return Response.json({ result: { digest: cached?.digest ?? null, ...(cached?.source ? { source: cached.source } : {}) } satisfies CachedDigestRouteResult }, { status: 200 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/**
 * POST /api/skills/digest — body `{paper}`, JSON result `{digest, fromCache,
 * costUsd}`; the paper page (`/paper/[key]`) renders `digest`/`fromCache` via
 * `PaperDigestView` (`costUsd` is metered/logged to `.scispark/usage`, not
 * displayed here — AI spend lives in Settings). Runs full-text acquisition +
 * the Digest Skill entirely server-side (M11 local-runtime pivot): the
 * browser never holds LLM keys or calls
 * `generateDigest` itself. Acquisition goes through `serverRelayFetch`
 * (see that file's doc comment) rather than a real HTTP call back to this
 * app's own `/api/fetch`/`/api/resolve` routes, since a relative URL has no
 * base to resolve against from server-side code. Builds its own deps
 * server-side (`getServerVault()` via `jsonSkillRoute`, `loadSettings(vault)`)
 * exactly like the trending/feed/consolidate routes; `setSkillTestOverrides`
 * lets tests inject a MockProvider and/or a fake fetch instead of real
 * network calls.
 */
export const POST = jsonSkillRoute<{ paper: PaperRecord }, DigestRouteResult>(async ({ paper }, vault) => {
  const overrides = getSkillTestOverrides()
  const cached = await loadCachedDigestEntry(vault, paperSlug(paper))
  if (cached?.source?.access === "full-text") return { ...cached, fromCache: true }
  const acquired = await loadPaperText(vault, paper, { fetchFn: overrides.fetchFn })
  if (cached && acquired.access !== "full-text") throw new Error("Full text could not be read or verified. Your saved digest is unchanged. Try again after opening the full paper.")
  const settings = await loadSettings(vault)

  const { digest, fromCache, costUsd, source } = await generateDigest(vault, paper, {
    fullText: acquired.access === "full-text" ? acquired.text : undefined,
    source: PaperTextInfoSchema.parse(acquired),
    settings,
    providerOverride: overrides.providerOverride,
  })

  return { digest, fromCache, costUsd, source }
})
