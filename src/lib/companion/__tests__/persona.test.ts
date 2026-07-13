import { describe, it, expect } from "vitest"
import { COMPANION, withPersona } from "../persona"

describe("COMPANION", () => {
  it("has a non-empty name", () => {
    expect(COMPANION.name.trim().length).toBeGreaterThan(0)
  })

  it("has a non-empty character description", () => {
    expect(COMPANION.character.trim().length).toBeGreaterThan(0)
  })

  it("has a non-empty systemFragment", () => {
    expect(COMPANION.systemFragment.trim().length).toBeGreaterThan(0)
  })

  it("systemFragment mentions grounding/accuracy so tone can never override substance", () => {
    const fragment = COMPANION.systemFragment.toLowerCase()
    const mentionsAccuracy = /accura|ground/.test(fragment)
    expect(mentionsAccuracy).toBe(true)
  })
})

describe("withPersona", () => {
  it("returns the persona fragment followed by the caller's system prompt", () => {
    const sys = "You are the Ingest skill. Only use provided sources."
    const result = withPersona(sys)
    expect(result).toContain(COMPANION.systemFragment)
    expect(result).toContain(sys)
    expect(result.indexOf(COMPANION.systemFragment)).toBeLessThan(result.indexOf(sys))
  })

  it("places the fragment strictly before the caller's prompt with a blank-line separator", () => {
    const sys = "Substantive rules go here."
    expect(withPersona(sys)).toBe(`${COMPANION.systemFragment}\n\n${sys}`)
  })
})
