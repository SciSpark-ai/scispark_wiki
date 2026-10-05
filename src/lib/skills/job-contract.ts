import { z } from "zod"

export const SkillJobKeySchema = z.string().min(1).max(512)
export const SkillJobSchema = z.object({
  id: z.string(), key: SkillJobKeySchema,
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  startedAt: z.string(), updatedAt: z.string(), ownerPid: z.number().nullable(),
  progress: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(), error: z.string().optional(),
  signature: z.string().optional(),
})
export type SkillJob = z.infer<typeof SkillJobSchema>
