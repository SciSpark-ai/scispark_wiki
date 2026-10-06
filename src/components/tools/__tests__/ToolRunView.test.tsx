// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
const roots: { root: ReturnType<typeof createRoot>; node: HTMLDivElement }[] = []
async function render(element: ReactNode) {
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node); roots.push({ root, node })
  await act(async () => root.render(element))
  return { rerender: async (next: ReactNode) => { await act(async () => root.render(next)) }, unmount: async () => { await act(async () => root.unmount()); node.remove(); roots.splice(roots.findIndex(x => x.root === root), 1) } }
}
const screen = {
  getByText: (text: string) => { const match = [...document.querySelectorAll("*")].find(el => el.textContent === text); expect(match).toBeTruthy(); return match },
  queryByText: (text: string) => [...document.querySelectorAll("*")].find(el => el.textContent === text) ?? null,
  getByRole: (_role: string, options: { name: string }) => { const match = [...document.querySelectorAll("button")].find(el => (el.getAttribute("aria-label") ?? el.textContent) === options.name); expect(match).toBeTruthy(); return match! },
  queryByRole: (_role: string, options: { name: string }) => [...document.querySelectorAll("button")].find(el => (el.getAttribute("aria-label") ?? el.textContent) === options.name) ?? null,
}
const waitFor = async (check: () => void) => { await act(async () => {}); check() }
const fireEvent = { click: async (button: HTMLButtonElement) => { await act(async () => button.click()) } }

import { workflowFixture } from "@/lib/workflows/__tests__/fixtures"
import { ToolRunDtoSchema, type RunEvent, type ToolRunDto } from "@/lib/workflows/contracts"
import { ToolRunView } from "../ToolRunView"
const mocks = vi.hoisted(() => ({ get: vi.fn(), watch: vi.fn(), act: vi.fn(), start: vi.fn(), report: vi.fn(), brief: vi.fn(), profile: "11111111-1111-4111-8111-111111111111" }))
vi.mock("@/components/layout/ProfileGate", () => ({ useLocalProfile: () => ({ id: mocks.profile }) }))
vi.mock("@/lib/workflows/client", () => ({ getToolRunRemote: mocks.get, watchToolRunRemote: mocks.watch, actOnToolRunRemote: mocks.act, startToolRemote: mocks.start }))
vi.mock("@/components/chat/ReviewReport", () => ({ ReviewReport: (props: unknown) => { mocks.report(props); return <div>Existing review report</div> } }))
vi.mock("@/components/chat/ReviewBlock", () => ({ ReviewBlock: (props: { id: string; onOpenReport?: () => void }) => { mocks.brief(props); return <button onClick={props.onOpenReport}>Existing native brief</button> } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
let snapshot: ToolRunDto, observers: { event: (e: RunEvent) => Promise<void>; signal: AbortSignal }[]
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); mocks.profile = workflowFixture().ctx.profileId; observers = []
  snapshot = ToolRunDtoSchema.strip().parse({ ...workflowFixture().run, status: "paused_limit", usage: { modelCalls: 3, commandCalls: 0, activeSeconds: 12, costUsd: null } })
  mocks.get.mockImplementation(async () => snapshot)
  mocks.watch.mockImplementation(async (_id, event, signal) => { observers.push({ event, signal }); await new Promise(resolve => signal.addEventListener("abort", resolve)) })
  mocks.act.mockImplementation(async (_id, input) => { snapshot = { ...snapshot, status: input.action === "extend" ? "paused_limit" : "running" }; return snapshot })
})
afterEach(async () => { for (const { root, node } of roots.splice(0)) { await act(async () => root.unmount()); node.remove() } })
describe("saved run observers", () => {
  it("opens an existing disabled tool read-only and continues its cumulative run", async () => {
    await render(<ToolRunView runId={snapshot.id} />)
    expect(await screen.getByRole("button", { name: "Continue" })).toBeTruthy()
    expect(screen.getByText("3 calls used")).toBeTruthy(); expect(mocks.start).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(mocks.act).toHaveBeenCalledTimes(2))
    expect(mocks.act.mock.calls.every(call => call[0] === snapshot.id)).toBe(true)
  })
  it("two observers detach independently, show partial Markdown and flush final text", async () => {
    snapshot = { ...snapshot, status: "running" }
    const first = await render(<ToolRunView runId={snapshot.id} />), second = await render(<ToolRunView runId={snapshot.id} />)
    await waitFor(() => expect(observers).toHaveLength(2))
    await act(async () => { await observers[0].event({ runId: snapshot.id, seq: 1, type: "text", text: "**Partial" }) })
    expect(screen.getByText("**Partial")).toBeTruthy()
    await first.unmount(); expect(observers[0].signal.aborted).toBe(true); expect(observers[1].signal.aborted).toBe(false)
    snapshot = { ...snapshot, status: "completed" }
    await act(async () => { await observers[1].event({ runId: snapshot.id, seq: 2, type: "text", text: "**Final report**" }); await observers[1].event({ runId: snapshot.id, seq: 3, type: "status", status: "completed" }) })
    expect(screen.getByText("Final report")).toBeTruthy(); expect(mocks.start).not.toHaveBeenCalled(); await second.unmount()
  })
  it("clears old profile text immediately and ignores late events", async () => {
    const view = await render(<ToolRunView runId={snapshot.id} />)
    await waitFor(() => expect(observers).toHaveLength(1))
    await act(async () => { await observers[0].event({ runId: snapshot.id, seq: 1, type: "text", text: "Other profile secret" }) })
    mocks.profile = workflowFixture().other.profileId; mocks.get.mockImplementation(() => new Promise(() => {})); await view.rerender(<ToolRunView runId={snapshot.id} />)
    expect(screen.queryByText("Other profile secret")).toBeNull(); expect(observers[0].signal.aborted).toBe(true)
    await act(async () => { await observers[0].event({ runId: snapshot.id, seq: 2, type: "text", text: "Late secret" }) })
    expect(screen.queryByText("Late secret")).toBeNull()
  })
  it("shows Stopping until owner acknowledgement and suppresses duplicate controls", async () => {
    snapshot = { ...snapshot, status: "running", cancelRequested: true }
    await render(<ToolRunView runId={snapshot.id} />)
    expect(await screen.getByText("Stopping…")).toBeTruthy(); expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull()
  })
})
it("shows unknown usage and separates accounting acknowledgement from opaque retry", async () => {
  const stepId = "55555555-5555-4555-8555-555555555555"
  snapshot = { ...snapshot, status: "needs_attention", observation: { text: "Saved partial result", usage: { ...snapshot.usage, heldCostUsd: .5, heldActiveSeconds: 12, heldAttempts: 1, uncertain: true }, uncertainSteps: [{ id: stepId, kind: "model", retryable: true }], saveableArtifactIds: [], saves: [], diagnostics: [] } }
  await render(<ToolRunView runId={snapshot.id} />)
  expect(screen.getByText("Usage pending for 1 attempt(s); reserved limits remain counted.")).toBeTruthy()
  await fireEvent.click(screen.getByRole("button", { name: "Acknowledge uncertain usage" }))
  expect(mocks.act.mock.calls[0][1]).toMatchObject({ action: "reconcile-accounting", resolution: "acknowledge" })
  expect(mocks.act.mock.calls[0][1]).not.toHaveProperty("stepId")
})
it("uses the exact persisted helper ref and native partial choices", async () => {
  const choiceId = "55555555-5555-4555-8555-555555555555", tool = { ...snapshot.tool, skillId: "supporting" }
  snapshot = { ...snapshot, status: "waiting_for_choice", observation: { text: "Retained output", usage: { ...snapshot.usage, heldCostUsd: 0, heldActiveSeconds: 0, heldAttempts: 0, uncertain: false }, choice: { id: choiceId, prompt: "Choose a supporting skill", candidates: [{ tool, label: "Methods helper" }] }, uncertainSteps: [], saveableArtifactIds: [], saves: [], diagnostics: [] } }
  const first = await render(<ToolRunView runId={snapshot.id} />)
  await fireEvent.click(screen.getByRole("button", { name: "Methods helper" }))
  expect(mocks.act.mock.calls[0][1]).toMatchObject({ action: "choose-helper", choiceId, tool })
  await first.unmount()
  snapshot = { ...snapshot, status: "waiting_for_choice", observation: { ...snapshot.observation!, choice: undefined, nativeReview: { retry: false, keep: true } } }
  await render(<ToolRunView runId={snapshot.id} />)
  expect(screen.queryByRole("button", { name: "Resume review" })).toBeNull()
  await fireEvent.click(screen.getByRole("button", { name: "Keep saved report" }))
  expect(mocks.act.mock.calls.at(-1)![1]).toMatchObject({ action: "native-review", resolution: "keep" })
})
it("clears streamed work on a cross-tab profile change before pending network work settles", async () => {
  snapshot = { ...snapshot, status: "running" }
  await render(<ToolRunView runId={snapshot.id} />)
  await act(async () => { await observers[0].event({ runId: snapshot.id, seq: 1, type: "text", text: "Old profile content" }) })
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "scispark-profile-changed", newValue: "new-profile" })))
  expect(screen.queryByText("Old profile content")).toBeNull(); expect(observers[0].signal.aborted).toBe(true)
})

it("opens an exact wording-revision report without a conversation, keeps it after stop, and gates fresh submission until accounting resolves", async () => {
  const stepId = "55555555-5555-4555-8555-555555555555", reviewId = `review_${"a".repeat(32)}`
  snapshot = { ...snapshot, sessionId: undefined, status: "needs_attention", observation: { text: "", usage: { ...snapshot.usage, heldCostUsd: .5, heldActiveSeconds: 12, heldAttempts: 1, uncertain: true }, uncertainSteps: [{ id: stepId, kind: "read", retryable: false, recovery: { kind: "native_revision", reviewId } }], saveableArtifactIds: [], saves: [], diagnostics: [] } }
  mocks.act.mockImplementation(async (_id, input) => {
    snapshot = { ...snapshot, status: "cancelled", observation: { ...snapshot.observation!, usage: { ...snapshot.observation!.usage, uncertain: input.action !== "reconcile-accounting", heldAttempts: input.action !== "reconcile-accounting" ? 1 : 0 } } }; return snapshot
  })
  await render(<ToolRunView runId={snapshot.id} />)
  expect(document.body.textContent).toContain("Wording revisions need a new explicit revision")
  expect(screen.queryByRole("button", { name: "Acknowledge and retry action" })).toBeNull()
  await fireEvent.click(screen.getByRole("button", { name: "Open review report" }))
  expect(mocks.report.mock.calls.at(-1)![0]).toMatchObject({ id: reviewId, historyLabel: "Saved in History" })
  expect(mocks.report.mock.calls.at(-1)![0].revisionBlockedReason).toBeTruthy(); expect(mocks.act).not.toHaveBeenCalled()
  await fireEvent.click(screen.getByRole("button", { name: "Stop this run" }))
  expect(screen.getByText("Existing review report")).toBeTruthy()
  expect(mocks.report.mock.calls.at(-1)![0].revisionBlockedReason).toBeTruthy()
  await fireEvent.click(screen.getByRole("button", { name: "Acknowledge uncertain usage" }))
  expect(mocks.report.mock.calls.at(-1)![0].revisionBlockedReason).toBeUndefined()
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "scispark-profile-changed", newValue: "new-profile" })))
  expect(screen.queryByText("Existing review report")).toBeNull()
})

it("shows the exact native brief in Tools with a local report, and suppresses a standalone chat duplicate", async () => {
  const id = `review_${"a".repeat(32)}`
  snapshot = { ...snapshot, status: "waiting_for_choice", observation: { text: "", usage: { ...snapshot.usage, heldCostUsd: 0, heldActiveSeconds: 0, heldAttempts: 0, uncertain: false }, nativeReviewId: id, uncertainSteps: [], saves: [], saveableArtifactIds: [], diagnostics: [] } }
  const view = await render(<ToolRunView runId={snapshot.id} />)
  expect(mocks.brief).toHaveBeenCalledWith(expect.objectContaining({ id }))
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull()
  await fireEvent.click(screen.getByRole("button", { name: "Existing native brief" }))
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ id }))
  await view.rerender(<ToolRunView runId={snapshot.id} standaloneReviewIds={[id]} reportInChat />)
  expect(screen.queryByRole("button", { name: "Existing native brief" })).toBeNull()
  expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.act).not.toHaveBeenCalled()
})

it("shows the retained human root name and explains subscription limits",async()=>{
 snapshot={...snapshot,toolName:"Evidence Atlas",tool:{...snapshot.tool,skillId:"SKILL.md"}}
 await render(<ToolRunView runId={snapshot.id}/>)
 expect(document.querySelector("h1")?.textContent).toBe("Evidence Atlas")
 expect(document.body.textContent).toContain("This engine does not report dollar cost. Call and time limits still apply.")
 expect(document.querySelector("details")?.textContent).toContain("SKILL.md")
})
