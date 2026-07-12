import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "./types"

export class MockProvider implements LLMProvider {
  readonly id: ProviderId = "anthropic"
  calls: Array<{ model: string; req: LLMRequest }> = []

  constructor(private responses: Array<LLMResult | Error>) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    this.calls.push({ model, req })
    const next = this.responses.shift()
    if (!next) throw new Error("MockProvider: no responses left")
    if (next instanceof Error) throw next
    return next
  }
}
