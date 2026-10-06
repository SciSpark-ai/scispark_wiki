"use client"
import Link from "next/link"
import { ToolRunView } from "@/components/tools/ToolRunView"
export function ToolRunBlock({ runId, standaloneReviewIds }: { runId: string; standaloneReviewIds?: string[] }) {
  return <div className="mt-3 rounded-card border border-border-warm bg-light-surface p-4"><Link className="mb-3 inline-block text-sm text-accent-ink" href={`/tools/runs/${runId}`}>Open research run</Link><ToolRunView runId={runId} standaloneReviewIds={standaloneReviewIds} reportInChat /></div>
}
