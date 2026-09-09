// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PaperSourcesCard } from "../PaperSourcesCard"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const anonymous = { mode: "anonymous", keySource: null, savedKeyPresent: false }
const saved = { mode: "authenticated", keySource: "vault", savedKeyPresent: true }
let host: HTMLDivElement
let root: Root
let transport: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ s2: anonymous }))
  vi.stubGlobal("fetch", transport)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const mount = async () => { await act(async () => { root.render(<PaperSourcesCard />) }) }
const input = () => host.querySelector<HTMLInputElement>('input[type="password"]')!
const keyButton = () => input().form!.querySelector('button[type="submit"]')!
function enter(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const submit = () => input().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

describe("combined Semantic Scholar save and test", () => {
  it("keeps the main storage copy brief and the privacy details collapsed", async () => {
    await mount()
    expect(host.querySelector("#source-key-privacy")!.textContent).toBe("Your key is saved locally on this device.")
    const details = host.querySelector("details")!
    expect(details.open).toBe(false)
    expect(details.querySelector("summary")!.textContent).toBe("Storage & privacy")
    expect(details.textContent).toContain("without encryption")
    expect(details.textContent).toContain("not included in vault exports")
    expect(host.textContent).not.toContain("Not returned by APIs")
    expect(host.textContent).not.toContain("No shared SciSpark key")
  })
  it("saves before testing once and clears the credential from the field", async () => {
    transport.mockResolvedValueOnce(Response.json({ s2: saved }))
      .mockResolvedValueOnce(Response.json({ result: { outcome: "ok", message: "Connection verified." } }))
    await mount()
    expect(keyButton().textContent).toBe("Save & test connection")
    enter("new-private-key")
    await act(async () => { submit(); submit() })
    expect(transport.mock.calls.map(([, options]) => options?.method)).toEqual([undefined, "PUT", "POST"])
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string)).toEqual({ apiKey: "new-private-key" })
    expect(transport.mock.calls[2][1]!.body).toBe("{}")
    expect(input().value).toBe("")
    expect(host.textContent).toContain("Connection verified")
  })
  it("does not test if saving fails, and retains the draft", async () => {
    transport.mockResolvedValueOnce(Response.json({ error: "save failed" }, { status: 500 }))
    await mount(); enter("new-key")
    await act(async () => { submit() })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(input().value).toBe("new-key")
    expect(host.textContent).toContain("Could not confirm the settings change")
  })
  it("keeps a successfully saved key when the probe is rate-limited or unavailable, then retries without saving again", async () => {
    transport.mockResolvedValueOnce(Response.json({ s2: saved }))
      .mockResolvedValueOnce(Response.json({ result: { outcome: "rate_limited", message: "Rate-limited. Your key is still saved." } }))
      .mockRejectedValueOnce(new Error("network failed"))
    await mount(); enter("new-key")
    await act(async () => { submit() })
    expect(host.textContent).toContain("Your key is still saved")
    expect(host.textContent).toContain("API key configured")
    expect(input().value).toBe("")
    expect(input().required).toBe(false)
    expect(keyButton().textContent).toBe("Test connection")
    await act(async () => { submit() })
    expect(transport.mock.calls.map(([, options]) => options?.method)).toEqual([undefined, "PUT", "POST", "POST"])
    expect(host.textContent).toContain("Your saved key is unchanged")
  })
  it("shows each phase and cannot submit another action while the probe is pending", async () => {
    let finishSave!: (response: Response) => void
    let finishTest!: (response: Response) => void
    transport.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishTest = resolve }))
    await mount(); enter("new-key")
    await act(async () => { submit() })
    expect(host.textContent).toContain("Saving…")
    await act(async () => { finishSave(Response.json({ s2: saved })) })
    expect(host.textContent).toContain("Testing connection…")
    expect(input().disabled).toBe(true)
    await act(async () => { submit() })
    expect(transport).toHaveBeenCalledTimes(3)
    await act(async () => { finishTest(Response.json({ result: { outcome: "ok", message: "Connection verified." } })) })
  })
})
