import { z } from "zod"
import { LLMError, type LLMProvider, type LLMRequest, type LLMUsage } from "./types"

export class StructuredOutputError extends LLMError {
  constructor(message: string, public attempts: string[]) {
    super(message)
  }
}

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
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
  opts?: { schemaName?: string },
): Promise<{ value: T; usage: LLMUsage }> {
  const jsonSchema = z.toJSONSchema(schema)
  const attempts: string[] = []
  let usage: LLMUsage | undefined
  let messages = req.messages

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.complete(model, {
      ...req,
      messages,
      jsonSchema,
      schemaName: opts?.schemaName,
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
