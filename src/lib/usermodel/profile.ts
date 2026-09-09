import { revisionOf } from "../projects/revision"
import { makeChangesetId } from "../vault/changesets"
import { commitChangeset, type MutationWarning } from "../vault/mutations"
import type { VaultStorage } from "../vault/storage"
import type { FileChange } from "../vault/types"
import {
  buildUserModelContents,
  readUserModel,
  USER_MODEL_PATHS,
  type OnboardingAnswers,
  type UserModel,
} from "./pages"
import { splitTopics } from "../trending/fields"
import { RecommendationPreferencesSchema, readRecommendationPreferences } from "../recommendation/contract"

export const PROFILE_AVATAR_PATH = "profile/avatar.json"
export const MAX_AVATAR_DATA_URL_LENGTH = 1_500_000

const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/

export interface EditableUserProfile extends OnboardingAnswers {
  avatarDataUrl: string | null
}

export interface UserProfileDetail extends EditableUserProfile {
  revision: string
}

export interface UpdateUserProfileInput extends EditableUserProfile {
  revision: string
  now?: Date
}

export interface UserProfileMutation {
  result: UserProfileDetail
  changesetId: string
  warnings: MutationWarning[]
}

export class UserProfileValidationError extends Error {}
export class UserProfileNotFoundError extends Error {}
export class UserProfileConflictError extends Error {}

function normalizedText(value: unknown, field: string, maxLength: number, required: boolean): string {
  if (typeof value !== "string") throw new UserProfileValidationError(`${field} must be a string`)
  const normalized = value.trim()
  if (required && normalized.length === 0) {
    throw new UserProfileValidationError(`${field} must not be empty`)
  }
  if (normalized.length > maxLength) {
    throw new UserProfileValidationError(`${field} must be at most ${maxLength} characters`)
  }
  return normalized
}

function normalizeAnswers(value: OnboardingAnswers): OnboardingAnswers {
  const preferences = value.recommendations === undefined ? undefined : RecommendationPreferencesSchema.safeParse(value.recommendations)
  if (preferences && !preferences.success) throw new UserProfileValidationError("invalid recommendation settings")
  return {
    name: normalizedText(value.name, "name", 100, true),
    role: normalizedText(value.role, "role", 1_000, true),
    fields: normalizedText(value.fields, "fields", 2_000, true),
    topics: normalizedText(value.topics, "topics", 4_000, false),
    feedPrefs: normalizedText(value.feedPrefs, "feedPrefs", 4_000, false),
    ...(preferences?.success ? { recommendations: preferences.data } : {}),
  }
}

function normalizeAvatar(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") {
    throw new UserProfileValidationError("avatarDataUrl must be a string or null")
  }
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new UserProfileValidationError("profile picture is too large")
  }
  if (!DATA_IMAGE_RE.test(value)) {
    throw new UserProfileValidationError("profile picture must be a PNG, JPEG, or WebP image")
  }
  return value
}

function sectionBody(markdown: string | null, heading: string): string {
  if (!markdown) return ""
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start < 0) return ""
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start + 1, end).join("\n").trim()
}

function replaceSection(
  markdown: string,
  heading: string,
  body: string,
  insertBeforeHeading?: string,
): string {
  const lines = markdown.replace(/\s+$/, "").split("\n")
  const headingLine = `## ${heading}`
  const start = lines.findIndex((line) => line.trim() === headingLine)
  const replacement = [headingLine, "", body]

  if (start >= 0) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index++) {
      if (/^##\s+/.test(lines[index])) {
        end = index
        break
      }
    }
    lines.splice(start, end - start, ...replacement, "")
  } else {
    const insertAt = insertBeforeHeading
      ? lines.findIndex((line) => line.trim() === `## ${insertBeforeHeading}`)
      : -1
    const block = [headingLine, "", body, ""]
    if (insertAt >= 0) lines.splice(insertAt, 0, ...block)
    else lines.push("", ...block)
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`
}

function topicsFromInterests(interests: string | null): string {
  return sectionBody(interests, "Active topics")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join("\n")
}

function activeTopicsBody(topics: string): string {
  return splitTopics(topics).map((topic) => `- ${topic}`).join("\n")
}

function parseAvatar(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as { version?: unknown; avatarDataUrl?: unknown }
    if (value.version !== 1) return null
    return normalizeAvatar(value.avatarDataUrl ?? null)
  } catch {
    return null
  }
}

function avatarRaw(avatarDataUrl: string | null): string | null {
  return avatarDataUrl === null
    ? null
    : `${JSON.stringify({ version: 1, avatarDataUrl }, null, 2)}\n`
}

function answersFromModel(model: UserModel): OnboardingAnswers {
  return {
    name: sectionBody(model.profile, "Name") || "Researcher",
    role: sectionBody(model.profile, "Who I am"),
    fields: sectionBody(model.profile, "Research fields"),
    topics: topicsFromInterests(model.interests),
    feedPrefs: sectionBody(model.profile, "What I want from my feed"),
    recommendations: readRecommendationPreferences(model.profile),
  }
}

async function profileRevision(
  profile: string,
  interests: string,
  avatar: string | null,
): Promise<string> {
  return revisionOf(JSON.stringify([profile, interests, avatar]))
}

async function readCurrent(storage: VaultStorage): Promise<{
  model: UserModel
  profile: string
  interests: string
  avatar: string | null
}> {
  const [model, avatar] = await Promise.all([
    readUserModel(storage),
    storage.read(PROFILE_AVATAR_PATH),
  ])
  if (model.profile === null || model.interests === null) {
    throw new UserProfileNotFoundError("research profile not found")
  }
  return { model, profile: model.profile, interests: model.interests, avatar }
}

export async function getUserProfile(storage: VaultStorage): Promise<UserProfileDetail> {
  const current = await readCurrent(storage)
  return {
    ...answersFromModel(current.model),
    avatarDataUrl: parseAvatar(current.avatar),
    revision: await profileRevision(current.profile, current.interests, current.avatar),
  }
}

export async function createUserProfile(
  storage: VaultStorage,
  rawAnswers: OnboardingAnswers,
  now: Date = new Date(),
): Promise<UserProfileMutation> {
  if (!Number.isFinite(now.getTime())) throw new UserProfileValidationError("now must be a valid date")
  const answers = normalizeAnswers(rawAnswers)
  const existing = await readUserModel(storage)
  if (existing.profile !== null || existing.interests !== null || existing.feedback !== null) {
    throw new UserProfileConflictError("research profile already exists")
  }
  const contents = buildUserModelContents(answers, now)
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "profile-create",
      model: "none",
      timestamp: now.toISOString(),
      changes: [
        { path: USER_MODEL_PATHS.profile, before: null, after: contents.profile },
        { path: USER_MODEL_PATHS.interests, before: null, after: contents.interests },
        { path: USER_MODEL_PATHS.feedback, before: null, after: contents.feedback },
      ],
    },
    { op: "profile-create", summary: answers.name },
  )
  return {
    result: {
      ...answers,
      avatarDataUrl: null,
      revision: await profileRevision(contents.profile, contents.interests, null),
    },
    changesetId: mutation.changesetId,
    warnings: mutation.warnings,
  }
}

export async function updateUserProfile(
  storage: VaultStorage,
  input: UpdateUserProfileInput,
): Promise<UserProfileMutation> {
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new UserProfileValidationError("now must be a valid date")
  if (typeof input.revision !== "string" || !/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new UserProfileValidationError("revision must be a SHA-256 hash")
  }
  const answers = normalizeAnswers(input)
  const avatarDataUrl = normalizeAvatar(input.avatarDataUrl)
  const current = await readCurrent(storage)
  const currentRevision = await profileRevision(current.profile, current.interests, current.avatar)
  if (currentRevision !== input.revision) {
    throw new UserProfileConflictError("research profile changed since it was opened")
  }

  let nextProfile = current.profile
  nextProfile = replaceSection(nextProfile, "Name", answers.name, "Who I am")
  nextProfile = replaceSection(nextProfile, "Who I am", answers.role)
  nextProfile = replaceSection(nextProfile, "Research fields", answers.fields)
  nextProfile = replaceSection(nextProfile, "What I want from my feed", answers.feedPrefs)
  if (answers.recommendations) nextProfile = replaceSection(nextProfile, "Recommendation settings", JSON.stringify(answers.recommendations))
  const nextInterests = replaceSection(current.interests, "Active topics", activeTopicsBody(answers.topics))
  const nextAvatar = avatarRaw(avatarDataUrl)

  const changes: FileChange[] = [
    { path: USER_MODEL_PATHS.profile, before: current.profile, after: nextProfile },
    { path: USER_MODEL_PATHS.interests, before: current.interests, after: nextInterests },
    { path: PROFILE_AVATAR_PATH, before: current.avatar, after: nextAvatar },
  ].filter((change) => change.before !== change.after)

  if (changes.length === 0) {
    throw new UserProfileValidationError("profile has no changes to save")
  }

  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "profile-update",
      model: "none",
      timestamp: now.toISOString(),
      changes,
    },
    { op: "profile-update", summary: answers.name },
  )
  return {
    result: {
      ...answers,
      avatarDataUrl,
      revision: await profileRevision(nextProfile, nextInterests, nextAvatar),
      recommendations: readRecommendationPreferences(nextProfile),
    },
    changesetId: mutation.changesetId,
    warnings: mutation.warnings,
  }
}
