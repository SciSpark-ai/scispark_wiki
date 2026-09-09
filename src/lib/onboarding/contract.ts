import { z } from "zod"
import { RecommendationPreferencesSchema } from "../recommendation/contract"

export const ONBOARDING_PATH = "profile/onboarding-conversation.json"
export const GREETING = "Hi, I’m Sparky — your research companion. What should I call you?"
export const AnswerSchema = z.object({
  name: z.string().trim().min(1).max(100), role: z.string().trim().min(1).max(1000),
  fields: z.string().trim().min(1).max(2000), topics: z.string().max(4000),
  feedPrefs: z.string().max(4000), recommendations: RecommendationPreferencesSchema,
}).strict()
export const DraftSchema = z.object({
  name: z.string().max(100), role: z.string().max(1000), fields: z.string().max(2000),
  topics: z.string().max(4000), feedPrefs: z.string().max(4000),
  diversity: z.enum(["focused", "balanced", "exploratory"]).nullable(),
  diversityNote: z.string().max(1000), learnFromFeedback: z.boolean().nullable(),
}).strict()
const QuestionSchema = z.enum(["name", "research", "diversity", "learning", "clarification", "review"])
export const ReplySchema = z.object({
  message: z.string().trim().min(1).max(2400),
  draft: DraftSchema,
  question: QuestionSchema,
}).strict().superRefine((reply, context) => {
  if (reply.question === "review" && !completeDraft(reply.draft)) context.addIssue({
    code: "custom", path: ["question"],
    message: "Before review, clarify missing name, role, fields, diversity or explicit feedback-learning choice. Do not invite a review of an incomplete draft.",
  })
})
export const RecordSchema = z.object({
  version: z.literal(1),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }).strict()).max(81),
  draft: DraftSchema, question: QuestionSchema,
  pending: z.boolean(), confirmedAnswers: AnswerSchema.nullable(),
}).strict()
const RevisionSchema = z.string().regex(/^[a-f0-9]{64}$/).nullable()
export const InputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), revision: RevisionSchema, message: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("retry"), revision: RevisionSchema }).strict(),
  z.object({ action: z.literal("confirm"), revision: RevisionSchema, answers: AnswerSchema }).strict(),
])
export type OnboardingRecord = z.infer<typeof RecordSchema>
export type OnboardingDraft = z.infer<typeof DraftSchema>
export type OnboardingInput = z.infer<typeof InputSchema>
export type OnboardingState = OnboardingRecord & { revision: string | null; connected: boolean; onboarded: boolean }
export function initialRecord(): OnboardingRecord {
  return { version: 1, messages: [{ role: "assistant", content: GREETING }],
    draft: { name: "", role: "", fields: "", topics: "", feedPrefs: "", diversity: null, diversityNote: "", learnFromFeedback: null },
    question: "name", pending: false, confirmedAnswers: null }
}
function completeDraft(draft: OnboardingDraft): boolean {
  return Boolean(draft.name.trim() && draft.role.trim() && draft.fields.trim()) && draft.diversity !== null && draft.learnFromFeedback !== null
}
export function readyForConfirmation(record: OnboardingRecord): boolean {
  return record.question === "review" && !record.pending && completeDraft(record.draft)
}
export function draftAnswers(draft: OnboardingDraft): z.infer<typeof AnswerSchema> {
  return { name: draft.name, role: draft.role, fields: draft.fields, topics: draft.topics,
    feedPrefs: draft.feedPrefs, recommendations: { diversity: draft.diversity ?? "balanced", learnFromFeedback: draft.learnFromFeedback ?? false, resetAt: null } }
}
