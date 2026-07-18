// @vitest-environment jsdom
//
// Review-fix regression (Task 10 follow-up, see .superpowers/sdd/task-10-report.md):
// handleEnrich in src/app/paper/[key]/page.tsx did the post-enrich reload
// (loadReadyState) with no try/catch. enrichRemote itself never throws, but
// the reload it's followed by CAN — RemoteVaultStorage.list()/read() throw on
// a transient non-ok /api/vault response. Before the fix, that left
// enrichState stuck on {status:"loading"} forever (Enrich button disabled,
// no error surfaced). This mounts the REAL /paper/[key] page over a real
// MemoryVaultStorage (mirroring PaperSavedState.test.tsx's fixture), drives a
// real click on the real Enrich button, and forces the reload's storage.list
// call to reject only on the second call (the post-enrich reload) — proving
// the button un-sticks and an error renders.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { serializeDocument } from "@/lib/vault/frontmatter"
import { buildPaperPage } from "@/lib/wiki/authoring"
import type { PaperRecord } from "@/lib/papers/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SLUG = "2409-08710"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for Auditory Attention Decoding",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

// getOpenVault is mocked to resolve through this box so each test can point
// it at its own fresh storage instance (vi.mock factories are hoisted above
// the storage a given `it` block creates).
const vaultBox: { current: () => Promise<MemoryVaultStorage> } = {
  current: async () => {
    throw new Error("vaultBox not set")
  },
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: SLUG }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: () => vaultBox.current() }))
// The companion hook pulls in usePathname + a zustand store + a fetch call —
// none of that is relevant to this test, and it's fire-and-forget/best-effort
// by contract, so stub it out entirely rather than wiring all of that up.
vi.mock("@/components/companion/useCompanion", () => ({ useCompanion: () => () => {} }))

import PaperPage from "../../../app/paper/[key]/page"

async function seedStorage(): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  const draft = buildPaperPage(PAPER, { fullText: false, today: "2026-07-17", status: "saved" })
  await storage.write(draft.path, serializeDocument(draft.frontmatter, draft.body))
  return storage
}

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("handleEnrich reload failure (review fix)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ result: { applied: true, tldr: "A short summary." } }), { status: 200 }),
      ),
    )
  })

  it("un-sticks the Enrich button and surfaces an error when the post-enrich reload throws", async () => {
    const storage = await seedStorage()
    vaultBox.current = async () => storage

    const { host, root } = mount()

    await act(async () => {
      root.render(<PaperPage />)
    })
    // Flush the mount effect's async loadReadyState + logEvent.
    await act(async () => {})
    await act(async () => {})

    const enrichButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Enrich")
    expect(enrichButton, "Enrich button should be present once the page reaches saved state").toBeTruthy()

    // Make the NEXT storage.list() call (the post-enrich loadReadyState ->
    // loadBundle -> storage.list("wiki/") call) reject, simulating a
    // transient non-ok /api/vault response. The mount load already
    // completed above, so this only affects the reload triggered by the
    // click below.
    let rejectNextList = true
    const originalList = storage.list.bind(storage)
    vi.spyOn(storage, "list").mockImplementation(async (prefix?: string) => {
      if (rejectNextList) {
        rejectNextList = false
        throw new Error("transient vault error")
      }
      return originalList(prefix)
    })

    await act(async () => {
      enrichButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    // Flush enrichRemote's fetch + the failing reload.
    await act(async () => {})
    await act(async () => {})

    const buttonAfter = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Enrich")
    expect(buttonAfter, "Enrich button should still exist post-failure").toBeTruthy()
    // Un-stuck: not left disabled on "Enriching…".
    expect(buttonAfter!.textContent).toBe("Enrich")
    expect(buttonAfter!.disabled).toBe(false)
    // Error surfaced instead of silently stuck.
    expect(host.textContent).toContain("transient vault error")

    act(() => root.unmount())
    host.remove()
  })
})
