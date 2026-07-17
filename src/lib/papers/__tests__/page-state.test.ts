import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { buildPaperPage, type PaperStatus } from "../../wiki/authoring"
import { applyChangeset, makeChangesetId } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { resolvePaperPageState } from "../page-state"
import type { PaperRecord } from "../types"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

const SLUG = "2409-08710"

async function vaultWithPaperPage(status?: PaperStatus): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  const draft = buildPaperPage(PAPER, { fullText: false, today: "2026-07-17", status })
  const content = serializeDocument(draft.frontmatter, draft.body)
  await applyChangeset(storage, {
    id: makeChangesetId(),
    skill: "test",
    model: "none",
    timestamp: "2026-07-17T00:00:00.000Z",
    changes: [{ path: draft.path, before: null, after: content }],
  })
  return storage
}

describe("resolvePaperPageState", () => {
  it("returns discovery when no paper page exists for the slug", async () => {
    const storage = new MemoryVaultStorage()
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, SLUG)).toEqual({ state: "discovery" })
  })

  it("returns saved for a status: saved page", async () => {
    const storage = await vaultWithPaperPage("saved")
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, SLUG)).toEqual({ state: "saved", status: "saved" })
  })

  it("returns saved for a status: enriched page", async () => {
    const storage = await vaultWithPaperPage("enriched")
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, SLUG)).toEqual({ state: "saved", status: "enriched" })
  })

  it("returns ingested for a status: ingested page", async () => {
    const storage = await vaultWithPaperPage("ingested")
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, SLUG)).toEqual({ state: "ingested", status: "ingested" })
  })

  it("defaults to saved when the page has no status field", async () => {
    const storage = await vaultWithPaperPage(undefined)
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, SLUG)).toEqual({ state: "saved", status: "saved" })
  })

  it("only matches the slug's own page (a different slug is still discovery)", async () => {
    const storage = await vaultWithPaperPage("saved")
    const bundle = await loadBundle(storage)
    expect(resolvePaperPageState(bundle, "some-other-slug")).toEqual({ state: "discovery" })
  })
})
