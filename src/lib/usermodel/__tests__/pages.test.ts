import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { USER_MODEL_PATHS, readUserModel, isOnboarded, seedUserModel } from "../pages"
import type { OnboardingAnswers } from "../pages"

const answers: OnboardingAnswers = {
  role: "PhD student in computational biology",
  fields: "genomics, machine learning",
  topics: "protein folding\nsingle-cell RNA-seq",
  feedPrefs: "mostly preprints, methods-heavy",
}

describe("isOnboarded", () => {
  it("is false on a fresh vault", async () => {
    const storage = new MemoryVaultStorage()
    expect(await isOnboarded(storage)).toBe(false)
  })

  it("is true after seedUserModel has run", async () => {
    const storage = new MemoryVaultStorage()
    await seedUserModel(storage, answers, () => new Date(2026, 6, 12, 9, 0, 0))
    expect(await isOnboarded(storage)).toBe(true)
  })
})

describe("seedUserModel", () => {
  it("writes profile.md, interests.md, feedback.md each containing the injected answers verbatim", async () => {
    const storage = new MemoryVaultStorage()
    await seedUserModel(storage, answers, () => new Date(2026, 6, 12, 9, 0, 0))

    const profile = await storage.read(USER_MODEL_PATHS.profile)
    const interests = await storage.read(USER_MODEL_PATHS.interests)
    const feedback = await storage.read(USER_MODEL_PATHS.feedback)

    expect(profile).not.toBeNull()
    expect(profile).toContain("# Profile")
    expect(profile).toContain("Seeded by onboarding on 2026-07-12")
    expect(profile).toContain("## Who I am")
    expect(profile).toContain(answers.role)
    expect(profile).toContain("## Research fields")
    expect(profile).toContain(answers.fields)
    expect(profile).toContain("## What I want from my feed")
    expect(profile).toContain(answers.feedPrefs)

    expect(interests).not.toBeNull()
    expect(interests).toContain("# Interests")
    expect(interests).toContain("Maintained by the Memory-Consolidation Skill")
    expect(interests).toContain("## Active topics")
    expect(interests).toContain("- protein folding")
    expect(interests).toContain("- single-cell RNA-seq")
    expect(interests).toContain("## Rising")
    expect(interests).toContain("## Fading")

    expect(feedback).not.toBeNull()
    expect(feedback).toContain("# Standing instructions")
    expect(feedback).toContain("Tell the agents how to behave")
    expect(feedback).toContain("- (none yet)")
  })

  it("throws when profile.md already exists (refuses to re-seed)", async () => {
    const storage = new MemoryVaultStorage()
    await seedUserModel(storage, answers, () => new Date(2026, 6, 12, 9, 0, 0))

    await expect(
      seedUserModel(storage, answers, () => new Date(2026, 6, 13, 9, 0, 0)),
    ).rejects.toThrow("user model already seeded")
  })
})

describe("readUserModel", () => {
  it("round-trips content written by seedUserModel", async () => {
    const storage = new MemoryVaultStorage()
    await seedUserModel(storage, answers, () => new Date(2026, 6, 12, 9, 0, 0))

    const model = await readUserModel(storage)
    expect(model.profile).toContain(answers.role)
    expect(model.interests).toContain("- protein folding")
    expect(model.feedback).toContain("- (none yet)")
  })

  it("returns nulls on a fresh vault", async () => {
    const storage = new MemoryVaultStorage()
    const model = await readUserModel(storage)
    expect(model).toEqual({ profile: null, interests: null, feedback: null })
  })
})
