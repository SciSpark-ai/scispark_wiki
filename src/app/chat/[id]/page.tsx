"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadSession, type ChatSession } from "@/lib/chat/session"
import { loadBundle } from "@/lib/vault/bundle"
import { askChatRemote, type ChatStage } from "@/lib/chat/client"
import { saveAnswerAsQueryRemote } from "@/lib/chat/save-query-client"
import { wikiHref } from "@/lib/wiki/href"
import { PageHeader } from "@/components/ui/PageHeader"
import { LoadingState } from "@/components/ui/LoadingState"
import { EmptyState } from "@/components/ui/EmptyState"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { MessageList } from "@/components/chat/MessageList"
import { Composer } from "@/components/chat/Composer"
import { SourcesToggle } from "@/components/chat/SourcesToggle"

type LoadState = "loading" | "ready" | "not-found"

function stageLabel(stage: ChatStage | null): string {
  if (stage === "selecting") return "Reading your knowledge base…"
  if (stage === "answering") return "Answering…"
  return "Thinking…"
}

/**
 * `/chat/[id]` — one KB-chat conversation (SP5 Task 9). Loads the persisted
 * session and every wiki page's title straight from the vault; every submit
 * or save round-trips through the server (`askChatRemote`/
 * `saveAnswerAsQueryRemote`) and then RELOADS the session from the vault
 * rather than optimistically appending a locally-built message — the
 * orchestrator is the one source of truth for what actually got persisted
 * (see `src/lib/chat/orchestrator.ts`'s doc comment), so this page never
 * keeps a competing copy of the transcript.
 */
export default function ChatSessionPage() {
  const params = useParams()
  const sessionId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : ""

  const [state, setState] = useState<LoadState>("loading")
  const [session, setSession] = useState<ChatSession | null>(null)
  const [pageTitleById, setPageTitleById] = useState<Record<string, string>>({})

  const [question, setQuestion] = useState("")
  const [readSourcesOnly, setReadSourcesOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<ChatStage | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedPageId, setSavedPageId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const vault = await getOpenVault()
    const [loaded, bundle] = await Promise.all([loadSession(vault, sessionId), loadBundle(vault)])
    const titles: Record<string, string> = {}
    for (const page of bundle.pages.values()) titles[page.id] = page.frontmatter.title
    setPageTitleById(titles)
    if (loaded == null) {
      setSession(null)
      setState("not-found")
    } else {
      setSession(loaded)
      setState("ready")
    }
  }, [sessionId])

  // `reload()` can REJECT, not just resolve with a null session: `loadSession`
  // rejects outright for an id that isn't a legal path segment (see
  // `sessionPath` in src/lib/chat/session.ts — the guard that stops a crafted
  // id from being written outside `.scispark/chats/`), and `sessionId` comes
  // straight off the URL. Without this catch the rejection is unhandled and
  // `state` stays "loading" forever, so a stale or hand-typed `/chat/<id>`
  // renders a permanent spinner instead of the not-found card. An unusable id
  // and a missing session are the same thing to the reader, so both land on
  // "not-found"; the real reason is logged rather than swallowed.
  useEffect(() => {
    setState("loading")
    reload().catch((err: unknown) => {
      console.warn("[chat] could not load session:", err)
      setSession(null)
      setState("not-found")
    })
  }, [reload])

  async function handleSubmit() {
    const q = question.trim()
    if (!q || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    setStage(null)
    try {
      await askChatRemote({ sessionId, question: q, readSourcesOnly }, setStage)
      setQuestion("")
      await reload()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
      setStage(null)
    }
  }

  async function handleSaveMessage(index: number) {
    if (!session) return
    const message = session.messages[index]
    if (!message || message.role !== "assistant") return
    const preceding = session.messages[index - 1]
    const precedingQuestion = preceding?.role === "user" ? preceding.content : session.title

    setSavingIndex(index)
    setSaveError(null)
    setSavedPageId(null)
    try {
      const result = await saveAnswerAsQueryRemote({
        question: precedingQuestion,
        answer: message.content,
        sessionId: session.id,
        citedPageIds: message.citedPageIds ?? [],
      })
      setSavedPageId(result.pageId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingIndex(null)
    }
  }

  if (state === "loading") {
    return (
      <div className="p-7">
        <LoadingState label="Loading conversation…" />
      </div>
    )
  }

  if (state === "not-found" || session == null) {
    return (
      <div className="p-7">
        <EmptyState title="Chat not found" hint="This conversation doesn't exist or was removed." />
      </div>
    )
  }

  return (
    <div className="p-7 mx-auto max-w-2xl">
      <PageHeader title={session.title} />

      <MessageList
        messages={session.messages}
        pageTitleById={pageTitleById}
        onSaveMessage={handleSaveMessage}
        savingIndex={savingIndex}
      />
      {saveError && <LlmErrorMessage message={saveError} />}
      {savedPageId && (
        <p className="mt-2 text-[12px] text-muted-text tracking-body">
          Saved to your knowledge base.{" "}
          <Link href={wikiHref(savedPageId)} className="text-orange hover:text-orange/80">
            View page →
          </Link>
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Composer value={question} onChange={setQuestion} onSubmit={handleSubmit} busy={submitting} />
        <SourcesToggle value={readSourcesOnly} onChange={setReadSourcesOnly} />
        {submitting && <p className="text-[12px] text-muted-text tracking-body">{stageLabel(stage)}</p>}
        {submitError && <LlmErrorMessage message={submitError} />}
      </div>
    </div>
  )
}
