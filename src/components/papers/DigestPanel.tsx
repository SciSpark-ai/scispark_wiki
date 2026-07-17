import type { DigestResult } from "@/lib/skills/digest"

/** Renders a generated digest's sections plus its cache/cost provenance line. */
export function DigestPanel({
  digest,
  fromCache,
}: {
  digest: DigestResult
  fromCache: boolean
}) {
  return (
    <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface">
      <div className="text-[11px] uppercase tracking-wide text-muted-text">
        {fromCache ? "from cache" : "AI digest"}
      </div>

      <div className="mt-2 text-[13px]/[14px] text-espresso whitespace-pre-wrap">{digest.summary}</div>

      {digest.keyPoints.length > 0 && (
        <div className="mt-2">
          <div className="text-[12px] font-medium text-espresso">Key points</div>
          <ul className="mt-1 list-disc list-inside text-[13px]/[14px] text-espresso space-y-0.5">
            {digest.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {digest.laySummary && (
        <div className="mt-2">
          <div className="text-[12px] font-medium text-espresso">Lay summary</div>
          <div className="mt-1 text-[13px]/[14px] text-muted-text whitespace-pre-wrap">{digest.laySummary}</div>
        </div>
      )}

      {digest.methods && (
        <div className="mt-2">
          <div className="text-[12px] font-medium text-espresso">Methods</div>
          <div className="mt-1 text-[13px]/[14px] text-muted-text whitespace-pre-wrap">{digest.methods}</div>
        </div>
      )}

      {digest.limitations && (
        <div className="mt-2">
          <div className="text-[12px] font-medium text-espresso">Limitations</div>
          <div className="mt-1 text-[13px]/[14px] text-muted-text whitespace-pre-wrap">{digest.limitations}</div>
        </div>
      )}

      {digest.fieldContext && (
        <div className="mt-2">
          <div className="text-[12px] font-medium text-espresso">Field context</div>
          <div className="mt-1 text-[13px]/[14px] text-muted-text whitespace-pre-wrap">{digest.fieldContext}</div>
        </div>
      )}
    </div>
  )
}
