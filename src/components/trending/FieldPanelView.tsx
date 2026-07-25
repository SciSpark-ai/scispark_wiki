import { displayTitle } from "@/lib/papers/title"
import type { FieldPanel } from "@/lib/trending/dashboard"
import { PublicationVolumeChart } from "./PublicationVolumeChart"
import { MomentumStat } from "./MomentumStat"

export function FieldPanelView({ panel }: { panel: FieldPanel }) {
  const { field, metrics, survey, surveyError } = panel
  return (
    <section className="border border-border-warm rounded-card bg-light-surface px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">{field.label}</h2>
        <MomentumStat recent={metrics.paperCountRecent} pctChange={metrics.pctChange} />
      </div>

      <div className="mt-3">
        <PublicationVolumeChart points={metrics.weeklyVolume} />
      </div>

      {metrics.topMovers.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[12px] uppercase tracking-wide text-muted-text">Top movers</h3>
          <ul className="mt-1 space-y-1">
            {metrics.topMovers.map((m, i) => (
              <li key={i} className="text-[13px] text-espresso tracking-body">
                {displayTitle(String(m.paper.title ?? ""))} <span className="text-muted-text">· {m.citationCount} citations</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {survey ? (
        <>
          <div className="mt-4">
            <h3 className="text-[12px] uppercase tracking-wide text-muted-text">Topic briefs</h3>
            <ul className="mt-1 space-y-1">
              {survey.topics.map((t, i) => (
                <li key={i} className="text-[13px] text-espresso tracking-body">
                  <span className="text-muted-text">{t.why}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[13px] text-espresso tracking-body">{survey.crossDisciplineNote}</p>
        </>
      ) : (
        <div className="mt-4">
          <p className="text-[13px] text-muted-text">
            Couldn&rsquo;t generate the trend summary for this field. The numbers above are still current.
          </p>
          {surveyError && (
            <p className="mt-1 text-[12px] text-muted-text/80 break-words">
              <span className="font-medium">Reason:</span> {surveyError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
