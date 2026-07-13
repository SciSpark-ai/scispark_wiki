import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import { runSkill } from "../skills/runner"
import { readUserModel } from "../usermodel/pages"
import { logEvent } from "../events/log"
import { loadCompanionSettings, SESSION_BUDGET } from "./settings"
import { evaluateTriggers, type TriggerState } from "./triggers"
import { companionSkill } from "./skill"

/**
 * Companion orchestrator (M7 Task 5): ties the trigger engine (T4), the
 * anti-Clippy session budget (T2), and the utterance skill (T3) together, and
 * owns all storage access — the skill itself stays a pure LLM-calling unit
 * (blessed orchestrator-owns-storage pattern, docs/design/04-agent-harness.md).
 */

export interface CompanionUtterance {
  trigger: string
  text: string
  action: { label: string; href: string } | null
  costUsd: number
  fromTemplate: boolean
}

export interface RunCompanionArgs {
  storage: VaultStorage
  state: Omit<TriggerState, "nowMs">
  /** Interventions already shown this session — the caller (UI store) tracks this. */
  sessionShownCount: number
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
}

/**
 * Returns an utterance to show, or null when the companion should stay quiet
 * (chattiness off, session budget exhausted, no trigger, or all on cooldown).
 * On a shown utterance, logs `companion_shown`. Does NOT itself run any
 * suggested action, and does NOT persist `lastShownTs`/session-count
 * bookkeeping — that's the caller's job (it only reads `state.lastShownTs`).
 *
 * Never throws: a companion failure must never break the app's render, so the
 * entire body is wrapped and any unexpected error resolves to null.
 */
export async function runCompanion(args: RunCompanionArgs): Promise<CompanionUtterance | null> {
  try {
    const now = args.now ?? (() => new Date())

    const settings = await loadCompanionSettings(args.storage)
    const budget = SESSION_BUDGET[settings.chattiness]
    if (settings.chattiness === "off" || args.sessionShownCount >= budget) {
      return null
    }

    const fired = evaluateTriggers({ ...args.state, nowMs: now().getTime() })
    if (fired === null) return null

    const userModel = await readUserModel(args.storage)

    const run = await runSkill({
      skill: companionSkill,
      input: {
        triggerContext: fired.contextBlurb,
        feedback: userModel.feedback ?? "",
        companionName: settings.companionName,
      },
      storage: args.storage,
      settings: args.settings,
      providerOverride: args.providerOverride,
      now: args.now,
    })

    const text = run.status === "ok" && run.output !== undefined ? run.output.utterance : fired.templateUtterance
    const fromTemplate = !(run.status === "ok" && run.output !== undefined)
    const costUsd = fromTemplate ? 0 : run.costUsd

    await logEvent(args.storage, { type: "companion_shown", trigger: fired.id }, now)

    return {
      trigger: fired.id,
      text,
      action: fired.action,
      costUsd,
      fromTemplate,
    }
  } catch {
    // Fail silent: a companion failure must never break the app's render.
    return null
  }
}
