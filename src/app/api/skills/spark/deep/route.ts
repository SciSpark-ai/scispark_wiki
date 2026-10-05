import { nativeSkillRoute } from "@/lib/server/native-workflow"

export const POST = nativeSkillRoute("idea-spark", "ndjson", raw => {
  const input = raw as Record<string, unknown>
  return { ...input, mode: "deep" }
})
