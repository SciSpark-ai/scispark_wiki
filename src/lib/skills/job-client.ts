import { readErrorMessage } from "../http"
import { SkillJobSchema, type SkillJob } from "./job-contract"

/** Read-only reconnect. Aborting stops observation, never server work. */
export async function observeSkillJob(key: string, onUpdate: (job: SkillJob) => void | Promise<void>, signal: AbortSignal, fetchFn: typeof fetch = fetch): Promise<void> {
  while (!signal.aborted) {
    const response = await fetchFn(`/api/skills/jobs?key=${encodeURIComponent(key)}`, { cache: "no-store", signal })
    if (!response.ok) throw new Error(await readErrorMessage(response, "Could not reconnect. Reload to check progress."))
    const { result } = await response.json()
    if (signal.aborted || result === null) return
    const job = SkillJobSchema.parse(result)
    await onUpdate(job)
    if (job.status !== "running" || signal.aborted) return
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
      const timer = setTimeout(finish, 750)
      signal.addEventListener("abort", finish, { once: true })
      if (signal.aborted) finish()
    })
  }
}
