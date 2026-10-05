import { createHash, randomUUID } from "node:crypto"
import type { VaultStorage } from "../vault/storage"
import { withVaultExclusive } from "../vault/exclusive"
import { processIsAlive } from "../vault/node-fs-storage"
import { SkillJobKeySchema, SkillJobSchema, type SkillJob } from "../skills/job-contract"

type Emit = (event: object) => void
type Active = { promise: Promise<unknown>; progress?: object; listeners: Set<Emit> }
// Stable across separately bundled routes and development module replacement.
const runtime = globalThis as typeof globalThis & {
  __scisparkSkillJobs?: { disk: Map<string, Map<string, Active>>; memory: WeakMap<VaultStorage, Map<string, Active>> }
}
const registry = runtime.__scisparkSkillJobs ??= { disk: new Map(), memory: new WeakMap() }
function jobs(storage: VaultStorage) {
  const key = storage.coordinationKey ?? storage
  // Separate maps preserve injected-storage isolation and real-vault identity.
  if (typeof key === "string") {
    if (!registry.disk.has(key)) registry.disk.set(key, new Map())
    return registry.disk.get(key)!
  }
  if (!registry.memory.has(key)) registry.memory.set(key, new Map())
  return registry.memory.get(key)!
}
const jobHash = (key: string) => createHash("sha256").update(SkillJobKeySchema.parse(key)).digest("hex")
export const skillJobPath = (key: string) => `.scispark/skill-jobs/${jobHash(key)}.json`
const lockName = (key: string) => `skill-job-${jobHash(key)}`
async function read(storage: VaultStorage, key: string): Promise<SkillJob | null> {
  const raw = await storage.read(skillJobPath(key))
  return raw === null ? null : SkillJobSchema.parse(JSON.parse(raw))
}
async function recover(storage: VaultStorage, key: string) {
  const job = await read(storage, key)
  if (job?.status === "running" && (!job.ownerPid || !processIsAlive(job.ownerPid)
    || (job.ownerPid === process.pid && !jobs(storage).has(key)))) {
    job.status = "interrupted"; job.ownerPid = null; job.updatedAt = new Date().toISOString()
    job.error = "The local server stopped before this action finished. It was not retried. Check the saved result before trying again."
    await storage.write(skillJobPath(key), JSON.stringify(job))
  }
  return job
}

/** Status reads never start work or silently replay an uncertain model call. */
export function readSkillJob(storage: VaultStorage, key: string) {
  return withVaultExclusive(storage, lockName(key), async () => {
    const job = await recover(storage, key)
    const progress = jobs(storage).get(key)?.progress
    // Returning to the page sees the latest text without per-token disk writes.
    return job?.status === "running" && progress ? { ...job, progress: { ...job.progress, ...progress } } : job
  })
}

function notify(active: Active, event: object) {
  active.progress = { ...active.progress, ...event }
  for (const listener of active.listeners) {
    try { listener(event) } catch { active.listeners.delete(listener) }
  }
}

/** The captured vault and durable ownership belong to the job, not its observers.
 * Existing POST response formats remain compatible; GET can reconnect after any
 * route change or browser reload. A dead runtime is reported, never auto-retried. */
export async function runSkillJob<T>(storage: VaultStorage, key: string, work: (emit: Emit) => Promise<T>, emit?: Emit, options: { signature?: string } = {}): Promise<T> {
  const signature = options.signature === undefined ? undefined : createHash("sha256").update(options.signature).digest("hex")
  const job = await withVaultExclusive(storage, lockName(key), async () => {
    const previous = await recover(storage, key)
    if (previous && (previous.status === "running" || jobs(storage).has(key))) {
      if (signature !== undefined && previous.signature !== signature) throw new Error("A response is still running in this conversation. Wait for it to finish.")
      return previous
    }
    const now = new Date().toISOString()
    const job: SkillJob = { id: randomUUID(), key, status: "running", startedAt: now, updatedAt: now, ownerPid: process.pid, signature }
    await storage.write(skillJobPath(key), JSON.stringify(job))
    const active: Active = { listeners: new Set(), promise: Promise.resolve() }
    jobs(storage).set(key, active)
    let writes = Promise.resolve()
    const persist = () => {
      const snapshot = JSON.stringify(job)
      writes = writes.then(() => storage.write(skillJobPath(key), snapshot))
      // The terminal await below handles write errors; avoid an early unhandled rejection.
      void writes.catch(() => undefined)
    }
    active.promise = Promise.resolve().then(async () => {
      try {
        const result = await work(event => {
          // Persist stages, not every token; the final chat is already durable.
          if (!("type" in event) || event.type !== "text") {
            job.progress = event as Record<string, unknown>; job.updatedAt = new Date().toISOString(); persist()
          }
          notify(active, event)
        })
        job.status = "completed"; job.result = result
        return result
      } catch (error) {
        job.status = "failed"; job.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        job.ownerPid = null; job.updatedAt = new Date().toISOString(); persist()
        try { await writes } finally { jobs(storage).delete(key) }
      }
    })
    void active.promise.catch(() => undefined)
    return job
  })
  const active = jobs(storage).get(key)
  if (active) {
    if (emit) { active.listeners.add(emit); if (active.progress) { try { emit(active.progress) } catch { active.listeners.delete(emit) } } }
    try { return await active.promise as T } finally { if (emit) active.listeners.delete(emit) }
  }
  // Another live local server may own the same vault. Observe its durable state.
  let snapshot = job
  while (snapshot.status === "running") {
    if (emit && snapshot.progress) { try { emit(snapshot.progress) } catch { emit = undefined } }
    await new Promise(resolve => setTimeout(resolve, 500))
    snapshot = (await readSkillJob(storage, key))!
  }
  if (snapshot.status !== "completed") throw new Error(snapshot.error ?? "The action did not complete.")
  return snapshot.result as T
}
