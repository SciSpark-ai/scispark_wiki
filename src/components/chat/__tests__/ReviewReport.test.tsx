// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ReviewReport } from "../ReviewReport"
import { ReviewRunSchema } from "@/lib/review/contracts"
const profile = vi.hoisted(() => ({ id: "profile-a" }))
vi.mock("@/components/layout/ProfileGate", () => ({ useLocalProfile: () => profile }))
let root: ReturnType<typeof createRoot>, node: HTMLDivElement, fetcher: ReturnType<typeof vi.fn>
const run = ReviewRunSchema.parse({ version: 1, id: "review_test", sessionId: "native_tools", status: "paused", stage: "Paused", revision: 1,
  createdAt: "2026-09-29T07:50:00Z", updatedAt: "2026-09-29T07:51:00Z", brief: { question: "Compare methods", scope: "", sources: ["openalex"], allowanceUsd: 1, usePersonalContext: false, context: [], limits: { searchRounds: 2, papers: 6 }, model: { engine: "codex", provider: "openai", model: "fixture", endpoint: "local://codex", rates: null } },
  approvedRevision: 1, ownerPid: null, checkpoints: {}, evidence: [], versions: [{ id: "version_1", parent: null, createdAt: "2026-09-29T07:50:00Z", markdown: "Retained report", verification: "needs-review", author: "pipeline", sourceIds: [] }], warnings: [], completionEvent: false, error: null })
async function render(blocked?: string) { await act(async () => root.render(<ReviewReport id={run.id} onClose={() => {}} historyLabel="Saved in History" revisionBlockedReason={blocked} />)) }
beforeEach(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; profile.id = "profile-a"; sessionStorage.clear(); node = document.createElement("div"); document.body.append(node); root = createRoot(node)
  fetcher = vi.fn(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { result: run } : { run, spending: { spentUsd: 0, heldUsd: 0, uncertain: false } }), { status: 200 })); vi.stubGlobal("fetch", fetcher) })
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals() })
it("opening is read-only and explicit wording revision uses the existing POST only after recovery", async () => {
  await render("Stop the run and reconcile usage first.")
  expect(node.textContent).toContain("Saved in History"); expect(fetcher.mock.calls.every(call => call[1]?.method !== "POST")).toBe(true)
  const textarea = node.querySelector('textarea[aria-label="Revision request"]') as HTMLTextAreaElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Clarify wording"); textarea.dispatchEvent(new Event("input", { bubbles: true })) })
  const submit = [...node.querySelectorAll("button")].find(b => b.textContent === "Revise wording")!
  expect(submit.disabled).toBe(true)
  await act(async () => textarea.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(fetcher.mock.calls.some(call => call[1]?.method === "POST")).toBe(false)
  await render(); expect(submit.disabled).toBe(false)
  await act(async () => textarea.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  const posted = fetcher.mock.calls.find(call => call[1]?.method === "POST")!
  expect(posted[0]).toBe("/api/reviews/review_test"); expect(JSON.parse(posted[1].body)).toEqual({ action: "revise", parent: "version_1", instruction: "Clarify wording" })
})
it("scopes drafts by profile and retains them across same-profile navigation", async () => {
  sessionStorage.setItem("review-edit:profile-a:review_test", JSON.stringify({ text: "Private A draft", parent: "version_1" }))
  sessionStorage.setItem("review-edit:review_test", JSON.stringify({ text: "Unscoped legacy draft", parent: "version_1" }))
  await render(); expect((node.querySelector('textarea[aria-label="Edit review report"]') as HTMLTextAreaElement).value).toBe("Private A draft")
  profile.id = "profile-b"; await render(); expect(node.querySelector('textarea[aria-label="Edit review report"]')).toBeNull(); expect(node.textContent).not.toContain("Private A draft")
  profile.id = "profile-a"; await render(); expect((node.querySelector('textarea[aria-label="Edit review report"]') as HTMLTextAreaElement).value).toBe("Private A draft")
})
