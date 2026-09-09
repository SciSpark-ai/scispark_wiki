// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PaperSourceSelection } from "../PaperSourceSelection"
import type { SourceId } from "@/lib/papers/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
let transport: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
  transport = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", transport)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const mount = (sources: SourceId[] = ["arxiv", "openalex", "s2", "pubmed"]) => act(() => root.render(<PaperSourceSelection initialSources={sources} />))
const checkbox = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

describe("paper source multi-selection", () => {
  it("saves multiple choices without sending a key or probing the provider", async () => {
    transport.mockResolvedValue(Response.json({ enabledSources: ["arxiv", "pubmed"] }))
    mount()
    act(() => { checkbox("OpenAlex").click(); checkbox("Semantic Scholar").click() })
    await act(async () => { submit(); submit() })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0]).toBe("/api/settings/paper-sources")
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({ enabledSources: ["arxiv", "pubmed"] })
    expect(host.textContent).toContain("Sources saved")
    expect(host.querySelector("button")!.disabled).toBe(true)
  })
  it("displays persisted choices and blocks an empty selection", async () => {
    mount(["pubmed"])
    expect(checkbox("PubMed").checked).toBe(true)
    expect(checkbox("arXiv").checked).toBe(false)
    act(() => checkbox("PubMed").click())
    expect(host.textContent).toContain("Choose at least one source")
    expect(host.querySelector("button")!.disabled).toBe(true)
    await act(async () => { submit() })
    expect(transport).not.toHaveBeenCalled()
  })
  it("retains draft choices and reports failed saves without claiming success", async () => {
    transport.mockResolvedValue(new Response(null, { status: 500 }))
    mount(["pubmed"])
    act(() => checkbox("arXiv").click())
    await act(async () => { submit() })
    expect(checkbox("arXiv").checked).toBe(true)
    expect(host.textContent).toContain("Could not confirm")
    expect(host.textContent).not.toContain("Sources saved")
  })
})
