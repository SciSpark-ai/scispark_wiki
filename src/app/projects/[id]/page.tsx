"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ChevronLeft,
  FileText,
  FolderOpen,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import {
  createProjectNoteRemote,
  deleteProjectNoteRemote,
  deleteProjectRemote,
  getProjectRemote,
  listProjectNotesRemote,
  previewDeleteProjectRemote,
  ProjectApiError,
  updateProjectNoteRemote,
  updateProjectRemote,
} from "@/lib/projects/client"
import type { ProjectDeletePreview, ProjectDetail, ProjectNote } from "@/lib/projects/types"
import type { MutationWarning } from "@/lib/vault/mutations"
import { wikiHref } from "@/lib/wiki/href"
import { askChatRemote, type ChatStage } from "@/lib/chat/client"
import { Composer } from "@/components/chat/Composer"
import { SourcesToggle } from "@/components/chat/SourcesToggle"
import { StreamingReply } from "@/components/chat/StreamingReply"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

type Tab = "papers" | "notes" | "chats"
type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: ProjectDetail; notes: ProjectNote[] }

interface NoteDraft {
  id: string | null
  revision: string | null
  title: string
  content: string
  originalTitle: string
  originalContent: string
}

function chatStageLabel(stage: ChatStage | null): string {
  if (stage === "selecting") return "Reading this project's members…"
  if (stage === "answering") return "Answering…"
  return "Thinking…"
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const rawId = params?.id
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId ?? ""
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [activeTab, setActiveTab] = useState<Tab>("papers")
  const [warnings, setWarnings] = useState<MutationWarning[]>([])
  const [conflict, setConflict] = useState<string | null>(null)
  const [projectEditor, setProjectEditor] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ title: "", description: "", instructions: "", overview: "" })
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletePreview, setDeletePreview] = useState<ProjectDeletePreview | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [chatQuestion, setChatQuestion] = useState("")
  const [chatReadSourcesOnly, setChatReadSourcesOnly] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatStage, setChatStage] = useState<ChatStage | null>(null)
  const [chatDraft, setChatDraft] = useState("")
  const [chatError, setChatError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) {
      setLoad({ status: "not-found" })
      return
    }
    setLoad({ status: "loading" })
    try {
      const [project, notes] = await Promise.all([
        getProjectRemote(id),
        listProjectNotesRemote(id),
      ])
      setLoad({ status: "ready", project, notes })
    } catch (error) {
      if (error instanceof ProjectApiError && error.status === 404) setLoad({ status: "not-found" })
      else setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  const noteDirty = noteDraft !== null &&
    (noteDraft.title !== noteDraft.originalTitle || noteDraft.content !== noteDraft.originalContent)

  useEffect(() => {
    if (!noteDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [noteDirty])

  const paperMembers = useMemo(
    () => load.status === "ready" ? load.project.members.filter((member) => member.type === "paper") : [],
    [load],
  )

  function setReadyProject(project: ProjectDetail) {
    setLoad((current) => current.status === "ready" ? { ...current, project } : current)
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault()
    if (load.status !== "ready") return
    setSaving(true)
    setConflict(null)
    try {
      const mutation = await updateProjectRemote(id, {
        revision: load.project.revision,
        ...projectDraft,
      })
      setReadyProject(mutation.result)
      setWarnings(mutation.warnings)
      setProjectEditor(false)
    } catch (error) {
      if (error instanceof ProjectApiError && error.status === 409) {
        setConflict("This project changed after you opened it. Reload before saving again.")
      } else {
        setConflict(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault()
    if (!noteDraft || load.status !== "ready") return
    setSaving(true)
    setConflict(null)
    try {
      const mutation = noteDraft.id === null
        ? await createProjectNoteRemote(id, {
            title: noteDraft.title,
            content: noteDraft.content,
            sources: [],
          })
        : await updateProjectNoteRemote(id, noteDraft.id, {
            revision: noteDraft.revision as string,
            title: noteDraft.title,
            content: noteDraft.content,
          })
      const notes = noteDraft.id === null
        ? [mutation.result, ...load.notes]
        : load.notes.map((note) => note.id === mutation.result.id ? mutation.result : note)
      setLoad({ status: "ready", project: { ...load.project, counts: { ...load.project.counts, notes: notes.length, members: load.project.counts.members + (noteDraft.id === null ? 1 : 0) } }, notes })
      setWarnings(mutation.warnings)
      setNoteDraft(null)
    } catch (error) {
      if (error instanceof ProjectApiError && error.status === 409) {
        setConflict("This note changed after you opened it. Reload before saving again.")
      } else {
        setConflict(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }

  function cancelNote() {
    if (noteDirty && !window.confirm("Discard your unsaved note changes?")) return
    setNoteDraft(null)
    setConflict(null)
  }

  async function removeNote(note: ProjectNote) {
    if (!window.confirm(`Delete “${note.title}”? You can recover it later from History.`)) return
    setConflict(null)
    try {
      const mutation = await deleteProjectNoteRemote(id, note.id, note.revision)
      setWarnings(mutation.warnings)
      if (load.status === "ready") {
        const notes = load.notes.filter((candidate) => candidate.id !== note.id)
        setLoad({ status: "ready", project: { ...load.project, counts: { ...load.project.counts, notes: notes.length, members: Math.max(0, load.project.counts.members - 1) } }, notes })
      }
    } catch (error) {
      setConflict(error instanceof ProjectApiError && error.status === 409
        ? "This note changed before deletion. Reload and review it first."
        : error instanceof Error ? error.message : String(error))
    }
  }

  async function beginDelete() {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      setDeletePreview(await previewDeleteProjectRemote(id))
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleteLoading(false)
    }
  }

  async function confirmDelete() {
    if (!deletePreview) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      const mutation = await deleteProjectRemote(id, {
        revision: deletePreview.revision,
        previewRevision: deletePreview.previewRevision,
      })
      setWarnings(mutation.warnings)
      router.push("/projects")
    } catch (error) {
      setDeleteError(error instanceof ProjectApiError && error.status === 409
        ? "The project or one of its members changed. Close this preview and review the latest data."
        : error instanceof Error ? error.message : String(error))
    } finally {
      setDeleteLoading(false)
    }
  }

  async function startProjectChat() {
    const question = chatQuestion.trim()
    if (!question || chatBusy || load.status !== "ready") return
    setChatBusy(true)
    setChatStage(null)
    setChatDraft("")
    setChatError(null)
    try {
      const result = await askChatRemote({
        sessionId: null,
        question,
        readSourcesOnly: chatReadSourcesOnly,
        projectId: load.project.id,
      }, setChatStage, undefined, setChatDraft)
      router.push(`/chat/${result.sessionId}`)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
      setChatBusy(false)
      setChatStage(null)
    }
  }

  if (load.status === "loading") return <div className="p-7 text-[14px] text-muted-text">Loading project…</div>

  if (load.status === "not-found") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-7">
        <p className="text-[16px] text-espresso">Project not found.</p>
        <Link href="/projects" className="flex items-center gap-1.5 text-[14px] text-orange hover:text-orange-light"><ChevronLeft size={16} />Back to Projects</Link>
      </div>
    )
  }

  if (load.status === "error") {
    return (
      <div className="p-7">
        <p className="text-[14px] text-espresso">Project could not be loaded: {load.message}</p>
        <button type="button" onClick={() => void reload()} className="mt-3 text-[13px] text-orange hover:text-orange-light">Try again</button>
      </div>
    )
  }

  const { project, notes } = load
  const tabs = [
    { id: "papers" as const, label: "Papers", icon: FileText, count: paperMembers.length },
    { id: "notes" as const, label: "Notes", icon: StickyNote, count: notes.length },
    { id: "chats" as const, label: "Chats", icon: MessageSquare, count: project.counts.conversations },
  ]

  return (
    <div className="p-7">
      <Link href="/projects" className="mb-5 flex items-center gap-1.5 text-[14px] text-muted-text hover:text-espresso"><ChevronLeft size={16} />Projects</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-orange/10 text-orange"><FolderOpen size={22} /></span>
          <div className="min-w-0">
            <h1 className="font-heading text-[26px] leading-[1.2] tracking-heading text-espresso">{project.title}</h1>
            <p className="mt-1 text-[14px] tracking-body text-muted-text">{project.description || "No description yet."}</p>
            <p className="mt-1.5 text-[12px] text-muted-text/70">Stable ID: {project.id} · {project.counts.members} members</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setProjectDraft({ title: project.title, description: project.description, instructions: project.instructions, overview: project.overview })
              setConflict(null)
              setProjectEditor(true)
            }}
            className="flex items-center gap-1.5 rounded-pill border border-border-warm px-3 py-1.5 text-[13px] text-espresso hover:bg-card-surface"
          ><Settings size={14} />Edit</button>
          <button type="button" onClick={() => void beginDelete()} className="flex items-center gap-1.5 rounded-pill border border-border-warm px-3 py-1.5 text-[13px] text-espresso hover:bg-card-surface"><Trash2 size={14} />Delete</button>
        </div>
      </div>

      {project.instructions && (
        <div className="mt-5 rounded-card border border-border-warm bg-card-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-text">Project AI instructions</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-espresso">{project.instructions}</p>
        </div>
      )}
      {project.overview.trim() && <p className="mt-5 whitespace-pre-wrap text-[14px] leading-relaxed text-espresso">{project.overview}</p>}

      {warnings.length > 0 && <div className="mt-4 rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-espresso">The vault change succeeded, with a derived-data warning: {warnings.map((warning) => warning.message).join(" ")}</div>}
      {conflict && <div role="alert" className="mt-4 rounded-card border border-border-warm bg-light-surface p-3 text-[13px] text-red-700">{conflict} <button type="button" onClick={() => void reload()} className="ml-2 text-orange">Reload</button></div>}

      <div className="mt-6 flex items-center gap-1 border-b border-border-warm/30">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`relative flex items-center gap-2 px-4 py-2.5 text-[14px] ${activeTab === tab.id ? "font-medium text-espresso" : "text-muted-text hover:text-espresso"}`}>
              <Icon size={15} />{tab.label}<span className="rounded-full bg-card-surface px-1.5 py-0.5 text-[12px]">{tab.count}</span>
              {activeTab === tab.id && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-orange" />}
            </button>
          )
        })}
        {activeTab === "notes" && <button type="button" onClick={() => setNoteDraft({ id: null, revision: null, title: "", content: "", originalTitle: "", originalContent: "" })} className="ml-auto flex items-center gap-1.5 px-3 py-2 text-[13px] text-orange hover:text-orange-light"><Plus size={14} />New note</button>}
      </div>

      <div className="mt-4">
        {activeTab === "papers" && (paperMembers.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center"><p className="text-[14px] text-espresso">No papers in this project</p><p className="mt-1 text-[12px] text-muted-text">Open a saved paper and use its project membership control.</p></div>
        ) : (
          <div className="space-y-2">{paperMembers.map((member) => <Link key={member.id} href={wikiHref(member.id)} className="flex items-center justify-between rounded-card border border-border-warm bg-light-surface px-4 py-3 hover:border-orange/40"><span className="text-[14px] text-espresso">{member.title}</span><span className="text-[11px] uppercase tracking-wide text-muted-text">{member.type}</span></Link>)}</div>
        ))}
        {activeTab === "notes" && (notes.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center"><p className="text-[14px] text-espresso">No project notes yet</p><p className="mt-1 text-[12px] text-muted-text">Create a note; it will be stored as a routed wiki page.</p></div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{notes.map((note) => (
            <article key={note.id} className="flex min-h-[210px] flex-col rounded-card border border-border-warm bg-light-surface p-4">
              <div className="flex items-start justify-between gap-2"><h2 className="font-medium text-[15px] text-espresso">{note.title}</h2><div className="flex gap-1"><button type="button" aria-label={`Edit ${note.title}`} onClick={() => setNoteDraft({ id: note.id, revision: note.revision, title: note.title, content: note.content, originalTitle: note.title, originalContent: note.content })} className="p-1 text-muted-text hover:text-espresso"><Pencil size={14} /></button><button type="button" aria-label={`Delete ${note.title}`} onClick={() => void removeNote(note)} className="p-1 text-muted-text hover:text-espresso"><Trash2 size={14} /></button></div></div>
              <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed text-espresso">{note.content || "(empty)"}</p>
              <p className="mt-auto border-t border-border-warm/20 pt-3 text-[11px] text-muted-text">Updated {note.updatedAt}{note.sources.length > 0 ? ` · ${note.sources.length} source${note.sources.length === 1 ? "" : "s"}` : ""}</p>
            </article>
          ))}</div>
        ))}
        {activeTab === "chats" && (
          <div className="space-y-4">
            <div className="rounded-card border border-border-warm bg-light-surface p-4">
              <p className="mb-3 text-[13px] text-muted-text">
                Answers are limited to current members of this project. Project instructions guide the response without weakening source grounding.
              </p>
              <div className="flex flex-col gap-3">
                <Composer value={chatQuestion} onChange={setChatQuestion} onSubmit={startProjectChat} busy={chatBusy} />
                <SourcesToggle value={chatReadSourcesOnly} onChange={setChatReadSourcesOnly} />
                {chatBusy && <StreamingReply text={chatDraft} label={chatDraft ? "Sparky is responding…" : chatStageLabel(chatStage)} />}
                {chatError && <LlmErrorMessage message={chatError} />}
              </div>
            </div>
            {project.conversations.length === 0 ? (
              <div className="rounded-card border border-dashed border-border-warm px-6 py-8 text-center">
                <p className="text-[14px] text-espresso">No scoped conversations yet</p>
                <p className="mt-1 text-[12px] text-muted-text">Ask the first question above to start one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {project.conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/chat/${conversation.id}`}
                    className="flex items-center justify-between gap-4 rounded-card border border-border-warm bg-light-surface px-4 py-3 hover:border-orange/40"
                  >
                    <span className="min-w-0 truncate text-[14px] text-espresso">{conversation.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-text">{conversation.messageCount} messages</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {projectEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 p-4 backdrop-blur-sm">
          <form onSubmit={saveProject} className="w-full max-w-2xl rounded-[18px] border border-border-warm bg-page-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border-warm/30 px-6 py-4"><h2 className="font-heading text-[20px] text-espresso">Edit project</h2><button type="button" aria-label="Cancel project edit" onClick={() => setProjectEditor(false)} className="p-1.5 text-muted-text hover:text-espresso"><X size={17} /></button></div>
            <div className="space-y-4 px-6 py-5">
              <label className="block text-[13px] font-medium text-espresso">Title<input required value={projectDraft.title} onChange={(event) => setProjectDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1.5 w-full rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none" /></label>
              <label className="block text-[13px] font-medium text-espresso">Description<textarea value={projectDraft.description} onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))} rows={2} className="mt-1.5 w-full rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none" /></label>
              <label className="block text-[13px] font-medium text-espresso">AI instructions<textarea value={projectDraft.instructions} onChange={(event) => setProjectDraft((current) => ({ ...current, instructions: event.target.value }))} rows={3} className="mt-1.5 w-full rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none" /></label>
              <label className="block text-[13px] font-medium text-espresso">Overview<textarea value={projectDraft.overview} onChange={(event) => setProjectDraft((current) => ({ ...current, overview: event.target.value }))} rows={5} className="mt-1.5 w-full rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none" /></label>
              {conflict && <p className="text-[13px] text-red-700">{conflict}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-warm/30 px-6 py-4"><button type="button" onClick={() => setProjectEditor(false)} className="rounded-pill border border-border-warm px-4 py-2 text-[13px] text-espresso">Cancel</button><button type="submit" disabled={saving} className="rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div>
          </form>
        </div>
      )}

      {noteDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 p-4 backdrop-blur-sm">
          <form onSubmit={saveNote} className="w-full max-w-2xl rounded-[18px] border border-border-warm bg-page-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border-warm/30 px-6 py-4"><h2 className="font-heading text-[20px] text-espresso">{noteDraft.id ? "Edit note" : "New note"}</h2><button type="button" aria-label="Cancel note edit" onClick={cancelNote} className="p-1.5 text-muted-text hover:text-espresso"><X size={17} /></button></div>
            <div className="space-y-4 px-6 py-5"><input autoFocus required placeholder="Note title" value={noteDraft.title} onChange={(event) => setNoteDraft((current) => current ? { ...current, title: event.target.value } : current)} className="w-full bg-transparent font-heading text-[22px] text-espresso placeholder:text-muted-text/50 focus:outline-none" /><textarea placeholder="Write your note…" value={noteDraft.content} onChange={(event) => setNoteDraft((current) => current ? { ...current, content: event.target.value } : current)} rows={10} className="w-full resize-y rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] leading-relaxed text-espresso focus:outline-none" />{conflict && <p className="text-[13px] text-red-700">{conflict}</p>}</div>
            <div className="flex items-center justify-between border-t border-border-warm/30 px-6 py-4"><span className="text-[12px] text-muted-text">Changes are written only when you choose Save.</span><div className="flex gap-2"><button type="button" onClick={cancelNote} className="rounded-pill border border-border-warm px-4 py-2 text-[13px] text-espresso">Cancel</button><button type="submit" disabled={saving} className="rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div></div>
          </form>
        </div>
      )}

      {(deleteLoading || deletePreview || deleteError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[18px] border border-border-warm bg-page-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border-warm/30 px-6 py-4"><h2 className="font-heading text-[20px] text-espresso">Delete project</h2><button type="button" aria-label="Close deletion preview" onClick={() => { setDeletePreview(null); setDeleteError(null) }} className="p-1.5 text-muted-text hover:text-espresso"><X size={17} /></button></div>
            <div className="px-6 py-5">{deleteLoading && !deletePreview && <p className="text-[14px] text-muted-text">Building deletion preview…</p>}{deleteError && <p className="text-[13px] text-red-700">{deleteError}</p>}{deletePreview && <><p className="text-[14px] text-espresso">This removes the project and unlinks its stable ID from {Math.max(0, deletePreview.files.length - 1)} member page{deletePreview.files.length === 2 ? "" : "s"}. The single changeset can be recovered from History.</p><ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-[12px] text-muted-text">{deletePreview.files.map((file) => <li key={file.path}>{file.operation}: {file.path}</li>)}</ul></>}</div>
            <div className="flex justify-end gap-2 border-t border-border-warm/30 px-6 py-4"><button type="button" onClick={() => { setDeletePreview(null); setDeleteError(null) }} className="rounded-pill border border-border-warm px-4 py-2 text-[13px] text-espresso">Cancel</button>{deletePreview && <button type="button" disabled={deleteLoading} onClick={() => void confirmDelete()} className="rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">{deleteLoading ? "Deleting…" : "Delete project"}</button>}</div>
          </div>
        </div>
      )}
    </div>
  )
}
