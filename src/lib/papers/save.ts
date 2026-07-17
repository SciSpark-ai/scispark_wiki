import type { VaultStorage } from "../vault/storage"
import type { Changeset } from "../vault/types"
import type { PaperRecord } from "./types"
import { buildPaperPage, paperSlug } from "../wiki/authoring"
import { serializeDocument } from "../vault/frontmatter"
import { makeChangesetId } from "../vault/changesets"
import { loadBundle } from "../vault/bundle"
import { loadRouting } from "../wiki/schema-routing"

/** Tier-1 save: a deterministic, LLM-free changeset that writes the paper's
 * metadata+abstract as a `status: "saved"` wiki page. Returns null when the
 * page already exists (a re-save is a no-op, never a duplicate). Full-text
 * availability isn't known at save time from metadata alone, so `full_text`
 * is set false here; a later ingest updates it. */
export async function buildSaveStubChangeset(
  storage: VaultStorage,
  paper: PaperRecord,
  today: string,
): Promise<Changeset | null> {
  const routing = await loadRouting(storage)
  const dir = routing["paper"] ?? "wiki/papers"
  const slug = paperSlug(paper)
  const bundle = await loadBundle(storage)
  if (bundle.pages.has(`${dir}/${slug}`)) return null

  const draft = buildPaperPage(paper, { fullText: false, today, status: "saved", dir })
  const content = serializeDocument(draft.frontmatter, draft.body)
  return {
    id: makeChangesetId(),
    skill: "save",
    model: "none",
    timestamp: `${today}T00:00:00.000Z`,
    changes: [{ path: draft.path, before: null, after: content }],
  }
}
