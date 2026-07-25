import { Card } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import type { TrendingBoard } from "@/lib/trending/dashboard"
import { TopicRow } from "./TopicRow"

export interface LeaderboardProps {
  board: TrendingBoard
  expandedKey: string | null
  onToggle: (key: string) => void
}

/** The ordered "Academia Right Now" topic list, one row per BoardTopic. */
export function Leaderboard({ board, expandedKey, onToggle }: LeaderboardProps) {
  if (board.topics.length === 0) {
    return <EmptyState title="No topic cleared the activity threshold this window" />
  }

  return (
    <Card>
      {board.topics.map((topic, i) => (
        <TopicRow
          key={topic.key}
          topic={topic}
          rank={i + 1}
          expanded={expandedKey === topic.key}
          onToggle={() => onToggle(topic.key)}
        />
      ))}
    </Card>
  )
}
