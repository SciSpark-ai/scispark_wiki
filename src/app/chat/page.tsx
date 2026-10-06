"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ChatWorkspace } from "@/components/chat/ChatWorkspace"
import { LoadingState } from "@/components/ui/LoadingState"

function Entry() {
  const params = useSearchParams()
  return <ChatWorkspace fresh={params.get("new") === "1"} resume={!params.has("tool") && params.get("mode") !== "search"} initialTool={params.get("tool") ?? undefined} initialMode={params.get("mode") === "search" ? "search" : "chat"} />
}
export default function ChatEntryPage() {
  return <Suspense fallback={<LoadingState label="Loading conversation…" />}><Entry /></Suspense>
}
