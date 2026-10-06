"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocalProfile } from "@/components/layout/ProfileGate"
import { PROFILE_CHANGED_KEY } from "@/lib/local-profile-client"
import { actOnToolRunRemote, getToolRunRemote, watchToolRunRemote } from "@/lib/workflows/client"
import { workflowPublicText, workflowPublicPhase, DEFAULT_RUN_ALLOWANCE, type RunActionInput, type ToolRunDto } from "@/lib/workflows/contracts"
import { Button } from "@/components/ui/Button"
import { BackLink } from "@/components/ui/BackLink"
import { ChatMarkdown } from "@/components/chat/ChatMarkdown"
import { StreamingReply } from "@/components/chat/StreamingReply"
import { ReviewBlock } from "@/components/chat/ReviewBlock"
import { ReviewReport } from "@/components/chat/ReviewReport"
import { ToolArtifacts } from "./ToolArtifacts"
import { workflowHistoryHref } from "@/lib/ui/nav-history"
const labels: Record<ToolRunDto["status"], string> = { queued: "Queued", running: "Working", waiting_for_choice: "Waiting for your choice", waiting_for_setup: "Setup needed", paused_limit: "Allowance reached", interrupted: "Interrupted", needs_attention: "Action uncertain", completed: "Completed", failed: "Failed", cancelled: "Cancelled" }
type Action = RunActionInput extends infer T ? T extends RunActionInput ? Omit<T, "operationId"> : never : never
type NativeReviewSurface = { standaloneReviewIds?: string[]; reportInChat?: boolean }
export function ToolRunView({ runId, ...nativeSurface }: { runId: string } & NativeReviewSurface) {
  const profile = useLocalProfile()
  return <RunObserver key={`${profile?.id ?? "local"}:${runId}`} runId={runId} profileId={profile?.id} {...nativeSurface} />
}
function RunObserver({ runId, profileId, standaloneReviewIds = [], reportInChat = false }: { runId: string; profileId?: string } & NativeReviewSurface) {
  const [run, setRun] = useState<ToolRunDto | null>(null), [text, setText] = useState(""), [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | undefined>(), [reportId, setReportId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [detached, setDetached] = useState(false)
  const lifetime = useRef<AbortController | null>(null), pending = useRef(new Map<string, RunActionInput>()), sending = useRef(false)
  const apply = (snapshot: ToolRunDto) => {
    if (lifetime.current?.signal.aborted) return
    if (snapshot.id !== runId || (profileId && snapshot.profileId !== profileId)) throw new Error("This run belongs to another profile.")
    setRun(snapshot)
    if (snapshot.observation) { setText(snapshot.observation.text); setPhase(snapshot.observation.phase) }
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    const changed = (event: StorageEvent) => { if (event.key === PROFILE_CHANGED_KEY) { controller.abort(); setDetached(true) } }
    window.addEventListener("storage", changed)
    void (async () => {
      const initial = await getToolRunRemote(runId, fetch, controller.signal)
      if (controller.signal.aborted) return
      if (initial.id !== runId || (profileId && initial.profileId !== profileId)) throw new Error("This run belongs to another profile.")
      setRun(initial); setText(initial.observation?.text ?? ""); setPhase(initial.observation?.phase)
      await watchToolRunRemote(runId, async event => {
        if (controller.signal.aborted) return
        if (event.type === "text") { const publicText = workflowPublicText(event.text); if (publicText !== null) setText(publicText); const nextPhase = workflowPublicPhase(event.text); if (nextPhase) setPhase(nextPhase) }
        else {
          const snapshot = await getToolRunRemote(runId, fetch, controller.signal)
          if (controller.signal.aborted) return
          if (snapshot.profileId !== initial.profileId) throw new Error("Workflow profile changed")
          setRun(snapshot)
          if (snapshot.observation) { setText(snapshot.observation.text); setPhase(snapshot.observation.phase) }
        }
      }, controller.signal, initial.eventCursor, fetch, snapshot => {
        if (controller.signal.aborted) return
        if (snapshot.profileId !== initial.profileId) throw new Error("Workflow profile changed")
        setRun(snapshot); if (snapshot.observation) { setText(snapshot.observation.text); setPhase(snapshot.observation.phase) }
      })
    })().catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not observe this run.") })
    return () => { controller.abort(); window.removeEventListener("storage", changed) }
  }, [runId, profileId])
  async function request(action: Action) {
    const key = `${run?.eventCursor ?? 0}:${JSON.stringify(action)}`
    const storageKey = `scispark:run-action:${profileId ?? "local"}:${runId}:${key}`
    let input = pending.current.get(key)
    if (!input) {
      let operationId: string | null = null
      try { operationId = sessionStorage.getItem(storageKey) } catch {}
      operationId ??= crypto.randomUUID()
      input = { ...action, operationId } as RunActionInput; pending.current.set(key, input)
      try { sessionStorage.setItem(storageKey, operationId) } catch {}
    }
    const snapshot = await actOnToolRunRemote(runId, input)
    apply(snapshot)
    return snapshot
  }
  async function act(action: Action) {
    if (sending.current || lifetime.current?.signal.aborted) return
    sending.current = true; setBusy(true); setError(null)
    try { await request(action) }
    catch (err) { if (!lifetime.current?.signal.aborted) setError(err instanceof Error ? err.message : "Could not apply this action.") }
    finally { sending.current = false; if (!lifetime.current?.signal.aborted) setBusy(false) }
  }
  async function continueRun() {
    if (!run || sending.current) return
    sending.current = true; setBusy(true); setError(null)
    try {
      if (run.status === "paused_limit") await request({ action: "extend", delta: { modelCalls: DEFAULT_RUN_ALLOWANCE.modelCalls, commandCalls: DEFAULT_RUN_ALLOWANCE.commandCalls, activeSeconds: DEFAULT_RUN_ALLOWANCE.activeSeconds, ...(run.allowance.costUsd === null ? {} : { costUsd: DEFAULT_RUN_ALLOWANCE.costUsd }) } })
      if (!lifetime.current?.signal.aborted) await request({ action: "resume" })
    } catch (err) { if (!lifetime.current?.signal.aborted) setError(err instanceof Error ? err.message : "Could not continue.") }
    finally { sending.current = false; if (!lifetime.current?.signal.aborted) setBusy(false) }
  }
  if (detached) return <p role="status" className="text-sm text-muted-text">Opening your profile…</p>
  if (!run) return <p role={error ? "alert" : "status"} className="text-sm text-muted-text">{error ?? "Loading saved run…"}</p>
  const terminal = ["completed", "cancelled", "failed"].includes(run.status), observation = run.observation
  const active = !run.cancelRequested && !terminal
  const revisionTargets = [...new Set(observation?.uncertainSteps.flatMap(step => step.recovery?.kind === "native_revision" ? [step.recovery.reviewId] : []) ?? [])]
  const nativeReviewId = observation?.nativeReviewId
  const nativeSurfaceVisible = nativeReviewId && !standaloneReviewIds.includes(nativeReviewId) && !revisionTargets.includes(nativeReviewId)
  const revisionBlockedReason = !terminal || run.cancelRequested ? "Stop this run and reconcile uncertain usage before requesting a new explicit revision." : observation?.usage.uncertain ? "Reconcile uncertain usage before requesting a new explicit revision." : undefined
  return <section aria-label="Research run" className="min-w-0 space-y-4">
    <div className="flex flex-wrap gap-4"><BackLink fallbackHref={workflowHistoryHref(run.sessionId)}>Back</BackLink><Link href="/history?tab=runs" className="text-sm text-accent-ink">All runs</Link>{run.sessionId && <Link className="text-sm text-accent-ink" href={`/chat/${encodeURIComponent(run.sessionId)}`}>Conversation</Link>}</div>
    <header><h1 className="font-heading text-2xl text-espresso">{run.toolName ?? run.tool.skillId}</h1><p role="status" className="mt-1 text-sm text-muted-text">{run.cancelRequested ? "Stopping…" : labels[run.status]}</p></header>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-text"><span>{run.usage.modelCalls} {run.usage.modelCalls === 1 ? "call" : "calls"} used</span><span>{run.usage.commandCalls} {run.usage.commandCalls === 1 ? "command" : "commands"} used</span><span>{Math.ceil(run.usage.activeSeconds)} {Math.ceil(run.usage.activeSeconds) === 1 ? "second" : "seconds"} used</span><span>{run.usage.costUsd === null ? "This engine does not report dollar cost. Call and time limits still apply." : `$${run.usage.costUsd.toFixed(2)} used`}</span></div>
    {observation?.usage.heldAttempts ? <p className="text-sm text-muted-text">Usage pending for {observation.usage.heldAttempts} attempt(s); reserved limits remain counted.</p> : null}
    {run.status === "running" && !run.cancelRequested ? <div>{phase && <p className="mb-2 text-sm text-muted-text">{phase}</p>}<StreamingReply text={text} label={phase ?? "Working…"} /></div> : text ? <ChatMarkdown text={text} /> : null}
    {error && <p role="alert" className="text-sm text-espresso">{error}</p>}
    {active && <div className="space-y-3">
      {run.status === "paused_limit" && <p className="text-sm text-muted-text">Continue adds 30 calls, 60 commands, 30 minutes{run.allowance.costUsd === null ? "" : " and $2"} to this run.</p>}
      {(run.status === "paused_limit" || (!nativeReviewId && ["interrupted", "waiting_for_setup"].includes(run.status))) && <Button disabled={busy} onClick={() => void continueRun()}>Continue</Button>}
      {run.status === "waiting_for_setup" && <Link href="/tools" className="ml-3 text-sm text-accent-ink">Open tool settings</Link>}
      {observation?.choice && <div className="rounded-card border border-border-warm bg-light-surface p-4"><p className="mb-3 text-sm text-espresso">{observation.choice.prompt}</p><div className="space-y-2">{observation.choice.candidates.map(candidate => <button key={JSON.stringify(candidate.tool)} aria-label={candidate.label} disabled={busy} className="block w-full rounded-btn border border-border-warm p-3 text-left text-sm text-espresso hover:bg-card-surface disabled:opacity-50" onClick={() => void act({ action: "choose-helper", choiceId: observation.choice!.id, tool: candidate.tool })}><span className="block">{candidate.label}</span><span className="mt-1 block text-xs text-muted-text">{candidate.tool.packageId} · {candidate.tool.version}</span></button>)}</div></div>}
      {observation?.nativeReview && <div className="flex flex-wrap gap-2">{!nativeReviewId && observation.nativeReview.retry && <Button disabled={busy} onClick={() => void act({ action: "native-review", resolution: "retry" })}>Resume review</Button>}{observation.nativeReview.keep && <Button variant="secondary" disabled={busy} onClick={() => void act({ action: "native-review", resolution: "keep" })}>Keep saved report</Button>}</div>}
      {run.status === "needs_attention" && <div className="rounded-card border border-border-warm bg-light-surface p-4 text-sm text-espresso"><p>An earlier action may have completed. Its usage remains counted.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void act({ action: "reconcile-accounting", resolution: "reconcile" })}>Check recorded usage</Button><Button variant="secondary" disabled={busy} onClick={() => void act({ action: "reconcile-accounting", resolution: "acknowledge" })}>Acknowledge uncertain usage</Button></div>{observation?.uncertainSteps.map(step => <div key={step.id} className="mt-3"><p>{step.recovery?.kind === "wiki_changeset" ? "Check the saved wiki changes; this write cannot be retried." : step.recovery?.kind === "native_revision" ? "Wording revisions need a new explicit revision. Stop this run, reconcile uncertain usage, then open the report to request one." : `${step.kind} action outcome is uncertain.`}</p>{step.retryable && <Button className="mt-2" disabled={busy} onClick={() => void act({ action: "resolve-uncertain", stepId: step.id, resolution: "retry" })}>Acknowledge and retry action</Button>}<Button className="ml-2" variant="quiet" disabled={busy} onClick={() => void act({ action: "resolve-uncertain", stepId: step.id, resolution: "stop" })}>Stop this run</Button></div>)}{observation?.saves.filter(save => save.state === "pending").map(save => <Button key={save.changesetId} className="mt-3" disabled={busy} onClick={() => void act({ action: "reconcile-wiki", changesetId: save.changesetId })}>Check saved wiki changes</Button>)}</div>}
      <Button variant="quiet" disabled={busy} onClick={() => void act({ action: "cancel" })}>Cancel run</Button>
    </div>}
    {terminal && observation?.usage.uncertain && !run.cancelRequested && <div className="rounded-card border border-border-warm bg-light-surface p-4"><p className="mb-3 text-sm text-muted-text">Reconcile uncertain usage before starting a new revision.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void act({ action: "reconcile-accounting", resolution: "reconcile" })}>Check recorded usage</Button><Button variant="secondary" disabled={busy} onClick={() => void act({ action: "reconcile-accounting", resolution: "acknowledge" })}>Acknowledge uncertain usage</Button></div></div>}
    {nativeSurfaceVisible && <ReviewBlock id={nativeReviewId} onOpenReport={reportInChat ? undefined : () => setReportId(nativeReviewId)} />}
    {revisionTargets.map(id => <Button key={id} variant="secondary" onClick={() => setReportId(id)}>Open review report</Button>)}
    {reportId && (revisionTargets.includes(reportId) || reportId === nativeReviewId) && <div className="h-[75dvh] min-h-96 overflow-hidden rounded-card border border-border-warm"><ReviewReport id={reportId} historyLabel="Saved in History" revisionBlockedReason={revisionTargets.includes(reportId) ? revisionBlockedReason : undefined} onClose={() => setReportId(null)} /></div>}
    <ToolArtifacts runId={runId} artifacts={run.artifacts} saveableArtifactIds={observation?.saveableArtifactIds} nextSaveArtifactIds={observation?.nextSaveArtifactIds} saves={observation?.saves} onSaved={async () => apply(await getToolRunRemote(runId))} />
    <details className="rounded-btn border border-border-warm p-3 text-xs text-muted-text"><summary className="cursor-pointer">Diagnostics</summary><p className="mt-2 break-all">Run {run.id} · {run.tool.packageId} · {run.tool.skillId} · {run.tool.version} · {run.tool.digest}</p>{observation?.diagnostics.map((message, index) => <p key={index} className="mt-2 break-words">{message}</p>)}</details>
  </section>
}
