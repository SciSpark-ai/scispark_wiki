import { getServerVault } from "@/lib/server/vault"
import { readSkillJob } from "@/lib/server/skill-jobs"
import { SkillJobKeySchema } from "@/lib/skills/job-contract"

export async function GET(request: Request) {
  const key = SkillJobKeySchema.safeParse(new URL(request.url).searchParams.get("key"))
  if (!key.success) return Response.json({ error: "Invalid action" }, { status: 400 })
  try {
    const job = await readSkillJob(await getServerVault(), key.data)
    return Response.json({ result: job }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load action" }, { status: 500 })
  }
}
