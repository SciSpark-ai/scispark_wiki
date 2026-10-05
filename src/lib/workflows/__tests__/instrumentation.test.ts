import { afterEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ vault: vi.fn(), review: vi.fn(), heartbeat: vi.fn(), workflow: vi.fn() }))
vi.mock("../../server/vault", () => ({ getDefaultServerVault: mocks.vault }))
vi.mock("../../review/coordinator", () => ({ recoverReviewJobs: mocks.review }))
vi.mock("../../scheduler/heartbeat", () => ({ startHeartbeat: mocks.heartbeat }))
vi.mock("../coordinator", () => ({ startWorkflowCoordinator: mocks.workflow }))
import { register } from "../../../instrumentation"
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

it("returns promptly while retaining review recovery, scheduler and workflow startup", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs")
  vi.stubEnv("NEXT_PHASE", "phase-development-server")
  const vault = {}; mocks.vault.mockResolvedValue(vault)
  let resolve!: () => void
  mocks.review.mockImplementation(() => new Promise<void>(done => { resolve = done }))
  let returned = false
  const registration = register().then(() => { returned = true })
  try {
    await vi.waitFor(() => expect(mocks.review).toHaveBeenCalledWith(vault))
    await vi.waitFor(() => expect(returned).toBe(true), { timeout: 100 })
  } finally { resolve(); await registration }
  await vi.waitFor(() => expect(mocks.heartbeat).toHaveBeenCalledTimes(1))
  expect(mocks.workflow).toHaveBeenCalledTimes(1)
})
it.each([["nodejs", "phase-production-build"], ["edge", "phase-development-server"]])("does not start background work in %s / %s", async (runtime, phase) => {
  vi.stubEnv("NEXT_RUNTIME", runtime); vi.stubEnv("NEXT_PHASE", phase)
  await register()
  expect(mocks.vault).not.toHaveBeenCalled(); expect(mocks.workflow).not.toHaveBeenCalled()
  expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.heartbeat).not.toHaveBeenCalled()
})
