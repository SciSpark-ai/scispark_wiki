"use client"

import { useParams } from "next/navigation"
import { ChatWorkspace } from "@/components/chat/ChatWorkspace"

export default function ChatSessionPage() {
  const params = useParams<{ id: string }>()
  return <ChatWorkspace key={params.id} sessionId={params.id} />
}
