import Link from "next/link"
import type { Bundle } from "@/lib/vault/bundle"
import type { WikiPage } from "@/lib/vault/types"
import { Card } from "@/components/ui/Card"
import { Backlinks } from "@/components/wiki/Backlinks"
import { preprocessWikilinks, renderMarkdown } from "@/components/wiki/markdown-preview"
import { wikiHref } from "@/lib/wiki/href"

export interface PaperSynthesisProps {
  bundle: Bundle
  /** The paper's own `wiki/papers/<slug>` bundle page — its `body` is the
   * ingested knowledge-base synthesis (whatever the ingest run's LLM step
   * wrote there), the same content `/wiki/[...id]` renders/edits. */
  page: WikiPage
}

/**
 * Ingested-state content for `/paper/[key]`: the wiki page's own body,
 * rendered read-only (reusing the wiki editor's preview path —
 * `renderMarkdown`/`preprocessWikilinks`, so `[[wikilinks]]` resolve to real
 * titles/hrefs against `bundle` exactly like `/wiki/[...id]` does), plus its
 * Backlinks and a quiet "Edit in wiki →" escape hatch to the real editable
 * page. Display only — editing a synthesis happens on `/wiki/<type>/<slug>`,
 * not here.
 */
export function PaperSynthesis({ bundle, page }: PaperSynthesisProps) {
  return (
    <div className="mt-4">
      <Card className="p-5">{renderMarkdown(preprocessWikilinks(page.body, bundle))}</Card>

      <Card className="mt-4 p-5">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-text">Backlinks</div>
        <Backlinks bundle={bundle} id={page.id} />
      </Card>

      <Link
        href={wikiHref(page.id)}
        className="mt-3 inline-block text-[13px] text-muted-text hover:text-espresso transition-colors"
      >
        Edit in wiki →
      </Link>
    </div>
  )
}
