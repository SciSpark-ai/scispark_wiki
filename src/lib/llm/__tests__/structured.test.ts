import { describe, it, expect } from "vitest"
import { z } from "zod"
import { completeStructured, StructuredOutputError } from "../structured"
import { MockProvider } from "../mock-provider"
import type { LLMResult } from "../types"

const schema = z.object({ name: z.string(), count: z.number() })

const result = (overrides: Partial<LLMResult>): LLMResult => ({
  text: "",
  usage: { inputTokens: 10, outputTokens: 5 },
  model: "m",
  provider: "anthropic",
  stopReason: "end_turn",
  ...overrides,
})

describe("completeStructured", () => {
  it("returns the parsed value and usage on a valid first try, with exactly one call", async () => {
    const p = new MockProvider([
      result({ text: JSON.stringify({ name: "widget", count: 3 }) }),
    ])
    const { value, usage } = await completeStructured(
      p,
      "m",
      { messages: [{ role: "user", content: "go" }] },
      schema,
    )
    expect(value).toEqual({ name: "widget", count: 3 })
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(p.calls).toHaveLength(1)
  })

  it("retries once after an invalid first attempt, appending assistant+user messages, and sums usage", async () => {
    const badOutput = JSON.stringify({ name: "widget" }) // missing "count"
    const p = new MockProvider([
      result({ text: badOutput, usage: { inputTokens: 10, outputTokens: 5 } }),
      result({
        text: JSON.stringify({ name: "widget", count: 3 }),
        usage: { inputTokens: 20, outputTokens: 8 },
      }),
    ])
    const { value, usage } = await completeStructured(
      p,
      "m",
      { messages: [{ role: "user", content: "go" }] },
      schema,
    )
    expect(value).toEqual({ name: "widget", count: 3 })
    expect(usage).toEqual({ inputTokens: 30, outputTokens: 13 })
    expect(p.calls).toHaveLength(2)

    const secondReqMessages = p.calls[1].req.messages
    expect(secondReqMessages).toHaveLength(3)
    expect(secondReqMessages[0]).toEqual({ role: "user", content: "go" })
    expect(secondReqMessages[1]).toEqual({ role: "assistant", content: badOutput })
    expect(secondReqMessages[2].role).toBe("user")
    expect(secondReqMessages[2].content).toContain("failed validation")
  })

  it("throws StructuredOutputError with both raw outputs when invalid twice", async () => {
    const badOutput1 = JSON.stringify({ name: "widget" })
    const badOutput2 = JSON.stringify({ count: 3 })
    const p = new MockProvider([
      result({ text: badOutput1 }),
      result({ text: badOutput2 }),
    ])

    let thrown: unknown
    try {
      await completeStructured(
        p,
        "m",
        { messages: [{ role: "user", content: "go" }] },
        schema,
      )
      throw new Error("expected completeStructured to throw")
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(StructuredOutputError)
    const err = thrown as StructuredOutputError
    expect(err.attempts).toEqual([badOutput1, badOutput2])
    expect(p.calls).toHaveLength(2)
    // The failure still spent provider tokens on BOTH attempts — carried on the
    // error so the harness can meter it (never a silent bill).
    expect(err.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
  })

  it("validates from result.json when the provider returns json directly (no text parsing)", async () => {
    const p = new MockProvider([
      result({ text: "not valid json {{{", json: { name: "widget", count: 3 } }),
    ])
    const { value } = await completeStructured(
      p,
      "m",
      { messages: [{ role: "user", content: "go" }] },
      schema,
    )
    expect(value).toEqual({ name: "widget", count: 3 })
    expect(p.calls).toHaveLength(1)
  })

  it("normalizes a known provider wire shape before validation without changing the advertised schema", async () => {
    const listSchema = z.object({
      items: z.array(z.object({ id: z.number().int() })),
    })
    const p = new MockProvider([
      result({ text: JSON.stringify([{ id: 7 }]), json: [{ id: 7 }] }),
    ])

    const { value } = await completeStructured(
      p,
      "m",
      { messages: [{ role: "user", content: "go" }] },
      listSchema,
      {
        normalizeCandidate: (candidate) => Array.isArray(candidate) ? { items: candidate } : candidate,
      },
    )

    expect(value).toEqual({ items: [{ id: 7 }] })
    expect(p.calls).toHaveLength(1)
    expect(p.calls[0].req.jsonSchema).toMatchObject({ type: "object" })
    expect(p.calls[0].req.jsonSchema).not.toHaveProperty("anyOf")
  })
})
