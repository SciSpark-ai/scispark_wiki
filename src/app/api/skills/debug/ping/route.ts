import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runSkill } from "@/lib/skills/runner"
import { pingSkill, structuredSkill } from "@/lib/skills/debug"
import type { SkillRunResult } from "@/lib/skills/types"

export interface DebugPingRouteInput {
  kind: "ping" | "structured"
}

/**
 * POST /api/skills/debug/ping — body `{kind: "ping" | "structured"}`, JSON
 * result is the raw `SkillRunResult` (status/output/usage/costUsd/logs) —
 * the same shape `/debug/llm` used to get back from calling `runSkill`
 * directly. Unlike the other skill routes, this one does NOT unwrap
 * `run.output`/throw on `status !== "ok"`: the debug page exists to inspect
 * the full run record, including failures, so it needs the whole thing.
 * Mirrors src/app/api/skills/spark/quick/route.ts for dep assembly
 * (`getServerVault()` via `jsonSkillRoute`, `loadSettings(vault)`,
 * `setSkillTestOverrides` for injecting a MockProvider in tests).
 */
export const POST = jsonSkillRoute<DebugPingRouteInput, SkillRunResult<unknown>>(async (input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  const common = { input: undefined, storage: vault, settings, providerOverride: overrides.providerOverride }
  // Branched (rather than picking `skill` via a ternary) so each `runSkill`
  // call gets its own O inferred from its specific skill — a ternary of the
  // two differently-typed SkillDefinitions collapses to a union TS can't
  // reconcile against a single runSkill<I, O> call.
  return input.kind === "structured"
    ? runSkill({ skill: structuredSkill, ...common })
    : runSkill({ skill: pingSkill, ...common })
})
