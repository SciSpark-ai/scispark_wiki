// Next.js App Router picks this file up automatically (Next 15+/16, no config
// flag needed) and calls register() once per server instance. This is the one
// production entry point for the scheduler heartbeat (M12 follow-up Task 7) —
// see src/lib/scheduler/heartbeat.ts for the interval/singleton/kill-switch
// mechanics.
export async function register(): Promise<void> {
  // instrumentation.ts also loads for the edge runtime and (briefly) during
  // the production build; the heartbeat is Node-only server-runtime behavior,
  // so both must be excluded, not just one.
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { startHeartbeat } = await import("./lib/scheduler/heartbeat")
  startHeartbeat()
}
