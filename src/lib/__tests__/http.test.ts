import { describe, it, expect } from "vitest"
import { readErrorMessage } from "../http"

describe("readErrorMessage", () => {
  it("returns the body's error field", async () => {
    expect(await readErrorMessage(Response.json({ error: "boom" }, { status: 500 }), "fallback")).toBe("boom")
  })

  it("falls back when the body has no error field or is not JSON", async () => {
    expect(await readErrorMessage(Response.json({}, { status: 500 }), "fallback")).toBe("fallback")
    expect(await readErrorMessage(new Response("<html>", { status: 502 }), "fallback")).toBe("fallback")
  })
})
