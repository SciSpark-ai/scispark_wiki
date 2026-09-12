/** Recover review state without paid resumption; start explicitly enabled scheduled jobs. */
export async function register() {
  // Keep Node-only imports inside the runtime branch so the development Edge
  // compiler can discard them before resolving native engine process modules.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return
    const { getServerVault } = await import("./lib/server/vault")
    const { recoverReviewJobs } = await import("./lib/review/coordinator")
    await recoverReviewJobs(await getServerVault())
    const { startHeartbeat } = await import("./lib/scheduler/heartbeat")
    startHeartbeat()
  }
}
