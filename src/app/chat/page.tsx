"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listSessions } from "@/lib/chat/session"
import { askChatRemote, type ChatStage } from "@/lib/chat/client"
import type { ChatSession } from "@/lib/chat/session"
import { PageHeader } from "@/components/ui/PageHeader"
import { LoadingState } from "@/components/ui/LoadingState"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { Composer } from "@/components/chat/Composer"
import { SourcesToggle } from "@/components/chat/SourcesToggle"

const RECENT_LIMIT = 8

function stageLabel(stage: ChatStage | null): string {
  if (stage === "selecting") return "Reading your knowledge base…"
  if (stage === "answering") return "Answering…"
  return "Thinking…"
}

/**
 * `/chat` — the real KB-chat entry point (SP5 Task 9), replacing the fork's
 * clinical-suggestion-chip mock. A first question is sent straight through
 * `askChatRemote` with `sessionId: null`; the orchestrator mints and persists
 * the session server-side, so this page only has to route to whatever
 * `sessionId` comes back — `/chat/[id]` then loads the transcript FROM the
 * vault rather than this page passing state along.
 *
 * No suggestion chips: the fork's ("Compare treatments", "Summarize RCT",
 * "Find guidelines", "Risk vs benefit") were clinical-product leftovers,
 * actively wrong for a general-research audience, and are deleted outright
 * rather than replaced with another hardcoded list.
 */
export default function ChatEntryPage() {
  const router = useRouter()
  const [question, setQuestion] = useState("")
  const [readSourcesOnly, setReadSourcesOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<ChatStage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const sessions = await listSessions(vault)
        setRecentSessions(sessions.slice(0, RECENT_LIMIT))
      } catch {
        // Recent sessions are a nice-to-have; a failure to load them must
        // never block the composer itself.
      } finally {
        setLoadingRecent(false)
      }
    })()
  }, [])

  async function handleSubmit() {
    const q = question.trim()
    if (!q || submitting) return
    setSubmitting(true)
    setError(null)
    setStage(null)
    try {
      const result = await askChatRemote({ sessionId: null, question: q, readSourcesOnly }, setStage)
      router.push(`/chat/${result.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
      setStage(null)
    }
  }

  return (
    <div className="p-7 mx-auto max-w-2xl">
      <PageHeader title="Chat with your knowledge base" description="Ask a question grounded in your saved papers and wiki pages." />

      <div className="flex flex-col gap-3">
        <Composer value={question} onChange={setQuestion} onSubmit={handleSubmit} busy={submitting} />
        <SourcesToggle value={readSourcesOnly} onChange={setReadSourcesOnly} />

        {submitting && <p className="text-[12px] text-muted-text tracking-body">{stageLabel(stage)}</p>}
        {error && <LlmErrorMessage message={error} />}
      </div>

      <section className="mt-10">
        <h2 className="text-[13px] uppercase tracking-wide text-muted-text mb-3">Recent conversations</h2>
        {loadingRecent ? (
          <LoadingState label="Loading…" />
        ) : recentSessions.length === 0 ? (
          <p className="text-[13px] text-muted-text tracking-body">No conversations yet — ask a question to start one.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/chat/${s.id}`}
                  className="block truncate rounded-card px-3 py-2 text-[14px] text-espresso tracking-body hover:bg-light-surface"
                >
                  <span className="block truncate">{s.title}</span>
                  {s.projectId && (
                    <span className="block truncate text-[11px] text-muted-text">
                      Project · {s.projectTitle ?? s.projectId}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
