// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ToolArtifacts } from "../ToolArtifacts"
import type { Artifact } from "@/lib/workflows/contracts"
const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("@/lib/workflows/client", () => ({ saveToolRunRemote: mocks.save, getToolArtifactRemote: vi.fn() }))
vi.mock("@/components/layout/ProfileGate", () => ({ useLocalProfile: () => ({ id: "profile" }) }))
let root: ReturnType<typeof createRoot>, node: HTMLDivElement
const artifact = (id: string) => ({ id, kind: "markdown", title: id, sourceRefs: [] }) as unknown as Artifact
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333"
const button = () => [...node.querySelectorAll("button")].find(b => b.textContent?.startsWith("Add "))!
async function render(ids: string[]) { await act(async () => root.render(<ToolArtifacts runId="run" artifacts={ids.map(artifact)} saveableArtifactIds={ids} />)) }
beforeEach(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; mocks.save.mockReset(); node = document.createElement("div"); document.body.append(node); root = createRoot(node) })
afterEach(async () => { await act(async () => root.unmount()); node.remove() })
it("saves each exact artifact selection with a distinct operation and preserves previous success", async () => {
  mocks.save.mockResolvedValue({}); await render([a]); await act(async () => button().click())
  expect(node.textContent).toContain("Added to wiki")
  await render([b, a]); expect(button()).toBeTruthy(); expect(node.textContent).not.toContain("Added to wiki")
  await act(async () => button().click()); expect(mocks.save.mock.calls[1][1]).toEqual([b])
  expect(mocks.save.mock.calls[1][2]).not.toBe(mocks.save.mock.calls[0][2])
  await render([a]); expect(node.textContent).toContain("Added to wiki"); expect(button()).toBeUndefined()
})
it("an old pending save response cannot mark an enlarged selection saved", async () => {
  let finish!: (value: object) => void
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render([a]); await act(async () => button().click()); await render([a, b]); await render([a, b, c])
  expect(button()).toBeUndefined(); expect(node.textContent).toContain("Saving…")
  await act(async () => finish({})); expect(node.textContent).not.toContain("Added to wiki"); expect(button()).toBeTruthy()
  mocks.save.mockResolvedValue({}); await act(async () => button().click())
  expect(mocks.save.mock.calls[1][2]).not.toBe(mocks.save.mock.calls[0][2]); expect(mocks.save.mock.calls[1][1]).toEqual([b, c])
})
it("reuses the same operation after a lost response and selection reordering", async () => {
  mocks.save.mockRejectedValueOnce(new Error("response lost")); await render([b, a]); await act(async () => button().click())
  const op = mocks.save.mock.calls[0][2]; await render([a]); await render([a, b]); mocks.save.mockResolvedValue({})
  await act(async () => button().click()); expect(mocks.save.mock.calls[1][2]).toBe(op)
})

it("keeps the server's pending selection fixed until it settles before offering new results", async () => {
  mocks.save.mockResolvedValue({})
  const props = { runId: "run", artifacts: [a, b].map(artifact), saveableArtifactIds: [a, b] }
  await act(async () => root.render(<ToolArtifacts {...props} nextSaveArtifactIds={[a]} saves={[{ changesetId: c, artifactIds: [a], state: "pending" }]} />))
  const pending = [...node.querySelectorAll("button")].find(button => button.textContent === "Check pending save")!
  expect(button()).toBeUndefined(); await act(async () => pending.click()); expect(mocks.save.mock.calls[0][1]).toEqual([a])
  await act(async () => root.render(<ToolArtifacts {...props} nextSaveArtifactIds={[b]} saves={[{ changesetId: c, artifactIds: [a], state: "saved" }]} />))
  expect(button().textContent).toBe("Add new results to wiki"); await act(async () => button().click())
  expect(mocks.save.mock.calls[1][1]).toEqual([b]); expect(mocks.save.mock.calls[1][2]).not.toBe(mocks.save.mock.calls[0][2])
})
