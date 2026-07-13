import { describe, it, expect } from "vitest"
import { COMPANION, personaFragment, withPersona } from "../persona"

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

  it("systemFragment carries a substantive accuracy-first directive tone can never override", () => {
    const fragment = COMPANION.systemFragment.toLowerCase()
    // Require an actual precedence statement, not just an incidental "ground"/"accura"
    // substring (e.g. "background") — so the fragment can't be gutted into pure fluff
    // while still passing. Match "accuracy … wins/first/always" or "never invent facts".
    const hasPrecedence =
      /accura\w*[^.]*\b(wins|first|comes first|always|over)\b/.test(fragment) ||
      /never (invent|fabricate|make up)\b/.test(fragment)
    expect(hasPrecedence).toBe(true)
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

describe("personaFragment (user-renamable companion, M7 addendum)", () => {
  it("substitutes the given name into the fragment", () => {
    expect(personaFragment("Fizz")).toContain("Fizz")
  })

  it("still carries the accuracy-first directive regardless of name", () => {
    expect(personaFragment("Fizz")).toContain("Accuracy and grounding always come first")
  })

  it("defaults to the default name (Ember) when called with no argument", () => {
    expect(personaFragment()).toContain("Ember")
  })
})

describe("withPersona with a custom name", () => {
  it("withPersona(sys, name) carries the custom name and the accuracy directive", () => {
    const sys = "Substantive rules go here."
    const result = withPersona(sys, "Fizz")
    expect(result).toContain("Fizz")
    expect(result).toContain("Accuracy and grounding always come first")
  })

  it("withPersona(sys) with no name still defaults to Ember", () => {
    expect(withPersona("Substantive rules go here.")).toContain("Ember")
  })
})
