import type { VaultStorage } from "../vault/storage"
import { revisionOf } from "../projects/revision"
import { commitChangeset, type MutationWarning } from "../vault/mutations"
import { makeChangesetId } from "../vault/changesets"
import { createUserProfile, getUserProfile } from "../usermodel/profile"
import { isOnboarded } from "../usermodel/pages"
import { loadSettings, isAiReady, resolveTier } from "../llm/settings"
import { runSkill } from "../skills/runner"
import type { LLMProvider, Tier } from "../llm/types"
import { onboardingSkill } from "./skill"
import { ONBOARDING_PATH, RecordSchema, initialRecord, readyForConfirmation, type OnboardingRecord, type OnboardingState, type OnboardingInput } from "./contract"

export class OnboardingError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
const queues = new WeakMap<VaultStorage, Promise<unknown>>()
function serialized<T>(storage: VaultStorage, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(storage) ?? Promise.resolve()).then(work)
  queues.set(storage, next.catch(() => undefined))
  return next
}
async function current(storage: VaultStorage) {
  const raw = await storage.read(ONBOARDING_PATH)
  if (raw === null) return { raw, record: initialRecord() }
  const parsed = RecordSchema.safeParse((() => { try { return JSON.parse(raw) } catch { return null } })())
  if (!parsed.success) throw new OnboardingError("The saved onboarding conversation could not be read. Restore it from History or a backup; it has not been overwritten.", 409)
  return { raw, record: parsed.data }
}
export async function getOnboardingState(storage: VaultStorage): Promise<OnboardingState> {
  const [{ raw, record }, settings, onboarded] = await Promise.all([current(storage), loadSettings(storage), isOnboarded(storage)])
  return { ...record, revision: raw === null ? null : await revisionOf(raw), onboarded,
    connected: await isAiReady(settings) }
}
async function save(storage: VaultStorage, before: string | null, record: OnboardingRecord, model: string) {
  const after = JSON.stringify(RecordSchema.parse(record), null, 2) + "\n"
  const mutation = await commitChangeset(storage, { id: makeChangesetId(), skill: "onboarding-conversation", model,
    timestamp: new Date().toISOString(), changes: [{ path: ONBOARDING_PATH, before, after }] },
  { summary: "Research profile conversation" })
  return { raw: after, warnings: mutation.warnings }
}
export async function advanceOnboarding(storage: VaultStorage, input: OnboardingInput, options: {
  onText?: (draft: string) => void; providerOverride?: Partial<Record<Tier, LLMProvider>>
} = {}) {
  return serialized(storage, async () => {
    let { raw, record } = await current(storage)
    const revision = raw === null ? null : await revisionOf(raw)
    // A repeated confirmation after a lost response must never create a second profile.
    if (record.confirmedAnswers && input.action === "confirm" && JSON.stringify(record.confirmedAnswers) === JSON.stringify(input.answers) && await isOnboarded(storage)) {
      return { state: await getOnboardingState(storage), profile: await getUserProfile(storage), warnings: [] }
    }
    if (revision !== input.revision) throw new OnboardingError("This conversation changed in another tab. Reload it before continuing.", 409)
    if (await isOnboarded(storage)) throw new OnboardingError("Your research profile is already saved. Edit it on Profile.", 409)
    const settings = await loadSettings(storage)
    if (!await isAiReady(settings) && !options.providerOverride?.strong) {
      throw new OnboardingError("Connect your AI provider before continuing.", 412)
    }
    if (input.action === "confirm") {
      if (!readyForConfirmation(record) || raw === null) throw new OnboardingError("Finish the conversation and review your profile before saving.", 409)
      record = { ...record, confirmedAnswers: input.answers }
      const mutation = await createUserProfile(storage, input.answers, new Date(), { before: raw, record })
      return { state: await getOnboardingState(storage), profile: mutation.result, changesetId: mutation.changesetId, warnings: mutation.warnings }
    }
    const warnings: MutationWarning[] = []
    if (input.action === "message") {
      if (record.pending) throw new OnboardingError("Your last answer is saved. Retry Sparky’s response before sending another answer.", 409)
      if (record.messages.length >= 79 || record.messages.reduce((total, message) => total + message.content.length, input.message.length) > 32000) throw new OnboardingError("This setup conversation has reached its length limit. Review the saved answers before continuing.", 400)
      record = { ...record, messages: [...record.messages, { role: "user", content: input.message }], pending: true }
      const saved = await save(storage, raw, record, "none")
      raw = saved.raw
      warnings.push(...saved.warnings)
    } else if (!record.pending) {
      throw new OnboardingError("There is no unfinished response to retry.", 409)
    }
    const run = await runSkill({ skill: onboardingSkill, input: record, storage, settings,
      providerOverride: options.providerOverride, onText: options.onText })
    if (run.status !== "ok" || !run.output) {
      throw new OnboardingError(run.status === "budget_exceeded" ? "Your AI budget was reached. Adjust it in Settings, then retry. Your answer is saved."
        : "Sparky could not finish this response. Your answer is saved. Retry, or check your AI connection in Settings.", 502)
    }
    const reply = run.output
    record = { ...record, draft: reply.draft, question: reply.question, pending: false,
      messages: [...record.messages, { role: "assistant", content: reply.message }] }
    const saved = await save(storage, raw, record, resolveTier(settings, "strong").model)
    warnings.push(...saved.warnings)
    return { state: await getOnboardingState(storage), warnings }
  })
}
