import { Card } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"

export interface PaperMetaProps {
  /** Tier-2 Enrich Skill one-liner ("what the paper IS") — `frontmatter.tldr`
   * on a saved paper page. Absent until the paper's been enriched. */
  tldr?: string
  /** 2-5 short topical chips — `frontmatter.tags`. Absent/empty pre-enrich. */
  tags?: string[]
}

/**
 * Saved-state TL;DR + tag chips, in their own card. Renders nothing when
 * neither is present (a `status: "saved"` page that hasn't been enriched
 * yet) so the caller can render it unconditionally.
 */
export function PaperMeta({ tldr, tags }: PaperMetaProps) {
  const hasTags = Boolean(tags && tags.length > 0)
  if (!tldr && !hasTags) return null

  return (
    <Card className="mt-4 p-5">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-text">TL;DR</div>
      {tldr && <p className="text-[14px] leading-[1.7] text-espresso tracking-body">{tldr}</p>}
      {hasTags && (
        <div className={tldr ? "mt-3 flex flex-wrap gap-1.5" : "flex flex-wrap gap-1.5"}>
          {(tags ?? []).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}
    </Card>
  )
}
