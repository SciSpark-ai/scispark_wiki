import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runSkill } from "@/lib/skills/runner"
import { readingCompanionSkill, type ReadingCompanionInput, type ReadingAnswer } from "@/lib/skills/reading-companion"

/**
 * POST /api/skills/ask — body `ReadingCompanionInput` (`{selection, surrounding,
 * paperMeta, wikiNeighborhood, userQuestion, companionName?}`), JSON result
 * `ReadingAnswer` (`{answer, citedPageIds}`) — the same shape `ReaderView` used
 * to get back from calling `runSkill(readingCompanionSkill, ...)` directly.
 *
 * Context assembly (`buildAskContext`, src/lib/reader/ask-context.ts) stays
 * client-side (M11 Task 9): it only reads the digest cache + wiki bundle via
 * `VaultStorage` — no LLM call, so no key ever needs to touch it — and
 * `ReaderView` already reads other vault state directly through
 * `RemoteVaultStorage` (highlights, source-page lookup). Moving just the
 * assembled `ReadingCompanionInput` here (rather than re-deriving it
 * server-side from `{paper, selection, surroundingText, userQuestion}`) kept
 * that diff smaller and avoids a second context-assembly implementation.
 * Only the LLM call itself moves server-side, mirroring
 * src/app/api/skills/spark/quick/route.ts and .../digest/route.ts:
 * `getServerVault()` via `jsonSkillRoute`, `loadSettings(vault)`, and
 * `setSkillTestOverrides` for injecting a MockProvider in tests.
 */
export const POST = jsonSkillRoute<ReadingCompanionInput, ReadingAnswer>(async (input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()

  const run = await runSkill({
    skill: readingCompanionSkill,
    input,
    storage: vault,
    settings,
    providerOverride: overrides.providerOverride,
  })

  if (run.status !== "ok" || run.output === undefined) {
    throw new Error(run.error ?? `reading-companion run finished with unexpected status "${run.status}"`)
  }
  return run.output
})
