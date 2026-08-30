import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { undoChangeset } from "../../vault/mutations"
import { USER_MODEL_PATHS, type OnboardingAnswers } from "../pages"
import {
  PROFILE_AVATAR_PATH,
  UserProfileConflictError,
  UserProfileValidationError,
  createUserProfile,
  getUserProfile,
  updateUserProfile,
} from "../profile"

const NOW = new Date("2026-08-29T19:00:00.000Z")
const ANSWERS: OnboardingAnswers = {
  name: "Ada",
  role: "Computational biology researcher",
  fields: "Genomics and machine learning",
  topics: "Protein folding\nSingle-cell RNA-seq",
  feedPrefs: "Methods-heavy papers and useful adjacent work",
}

describe("user profile repository", () => {
  it("creates the complete onboarding profile as one undoable changeset", async () => {
    const storage = new MemoryVaultStorage()
    const mutation = await createUserProfile(storage, ANSWERS, NOW)

    expect(mutation.result).toMatchObject({ ...ANSWERS, avatarDataUrl: null })
    expect(await storage.read(USER_MODEL_PATHS.profile)).toContain("## Name\n\nAda")
    expect(await storage.read(USER_MODEL_PATHS.interests)).toContain("- Protein folding")
    expect(await storage.read(USER_MODEL_PATHS.feedback)).toContain("# Standing instructions")
    expect((await getUserProfile(storage)).revision).toBe(mutation.result.revision)

    await undoChangeset(storage, mutation.changesetId)
    expect(await storage.read(USER_MODEL_PATHS.profile)).toBeNull()
    expect(await storage.read(USER_MODEL_PATHS.interests)).toBeNull()
    expect(await storage.read(USER_MODEL_PATHS.feedback)).toBeNull()
  })

  it("reads a pre-name profile with a safe legacy identity", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      USER_MODEL_PATHS.profile,
      "# Profile\n\n## Who I am\n\nResearch fellow\n\n## Research fields\n\nNeuroscience\n\n## What I want from my feed\n\nReviews\n",
    )
    await storage.write(
      USER_MODEL_PATHS.interests,
      "# Interests\n\n## Active topics\n\n- auditory attention\n\n## Rising\n\n- ear-EEG\n",
    )

    await expect(getUserProfile(storage)).resolves.toMatchObject({
      name: "Researcher",
      role: "Research fellow",
      fields: "Neuroscience",
      topics: "auditory attention",
      feedPrefs: "Reviews",
    })
  })

  it("updates every onboarding answer and avatar while preserving agent-maintained sections", async () => {
    const storage = new MemoryVaultStorage()
    await createUserProfile(storage, ANSWERS, NOW)
    const profileBefore = await storage.read(USER_MODEL_PATHS.profile)
    const interestsBefore = await storage.read(USER_MODEL_PATHS.interests)
    await storage.write(
      USER_MODEL_PATHS.profile,
      `${profileBefore}\n## Private note\n\nKeep this exact section.\n`,
    )
    await storage.write(
      USER_MODEL_PATHS.interests,
      `${interestsBefore?.replace("## Rising\n\n", "## Rising\n\n- multimodal models\n\n")}\n## Watchlist\n\n- journal club\n`,
    )
    const current = await getUserProfile(storage)
    const avatarDataUrl = "data:image/png;base64,aGVsbG8="

    const mutation = await updateUserProfile(storage, {
      revision: current.revision,
      name: "Ada Lovelace",
      role: "Principal investigator",
      fields: "Neuroscience",
      topics: "Language development\nNeuroimaging",
      feedPrefs: "Prioritize methods",
      avatarDataUrl,
      now: new Date("2026-08-29T20:00:00.000Z"),
    })

    expect(mutation.result).toMatchObject({
      name: "Ada Lovelace",
      role: "Principal investigator",
      fields: "Neuroscience",
      topics: "Language development\nNeuroimaging",
      feedPrefs: "Prioritize methods",
      avatarDataUrl,
    })
    expect(await storage.read(USER_MODEL_PATHS.profile)).toContain("Keep this exact section.")
    expect(await storage.read(USER_MODEL_PATHS.interests)).toContain("- multimodal models")
    expect(await storage.read(USER_MODEL_PATHS.interests)).toContain("- journal club")
    expect(await storage.read(PROFILE_AVATAR_PATH)).toContain(avatarDataUrl)
    expect((await getUserProfile(storage)).revision).toBe(mutation.result.revision)
  })

  it("rejects stale revisions and invalid image payloads", async () => {
    const storage = new MemoryVaultStorage()
    const created = await createUserProfile(storage, ANSWERS, NOW)

    await expect(
      updateUserProfile(storage, {
        ...ANSWERS,
        name: "Changed",
        revision: "0".repeat(64),
        avatarDataUrl: null,
      }),
    ).rejects.toBeInstanceOf(UserProfileConflictError)

    await expect(
      updateUserProfile(storage, {
        ...ANSWERS,
        name: "Changed",
        revision: created.result.revision,
        avatarDataUrl: "data:text/html;base64,PGgxPk5vPC9oMT4=",
      }),
    ).rejects.toBeInstanceOf(UserProfileValidationError)
  })
})
