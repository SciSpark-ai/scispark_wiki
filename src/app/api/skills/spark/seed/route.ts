import { jsonSkillRoute } from "@/lib/server/skill-route"
import { saveSeed, type Seed } from "@/lib/spark/quick"
import type { MutationWarning } from "@/lib/vault/mutations"

export interface SeedRouteInput {
  seed: Seed
}

export interface SeedRouteResult {
  changesetId: string
  path: string
  warnings?: MutationWarning[]
}

/**
 * POST /api/skills/spark/seed — body `{seed}`, JSON result `{changesetId,
 * path}` — the same shape `SparkPanel`'s `persistSeed` used to get back from
 * calling `saveSeed` directly. No LLM call (a pure vault write via a single
 * atomic changeset), so no settings/providerOverride wiring is needed here,
 * unlike the other spark routes. `today` is computed server-side (UTC date),
 * mirroring src/app/api/skills/ingest/route.ts's own `today` computation
 * rather than trusting a client-supplied date.
 */
export const POST = jsonSkillRoute<SeedRouteInput, SeedRouteResult>(async ({ seed }, vault) => {
  const today = new Date().toISOString().slice(0, 10)
  return saveSeed(vault, seed, { today })
})
