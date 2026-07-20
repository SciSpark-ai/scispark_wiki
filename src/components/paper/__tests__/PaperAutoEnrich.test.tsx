// @vitest-environment jsdom
//
// Automatic-only enrich (Tong, 2026-07-19 — replaces PaperEnrichError.test.tsx):
// the Enrich button is gone; `/paper/[key]` fires the tier-2 skill itself
// whenever it shows a saved paper that has no TL;DR yet. These tests mount
// the REAL page over a real MemoryVaultStorage and prove:
//   1. the auto-enrich fires exactly once on load (no button anywhere), and
//      the merged TL;DR renders under the "At a glance" heading; and
//   2. the Task-10 review regression still holds in the new shape — a
//      post-enrich reload failure surfaces an error instead of leaving the
//      "Summarizing…" status stuck forever.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { parseDocument, serializeDocument } from "@/lib/vault/frontmatter"
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

const TLDR = "A wearable ear-EEG method for tracking auditory attention."

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
// none of that is relevant here, and it's best-effort by contract.
vi.mock("@/components/companion/useCompanion", () => ({ useCompanion: () => () => {} }))

import PaperPage from "../../../app/paper/[key]/page"

async function seedSavedPage(storage: MemoryVaultStorage): Promise<string> {
  const draft = buildPaperPage(PAPER, { today: "2026-07-17", status: "saved" })
  await storage.write(draft.path, serializeDocument(draft.frontmatter, draft.body))
  return draft.path
}

/** Writes `tldr` into the seeded page's frontmatter — the server-side effect
 * the real /api/skills/enrich route has, which the stubbed fetch must
 * reproduce for the post-enrich reload to show anything new. */
async function mergeTldrIntoPage(storage: MemoryVaultStorage, path: string): Promise<void> {
  const raw = await storage.read(path)
  if (raw === null) throw new Error(`seeded page missing at ${path}`)
  const { frontmatter, body } = parseDocument(raw)
  frontmatter.tldr = TLDR
  frontmatter.status = "enriched"
  await storage.write(path, serializeDocument(frontmatter, body))
}

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {})
  }
}

describe("paper page automatic enrich", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("fires enrich once on load for a saved paper without a TL;DR and renders the result — no Enrich button", async () => {
    const storage = new MemoryVaultStorage()
    const pagePath = await seedSavedPage(storage)
    vaultBox.current = async () => storage

    const enrichCalls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/api/skills/enrich")) {
          enrichCalls.push(String(init?.body))
          await mergeTldrIntoPage(storage, pagePath)
          return new Response(JSON.stringify({ result: { applied: true, tldr: TLDR } }), { status: 200 })
        }
        throw new Error(`unexpected fetch in test: ${url}`)
      }),
    )

    const { host, root } = mount()
    await act(async () => {
      root.render(<PaperPage />)
    })
    await flush()

    // Automatic-only: no Enrich button anywhere, ever.
    const buttons = Array.from(host.querySelectorAll("button")).map((b) => b.textContent)
    expect(buttons).not.toContain("Enrich")

    // Exactly one enrich run despite the post-enrich reload re-running the effect's deps.
    expect(enrichCalls).toHaveLength(1)

    // The merged TL;DR renders under the renamed heading (2026-07-19: "TL;DR"
    // read as "the digest already ran" — see PaperMeta's doc comment).
    expect(host.textContent).toContain("At a glance")
    expect(host.textContent).toContain(TLDR)
    expect(host.textContent).not.toContain("Summarizing…")

    act(() => root.unmount())
    host.remove()
  })

  it("surfaces an error instead of a stuck Summarizing state when the post-enrich reload throws", async () => {
    const storage = new MemoryVaultStorage()
    await seedSavedPage(storage)
    vaultBox.current = async () => storage

    // Deferred enrich response: lets the mount load finish cleanly first,
    // then arms the reload failure BEFORE the enrich call resolves.
    let releaseEnrich: () => void = () => {}
    const enrichGate = new Promise<void>((resolve) => {
      releaseEnrich = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/skills/enrich")) {
          await enrichGate
          return new Response(JSON.stringify({ result: { applied: true, tldr: TLDR } }), { status: 200 })
        }
        throw new Error(`unexpected fetch in test: ${url}`)
      }),
    )

    const { host, root } = mount()
    await act(async () => {
      root.render(<PaperPage />)
    })
    await flush()

    // The auto-enrich is now in flight (waiting on the gate) and the status
    // line shows.
    expect(host.textContent).toContain("Summarizing…")

    // Arm: the NEXT storage.list() call (the post-enrich reload's
    // loadBundle) rejects, simulating a transient non-ok /api/vault response.
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
      releaseEnrich()
    })
    await flush()

    // Un-stuck: the status line cleared and the failure is visible.
    expect(host.textContent).not.toContain("Summarizing…")
    expect(host.textContent).toContain("transient vault error")

    act(() => root.unmount())
    host.remove()
  })
})
