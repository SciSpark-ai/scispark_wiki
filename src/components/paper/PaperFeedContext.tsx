import { Card } from "@/components/ui/Card"

export interface PaperFeedContextProps {
  whyThis: string
  whyYou: string
  whyNow: string
}

/**
 * The personalized rationale is evidence for why the paper deserves attention,
 * not generic metadata. Present the three distinct judgments as a wide research
 * note so they can be compared at a glance on desktop and read sequentially on
 * smaller screens.
 */
export function PaperFeedContext({ whyThis, whyYou, whyNow }: PaperFeedContextProps) {
  const reasons = [
    { label: "Why this", value: whyThis },
    { label: "Why you", value: whyYou },
    { label: "Why now", value: whyNow },
  ]

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border-warm px-5 py-4 sm:px-6">
        <div className="text-[11px] uppercase tracking-wide text-muted-text">Why this paper is in your feed</div>
      </div>
      <div className="grid divide-y divide-border-warm md:grid-cols-3 md:divide-x md:divide-y-0">
        {reasons.map((reason) => (
          <div key={reason.label} className="p-5 sm:p-6">
            <div className="text-[12px] font-medium text-orange">{reason.label}</div>
            <p className="mt-2 text-[14px] leading-[1.65] text-espresso tracking-body">{reason.value}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}
