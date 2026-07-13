import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { seedUserModel, USER_MODEL_PATHS, readUserModel } from "../../usermodel/pages"
import { logEvent } from "../../events/log"
import { loadChangeset } from "../../vault/changesets"
import {
  ConsolidationSchema,
  CONSOLIDATION_MARKER,
  CONSOLIDATION_MIN_EVENTS,
  consolidationDue,
  runConsolidation,
} from "../consolidation"

const NOW = () => new Date("2026-07-12T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const ANSWERS = {
  role: "PhD student in computational biology",
  fields: "computational biology, protein structure",
  topics: "protein folding\ndiffusion models",
  feedPrefs: "mostly methods papers",
}

async function seededStorage(): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  await seedUserModel(storage, ANSWERS, NOW)
  return storage
}

/** Logs `n` synthetic events, spaced one second apart starting at NOW(). */
async function logManyEvents(storage: MemoryVaultStorage, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const ts = new Date(NOW().getTime() + i * 1000)
    await logEvent(storage, { type: "paper_view", paperKey: `arxiv:${i}`, title: `Paper ${i}` }, () => ts)
  }
}

function structuredResult(output: { profile: string; interests: string; feedback: string }): LLMResult {
  return {
    text: JSON.stringify(output),
    json: output,
    usage: { inputTokens: 300, outputTokens: 150 },
    model: "claude-haiku-4-5",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

describe("ConsolidationSchema", () => {
  it("parses a well-formed result", () => {
    const value = { profile: "# Profile", interests: "# Interests", feedback: "# Standing instructions" }
    expect(ConsolidationSchema.safeParse(value).success).toBe(true)
  })

  it("rejects a result missing a required field", () => {
    expect(ConsolidationSchema.safeParse({ profile: "x", interests: "y" }).success).toBe(false)
  })
})

describe("consolidationDue", () => {
  it("is false on a fresh vault with no marker and no events", async () => {
    const storage = await seededStorage()
    expect(await consolidationDue(storage)).toBe(false)
  })

  it("is false below CONSOLIDATION_MIN_EVENTS", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS - 1)
    expect(await consolidationDue(storage)).toBe(false)
  })

  it("is true at or above CONSOLIDATION_MIN_EVENTS", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    expect(await consolidationDue(storage)).toBe(true)
  })
})

describe("runConsolidation", () => {
  it("returns skipped when below threshold and not forced — no LLM call made", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, 5)
    const provider = new MockProvider([])

    const result = await runConsolidation(storage, {
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(result).toEqual({ status: "skipped" })
    expect(provider.calls).toHaveLength(0)
    expect(await storage.read(CONSOLIDATION_MARKER)).toBeNull()
  })

  it("forced run bypasses the threshold even with zero events", async () => {
    const storage = await seededStorage()
    const before = await readUserModel(storage)
    const provider = new MockProvider([
      structuredResult({
        profile: before.profile!,
        interests: before.interests!,
        feedback: before.feedback!,
      }),
    ])

    const result = await runConsolidation(storage, {
      force: true,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(result.status).toBe("unchanged")
  })

  it("applied: writes only the changed pages via an atomic changeset, writes the marker, and logs a consolidation event", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    const before = await readUserModel(storage)

    const updatedInterests = before.interests + "\n- newly surfaced topic (5 views this week)\n"
    const provider = new MockProvider([
      structuredResult({
        profile: before.profile!, // unchanged
        interests: updatedInterests, // changed
        feedback: before.feedback!, // unchanged
      }),
    ])

    const result = await runConsolidation(storage, {
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(result.status).toBe("applied")
    expect(result.changesetId).toBeDefined()
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.runId).toBeDefined()

    // Only interests.md was rewritten.
    const after = await readUserModel(storage)
    expect(after.profile).toBe(before.profile)
    expect(after.interests).toBe(updatedInterests)
    expect(after.feedback).toBe(before.feedback)

    // The changeset record exists and only touches the changed page.
    const changeset = await loadChangeset(storage, result.changesetId!)
    expect(changeset).not.toBeNull()
    expect(changeset!.skill).toBe("memory-consolidation")
    expect(changeset!.changes).toHaveLength(1)
    expect(changeset!.changes[0].path).toBe(USER_MODEL_PATHS.interests)

    // Marker written.
    const markerRaw = await storage.read(CONSOLIDATION_MARKER)
    expect(markerRaw).not.toBeNull()
    const marker = JSON.parse(markerRaw as string)
    expect(typeof marker.lastTs).toBe("string")
    expect(marker.runId).toBe(result.runId)

    // consolidation event logged.
    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    expect(eventsRaw).not.toBeNull()
    const lines = (eventsRaw as string).trim().split("\n").map((l) => JSON.parse(l))
    const consolidationEvents = lines.filter((e) => e.type === "consolidation")
    expect(consolidationEvents).toHaveLength(1)
    expect(consolidationEvents[0].changesetId).toBe(result.changesetId)
  })

  it("unchanged: mock echoes current bodies verbatim — no changeset written, marker still advances", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    const before = await readUserModel(storage)

    const provider = new MockProvider([
      structuredResult({
        profile: before.profile!,
        interests: before.interests!,
        feedback: before.feedback!,
      }),
    ])

    const result = await runConsolidation(storage, {
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(result.status).toBe("unchanged")
    expect(result.changesetId).toBeUndefined()

    // No changeset audit records were created.
    const changesetFiles = await storage.list(".scispark/changesets/")
    expect(changesetFiles).toHaveLength(0)

    // Marker was still written (due-ness resets).
    const markerRaw = await storage.read(CONSOLIDATION_MARKER)
    expect(markerRaw).not.toBeNull()

    // No consolidation event was logged.
    const eventsRaw = await storage.read(".scispark/events/2026-07.jsonl")
    const lines = (eventsRaw as string).trim().split("\n").map((l) => JSON.parse(l))
    expect(lines.filter((e) => e.type === "consolidation")).toHaveLength(0)

    // Pages themselves are untouched.
    const after = await readUserModel(storage)
    expect(after).toEqual(before)
  })

  it("marker high-water mark excludes events logged during the LLM round-trip", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    const before = await readUserModel(storage)
    // Newest pre-call event ts: NOW + (MIN_EVENTS-1) seconds.
    const preCallNewest = new Date(NOW().getTime() + (CONSOLIDATION_MIN_EVENTS - 1) * 1000).toISOString()

    const inner = new MockProvider([
      structuredResult({ profile: before.profile!, interests: before.interests!, feedback: before.feedback! }),
    ])
    // A provider that logs a fresh event mid-call, simulating user activity
    // while the model is thinking.
    const midCallTs = new Date(NOW().getTime() + 3_600_000)
    const racyProvider = {
      id: inner.id,
      complete: async (model: string, req: Parameters<typeof inner.complete>[1]) => {
        await logEvent(storage, { type: "paper_view", paperKey: "arxiv:race", title: "Mid-run paper" }, () => midCallTs)
        return inner.complete(model, req)
      },
    }

    await runConsolidation(storage, {
      settings: settingsWithKeys(),
      providerOverride: { fast: racyProvider },
      now: NOW,
    })

    const marker = JSON.parse((await storage.read(CONSOLIDATION_MARKER)) as string)
    // The mid-run event was NOT in the LLM's context, so it must remain unconsolidated.
    expect(marker.lastTs).toBe(preCallNewest)
    expect(marker.lastTs < midCallTs.toISOString()).toBe(true)
  })

  it("a non-ok run status throws an Error carrying the run's error message", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    const provider = new MockProvider([new Error("provider exploded")])

    await expect(
      runConsolidation(storage, {
        settings: settingsWithKeys(),
        providerOverride: { fast: provider },
        now: NOW,
      }),
    ).rejects.toThrow(/provider exploded/)

    // Nothing written on failure.
    expect(await storage.read(CONSOLIDATION_MARKER)).toBeNull()
  })

  it("subsequent due-ness resets after a run advances the marker", async () => {
    const storage = await seededStorage()
    await logManyEvents(storage, CONSOLIDATION_MIN_EVENTS)
    const before = await readUserModel(storage)
    const provider = new MockProvider([
      structuredResult({ profile: before.profile!, interests: before.interests!, feedback: before.feedback! }),
    ])

    expect(await consolidationDue(storage)).toBe(true)
    await runConsolidation(storage, {
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })
    expect(await consolidationDue(storage)).toBe(false)
  })
})
