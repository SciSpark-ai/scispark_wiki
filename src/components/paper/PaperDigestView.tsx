import type { DigestResult } from "@/lib/skills/digest"
import { Card } from "@/components/ui/Card"

/**
 * Full-page rendering of a generated digest's six sections (summary, key
 * points, lay summary, methods, limitations, field context) plus its cache
 * provenance line. Content lifted from `DigestPanel` (the cramped
 * search-sidebar version) but full-width with no nested card — this IS the
 * page's main content, not a side panel.
 */
export function PaperDigestView({ digest, fromCache }: { digest: DigestResult; fromCache: boolean }) {
  return (
    <section className="mt-8 border-t border-border-warm pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-[28px] text-espresso tracking-heading">Paper digest</h2>
        <div className="text-[11px] uppercase tracking-wide text-muted-text">{fromCache ? "Cached" : "Freshly generated"}</div>
      </div>

      <div className="mt-4 max-w-[78ch] whitespace-pre-wrap text-[17px] leading-[1.75] text-espresso tracking-body">
        {digest.summary}
      </div>

      {digest.keyPoints.length > 0 && (
        <Card className="mt-7 p-5 sm:p-6">
          <h3 className="text-[13px] font-medium text-espresso">Key points</h3>
          <ul className="mt-3 list-outside list-disc space-y-2 pl-5 text-[14px] leading-[1.65] text-espresso tracking-body marker:text-orange">
            {digest.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {digest.laySummary && (
          <div className="md:col-span-2">
            <h3 className="text-[13px] font-medium text-espresso">In plain language</h3>
            <div className="mt-2 max-w-[78ch] whitespace-pre-wrap text-[15px] leading-[1.7] text-muted-text tracking-body">
              {digest.laySummary}
            </div>
          </div>
        )}

        {digest.methods && (
          <div>
            <h3 className="text-[13px] font-medium text-espresso">Methods</h3>
            <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">{digest.methods}</div>
          </div>
        )}

        {digest.limitations && (
          <div>
            <h3 className="text-[13px] font-medium text-espresso">Limitations</h3>
            <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">
              {digest.limitations}
            </div>
          </div>
        )}

        {digest.fieldContext && (
          <div className="md:col-span-2">
            <h3 className="text-[13px] font-medium text-espresso">Field context</h3>
            <div className="mt-2 max-w-[78ch] whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">
              {digest.fieldContext}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
