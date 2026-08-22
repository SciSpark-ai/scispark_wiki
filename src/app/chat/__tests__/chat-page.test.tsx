// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { ChatSession } from "@/lib/chat/session"
import type { AskChatResult } from "@/lib/chat/orchestrator"
import type { Bundle } from "@/lib/vault/bundle"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getOpenVaultMock = vi.fn()
const listSessionsMock = vi.fn()
const loadSessionMock = vi.fn()
const loadBundleMock = vi.fn()
const askChatRemoteMock = vi.fn()
const saveAnswerAsQueryRemoteMock = vi.fn()
const getProjectRemoteMock = vi.fn()
const routerPushMock = vi.fn()
let paramsValue: { id?: string } = {}

vi.mock("@/lib/vault/get-vault", () => ({
  getOpenVault: (...args: unknown[]) => getOpenVaultMock(...args),
}))
// Only the two pure/session functions the pages need — NOT the whole real
// module, which would pull VaultStorage plumbing along for the ride.
vi.mock("@/lib/chat/session", () => ({
  listSessions: (...args: unknown[]) => listSessionsMock(...args),
  loadSession: (...args: unknown[]) => loadSessionMock(...args),
}))
vi.mock("@/lib/vault/bundle", () => ({
  loadBundle: (...args: unknown[]) => loadBundleMock(...args),
}))
vi.mock("@/lib/chat/client", () => ({
  askChatRemote: (...args: unknown[]) => askChatRemoteMock(...args),
}))
vi.mock("@/lib/chat/save-query-client", () => ({
  saveAnswerAsQueryRemote: (...args: unknown[]) => saveAnswerAsQueryRemoteMock(...args),
}))
vi.mock("@/lib/projects/client", () => ({
  getProjectRemote: (...args: unknown[]) => getProjectRemoteMock(...args),
  ProjectApiError: class ProjectApiError extends Error {
    constructor(public status: number, message: string) {
      super(message)
    }
  },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useParams: () => paramsValue,
}))

import ChatEntryPage from "../page"
import ChatSessionPage from "../[id]/page"

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "chat_1",
    title: "What is a TRF?",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    messages: [
      { role: "user", content: "What is a TRF?" },
      { role: "assistant", content: "A TRF is a temporal response function.", citedPageIds: [] },
    ],
    ...overrides,
  }
}

function emptyBundle(): Bundle {
  return { pages: new Map(), links: [], errors: [] }
}

async function renderPage(el: React.ReactElement): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(el)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function findByText(container: HTMLElement, selector: string, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll(selector)).find((e) => e.textContent?.trim() === text) as
    | HTMLElement
    | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  paramsValue = {}
  getOpenVaultMock.mockResolvedValue({})
  listSessionsMock.mockResolvedValue([])
  loadSessionMock.mockResolvedValue(null)
  loadBundleMock.mockResolvedValue(emptyBundle())
  getProjectRemoteMock.mockResolvedValue({ id: "auditory-biomarkers" })
})

describe("ChatEntryPage (/chat)", () => {
  it("renders the composer and no clinical suggestion chips", async () => {
    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    expect(container.querySelector("textarea")).toBeTruthy()
    expect(container.textContent).not.toContain("Compare treatments")
    expect(container.textContent).not.toContain("Summarize RCT")
    expect(container.textContent).not.toContain("Find guidelines")
    expect(container.textContent).not.toContain("Risk vs benefit")

    cleanup()
  })

  it("renders the Read Sources Only toggle", async () => {
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    expect(container.textContent).toMatch(/read sources only/i)
    cleanup()
  })

  it("lists recent sessions from the vault", async () => {
    listSessionsMock.mockResolvedValue([session(), session({ id: "chat_2", title: "Second question" })])

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    expect(container.textContent).toContain("What is a TRF?")
    expect(container.textContent).toContain("Second question")

    cleanup()
  })

  it("submitting calls the orchestrator client and routes to the returned session id", async () => {
    const result: AskChatResult = {
      sessionId: "chat_42",
      message: { role: "assistant", content: "A TRF is...", citedPageIds: [] },
    }
    askChatRemoteMock.mockResolvedValue(result)

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "What is a TRF?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    const [input] = askChatRemoteMock.mock.calls[0]
    expect(input).toMatchObject({ sessionId: null, question: "What is a TRF?", readSourcesOnly: false })
    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat_42")

    cleanup()
  })

  it("shows the request error inline and does not route when the orchestrator call rejects", async () => {
    askChatRemoteMock.mockRejectedValue(new Error("network down"))

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "What is a TRF?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(container.textContent).toContain("network down")
    expect(routerPushMock).not.toHaveBeenCalled()

    cleanup()
  })
})

describe("ChatSessionPage (/chat/[id])", () => {
  it("renders a persisted session's turns", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(session())

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("What is a TRF?")
    expect(container.textContent).toContain("A TRF is a temporal response function.")

    cleanup()
  })

  it("labels a project-scoped transcript and verifies its live scope", async () => {
    paramsValue = { id: "chat_project" }
    loadSessionMock.mockResolvedValue(session({
      id: "chat_project",
      projectId: "auditory-biomarkers",
      projectTitle: "Auditory Biomarkers",
    }))

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("Project conversation · Auditory Biomarkers")
    expect(container.textContent).toContain("Scoped to current members")
    expect(getProjectRemoteMock).toHaveBeenCalledWith("auditory-biomarkers")
    cleanup()
  })

  it("keeps a deleted-project transcript readable and disables continuation", async () => {
    paramsValue = { id: "chat_deleted" }
    loadSessionMock.mockResolvedValue(session({
      id: "chat_deleted",
      projectId: "deleted-project",
      projectTitle: "Deleted Project",
    }))
    const { ProjectApiError } = await import("@/lib/projects/client")
    getProjectRemoteMock.mockRejectedValue(new ProjectApiError(404, "not found"))

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("The transcript is preserved")
    expect(container.textContent).toContain("A TRF is a temporal response function")
    expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true)
    cleanup()
  })

  it("renders a not-found state instead of crashing when the session id does not resolve", async () => {
    paramsValue = { id: "chat_missing" }
    loadSessionMock.mockResolvedValue(null)

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toMatch(/not found|doesn.t exist|couldn.t find/i)

    cleanup()
  })

  // The case above mocks a RESOLVED null with a valid-shaped id, so it passes
  // whether or not the load is error-handled. This one covers the other exit:
  // `loadSession` REJECTS for an id that isn't a legal path segment (the
  // `sessionPath` guard), and `sessionId` comes straight off the URL — so a
  // stale or hand-typed `/chat/<id>` must still land on the not-found card
  // rather than spinning on "Loading conversation…" forever.
  it("renders not-found (never a permanent spinner) when loading the session rejects", async () => {
    paramsValue = { id: "bad id" }
    loadSessionMock.mockRejectedValue(new Error("invalid session id: bad id"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toMatch(/not found|doesn.t exist|couldn.t find/i)
    expect(container.textContent).not.toMatch(/Loading conversation/i)

    warn.mockRestore()
    cleanup()
  })

  it("appends the new turn returned by the orchestrator client after a follow-up submit", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValueOnce(session())

    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.textContent).toContain("A TRF is a temporal response function.")

    const followUp = session({
      messages: [
        ...session().messages,
        { role: "user", content: "And what modulates it?" },
        { role: "assistant", content: "Attention modulates TRF amplitude.", citedPageIds: [] },
      ],
    })
    loadSessionMock.mockResolvedValueOnce(followUp)
    askChatRemoteMock.mockResolvedValue({
      sessionId: "chat_1",
      message: { role: "assistant", content: "Attention modulates TRF amplitude.", citedPageIds: [] },
    })

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "And what modulates it?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    const [input] = askChatRemoteMock.mock.calls[0]
    expect(input).toMatchObject({ sessionId: "chat_1", question: "And what modulates it?" })
    expect(container.textContent).toContain("Attention modulates TRF amplitude.")

    cleanup()
  })

  it("routes a Save click through saveAnswerAsQueryRemote with the cited page ids", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(
      session({
        messages: [
          { role: "user", content: "What is a TRF?" },
          { role: "assistant", content: "A TRF is...", citedPageIds: ["wiki/concepts/trf"] },
        ],
      }),
    )
    saveAnswerAsQueryRemoteMock.mockResolvedValue({ changesetId: "cs_1", pageId: "wiki/queries/what-is-a-trf" })

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    const saveButton = findByText(container, "button", "Save to knowledge base")!
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(saveAnswerAsQueryRemoteMock).toHaveBeenCalledTimes(1)
    const [opts] = saveAnswerAsQueryRemoteMock.mock.calls[0]
    expect(opts).toMatchObject({
      question: "What is a TRF?",
      answer: "A TRF is...",
      sessionId: "chat_1",
      citedPageIds: ["wiki/concepts/trf"],
    })
    expect(container.innerHTML).toMatch(/href="\/wiki\/queries\/what-is-a-trf"/)

    cleanup()
  })
})
