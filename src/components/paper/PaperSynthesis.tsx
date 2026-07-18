import Link from "next/link"
import type { Bundle } from "@/lib/vault/bundle"
import type { WikiPage } from "@/lib/vault/types"
import { Card } from "@/components/ui/Card"
import { Backlinks } from "@/components/wiki/Backlinks"
import { preprocessWikilinks, renderMarkdown } from "@/components/wiki/markdown-preview"
import { wikiHref } from "@/lib/wiki/href"

export interface PaperSynthesisProps {
  bundle: Bundle
  /** The paper's own `wiki/papers/<slug>` bundle page. Its `body` is
   * code-composed by `buildPaperPage` (src/lib/wiki/authoring.ts) —
   * `# title` + an optional `## Digest` section (content from the separate
   * Digest skill, src/lib/skills/digest.ts) + an optional `## Abstract` +
   * an optional `## Links` — never LLM-written: ingest's generation step is
   * forbidden from emitting a file at this page's path (silently dropped if
   * it tries, see `prepareFiles` in src/lib/skills/ingest.ts), so the LLM
   * only ever integrates the paper into OTHER wiki pages, never this one. */
  page: WikiPage
}

/**
 * Drops the leading `# title` heading and the `## Abstract` section from an
 * ingested paper page's body. PaperHeader (rendered directly above this
 * component, in every page state) already shows the title and the
 * abstract, so re-rendering them here would duplicate them. Every other
 * section — `## Digest`, `## Links`, and anything else — is left untouched,
 * since those are the genuinely-new content this component exists to show.
 * Pure function, no rendering — kept separate from PaperSynthesis so it can
 * be unit tested directly (see `__tests__/stripRedundantSynthesisSections.test.ts`).
 */
export function stripRedundantSynthesisSections(body: string): string {
  const lines = body.split("\n")
  let i = 0
  // A leading H1 ("# ...", not "## ..." — the whitespace-after-single-hash
  // check excludes H2+) is always the title per buildPaperPage; drop it and
  // the blank line(s) immediately after it.
  if (/^#\s+.+$/.test(lines[0] ?? "")) {
    i = 1
    while (i < lines.length && lines[i].trim() === "") i++
  }

  const kept: string[] = []
  let skippingAbstract = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (/^##\s+Abstract\s*$/i.test(line)) {
      skippingAbstract = true
      continue
    }
    if (skippingAbstract) {
      if (/^##\s+/.test(line)) {
        skippingAbstract = false
      } else {
        continue
      }
    }
    kept.push(line)
  }

  return kept.join("\n").trim()
}

/**
 * Ingested-state content for `/paper/[key]`: the wiki page's own body,
 * trimmed of its redundant title/abstract (see `stripRedundantSynthesisSections`
 * — PaperHeader above already shows both) and rendered read-only (reusing
 * the wiki editor's preview path — `renderMarkdown`/`preprocessWikilinks`,
 * so `[[wikilinks]]` resolve to real titles/hrefs against `bundle` exactly
 * like `/wiki/[...id]` does), plus its Backlinks and a quiet "Edit in wiki
 * →" escape hatch to the real editable page (which still shows the full,
 * untrimmed body). Display only — editing happens on `/wiki/<type>/<slug>`,
 * not here.
 */
export function PaperSynthesis({ bundle, page }: PaperSynthesisProps) {
  const body = stripRedundantSynthesisSections(page.body)
  return (
    <div className="mt-4">
      {body && <Card className="p-5">{renderMarkdown(preprocessWikilinks(body, bundle))}</Card>}

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
