import { z } from "zod"
import { LLMError, type LLMProvider, type LLMRequest, type LLMUsage } from "./types"
import { streamedStringField } from "./streamed-field"

export class StructuredOutputError extends LLMError {
  constructor(
    message: string,
    public attempts: string[],
    /**
     * Provider tokens actually spent across every attempt before giving up. A
     * structured call that fails validation still calls the model (often twice)
     * and still costs real money — the harness meters this so a failed call is
     * never silently billed. Defaults to zero for the unreachable-fallthrough
     * throw where no request was made.
     */
    public usage: LLMUsage = { inputTokens: 0, outputTokens: 0 },
  ) {
    super(message)
  }
}

export interface StructuredOutputOptions {
  streamField?: string
  onText?: (text: string) => void
  schemaName?: string
  /**
   * Narrow compatibility hook applied before strict schema validation. It may
   * normalize a known provider wire quirk, but the normalized value must still
   * pass the original zod schema. The provider always receives that original
   * schema; this hook never weakens or changes the advertised JSON contract.
   */
  normalizeCandidate?: (candidate: unknown) => unknown
}

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cachedInputTokens !== undefined || b.cachedInputTokens !== undefined
      ? { cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) } : {}),
    ...(a.reasoningTokens !== undefined || b.reasoningTokens !== undefined
      ? { reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) } : {}),
    ...(a.reported === false || b.reported === false ? { reported: false } : {}),
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
}

export async function completeStructured<T>(
  provider: LLMProvider,
  model: string,
  req: Omit<LLMRequest, "jsonSchema" | "schemaName">,
  schema: z.ZodType<T>,
  opts?: StructuredOutputOptions,
): Promise<{ value: T; usage: LLMUsage }> {
  const jsonSchema = z.toJSONSchema(schema)
  const attempts: string[] = []
  let usage: LLMUsage | undefined
  let messages = req.messages

  for (let attempt = 0; attempt < 2; attempt++) {
    let previousPreview: string | undefined
    const result = await provider.complete(model, {
      ...req,
      messages,
      jsonSchema,
      schemaName: opts?.schemaName,
      ...(opts?.streamField && opts.onText ? {
        onText: (raw: string) => {
          const preview = streamedStringField(raw, opts.streamField!)
          if (preview === previousPreview) return
          previousPreview = preview
          opts.onText!(preview)
        },
      } : {}),
    })
    usage = usage ? sumUsage(usage, result.usage) : result.usage
    attempts.push(result.text)

    let candidate: unknown
    let parseError: string | undefined
    if (result.json !== undefined) {
      candidate = result.json
    } else {
      try {
        candidate = JSON.parse(result.text)
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e)
      }
    }

    if (parseError === undefined) {
      if (opts?.normalizeCandidate) candidate = opts.normalizeCandidate(candidate)
      const parsed = schema.safeParse(candidate)
      if (parsed.success) {
        return { value: parsed.data, usage: usage! }
      }
      parseError = formatIssues(parsed.error)
    }

    if (attempt === 1) {
      throw new StructuredOutputError(
        `Structured output validation failed after ${attempts.length} attempts: ${parseError}`,
        attempts,
        usage,
      )
    }

    messages = [
      ...messages,
      { role: "assistant", content: result.text },
      {
        role: "user",
        content: `Your previous output failed validation: ${parseError}. Return ONLY corrected JSON matching the schema.`,
      },
    ]
  }

  // Unreachable: loop always returns or throws.
  throw new StructuredOutputError("Structured output validation failed", attempts)
}
