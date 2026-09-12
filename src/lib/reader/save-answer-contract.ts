import { z } from "zod"

export const SaveReadingAnswerSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  answer: z.string().trim().min(1).max(100000),
  paperKey: z.string().trim().min(1).max(1000),
  paperTitle: z.string().trim().min(1).max(2000),
  selection: z.string().trim().min(1).max(50000),
  citedPageIds: z.array(z.string().min(1).max(1000)).max(100),
}).strict()
export type SaveReadingAnswerInput = z.infer<typeof SaveReadingAnswerSchema>
