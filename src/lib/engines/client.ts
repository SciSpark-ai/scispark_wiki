import type { EngineStatus, LocalEngine } from "./contracts"
import { errorMessageFor } from "../llm/settings-client"

/** Installation/login inspection only; never initiates model inference. */
export async function checkLocalEngine(engine: LocalEngine): Promise<EngineStatus> {
  const response = await fetch("/api/settings/engines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine }) })
  if (!response.ok) throw new Error(await errorMessageFor(response))
  return (await response.json() as { status: EngineStatus }).status
}
