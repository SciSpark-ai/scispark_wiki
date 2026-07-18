import type { DigestResult } from "@/lib/skills/digest"

/**
 * Full-page rendering of a generated digest's six sections (summary, key
 * points, lay summary, methods, limitations, field context) plus its cache
 * provenance line. Content lifted from `DigestPanel` (the cramped
 * search-sidebar version) but full-width with no nested card — this IS the
 * page's main content, not a side panel.
 */
export function PaperDigestView({ digest, fromCache }: { digest: DigestResult; fromCache: boolean }) {
  return (
    <div className="mt-8">
      <div className="text-[11px] uppercase tracking-wide text-muted-text">{fromCache ? "From cache" : "AI digest"}</div>

      <div className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.7] text-espresso tracking-body">{digest.summary}</div>

      {digest.keyPoints.length > 0 && (
        <div className="mt-6">
          <div className="text-[13px] font-medium text-espresso">Key points</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[14px] leading-[1.7] text-espresso tracking-body">
            {digest.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {digest.laySummary && (
        <div className="mt-6">
          <div className="text-[13px] font-medium text-espresso">Lay summary</div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">
            {digest.laySummary}
          </div>
        </div>
      )}

      {digest.methods && (
        <div className="mt-6">
          <div className="text-[13px] font-medium text-espresso">Methods</div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">{digest.methods}</div>
        </div>
      )}

      {digest.limitations && (
        <div className="mt-6">
          <div className="text-[13px] font-medium text-espresso">Limitations</div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">
            {digest.limitations}
          </div>
        </div>
      )}

      {digest.fieldContext && (
        <div className="mt-6">
          <div className="text-[13px] font-medium text-espresso">Field context</div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted-text tracking-body">
            {digest.fieldContext}
          </div>
        </div>
      )}
    </div>
  )
}
