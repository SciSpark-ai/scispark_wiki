import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { loadSession } from "../../chat/session"
import type { AskChatResult } from "../../chat/orchestrator"
import * as chatRoute from "../../../app/api/skills/chat/route"

const CONCEPT_ID = "wiki/concepts/attention"

function structured(output: unknown): LLMResult {
  return {
    text: JSON.stringify(output),
    json: output,
    usage: { inputTokens: 10, outputTokens: 5 },
    model: "m",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

function req(body: unknown): Request {
  return new Request("http://x/api/skills/chat", { method: "POST", body: JSON.stringify(body) })
}

describe("POST /api/skills/chat", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    await storage.write(
      ".scispark/settings.json",
      JSON.stringify({ ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }),
    )
    await storage.write(
      `${CONCEPT_ID}.md`,
      "---\ntype: concept\ntitle: Attention\ncreated: '2026-07-17'\nupdated: '2026-07-17'\ntags: []\nrelated: []\nsources: []\n---\n\n# Attention\n\nAttention weights every token pair.\n",
    )
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  it("streams both stages and returns the persisted assistant message", async () => {
    setSkillTestOverrides({
      providerOverride: {
        fast: new MockProvider([structured({ pageIds: ["attention"] })]),
        strong: new MockProvider([
          structured({ answer: "Attention weights token pairs.", citedPageIds: [CONCEPT_ID] }),
        ]),
      },
    })

    const res = await chatRoute.POST(req({ sessionId: null, question: "What is attention?", readSourcesOnly: false }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/x-ndjson")

    const stages: string[] = []
    const result = (await readNdjson(res, (event) => {
      if (event.type === "progress") stages.push(event.stage as string)
    })) as AskChatResult

    expect(stages).toEqual(["selecting", "answering"])
    expect(result.message.content).toBe("Attention weights token pairs.")
    expect(result.message.citedPageIds).toEqual([CONCEPT_ID])
    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages).toHaveLength(2)
  })

  it("returns a degraded turn as a normal result, not a terminal error line", async () => {
    setSkillTestOverrides({
      providerOverride: {
        fast: new MockProvider([structured({ pageIds: ["attention"] })]),
        strong: new MockProvider([new Error("provider exploded")]),
      },
    })

    const res = await chatRoute.POST(req({ sessionId: null, question: "What is attention?", readSourcesOnly: false }))
    const result = (await readNdjson(res, () => {})) as AskChatResult

    expect(result.message.error).toContain("provider exploded")
    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages[0]).toEqual({ role: "user", content: "What is attention?" })
  })
})
