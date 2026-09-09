import { EmptyState } from "@/components/ui/EmptyState"
import type { TrendingBoard } from "@/lib/trending/types"
import { trendingWindowLabels } from "@/lib/trending/topics"
import { TopicRow } from "./TopicRow"

export interface LeaderboardProps {
  board: TrendingBoard
  expandedKey: string | null
  onToggle: (key: string) => void
}

/** The ordered "Academia Right Now" topic list, one row per BoardTopic. */
export function Leaderboard({ board, expandedKey, onToggle }: LeaderboardProps) {
  const windows = trendingWindowLabels(board.generatedAt)
  if (board.topics.length === 0) {
    // An empty board has two very different causes. Only claim the quiet-window
    // one when the deterministic layer actually succeeded: if a count or
    // grouping request failed, its rows were DROPPED (never defaulted to zero),
    // so blaming the data would be a false explanation of our own outage.
    return board.dataError ? (
      <EmptyState
        title={`Couldn’t measure activity for ${windows.recent}`}
        hint={`Nothing is being claimed about the field — the numbers simply didn’t come back. Reason: ${board.dataError}`}
      />
    ) : (
      <EmptyState title={`No topic cleared the activity threshold for ${windows.recent}`} />
    )
  }

  return (
    <div className="overflow-hidden rounded-btn border border-border-warm bg-light-surface">
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_4.5rem_6rem_1rem] items-center gap-4 border-b border-border-warm bg-page-warm px-5 py-3 text-[12px] text-secondary-dark md:grid">
        <span>Research topic</span><span className="text-right">Papers</span><span className="text-right">Share growth</span><span />
      </div>
      {board.topics.map((topic, i) => (
        <TopicRow
          key={topic.key}
          topic={topic}
          rank={i + 1}
          expanded={expandedKey === topic.key}
          onToggle={() => onToggle(topic.key)}
          recentWindowLabel={windows.recent}
          priorWindowLabel={windows.prior}
        />
      ))}
    </div>
  )
}
