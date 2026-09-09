"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, FolderOpen, Plus, X } from "lucide-react"
import { createProjectNoteRemote, listProjectsRemote } from "@/lib/projects/client"
import type { ProjectSummary } from "@/lib/projects/types"

type NoteSourceKind = "paper" | "chat" | "manual"

interface BubbleState {
  text: string
  top: number
  left: number
  kind: NoteSourceKind
  refId?: string
  refLabel?: string
}

export function SelectionToNoteBubble() {
  const [state, setState] = useState<BubbleState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [chosenProject, setChosenProject] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void listProjectsRemote()
      .then((items) => {
        setProjects(items)
        setChosenProject((current) => current || items[0]?.id || "")
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
        const text = selection.toString().trim()
        if (text.length < 2) return
        const range = selection.getRangeAt(0)
        const node = range.commonAncestorContainer
        const element = node instanceof Element ? node : node.parentElement
        const source = element?.closest("[data-note-source]")
        if (!source) return
        const rect = range.getBoundingClientRect()
        setState({
          text,
          top: rect.top - 44,
          left: rect.left + rect.width / 2,
          kind: (source.getAttribute("data-note-source") as NoteSourceKind) || "manual",
          refId: source.getAttribute("data-note-source-id") ?? undefined,
          refLabel: source.getAttribute("data-note-source-label") ?? undefined,
        })
        setExpanded(false)
        setShowConfirm(false)
        setError(null)
      }, 0)
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element
      if (target.closest?.("[data-selection-bubble]")) return
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) {
          setState(null)
          setExpanded(false)
        }
      }, 0)
    }
    const onScroll = () => {
      setState(null)
      setExpanded(false)
    }
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [])

  const chosenTitle = useMemo(
    () => projects.find((project) => project.id === chosenProject)?.title ?? "project",
    [chosenProject, projects],
  )

  async function save() {
    if (!state || !chosenProject) return
    const firstLine = state.text.split("\n")[0].trim()
    const title = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
    const provenance = state.refId
      ? [`${state.kind}:${state.refId}`]
      : state.refLabel ? [`${state.kind}:${state.refLabel}`] : []
    setSaving(true)
    setError(null)
    try {
      await createProjectNoteRemote(chosenProject, {
        title: title || "Untitled note",
        content: state.text,
        sources: provenance,
      })
      setShowConfirm(true)
      window.getSelection()?.removeAllRanges()
      setTimeout(() => {
        setState(null)
        setExpanded(false)
        setShowConfirm(false)
      }, 1100)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null

  return (
    <AnimatePresence>
      <motion.div
        key="bubble"
        data-selection-bubble
        initial={{ opacity: 0, y: 6, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.94 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={{ position: "fixed", top: state.top, left: state.left, transform: "translate(-50%, 0)", zIndex: 70 }}
        className="rounded-pill border border-border-warm/40 bg-light-surface shadow-md"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {showConfirm ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[13px] font-medium text-emerald-700"><Check size={14} />Saved to {chosenTitle}</div>
        ) : !expanded ? (
          <button type="button" onClick={() => setExpanded(true)} className="flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3 py-1.5 text-[13px] font-medium text-espresso hover:bg-page-warm"><Plus size={14} className="text-accent-ink" />Save to note</button>
        ) : (
          <div className="flex max-w-[520px] items-center gap-2 px-2 py-1.5">
            <FolderOpen size={14} className="ml-1.5 shrink-0 text-accent-ink" />
            {projects.length > 0 ? <select value={chosenProject} onChange={(event) => setChosenProject(event.target.value)} className="max-w-[180px] truncate bg-transparent text-[13px] text-espresso focus:outline-none">{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select> : <span className="text-[12px] text-muted-text">Create a project first</span>}
            <button type="button" disabled={!chosenProject || saving} onClick={() => void save()} className="rounded-pill bg-orange px-3 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button type="button" aria-label="Cancel" onClick={() => { setState(null); setExpanded(false); window.getSelection()?.removeAllRanges() }} className="p-0.5 text-muted-text hover:text-espresso"><X size={13} /></button>
            {error && <span className="max-w-[180px] truncate text-[11px] text-red-700" title={error}>{error}</span>}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
