import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { SearchFn } from "../skills/feed"
import { getServerVault } from "./vault"

/**
 * Re-exported for server-side convenience (the interface this module was
 * originally specced against groups `readNdjson` with `jsonSkillRoute`/
 * `ndjsonSkillRoute` as "the same file"). Browser code MUST import
 * `readNdjson` from `./ndjson` directly instead of from here — see that
 * file's header comment for why importing it via this module breaks the
 * client bundle.
 */
export { readNdjson } from "./ndjson"

/**
 * Shared skill-route foundation (M11 Task 5): every skill route (trending,
 * and every later milestone's route) is either a single-shot JSON call
 * (`jsonSkillRoute`) or a progress-streaming NDJSON call (`ndjsonSkillRoute`).
 * Both own the boilerplate every route would otherwise repeat: parsing the
 * request body, resolving the server vault singleton, and turning a thrown
 * error into a well-formed error response — so route files themselves stay
 * down to "assemble deps, call the orchestrator".
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * `req.json()` → `getServerVault()` → `handler(input, vault)` → `200 {result}`.
 * Any throw anywhere in that chain (malformed body, vault failure, handler
 * failure) becomes `500 {error: message}` — this route family has no
 * user-facing form to validate against, so it collapses every failure mode
 * to one shape rather than distinguishing 400 vs 500.
 */
export function jsonSkillRoute<TIn, TOut>(
  handler: (input: TIn, vault: VaultStorage) => Promise<TOut>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const input = (await req.json()) as TIn
      const vault = await getServerVault()
      const result = await handler(input, vault)
      return jsonResponse(200, { result })
    } catch (err) {
      return jsonResponse(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

/**
 * `req.json()` → `getServerVault()` → `handler(input, vault, emit)`, streamed
 * back as newline-delimited JSON (`content-type: application/x-ndjson`).
 * `emit(event)` writes one `{...}\n` progress line immediately (for
 * long-running skills to report per-item progress); the handler's resolved
 * value is written as the terminal `{"type":"result",...}\n` line; any throw
 * anywhere in the chain (malformed body, vault failure, handler failure)
 * writes the terminal `{"type":"error","message":...}\n` line instead. The
 * stream always terminates — the `finally` closes the controller on both the
 * success and failure paths, and the HTTP response itself is always 200 (the
 * outcome lives in the terminal NDJSON line, not the status code, since the
 * headers are already committed once streaming starts).
 */
export function ndjsonSkillRoute<TIn>(
  handler: (input: TIn, vault: VaultStorage, emit: (event: object) => void) => Promise<object>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: object): void => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
        try {
          const input = (await req.json()) as TIn
          const vault = await getServerVault()
          const result = await handler(input, vault, emit)
          emit({ type: "result", ...result })
        } catch (err) {
          emit({ type: "error", message: err instanceof Error ? err.message : String(err) })
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    })
  }
}

export interface SkillTestOverrides {
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  searchFn?: SearchFn
}

let skillTestOverrides: SkillTestOverrides = {}

/**
 * Test-only hook: lets a route test inject a MockProvider and/or a fake
 * SearchFn so skill routes never hit the network or spend real money. Route
 * handlers read this via `getSkillTestOverrides()` and fall back to their
 * real production deps (`nodeSearchFn()`, no `providerOverride`) when unset.
 * This is module-level, cross-test state — like `setServerVaultForTests`,
 * every test that calls this MUST reset it in `afterEach` (call with no args,
 * i.e. `setSkillTestOverrides()`, to clear) or it leaks into later tests.
 */
export function setSkillTestOverrides(overrides: SkillTestOverrides = {}): void {
  skillTestOverrides = overrides
}

/** Read the current test overrides (production route handlers call this). */
export function getSkillTestOverrides(): SkillTestOverrides {
  return skillTestOverrides
}

