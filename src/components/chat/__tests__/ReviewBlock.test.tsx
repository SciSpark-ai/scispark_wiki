// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ReviewBlock } from "../ReviewBlock"
import { readReview, changeReview } from "@/lib/review/client"
import { ReviewRunSchema } from "@/lib/review/contracts"
import { useUIStore } from "@/stores/ui-store"

vi.mock("@/lib/review/client", () => ({ readReview: vi.fn(), changeReview: vi.fn() }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { roots.forEach(root => act(() => root.unmount())); roots.length = 0; document.body.innerHTML = ""; vi.clearAllMocks() })

it("shows the recovery choice for a failed engine call without replaying it on reopen", async () => {
  vi.mocked(readReview).mockResolvedValue({
    run: ReviewRunSchema.parse({ version: 1, id: "review_test", sessionId: "chat_test", status: "paused", stage: "Review paused", revision: 4,
      createdAt: "2026-09-29T07:50:00Z", updatedAt: "2026-09-29T07:51:00Z",
      brief: { question: "Compare research methods", scope: "", sources: ["openalex"], allowanceUsd: 1,
        usePersonalContext: false, context: [], limits: { searchRounds: 2, papers: 6 },
        model: { engine: "codex", provider: "openai", model: "gpt-6-astra", endpoint: "local://codex", rates: null } },
      approvedRevision: 0, ownerPid: null, checkpoints: {}, evidence: [], versions: [], warnings: [], completionEvent: false,
      error: "Codex's connection failed before the request finished.",
    }),
    spending: { engineCalls: 1, spentUsd: 0, heldUsd: 0, uncertain: true },
  })
  const host = document.createElement("div"); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<ReviewBlock id="review_test" />) })
  expect(host.textContent).toContain("Review needs attention")
  expect(host.querySelector("details")?.open).toBe(true)
  expect(host.textContent).toContain("Acknowledge and resume")
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Resume review")).toBe(false)
  expect(changeReview).not.toHaveBeenCalled()
  const blocked = { ...structuredClone(await readReview("review_test")), modelError: "The installed Codex CLI does not list gpt-6-astra as an available model." }
  vi.mocked(readReview).mockResolvedValue(blocked)
  await act(async () => { window.dispatchEvent(new Event("review-changed")) })
  expect(host.textContent).toContain("does not list gpt-6-astra")
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "Acknowledge and resume")?.disabled).toBe(true)
  await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Choose model")!.click() })
  expect(useUIStore.getState().settingsModalSection).toBe("ai")
  useUIStore.getState().closeSettingsModal()
  expect(changeReview).not.toHaveBeenCalled()
  const updated = structuredClone(await readReview("review_test"))
  delete (updated as { modelError?: string }).modelError
  updated.run.status = "awaiting-approval"
  vi.mocked(readReview).mockResolvedValue(updated)
  await act(async () => { window.dispatchEvent(new Event("review-changed")) })
  const start = [...host.querySelectorAll("button")].find(button => button.textContent === "Acknowledge and start review")
  expect(start).toBeDefined()
  await act(async () => { start!.click() })
  expect(changeReview).toHaveBeenCalledWith("review_test", { action: "approve", revision: 4, acknowledgeUncertainCharge: true })
})
