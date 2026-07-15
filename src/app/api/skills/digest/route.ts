import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { acquireFullText } from "@/lib/wiki/acquire"
import { generateDigest, type DigestResult } from "@/lib/skills/digest"
import { serverRelayFetch } from "@/lib/server/relay-fetch"
import type { PaperRecord } from "@/lib/papers/types"

export interface DigestRouteResult {
  digest: DigestResult
  fromCache: boolean
  costUsd?: number
}

/**
 * POST /api/skills/digest — body `{paper}`, JSON result `{digest, fromCache,
 * costUsd}` (the same fields the papers page renders in `DigestPanel`).
 * Runs full-text acquisition + the Digest Skill entirely server-side (M11
 * local-runtime pivot): the browser never holds LLM keys or calls
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
