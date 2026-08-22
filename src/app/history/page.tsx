import { Suspense } from "react"
import { HistoryPageClient } from "@/components/history/HistoryPageClient"
import { LoadingState } from "@/components/ui/LoadingState"

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="p-7"><LoadingState label="Loading History…" /></div>}>
      <HistoryPageClient />
    </Suspense>
  )
}
