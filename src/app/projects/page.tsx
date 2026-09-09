"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, FolderOpen, MessageSquare, Plus, Search, X } from "lucide-react"
import { createProjectRemote, listProjectsRemote } from "@/lib/projects/client"
import type { MutationWarning } from "@/lib/vault/mutations"
import type { ProjectSummary } from "@/lib/projects/types"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: ProjectSummary[] }

const EMPTY_FORM = { title: "", description: "", instructions: "", overview: "" }

export default function ProjectsPage() {
  const router = useRouter()
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<MutationWarning[]>([])

  const reload = useCallback(async () => {
    setLoad({ status: "loading" })
    try {
      setLoad({ status: "ready", projects: await listProjectsRemote() })
    } catch (error) {
      setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    if (load.status !== "ready") return []
    const query = search.trim().toLowerCase()
    if (!query) return load.projects
    return load.projects.filter(
      (project) =>
        project.title.toLowerCase().includes(query) ||
        project.description.toLowerCase().includes(query),
    )
  }, [load, search])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const created = await createProjectRemote(form)
      setWarnings(created.warnings)
      setCreating(false)
      setForm(EMPTY_FORM)
      router.push(`/projects/${created.result.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-[28px] tracking-heading text-espresso">Projects</h1>
          <p className="mt-1 text-[14px] tracking-body text-muted-text">
            Organize vault papers, conversations, and notes by research question.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true)
            setFormError(null)
          }}
          className="flex items-center gap-2 rounded-[10px] bg-orange px-4 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90"
        >
          <Plus size={16} />
          New project
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-espresso">
          The project was saved, but derived vault data needs attention: {warnings.map((item) => item.message).join(" ")}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 rounded-[10px] border border-border-warm bg-light-surface px-3 py-2.5">
        <Search size={16} className="shrink-0 text-muted-text" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects…"
          className="flex-1 bg-transparent text-[14px] text-espresso placeholder:text-muted-text focus:outline-none"
        />
      </div>

      {load.status === "loading" && (
        <p className="mt-8 text-[14px] text-muted-text">Loading projects…</p>
      )}

      {load.status === "error" && (
        <div className="mt-8 rounded-card border border-border-warm bg-light-surface p-5">
          <p className="text-[14px] text-espresso">Projects could not be loaded: {load.message}</p>
          <button type="button" onClick={() => void reload()} className="mt-3 text-[13px] text-accent-ink hover:text-accent-ink-hover">
            Try again
          </button>
        </div>
      )}

      {load.status === "ready" && filtered.length === 0 && (
        <div className="mt-8 rounded-card border border-dashed border-border-warm p-8 text-center">
          <FolderOpen className="mx-auto text-muted-text" size={28} />
          <p className="mt-3 text-[15px] text-espresso">
            {load.projects.length === 0 ? "No projects yet" : "No projects match that search"}
          </p>
          <p className="mt-1 text-[13px] text-muted-text">
            {load.projects.length === 0
              ? "Create a project to group saved papers and notes in your vault."
              : "Try a different title or description."}
          </p>
        </div>
      )}

      {load.status === "ready" && filtered.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => router.push(`/projects/${project.id}`)}
              className="group rounded-[14px] border border-border-warm/30 bg-light-surface p-5 text-left transition-all hover:border-orange/40 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-orange/10 text-accent-ink">
                  <FolderOpen size={18} />
                </span>
                <h2 className="line-clamp-2 font-heading text-[16px] leading-[1.35] tracking-heading-card text-espresso">
                  {project.title}
                </h2>
              </div>
              <p className="mt-3 line-clamp-2 min-h-[39px] text-[13px] leading-[1.5] text-muted-text">
                {project.description || "No description yet."}
              </p>
              <div className="mt-4 flex items-center gap-4 border-t border-border-warm/30 pt-3 text-[12px] text-muted-text">
                <span className="flex items-center gap-1.5"><FileText size={13} />{project.counts.papers} papers</span>
                <span className="flex items-center gap-1.5"><MessageSquare size={13} />{project.counts.conversations} chats</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 p-4 backdrop-blur-sm">
          <form onSubmit={submit} className="w-full max-w-2xl rounded-[18px] border border-border-warm bg-page-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border-warm/30 px-6 py-4">
              <h2 className="font-heading text-[20px] text-espresso">Create project</h2>
              <button type="button" aria-label="Cancel project creation" onClick={() => setCreating(false)} className="rounded-[6px] p-1.5 text-muted-text hover:bg-page-warm hover:text-espresso">
                <X size={17} />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <label className="block text-[13px] font-medium text-espresso">
                Title
                <input autoFocus required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-1.5 w-full rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-orange/20" />
              </label>
              <label className="block text-[13px] font-medium text-espresso">
                Description
                <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={2} className="mt-1.5 w-full resize-y rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-orange/20" />
              </label>
              <label className="block text-[13px] font-medium text-espresso">
                AI instructions
                <textarea value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} rows={3} className="mt-1.5 w-full resize-y rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-orange/20" />
              </label>
              <label className="block text-[13px] font-medium text-espresso">
                Overview
                <textarea value={form.overview} onChange={(event) => setForm((current) => ({ ...current, overview: event.target.value }))} rows={5} className="mt-1.5 w-full resize-y rounded-[9px] border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] font-normal focus:outline-none focus:ring-2 focus:ring-orange/20" />
              </label>
              {formError && <p className="text-[13px] text-red-700">{formError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-warm/30 px-6 py-4">
              <button type="button" onClick={() => setCreating(false)} className="rounded-pill border border-border-warm px-4 py-2 text-[13px] text-espresso hover:bg-page-warm">Cancel</button>
              <button type="submit" disabled={submitting} className="rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-50">
                {submitting ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
