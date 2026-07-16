// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { extractBaseHref, buildFigureSrcResolver } from "../figures"

const ARXIV_HTML =
  '<!DOCTYPE html><html><head><base href="/html/2409.08710v1/"/><title>t</title></head>' +
  '<body><img src="extracted/5852395/F2.jpg"/></body></html>'

describe("extractBaseHref", () => {
  it("reads the document's <base href>", () => {
    expect(extractBaseHref(ARXIV_HTML)).toBe("/html/2409.08710v1/")
  })

  it("returns null when there is no base tag", () => {
    expect(extractBaseHref("<html><body><p>no base</p></body></html>")).toBeNull()
  })
})

describe("buildFigureSrcResolver", () => {
  const resolve = buildFigureSrcResolver(ARXIV_HTML, "https://arxiv.org/html/2409.08710")

  it("resolves a relative src against the document base and rewrites it through the relay", () => {
    expect(resolve("extracted/5852395/F2.jpg")).toBe(
      "/api/fetch?url=" + encodeURIComponent("https://arxiv.org/html/2409.08710v1/extracted/5852395/F2.jpg"),
    )
  })

  it("accepts an absolute same-host https src", () => {
    expect(resolve("https://arxiv.org/html/2409.08710v1/x1.png")).toBe(
      "/api/fetch?url=" + encodeURIComponent("https://arxiv.org/html/2409.08710v1/x1.png"),
    )
  })

  it("rejects cross-host srcs (crafted paper HTML must not turn readers into arbitrary fetchers)", () => {
    expect(resolve("https://evil.example.com/track.png")).toBeNull()
    expect(resolve("//evil.example.com/track.png")).toBeNull()
  })

  it("rejects non-http(s) schemes", () => {
    expect(resolve("data:image/png;base64,AAAA")).toBeNull()
    expect(resolve("javascript:alert(1)")).toBeNull()
    expect(resolve("blob:https://arxiv.org/uuid")).toBeNull()
  })

  it("rejects http (relay is https-only for figures)", () => {
    expect(resolve("http://arxiv.org/html/2409.08710v1/x1.png")).toBeNull()
  })

  it("resolves against the source URL directly when the document has no <base>", () => {
    const noBase = buildFigureSrcResolver("<html><body></body></html>", "https://arxiv.org/html/2409.08710v1/")
    expect(noBase("figs/one.png")).toBe(
      "/api/fetch?url=" + encodeURIComponent("https://arxiv.org/html/2409.08710v1/figs/one.png"),
    )
  })

  it("returns a null resolver result for everything when no usable source URL exists", () => {
    const noSource = buildFigureSrcResolver(ARXIV_HTML, undefined)
    expect(noSource("extracted/5852395/F2.jpg")).toBeNull()
  })

  it("rejects empty and whitespace srcs", () => {
    expect(resolve("")).toBeNull()
    expect(resolve("   ")).toBeNull()
  })
})
