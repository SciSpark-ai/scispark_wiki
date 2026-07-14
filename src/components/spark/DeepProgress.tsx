"use client"

import { DEEP_SPARK_PHASES, deepSparkPhaseLabel, type DeepSparkPhase } from "@/lib/spark/ui-format"

interface DeepProgressProps {
  /** Current phase key from `runDeepSpark`'s `onPhase` callback, or null before
   * the first phase fires. */
  phase: string | null
}

/**
 * Live phase tracker for a running Deep Spark pipeline — grounding →
 * bottleneck → ideation → scoop-check → audit. Phases before the current one
 * are marked done; the single internal retry-on-abandon re-fires
 * ideation/scoop-check/audit, which this simply re-highlights rather than
 * tracking as a separate pass (the orchestrator doesn't surface that distinction).
 */
export function DeepProgress({ phase }: DeepProgressProps) {
  const currentIndex = phase ? DEEP_SPARK_PHASES.indexOf(phase as DeepSparkPhase) : -1

  return (
    <ul className="mt-3 flex flex-col gap-1">
      {DEEP_SPARK_PHASES.map((p, i) => {
        const done = currentIndex > i
        const active = currentIndex === i
        return (
          <li
            key={p}
            className={`text-[13px] tracking-body ${
              active ? "text-espresso font-medium" : done ? "text-muted-text" : "text-muted-text/50"
            }`}
          >
            {done ? "✓ " : active ? "… " : "· "}
            {deepSparkPhaseLabel(p)}
          </li>
        )
      })}
    </ul>
  )
}
