import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../../local-profile-contract"

const request = vi.hoisted(() => ({ token: undefined as string | undefined, expected: null as string | null }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => key === "scispark-session" && request.token ? { value: request.token } : undefined }),
  headers: async () => ({ get: (key: string) => key === "x-scispark-profile" ? request.expected : null }),
}))
import { createProfileSession, listLocalProfiles } from "../../server/local-profiles"
import { getWorkflowContext } from "../context"

let root: string | undefined
afterEach(async () => { request.token = undefined; request.expected = null; vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); root = undefined })
describe("authenticated workflow context", () => {
  it("requires authentication and checks the expected profile before capturing ownership", async () => {
    expect(PROFILE_COOKIE).toBe("scispark-session")
    expect(PROFILE_HEADER).toBe("x-scispark-profile")
    root = await mkdtemp(join(tmpdir(), "scispark-workflow-context-"))
    vi.stubEnv("SCISPARK_VAULT", join(root, "vault"))
    vi.stubEnv("SCISPARK_PROFILES_DIR", join(root, "registry"))
    await expect(getWorkflowContext()).rejects.toThrow(/Open a local profile/)
    const [profile] = await listLocalProfiles()
    request.token = (await createProfileSession(profile.id)).token
    request.expected = "different-profile"
    await expect(getWorkflowContext()).rejects.toThrow(/Open a local profile/)
    request.expected = profile.id
    const context = await getWorkflowContext()
    expect(context.profileId).toBe(profile.id)
    request.expected = "another-profile"
    expect(context.profileId).toBe(profile.id)
    expect(context.vaultPath).toBe(profile.vaultPath)
  })
})
