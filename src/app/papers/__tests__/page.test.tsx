// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ResearchSearchResult } from "@/lib/skills/research-search-contract"
import type { ChatSession } from "@/lib/chat/session"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: { get: vi.fn<(key: string) => string | null>(() => null) },
  ask: vi.fn(), vault: vi.fn(), list: vi.fn(), load: vi.fn(),
  resolve: vi.fn(), handoff: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => mocks.params }))
vi.mock("@/lib/chat/client", () => ({ askChatRemote: mocks.ask }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: mocks.vault }))
vi.mock("@/lib/chat/session", () => ({ listSessions: mocks.list, loadSession: mocks.load }))
vi.mock("@/lib/vault/bundle", () => ({ loadBundle: async () => ({ pages: new Map(), links: [], errors: [] }) }))
vi.mock("@/lib/papers/resolve", () => ({ resolvePaperByKey: mocks.resolve }))
vi.mock("@/lib/reader/handoff", () => ({ writeReaderHandoff: mocks.handoff }))

import PapersPage from "../page"
import { ChatWorkspace } from "@/components/chat/ChatWorkspace"
import { useUIStore } from "@/stores/ui-store"

const RESULT: ResearchSearchResult = {
  query: "attention decoding",
  plan: { interpretation: "Auditory attention decoding methods", sort: "relevance", fromDate: null,
    queries: [{ source: "openalex", query: "auditory attention decoding", rationale: "Cover methods." }] },
  items: [{ paper: { ids: { doi: "10.1/result" }, title: "Decoding auditory attention from EEG",
    abstract: "We compare neural decoding methods.", authors: [{ name: "Ada Author" }],
    year: 2026, venue: "Neural Methods", citationCount: 4, fields: ["Neuroscience"], source: "openalex" },
    score: 95, whyMatch: "Directly compares methods for the requested decoding task.",
    foundBy: [{ source: "openalex", rationale: "Cover methods." }] }],
  stats: { retrieved: 8, deduplicated: 6 }, costUsd: 0.01, warnings: [],
}
const SESSION: ChatSession = {
  id: "chat_search", title: "attention decoding", createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
  messages: [{ role: "user", content: RESULT.query }, { role: "assistant", content: "Found one matching paper.",
    blocks: [{ type: "paper-results", retrievedAt: "2026-09-07T00:00:00Z", result: RESULT }] }],
}
const disposals: Array<() => void> = []
async function mount(element: React.ReactElement = <PapersPage />) {
  const host = document.createElement("div"); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  const cleanup = () => { act(() => root.unmount()); host.remove() }
  disposals.push(cleanup)
  return { host, cleanup }
}
function enter(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
function button(host: HTMLElement, name: string) {
  return [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name)!
}
describe("Search in the unified conversation workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks(); sessionStorage.clear()
    mocks.params.get.mockReturnValue(null)
    mocks.vault.mockResolvedValue({})
    mocks.list.mockResolvedValue([])
    mocks.load.mockResolvedValue(SESSION)
    mocks.handoff.mockResolvedValue(undefined)
    mocks.ask.mockResolvedValue({ sessionId: SESSION.id, message: SESSION.messages[1] })
    useUIStore.getState().closeSettingsModal()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabledSources: ["arxiv", "openalex", "s2", "pubmed"] })))
  })
  afterEach(() => {
    disposals.splice(0).forEach((dispose) => dispose())
    useUIStore.getState().closeSettingsModal(); vi.unstubAllGlobals()
  })
  it("opens a natural-language composer with optional source refinements", async () => {
    const { host } = await mount()
    expect(host.textContent).toContain("What would you like to explore?")
    expect(button(host, "Find papers").getAttribute("aria-pressed")).toBe("true")
    act(() => (host.querySelector("summary") ?? button(host, "Search scope")).click())
    expect(host.textContent).toContain("Semantic Scholar")
    expect(host.textContent).toContain("PubMed")
  })
  it("sends a stable conversation and operation id, then opens its persisted result", async () => {
    const { host } = await mount()
    enter(host.querySelector("textarea")!, RESULT.query)
    await act(async () => button(host, "Send").click())
    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({
      question: RESULT.query, mode: "search", sessionId: expect.stringMatching(/^chat_/),
      operationId: expect.any(String), sources: ["arxiv", "openalex", "s2", "pubmed"],
    }), expect.any(Function), undefined, expect.any(Function))
    expect(mocks.router.push).toHaveBeenCalledWith("/chat/chat_search")
    const saved = await mount(<ChatWorkspace sessionId={SESSION.id} />)
    expect(saved.host.textContent).toContain(RESULT.items[0].paper.title)
    expect(saved.host.textContent).toContain(RESULT.items[0].whyMatch)
    expect(saved.host.textContent).toContain("Search details")
    expect(mocks.ask).toHaveBeenCalledTimes(1)
  })
  it("offers recent searches without redirecting, and restores an explicitly opened session", async () => {
    mocks.list.mockResolvedValue([SESSION])
    const { host } = await mount()
    expect(mocks.router.replace).not.toHaveBeenCalled()
    expect(host.querySelector('a[href="/chat/chat_search"]')).toBeTruthy()
    await mount(<ChatWorkspace sessionId={SESSION.id} />)
    expect(mocks.ask).not.toHaveBeenCalled()
  })
  it("starts with saved sources and does not offer disabled indexes", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ enabledSources: ["pubmed", "openalex"] }))
    const { host } = await mount()
    act(() => (host.querySelector("summary") ?? button(host, "Search scope")).click())
    expect(host.textContent).toContain("PubMed")
    expect(host.textContent).not.toContain("Semantic Scholar")
    expect(host.textContent).not.toContain("arXiv")
  })
  it("opens settings in place without losing the transcript or unsent draft", async () => {
    const { host } = await mount(<ChatWorkspace sessionId={SESSION.id} initialMode="search" />)
    const textarea = host.querySelector("textarea")!
    enter(textarea, "attention decoding in adults")
    act(() => (host.querySelector("summary") ?? button(host, "Search scope")).click())
    act(() => button(host, "Manage sources").click())
    expect(useUIStore.getState().settingsModalSection).toBe("sources")
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(mocks.router.replace).not.toHaveBeenCalled()
    act(() => useUIStore.getState().closeSettingsModal())
    expect(textarea.value).toBe("attention decoding in adults")
    expect(host.textContent).toContain(RESULT.items[0].paper.title)
    expect(mocks.ask).not.toHaveBeenCalled()
  })
  it("prevents searching if preferences cannot be loaded", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"))
    const { host } = await mount()
    enter(host.querySelector("textarea")!, "attention")
    expect(button(host, "Send").disabled).toBe(true)
    expect(host.textContent).toContain("Could not load your paper sources")
    expect(mocks.ask).not.toHaveBeenCalled()
  })
  it("preserves old paperKey links through the reader handoff", async () => {
    mocks.params.get.mockImplementation((key) => key === "paperKey" ? "doi:10.1/result" : null)
    mocks.resolve.mockResolvedValue(RESULT.items[0].paper)
    await mount()
    expect(mocks.resolve).toHaveBeenCalledWith({}, "doi:10.1/result")
    expect(mocks.handoff).toHaveBeenCalledWith({}, RESULT.items[0].paper)
    expect(mocks.router.replace).toHaveBeenCalledWith("/paper/10-1-result")
    expect(mocks.ask).not.toHaveBeenCalled()
  })
})
