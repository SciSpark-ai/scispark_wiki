/** Local-server startup reconciliation only. Never auto-resume paid work. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return
  const { getServerVault } = await import("./lib/server/vault")
  const { recoverReviewJobs } = await import("./lib/review/coordinator")
  await recoverReviewJobs(await getServerVault())
}
