// Shared schema only: safe in the browser without importing the AI runner.
import { z } from "zod"

export const DigestSchema = z.object({
  /** One precise, technical paragraph summarizing the paper for a researcher in the field. */
  summary: z.string(),
  /** 2-3 sentences a non-specialist can understand. */
  laySummary: z.string(),
  /** Up to 6 concrete findings/contributions — not section names. */
  keyPoints: z.array(z.string()),
  /** How the work was done. */
  methods: z.string(),
  /** Honest limitations and caveats. */
  limitations: z.string(),
  /** Where this work sits within its broader field. */
  fieldContext: z.string(),
})

export type DigestResult = z.infer<typeof DigestSchema>
