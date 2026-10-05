// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { DeepOutcomeCard } from "../SparkPanel"

let root: Root | undefined, container: HTMLDivElement
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); vi.unstubAllGlobals() })
const outcome = { kind: "proposal" as const, status: "sparked" as const, ideaPageId: "wiki/ideas/fixture", workflowId: "11111111-1111-4111-8111-111111111111", artifactId: "22222222-2222-4222-8222-222222222222" }
async function renderProposal() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<DeepOutcomeCard outcome={outcome} costUsd={0.1} />))
}
describe("native Spark proposal", () => {
  it("offers the durable proposal and writes only after an explicit save", async () => {
    const fetch = vi.fn(async (url: string, options: RequestInit) => { expect(url).toContain("/save"); expect(options.method).toBe("POST"); return Response.json({ result: { changesetId: "fixture" } }) })
    vi.stubGlobal("fetch", fetch)
    await renderProposal()
    expect(container.querySelector("a")!.getAttribute("href")).toContain(`/runs/${outcome.workflowId}/artifacts/${outcome.artifactId}`)
    expect(container.textContent).not.toContain("View idea page")
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => container.querySelector("button")!.click())
    expect(container.textContent).toContain("View idea page")
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(`/api/tools/runs/${outcome.workflowId}/save`)
    expect(JSON.parse(options.body as string)).toMatchObject({ artifactIds: [outcome.artifactId] })
  })
  it("keeps the proposal available after failure and reuses the save operation on retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "conflict" }, { status: 409 })).mockResolvedValueOnce(Response.json({ result: {} }))
    vi.stubGlobal("fetch", fetch)
    await renderProposal()
    await act(async () => container.querySelector("button")!.click())
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain("View proposal")
    await act(async () => container.querySelector("button")!.click())
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[0][1].body).operationId).toBe(JSON.parse(fetch.mock.calls[1][1].body).operationId)
  })
})
