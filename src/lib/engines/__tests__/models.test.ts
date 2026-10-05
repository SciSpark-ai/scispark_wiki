import { expect, it, vi } from "vitest"
import { engineExecutable, runEngineProcess } from "../process"
import { codexModels } from "../models"

vi.mock("../process", () => ({ engineExecutable: vi.fn(), runEngineProcess: vi.fn() }))

it("refreshes an updated CLI catalog on request without waiting for cache expiry", async () => {
  vi.mocked(engineExecutable).mockResolvedValue("/synthetic/codex")
  let model = "initial-model"
  vi.mocked(runEngineProcess).mockImplementation(async (request) => {
    const reply = vi.fn()
    request.onLine?.(JSON.stringify({ id: 1, result: {} }), reply)
    request.onLine?.(JSON.stringify({ id: 2, result: { data: [{ model, displayName: model }] } }), reply)
    return { code: 0, stdout: "", stderr: "" }
  })
  expect(await codexModels()).toEqual([{ id: "initial-model", label: "initial-model" }])
  model = "updated-model"
  expect(await codexModels()).toEqual([{ id: "initial-model", label: "initial-model" }])
  expect(runEngineProcess).toHaveBeenCalledTimes(1)
  expect(await codexModels(true)).toEqual([{ id: "updated-model", label: "updated-model" }])
  expect(await codexModels()).toEqual([{ id: "updated-model", label: "updated-model" }])
  expect(runEngineProcess).toHaveBeenCalledTimes(2)
})
