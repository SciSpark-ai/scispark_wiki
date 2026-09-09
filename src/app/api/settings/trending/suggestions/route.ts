import { z } from "zod"
import { deriveAnchorDisciplines } from "@/lib/trending/anchors"
import { completeWindows } from "@/lib/trending/topics"
import { nodeTopicFieldGroupFn } from "@/lib/papers/node-search"
import { getSkillTestOverrides } from "@/lib/server/skill-route"

const Input = z.object({ labels: z.array(z.string().trim().min(1).max(120)).min(1).max(3) }).strict()

/** Explicit source lookup only: no AI, persistence or automatic selection. */
export async function POST(request: Request) {
  const input = Input.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: "Add 1–3 interests to suggest fields." }, { status: 400 })
  const anchors = await deriveAnchorDisciplines(
    input.data.labels, getSkillTestOverrides().fieldGroupFn ?? nodeTopicFieldGroupFn(),
    completeWindows(new Date()).recent,
  )
  if (!anchors.length) return Response.json({ error: "No suggestions available. You can choose fields from the list." }, { status: 503 })
  return Response.json({ anchors })
}
