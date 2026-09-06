// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ResearchSearchResult } from "@/lib/skills/research-search-contract"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const {
  routerMock,
  searchParamsMock,
  researchSearchMock,
  getVaultMock,
  logEventMock,
} = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), replace: vi.fn() },
  searchParamsMock: { get: vi.fn(() => null) },
  researchSearchMock: vi.fn(),
  getVaultMock: vi.fn(),
  logEventMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
}))
vi.mock("@/lib/skills/research-search-client", () => ({ researchSearchRemote: researchSearchMock }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: getVaultMock }))
vi.mock("@/lib/events/log", () => ({ logEvent: logEventMock }))
vi.mock("@/lib/papers/resolve", () => ({ resolvePaperByKey: vi.fn() }))
vi.mock("@/lib/reader/handoff", () => ({ writeReaderHandoff: vi.fn() }))

import PapersPage from "../page"

const RESULT: ResearchSearchResult = {
  query: "attention decoding",
  plan: {
    interpretation: "Auditory attention decoding methods",
    sort: "relevance",
    fromDate: null,
    queries: [{ source: "openalex", query: "auditory attention decoding", rationale: "Cover the broader methods literature." }],
  },
  items: [{
    paper: {
      ids: { doi: "10.1/result" },
      title: "Decoding auditory attention from EEG",
      abstract: "We compare neural decoding methods.",
      authors: [{ name: "Ada Author" }],
      year: 2026,
      venue: "Neural Methods",
      citationCount: 4,
      fields: ["Neuroscience"],
      source: "openalex",
    },
    score: 95,
    whyMatch: "Directly compares methods for the requested decoding task.",
    foundBy: [{ source: "openalex", rationale: "Cover the broader methods literature." }],
  }],
  stats: { retrieved: 8, deduplicated: 6 },
  costUsd: 0.01,
  warnings: [],
}

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<PapersPage />))
  return { host, root }
}

function enterTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  act(() => {
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("AI-driven Papers page", () => {
  beforeEach(() => {
    routerMock.push.mockReset()
    routerMock.replace.mockReset()
    researchSearchMock.mockReset()
    getVaultMock.mockReset().mockResolvedValue({})
    logEventMock.mockReset().mockResolvedValue(undefined)
  })

  it("opens with a natural-language research composer and optional source refinements", () => {
    const { host, root } = mount()

    expect(host.textContent).toContain("What do you want to understand?")
    expect(host.textContent).toContain("Sparky will plan the search")
    expect(host.querySelector("select")).toBeNull()
    const scopeButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Search scope"))
    act(() => scopeButton?.click())
    expect(host.textContent).toContain("Semantic Scholar")
    expect(host.textContent).toContain("PubMed")

    act(() => root.unmount())
    host.remove()
  })

  it("sends the question to the AI search flow and renders explained results plus its search brief", async () => {
    researchSearchMock.mockImplementation(async (_input, onStage: (stage: string) => void) => {
      onStage("planning")
      onStage("searching")
      onStage("ranking")
      return RESULT
    })
    const { host, root } = mount()
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement
    enterTextarea(textarea, "attention decoding")
    const submit = host.querySelector('button[aria-label="Search with Sparky"]') as HTMLButtonElement

    await act(async () => submit.click())

    expect(researchSearchMock).toHaveBeenCalledWith({
      query: "attention decoding",
      sources: ["arxiv", "openalex", "s2", "pubmed"],
    }, expect.any(Function))
    expect(host.textContent).toContain("1 paper for “Auditory attention decoding methods”")
    expect(host.textContent).toContain("Decoding auditory attention from EEG")
    expect(host.textContent).toContain("Directly compares methods for the requested decoding task")
    expect(host.textContent).toContain("Search brief")
    expect(host.textContent).toContain("auditory attention decoding")

    act(() => root.unmount())
    host.remove()
  })
})
