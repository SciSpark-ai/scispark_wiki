"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Check, FolderOpen } from "lucide-react"
import {
  addProjectMemberRemote,
  listProjectsRemote,
  removeProjectMemberRemote,
} from "@/lib/projects/client"
import { revisionOf } from "@/lib/projects/revision"
import type { ProjectSummary } from "@/lib/projects/types"
import { getOpenVault } from "@/lib/vault/get-vault"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; projects: ProjectSummary[]; revision: string }

export function ProjectMembershipControl({ pageId }: { pageId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [projects, storage] = await Promise.all([listProjectsRemote(), getOpenVault()])
      const raw = await storage.read(`${pageId}.md`)
      if (raw === null) throw new Error("The member page no longer exists in the vault.")
      setLoad({ status: "ready", projects, revision: await revisionOf(raw) })
    } catch (error) {
      setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [pageId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function toggle(project: ProjectSummary, isMember: boolean) {
    if (load.status !== "ready") return
    setBusyProjectId(project.id)
    setWarning(null)
    try {
      const mutation = isMember
        ? await removeProjectMemberRemote(project.id, { pageId, revision: load.revision })
        : await addProjectMemberRemote(project.id, { pageId, revision: load.revision })
      if (mutation.warnings.length > 0) setWarning(mutation.warnings.map((item) => item.message).join(" "))
      await reload()
    } catch (error) {
      setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyProjectId(null)
    }
  }

  return (
    <section className="mt-4 rounded-card border border-border-warm bg-light-surface p-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-espresso">
        <FolderOpen size={15} className="text-accent-ink" />
        Project membership
      </div>
      {load.status === "loading" && <p className="mt-2 text-[12px] text-muted-text">Loading projects…</p>}
      {load.status === "error" && <p className="mt-2 text-[12px] text-red-700">{load.message} <button type="button" onClick={() => void reload()} className="text-accent-ink">Retry</button></p>}
      {load.status === "ready" && load.projects.length === 0 && <p className="mt-2 text-[12px] text-muted-text">No projects yet. <Link href="/projects" className="text-accent-ink">Create one</Link></p>}
      {load.status === "ready" && load.projects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {load.projects.map((project) => {
            const isMember = project.members.some((member) => member.id === pageId)
            return (
              <button
                key={project.id}
                type="button"
                disabled={busyProjectId !== null}
                onClick={() => void toggle(project, isMember)}
                className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${isMember ? "border-orange bg-orange/10 text-accent-ink" : "border-border-warm text-espresso hover:bg-card-surface"}`}
              >
                {isMember && <Check size={12} />}
                {busyProjectId === project.id ? "Saving…" : project.title}
              </button>
            )
          })}
        </div>
      )}
      {warning && <p className="mt-2 text-[12px] text-espresso">Membership changed, with a derived-data warning: {warning}</p>}
    </section>
  )
}
