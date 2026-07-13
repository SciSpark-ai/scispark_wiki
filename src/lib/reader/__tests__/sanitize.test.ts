// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { sanitizePaperHtml } from "../sanitize"

describe("sanitizePaperHtml", () => {
  it("removes <script> tags and their content entirely", () => {
    const out = sanitizePaperHtml('<p>Before</p><script>alert("xss")</script><p>After</p>')
    expect(out).not.toContain("<script")
    expect(out).not.toContain("alert")
    expect(out).toContain("Before")
    expect(out).toContain("After")
  })

  it("strips on* event-handler attributes but keeps the element's text", () => {
    const out = sanitizePaperHtml('<p onclick="alert(1)" onmouseover="evil()">Click me</p>')
    expect(out).not.toContain("onclick")
    expect(out).not.toContain("onmouseover")
    expect(out).not.toContain("alert")
    expect(out).toContain("Click me")
  })

  it("drops <img> tags (or replaces them with a placeholder) so no external request is possible", () => {
    const out = sanitizePaperHtml('<p>See figure below.</p><img src="http://evil.example.com/track.png" onerror="steal()">')
    expect(out).not.toContain("<img")
    expect(out).not.toContain("evil.example.com")
    expect(out).not.toContain("steal")
    expect(out).toContain("See figure below.")
  })

  it("gives the img placeholder a class the reader typography can target, and keeps class on allowed elements", () => {
    const out = sanitizePaperHtml('<p class="lead">Text</p><img src="http://x/y.png">')
    expect(out).toContain('class="reader-figure-placeholder"')
    // class is allowed (inert) so the placeholder hook and structural hooks work.
    expect(out).toContain('class="lead"')
  })

  it("still forbids the style attribute even though class is allowed", () => {
    const out = sanitizePaperHtml('<p style="position:fixed" class="ok">Text</p>')
    expect(out).not.toContain("position:fixed")
    expect(out).not.toContain("style=")
  })

  it("strips iframe/style/object/embed tags", () => {
    const out = sanitizePaperHtml(
      '<iframe src="http://evil.example.com"></iframe>' +
        "<style>body{display:none}</style>" +
        '<object data="http://evil.example.com/x.swf"></object>' +
        '<embed src="http://evil.example.com/x.swf">' +
        "<p>Still here</p>",
    )
    expect(out).not.toContain("<iframe")
    expect(out).not.toContain("<style")
    expect(out).not.toContain("<object")
    expect(out).not.toContain("<embed")
    expect(out).not.toContain("evil.example.com")
    expect(out).toContain("Still here")
  })

  it("strips inline style attributes", () => {
    const out = sanitizePaperHtml('<p style="background:url(http://evil.example.com/x.png)">Text</p>')
    expect(out).not.toContain("style=")
    expect(out).not.toContain("evil.example.com")
    expect(out).toContain("Text")
  })

  it("neutralizes javascript: hrefs on anchors while keeping safe hrefs", () => {
    const out = sanitizePaperHtml(
      '<a href="javascript:alert(1)">bad</a><a href="https://example.com/paper">good</a>',
    )
    expect(out).not.toContain("javascript:")
    expect(out).toContain('href="https://example.com/paper"')
    expect(out).toContain("good")
  })

  it("keeps structural tags and their text content intact", () => {
    const html =
      "<h1>Title</h1>" +
      "<p>Intro paragraph with <strong>bold</strong> and <em>emphasis</em>.</p>" +
      "<ul><li>One</li><li>Two</li></ul>" +
      "<blockquote>A quote</blockquote>" +
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>" +
      "<figure><figcaption>Caption text</figcaption></figure>" +
      "<pre><code>const x = 1;</code></pre>" +
      "<p>H<sub>2</sub>O and E=mc<sup>2</sup></p>"

    const out = sanitizePaperHtml(html)

    expect(out).toContain("<h1>Title</h1>")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<em>emphasis</em>")
    expect(out).toContain("<li>One</li>")
    expect(out).toContain("<li>Two</li>")
    expect(out).toContain("A quote")
    expect(out).toContain("<table>")
    expect(out).toContain("Caption text")
    expect(out).toContain("const x = 1;")
    expect(out).toContain("<sub>2</sub>")
    expect(out).toContain("<sup>2</sup>")
  })

  it("is idempotent and deterministic on repeated calls", () => {
    const html = '<p onclick="x()">Repeat <script>evil()</script>me</p>'
    const first = sanitizePaperHtml(html)
    const second = sanitizePaperHtml(html)
    expect(first).toBe(second)
  })
})
