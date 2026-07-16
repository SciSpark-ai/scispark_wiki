import type { VaultStorage } from "../vault/storage"
import { splitTopics } from "../trending/fields"

export const USER_MODEL_PATHS = {
  profile: "profile.md",
  interests: "interests.md",
  feedback: "feedback.md",
} as const

export interface UserModel {
  profile: string | null
  interests: string | null
  feedback: string | null
}

export async function readUserModel(storage: VaultStorage): Promise<UserModel> {
  const [profile, interests, feedback] = await Promise.all([
    storage.read(USER_MODEL_PATHS.profile),
    storage.read(USER_MODEL_PATHS.interests),
    storage.read(USER_MODEL_PATHS.feedback),
  ])
  return { profile, interests, feedback }
}

export async function isOnboarded(storage: VaultStorage): Promise<boolean> {
  return (await storage.read(USER_MODEL_PATHS.profile)) !== null
}

export interface OnboardingAnswers {
  role: string
  fields: string
  topics: string
  feedPrefs: string
}

function formatDate(date: Date): string {
  // Local calendar day, not UTC — the label should match the day the user experienced.
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function buildProfile(answers: OnboardingAnswers, now: Date): string {
  return [
    "# Profile",
    "",
    `_Seeded by onboarding on ${formatDate(now)}. Edit freely — agents read this before every feed run._`,
    "",
    "## Who I am",
    "",
    answers.role,
    "",
    "## Research fields",
    "",
    answers.fields,
    "",
    "## What I want from my feed",
    "",
    answers.feedPrefs,
    "",
  ].join("\n")
}

function buildInterests(answers: OnboardingAnswers): string {
  // Split on newlines AND commas/semicolons so a free-text answer becomes one
  // topic per bullet — the trending dashboard derives its tracked fields from
  // these bullets, and a single blob bullet would become one unqueryable field.
  const topics = splitTopics(answers.topics)
    .map((topic) => `- ${topic}`)
    .join("\n")

  return [
    "# Interests",
    "",
    "_Maintained by the Memory-Consolidation Skill from your activity. Edit freely._",
    "",
    "## Active topics",
    "",
    topics,
    "",
    "## Rising",
    "",
    "## Fading",
    "",
  ].join("\n")
}

function buildFeedback(): string {
  return [
    "# Standing instructions",
    "",
    '_Tell the agents how to behave — e.g. "never show preprints", "more methods papers". They obey this file._',
    "",
    "- (none yet)",
    "",
  ].join("\n")
}

export async function seedUserModel(
  storage: VaultStorage,
  answers: OnboardingAnswers,
  now: () => Date = () => new Date(),
): Promise<void> {
  if ((await storage.read(USER_MODEL_PATHS.profile)) !== null) {
    throw new Error("user model already seeded")
  }

  const nowDate = now()
  await Promise.all([
    storage.write(USER_MODEL_PATHS.profile, buildProfile(answers, nowDate)),
    storage.write(USER_MODEL_PATHS.interests, buildInterests(answers)),
    storage.write(USER_MODEL_PATHS.feedback, buildFeedback()),
  ])
}
