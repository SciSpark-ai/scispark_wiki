import { tmpdir } from "node:os"
import { z } from "zod"
import { engineExecutable, runEngineProcess } from "./process"
import type { EngineModel } from "./contracts"
import { LLMError } from "../llm/types"

const PageSchema = z.object({ data: z.array(z.object({
  model: z.string().min(1).max(150).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  displayName: z.string().min(1).max(200),
})).max(500), nextCursor: z.string().nullable().optional() })
const catalogs = new Map<string, { expires: number; pending: Promise<EngineModel[]> }>()

/** Read the installed CLI's catalog, not another app/version's shared cache.
 * Only initialize and model/list are sent; no thread, turn or model inference. */
export async function codexModels(): Promise<EngineModel[]> {
  const executable = await engineExecutable("codex")
  const cached = catalogs.get(executable)
  if (cached && cached.expires > Date.now()) return cached.pending
  const pending = readCatalog(executable).catch(() => {
    if (catalogs.get(executable)?.pending === pending) catalogs.delete(executable)
    throw new LLMError("Could not read this Codex CLI's available models. Check the connection again before starting a request.")
  })
  const entry = { expires: Date.now() + 60_000, pending }
  catalogs.set(executable, entry)
  return pending
}

async function readCatalog(executable: string): Promise<EngineModel[]> {
  const models: EngineModel[] = []
  let expectedId = 1, pages = 0, done = false
  const encode = (message: unknown) => `${JSON.stringify(message)}\n`
  const result = await runEngineProcess({ executable, cwd: tmpdir(), timeoutMs: 15_000, keepStdinOpen: true,
    args: ["app-server", "--listen", "stdio://", "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"',
      "-c", "analytics.enabled=false", "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.hooks=false"],
    input: encode({ id: 1, method: "initialize", params: { clientInfo: { name: "scispark_model_catalog", version: "0.1.0" }, capabilities: { experimentalApi: true } } }),
    onLine(line, reply) {
      if (!line.trim()) return
      const event = JSON.parse(line)
      if (event.id !== expectedId || done) return
      if (event.error) throw new Error("Model catalog request failed")
      if (expectedId === 1) {
        reply(encode({ method: "initialized", params: {} }))
        reply(encode({ id: ++expectedId, method: "model/list", params: { includeHidden: true } }))
        return
      }
      const page = PageSchema.parse(event.result)
      models.push(...page.data.map(m => ({ id: m.model, label: m.displayName })))
      if (page.nextCursor) {
        if (++pages >= 10) throw new Error("Model catalog exceeded page limit")
        reply(encode({ id: ++expectedId, method: "model/list", params: { includeHidden: true, cursor: page.nextCursor } }))
      } else { done = true; reply(null) }
    },
  })
  if (result.code !== 0 || !done || !models.length) throw new Error("No complete model catalog")
  return models.filter((model, i) => models.findIndex(m => m.id === model.id) === i)
}

export async function requireCodexModel(model: string) {
  if (!(await codexModels()).some(m => m.id === model)) throw new LLMError(`The installed Codex CLI does not list ${model} as an available model. Choose one from Check connection in Settings → Connect your AI. No model request was sent.`)
}
