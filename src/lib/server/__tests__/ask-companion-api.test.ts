import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { ReadingCompanionInput, ReadingAnswer } from "../../skills/reading-companion"
import type { CompanionUtterance } from "../../companion/run"
import type { Changeset } from "../../vault/types"
import { loadBundle } from "../../vault/bundle"
import { applyChangesetRemote } from "../../vault/changeset-client"
import * as askRoute from "../../../app/api/skills/ask/route"
import * as companionRoute from "../../../app/api/skills/companion/route"
import * as changesetRoute from "../../../app/api/vault/changeset/route"

// ---------------------------------------------------------------------------
// Route-in-process fetch, mirroring src/lib/vault/__tests__/remote-storage.test.ts's
// `routeFetch` — dispatches a relative-URL request to the real changeset route
// handler. `applyChangesetRemote` calls `fetchFn("/api/vault/changeset", ...)`
// with a relative path (no base), so this wrapper prefixes an arbitrary origin
// before constructing the `Request` (Node's `Request` constructor requires an
// absolute URL, unlike a browser's document-relative fetch).
// ---------------------------------------------------------------------------
function changesetRouteFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input)
    const url = raw.startsWith("/") ? `http://local${raw}` : raw
    const req = new Request(url, init)
    return changesetRoute.POST(req)
  }) as typeof fetch
}

function structured(json: unknown): LLMResult {
  return {
    text: JSON.stringify(json),
    json,
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "m",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

async function jsonResult<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result: T }
  return body.result
}

describe("reading-companion ask + companion utterance skill routes", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await createVault(storage, { purpose: "Track my ML research reading.", today: "2026-07-14" })
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  describe("POST /api/skills/ask", () => {
    const ASK_INPUT: ReadingCompanionInput = {
      selection: "Sparse attention cuts FLOPs by 40%.",
      surrounding: "...context around the selection...",
      paperMeta: "Title: Efficient Long-Context Attention",
      wikiNeighborhood: "(no related wiki pages found)",
      userQuestion: "Why does this help?",
      companionName: "Ember",
    }

    it("returns the reading-companion skill's answer output", async () => {
      const answer: ReadingAnswer = { answer: "It routes tokens through a sparse gate.", citedPageIds: [] }
      const provider = new MockProvider([structured(answer)])
      setSkillTestOverrides({ providerOverride: { strong: provider } })

      const res = await askRoute.POST(
        new Request("http://x/api/skills/ask", { method: "POST", body: JSON.stringify(ASK_INPUT) }),
      )

      expect(res.status).toBe(200)
      const result = await jsonResult<ReadingAnswer>(res)
      expect(result).toEqual(answer)
      expect(provider.calls).toHaveLength(1)
    })

    it("a skill run failure (no key, no override) returns a 500 error", async () => {
      const res = await askRoute.POST(
        new Request("http://x/api/skills/ask", { method: "POST", body: JSON.stringify(ASK_INPUT) }),
      )
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/missing api key/i)
    })
  })

  describe("POST /api/skills/companion", () => {
    it("a firing trigger under budget returns an utterance", async () => {
      // Seed one active review item so the review-pending trigger fires
      // regardless of route/feed-cache state (simpler to seed than a full
      // FeedResultCacheSchema-valid feed cache for the app-open trigger).
      await storage.write(
        ".scispark/review/rev-1.json",
        JSON.stringify({
          id: "rev-1",
          createdAt: "2026-07-14T00:00:00.000Z",
          changesetId: "cs-1",
          kind: "suggestion",
          title: "Possible duplicate",
          description: "Two pages look similar.",
          pages: [],
        }),
      )

      const utterance = { utterance: "You have 1 item in your review inbox." }
      const provider = new MockProvider([structured(utterance)])
      setSkillTestOverrides({ providerOverride: { fast: provider } })

      const res = await companionRoute.POST(
        new Request("http://x/api/skills/companion", {
          method: "POST",
          body: JSON.stringify({ route: "/papers", sessionShownCount: 0, lastShownTs: {} }),
        }),
      )

      expect(res.status).toBe(200)
      const result = await jsonResult<CompanionUtterance | null>(res)
      expect(result).not.toBeNull()
      expect(result!.trigger).toBe("review-pending")
      expect(result!.text).toBe(utterance.utterance)
      expect(result!.action).toEqual({ label: "Review inbox", href: "/wiki/inbox" })
      expect(provider.calls).toHaveLength(1)
    })

    it("no trigger eligible: a scripted null round-trips as JSON null, not a missing field", async () => {
      const res = await companionRoute.POST(
        new Request("http://x/api/skills/companion", {
          method: "POST",
          body: JSON.stringify({ route: "/papers", sessionShownCount: 0, lastShownTs: {} }),
        }),
      )

      expect(res.status).toBe(200)
      const raw = (await res.clone().text()).trim()
      // Assert the literal wire shape carries a real JSON null, not an absent key.
      expect(raw).toBe('{"result":null}')
      const result = await jsonResult<CompanionUtterance | null>(res)
      expect(result).toBeNull()
    })

    it("session budget exhausted also round-trips null even when a trigger would otherwise fire", async () => {
      const res = await companionRoute.POST(
        new Request("http://x/api/skills/companion", {
          method: "POST",
          // "off"-equivalent isn't reachable from the request alone (chattiness
          // lives in vault settings, defaulting to "medium"/budget 5) — instead
          // exhaust the medium budget via a high sessionShownCount, which the
          // caller (client store) is trusted to report accurately.
          body: JSON.stringify({ route: "/", sessionShownCount: 999, lastShownTs: {} }),
        }),
      )
      expect(res.status).toBe(200)
      const result = await jsonResult<CompanionUtterance | null>(res)
      expect(result).toBeNull()
    })
  })

  describe("note-capture changeset via applyChangesetRemote", () => {
    function noteChangeset(id: string): Changeset {
      return {
        id,
        skill: "reading-companion",
        model: "tier:strong",
        timestamp: "2026-07-14T00:00:00.000Z",
        changes: [
          {
            path: "wiki/notes/note-captured-idea.md",
            before: null,
            after:
              "---\ntype: note\ntitle: Captured idea\ncreated: 2026-07-14\nupdated: 2026-07-14\ntags: []\nrelated: []\nsources: []\n---\n\nAn idea worth remembering.\n",
          },
        ],
      }
    }

    it("applies through the real /api/vault/changeset route and lands in the test vault", async () => {
      await applyChangesetRemote(noteChangeset("cs-note-1"), changesetRouteFetch())

      const bundle = await loadBundle(storage)
      const page = bundle.pages.get("wiki/notes/note-captured-idea")
      expect(page).toBeDefined()
      expect(page!.frontmatter.type).toBe("note")
      expect(page!.body).toContain("An idea worth remembering.")
    })

    it("surfaces a 400 {error} (changeset id collision) as a thrown Error", async () => {
      const changeset = noteChangeset("cs-note-2")
      await applyChangesetRemote(changeset, changesetRouteFetch())

      await expect(applyChangesetRemote(changeset, changesetRouteFetch())).rejects.toThrow()
    })
  })
})
