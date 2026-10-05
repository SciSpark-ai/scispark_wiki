/** Recover durable state and start enabled jobs without delaying server readiness. */
export async function register() {
  // Keep Node-only imports inside the runtime branch so the development Edge
  // compiler can discard them before resolving native engine process modules.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return
    const start = async () => {
      const { getDefaultServerVault } = await import("./lib/server/vault")
      const { recoverReviewJobs } = await import("./lib/review/coordinator")
      await recoverReviewJobs(await getDefaultServerVault())
      const { startHeartbeat } = await import("./lib/scheduler/heartbeat")
      startHeartbeat()
      const { startWorkflowCoordinator } = await import("./lib/workflows/coordinator")
      await startWorkflowCoordinator()
    }
    void start().catch(() => { console.error("Runtime recovery failed; saved jobs remain available for recovery.") })
  }
}
