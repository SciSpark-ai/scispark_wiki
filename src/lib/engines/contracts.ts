import { z } from "zod"

export const LocalEngineSchema = z.enum(["codex", "claude-code"])
export type LocalEngine = z.infer<typeof LocalEngineSchema>
const ModelSchema = z.string().trim().min(1).max(150).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)
const ModelsSchema = z.object({ fast: ModelSchema, strong: ModelSchema }).strict()
export const EngineSettingsSchema = z.object({
  kind: z.enum(["api", "codex", "claude-code"]),
  models: z.object({ codex: ModelsSchema, "claude-code": ModelsSchema }).strict(),
  timeoutSeconds: z.number().int().min(30).max(600),
}).strict()
export type EngineSettings = z.infer<typeof EngineSettingsSchema>
export const DEFAULT_ENGINES: EngineSettings = {
  kind: "api", models: {
    codex: { fast: "gpt-5.6-luna", strong: "gpt-5.6-sol" },
    "claude-code": { fast: "haiku", strong: "sonnet" },
  }, timeoutSeconds: 180,
}
export interface EngineStatus {
  engine: LocalEngine
  state: "ready" | "missing" | "signed-out" | "unsupported" | "unavailable"
  version?: string
  message: string
}
export const engineLabel = (kind: string) => kind === "codex" ? "Codex" : kind === "claude-code" ? "Claude Code" : "API key"
