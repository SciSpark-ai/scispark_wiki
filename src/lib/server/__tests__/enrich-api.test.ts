import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { buildSaveStubChangeset } from "../../papers/save"
import { paperSlug } from "../../wiki/authoring"
import { applyChangeset } from "../../vault/changesets"
import { loadBundle } from "../../vault/bundle"
import type { PaperRecord } from "../../papers/types"
import * as enrichRoute from "../../../app/api/skills/enrich/route"
import type { EnrichRouteResult } from "../../../app/api/skills/enrich/route"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}

async function jsonResult<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result: T }
  return body.result
}

function req(body: unknown): Request {
  return new Request("http://x/api/skills/enrich", { method: "POST", body: JSON.stringify(body) })
}

describe("POST /api/skills/enrich", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }))
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  it("applies a merge changeset for an existing saved page, dropping any related id not in the index", async () => {
    const cs = await buildSaveStubChangeset(storage, PAPER, "2026-07-17")
    await applyChangeset(storage, cs!)
    // A real existing page the skill is allowed to link to.
    await storage.write(
      "wiki/concepts/attention.md",
      "---\ntype: concept\ntitle: Attention\ncreated: '2026-07-17'\nupdated: '2026-07-17'\ntags: []\nrelated: []\nsources: []\n---\n\n# Attention\n",
    )

    setSkillTestOverrides({
      providerOverride: {
        fast: new MockProvider([
          structured({
            tldr: "A study of ear-EEG.",
            tags: ["ear-eeg", "methods"],
            relatedPageIds: ["wiki/concepts/attention", "wiki/concepts/does-not-exist"],
          }),
        ]),
      },
    })

    const slug = paperSlug(PAPER)
    const res = await enrichRoute.POST(req({ slug }))
    expect(res.status).toBe(200)
    const result = await jsonResult<EnrichRouteResult>(res)
    expect(result.applied).toBe(true)
    expect(result.tldr).toBe("A study of ear-EEG.")
    expect(result.tags).toEqual(["ear-eeg", "methods"])
    expect(typeof result.costUsd).toBe("number")

    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(`wiki/papers/${slug}`)
    expect(page?.frontmatter.status).toBe("enriched")
    expect(page?.frontmatter.tldr).toBe("A study of ear-EEG.")
    expect(page?.frontmatter.tags).toEqual(["ear-eeg", "methods"])
    // The nonexistent id was dropped — only the real page survives.
    expect(page?.frontmatter.related).toEqual(["wiki/concepts/attention"])
  })

  it("returns {applied:false} when no page matches the slug", async () => {
    const res = await enrichRoute.POST(req({ slug: "no-such-paper" }))
    expect(res.status).toBe(200)
    const result = await jsonResult<EnrichRouteResult>(res)
    expect(result.applied).toBe(false)
    expect(result.costUsd).toBe(0)
  })

  it("returns {applied:false} (still HTTP 200) when the skill run fails", async () => {
    const cs = await buildSaveStubChangeset(storage, PAPER, "2026-07-17")
    await applyChangeset(storage, cs!)
    // No key configured -> buildProvider throws inside the run.
    await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: {} }))
    setSkillTestOverrides({})

    const slug = paperSlug(PAPER)
    const res = await enrichRoute.POST(req({ slug }))
    expect(res.status).toBe(200)
    const result = await jsonResult<EnrichRouteResult>(res)
    expect(result.applied).toBe(false)

    // The page must be untouched.
    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(`wiki/papers/${slug}`)
    expect(page?.frontmatter.status).toBe("saved")
  })
})
