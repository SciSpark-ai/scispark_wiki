// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuickChat } from "../QuickChat"
import { askChatRemote } from "@/lib/chat/client"
import { loadSession, type ChatSession } from "@/lib/chat/session"
import { observeSkillJob } from "@/lib/skills/job-client"
import { saveAnswerAsQueryRemote } from "@/lib/chat/save-query-client"
import type { SparkySelectionRequest } from "../selection-request"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: vi.fn(async () => ({})) }))
vi.mock("@/lib/papers/resolve", () => ({ resolvePaperBySlug: vi.fn(async () => ({ title: "Attention paper" })) }))
vi.mock("@/lib/chat/session", async importOriginal => ({ ...await importOriginal<object>(), loadSession: vi.fn() }))
vi.mock("@/lib/chat/client", async importOriginal => ({ ...await importOriginal<object>(), askChatRemote: vi.fn() }))
vi.mock("@/lib/skills/job-client", () => ({ observeSkillJob: vi.fn() }))
vi.mock("@/lib/chat/save-query-client", () => ({ saveAnswerAsQueryRemote: vi.fn() }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const request: SparkySelectionRequest = { id: "selection-1", paperSlug: "attention", selection: { text: "CNNT", surrounding: "The encoders are CNNT or FCTNet." } }
const session = { id: "chat_selection", title: "Explain this passage", paperContext: { slug: "attention" }, messages: [
  { role: "user", content: "Explain this passage.", selection: request.selection },
  { role: "assistant", content: "CNNT encodes the EEG signal.", citedPageIds: [] },
] } as ChatSession
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
function render(selectionRequest?: SparkySelectionRequest, open = true) {
  act(() => root.render(<StrictMode><QuickChat open={open} onClose={() => {}} paperSlug="attention" selectionRequest={selectionRequest} /></StrictMode>))
}
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === text)! }
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  vi.mocked(loadSession).mockResolvedValue(session)
  vi.mocked(observeSkillJob).mockResolvedValue(undefined)
})
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); vi.resetAllMocks() })

describe("selected passages in Sparky", () => {
  it("sends once under StrictMode, streams in the shared panel, and preserves the quote", async () => {
    let finish!: (value: Awaited<ReturnType<typeof askChatRemote>>) => void
    vi.mocked(askChatRemote).mockImplementation((_input, _stage, _fetch, onText) => {
      onText?.("CNNT encodes")
      return new Promise(resolve => { finish = resolve })
    })
    render(request); await flush()
    expect(askChatRemote).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askChatRemote).mock.calls[0][0]).toMatchObject({ paperSlug: "attention", selection: request.selection, operationId: "selection-1" })
    expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toBe("CNNT")
    expect(host.querySelector('[data-streaming-reply]')?.textContent).toContain("CNNT encodes")
    await act(async () => finish({ sessionId: "chat_selection", message: session.messages[1] }))
    expect(host.textContent).toContain("CNNT encodes the EEG signal.")
    expect(host.querySelector('[data-streaming-reply]')).toBeNull()
    render(request, false); render(request); await flush()
    expect(askChatRemote).toHaveBeenCalledTimes(1)
  })
  it("restores a running conversation by reading its job, without another model request", async () => {
    sessionStorage.setItem("scispark:quick-chat:attention", "chat_selection")
    let update!: Parameters<typeof observeSkillJob>[1]
    vi.mocked(observeSkillJob).mockImplementation(async (_key, onUpdate) => { update = onUpdate; await onUpdate({ id: "job", key: "chat:chat_selection", status: "running", startedAt: "now", updatedAt: "now", ownerPid: 1 }); await new Promise(() => {}) })
    render(); await flush()
    expect(host.querySelector('[data-streaming-reply]')).not.toBeNull()
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true)
    await act(async () => update({ id: "job", key: "chat:chat_selection", status: "completed", startedAt: "now", updatedAt: "now", ownerPid: null }))
    expect(host.querySelector('[data-streaming-reply]')).toBeNull()
    expect(host.textContent).toContain("CNNT encodes the EEG signal.")
    expect(askChatRemote).not.toHaveBeenCalled()
  })
  it("shows interrupted jobs explicitly without replaying them", async () => {
    sessionStorage.setItem("scispark:quick-chat:attention", "chat_selection")
    vi.mocked(observeSkillJob).mockImplementation(async (_key, update) => { await update({ id: "job", key: "chat:chat_selection", status: "interrupted", startedAt: "now", updatedAt: "now", ownerPid: null, error: "The server stopped. Your question is saved." }) })
    render(); await flush()
    expect(host.textContent).toContain("The server stopped.")
    expect(host.querySelector('[data-streaming-reply]')).toBeNull()
    expect(askChatRemote).not.toHaveBeenCalled()
  })
  it("clears the pending indicator when reconnecting fails", async () => {
    sessionStorage.setItem("scispark:quick-chat:attention", "chat_selection")
    vi.mocked(observeSkillJob).mockImplementation(async (_key, update) => {
      await update({ id: "job", key: "chat:chat_selection", status: "running", startedAt: "now", updatedAt: "now", ownerPid: 1 })
      throw new Error("Could not reconnect. Reopen Sparky to try again.")
    })
    render(); await flush()
    expect(host.querySelector('[data-streaming-reply]')).toBeNull()
    expect(host.textContent).toContain("Could not reconnect")
    expect(askChatRemote).not.toHaveBeenCalled()
  })
  it("keeps a second selection as a draft while a response is running", async () => {
    vi.mocked(askChatRemote).mockImplementation(async () => new Promise(() => {}))
    render(request); await flush()
    render({ ...request, id: "selection-2", selection: { text: "FCTNet" } }); await flush()
    expect(host.querySelector('[aria-label="Selected passage draft"]')?.textContent).toBe("FCTNet")
    expect(askChatRemote).toHaveBeenCalledTimes(1)
  })
  it("shows activity before the first token, then replaces it with streamed text", async () => {
    let text!: (value: string) => void
    vi.mocked(askChatRemote).mockImplementation(async (_input, stage, _fetch, onText) => {
      stage?.("reading"); text = onText!
      return new Promise(() => {})
    })
    render(request); await flush()
    expect(host.querySelector('[data-thinking-dots]')).not.toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Reading this paper…")
    act(() => text("CNNT encodes"))
    expect(host.querySelector('[data-thinking-dots]')).toBeNull()
    expect(host.querySelector('[data-streaming-text]')?.textContent).toBe("CNNT encodes")
    expect(host.querySelector('[data-streaming-reply] button')).toBeNull()
  })
  it("ends the spinner and shows a transport failure", async () => {
    vi.mocked(askChatRemote).mockRejectedValue(new Error("Connection lost. Reopen Sparky to check the answer."))
    render(request); await flush()
    expect(host.querySelector('[data-streaming-reply]')).toBeNull()
    expect(host.textContent).toContain("Connection lost")
    expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toBe("CNNT")
  })
  it("guards duplicate save clicks and allows an explicit retry after failure", async () => {
    sessionStorage.setItem("scispark:quick-chat:attention", "chat_selection")
    vi.mocked(saveAnswerAsQueryRemote).mockRejectedValueOnce(new Error("Save unavailable")).mockResolvedValueOnce({ pageId: "wiki/queries/cnnt", changesetId: "save-1" })
    render(); await flush()
    act(() => { button("Save to knowledge base").click(); button("Save to knowledge base").click() }); await flush()
    expect(saveAnswerAsQueryRemote).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain("Save unavailable")
    act(() => button("Save to knowledge base").click()); await flush()
    expect(host.querySelector('a[href="/wiki/queries/cnnt"]')).not.toBeNull()
    expect(askChatRemote).not.toHaveBeenCalled()
  })
})
