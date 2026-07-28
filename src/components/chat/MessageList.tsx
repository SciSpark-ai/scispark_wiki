import { EmptyState } from "@/components/ui/EmptyState"
import type { ChatMessage } from "@/lib/chat/session"
import { MessageBubble } from "./MessageBubble"

export interface MessageListProps {
  messages: ChatMessage[]
  pageTitleById: Record<string, string>
  /** Fired with the message's index when its Save control is clicked — the
   * caller (Task 9) tracks which turn is mid-save and what "save" does. */
  onSaveMessage: (index: number) => void
  /** Index of the message currently being saved, or null when none is. */
  savingIndex: number | null
}

/**
 * The ordered chat stream — purely presentational. Loading the session,
 * streaming a new turn in, and wiring `onSaveMessage` to the actual
 * save-as-query call are all Task 9's job.
 */
export function MessageList({ messages, pageTitleById, onSaveMessage, savingIndex }: MessageListProps) {
  if (messages.length === 0) {
    return <EmptyState title="No messages yet" hint="Ask a question about your knowledge base to get started." />
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          message={message}
          pageTitleById={pageTitleById}
          onSave={() => onSaveMessage(index)}
          saving={savingIndex === index}
        />
      ))}
    </div>
  )
}
