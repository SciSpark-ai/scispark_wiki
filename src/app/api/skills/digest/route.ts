import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { acquireFullText } from "@/lib/wiki/acquire"
import {
  generateDigest,
  isDigestCacheSlug,
  loadCachedDigestBySlug,
  type DigestResult,
} from "@/lib/skills/digest"
import { serverRelayFetch } from "@/lib/server/relay-fetch"
import type { PaperRecord } from "@/lib/papers/types"

export interface DigestRouteResult {
  digest: DigestResult
  fromCache: boolean
  costUsd?: number | null
}

export interface CachedDigestRouteResult {
  digest: DigestResult | null
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
    const digest = await loadCachedDigestBySlug(await getServerVault(), slug)
    return Response.json({ result: { digest } satisfies CachedDigestRouteResult }, { status: 200 })
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
  const fetchFn = overrides.fetchFn ?? serverRelayFetch("server-ingest")
  const acquired = await acquireFullText(paper, { fetchFn })
  const settings = await loadSettings(vault)

  const { digest, fromCache, costUsd } = await generateDigest(vault, paper, {
    fullText: acquired.kind === "html" ? acquired.text : undefined,
    settings,
    providerOverride: overrides.providerOverride,
  })

  return { digest, fromCache, costUsd }
})
