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

describe("sanitizePaperHtml — figure images", () => {
  const resolveToRelay = (raw: string) =>
    raw.startsWith("extracted/") ? "/api/fetch?url=" + encodeURIComponent("https://arxiv.org/html/v1/" + raw) : null

  it("keeps an <img> whose src the resolver rewrites through the relay", () => {
    const out = sanitizePaperHtml(
      '<figure><img src="extracted/5852395/F2.jpg" alt="Refer to caption" width="598" height="255" onerror="p0wn()"><figcaption>Fig 1</figcaption></figure>',
      { resolveImageSrc: resolveToRelay },
    )
    expect(out).toContain("<img")
    expect(out).toContain('src="/api/fetch?url=' + encodeURIComponent("https://arxiv.org/html/v1/extracted/5852395/F2.jpg").replace(/&/g, "&amp;"))
    expect(out).toContain('alt="Refer to caption"')
    expect(out).toContain('width="598"')
    expect(out).toContain('loading="lazy"')
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("p0wn")
    expect(out).toContain("Fig 1")
  })

  it("replaces an <img> the resolver rejects with the [figure] placeholder", () => {
    const out = sanitizePaperHtml('<img src="https://evil.example.com/track.png">', {
      resolveImageSrc: resolveToRelay,
    })
    expect(out).not.toContain("<img")
    expect(out).not.toContain("evil.example.com")
    expect(out).toContain('class="reader-figure-placeholder"')
  })

  it("keeps placeholder behavior when no resolver is provided (default)", () => {
    const out = sanitizePaperHtml('<img src="extracted/5852395/F2.jpg">')
    expect(out).not.toContain("<img")
    expect(out).toContain('class="reader-figure-placeholder"')
  })

  it("never trusts the document's own src after resolution — the resolver's output is the only src", () => {
    // A crafted src that the resolver rewrites still can't smuggle its raw
    // value through: the output src must be exactly the resolver's return.
    const out = sanitizePaperHtml('<img src="extracted/x.png?a=1&b=2">', {
      resolveImageSrc: () => "/api/fetch?url=SAFE",
    })
    expect(out).toContain('src="/api/fetch?url=SAFE"')
    expect(out).not.toContain("a=1")
  })
})

describe("sanitizePaperHtml — MathML equations", () => {
  // Shape emitted by arXiv's LaTeXML: presentation MathML wrapped in
  // <semantics>, with content-MathML and the raw LaTeX source as
  // annotations. Browsers render MathML Core natively (semantics renders
  // its first child), so presentation markup must survive while the
  // annotations must be dropped WITH their contents.
  const LATEXML_EQUATION =
    '<math alttext="\\hat{r}(t,n)" display="inline" class="ltx_Math">' +
    "<semantics>" +
    '<mrow><mover accent="true"><mi>r</mi><mo stretchy="false">^</mo></mover>' +
    "<mo>⁢</mo>" +
    '<mrow><mo stretchy="false">(</mo><mi>t</mi><mo>,</mo><mi>n</mi><mo stretchy="false">)</mo></mrow></mrow>' +
    '<annotation-xml encoding="MathML-Content"><apply><ci>r</ci></apply></annotation-xml>' +
    '<annotation encoding="application/x-tex">\\hat{r}(t,n)</annotation>' +
    "</semantics></math>"

  it("keeps presentation MathML so browsers render it natively", () => {
    const out = sanitizePaperHtml(`<p>Where ${LATEXML_EQUATION} is the estimate.</p>`)
    expect(out).toContain("<math")
    expect(out).toContain("<mover")
    expect(out).toContain("<mi>r</mi>")
    expect(out).toContain("<mo")
    expect(out).toContain("is the estimate.")
  })

  it("keeps inert math attributes needed for correct rendering", () => {
    const out = sanitizePaperHtml(LATEXML_EQUATION)
    expect(out).toContain('display="inline"')
    expect(out).toContain('stretchy="false"')
    expect(out).toContain('accent="true"')
  })

  it("drops annotation and annotation-xml INCLUDING their contents (no LaTeX source leaking as text)", () => {
    const out = sanitizePaperHtml(LATEXML_EQUATION)
    expect(out).not.toContain("annotation")
    expect(out).not.toContain("x-tex")
    // The raw LaTeX source must not leak into VISIBLE text (it legitimately
    // survives in <math alttext="…">, which screen readers use and layout
    // never shows).
    const probe = document.createElement("div")
    probe.innerHTML = out
    expect(probe.textContent).not.toContain("\\hat{r}")
    // Content-MathML apply/ci must not survive either.
    expect(out).not.toContain("<apply")
    expect(out).not.toContain("<ci")
  })

  it("keeps display-block equations (the LaTeXML equation-table cells)", () => {
    const out = sanitizePaperHtml(
      '<table class="ltx_equationgroup"><tbody><tr><td>' +
        '<math display="block"><mrow><mi>s</mi><mo>=</mo><mn>1</mn></mrow></math>' +
        "</td></tr></tbody></table>",
    )
    expect(out).toContain('display="block"')
    expect(out).toContain("<mn>1</mn>")
  })

  it("never lets script content smuggle through MathML annotation or namespace tricks", () => {
    const out = sanitizePaperHtml(
      "<math><semantics>" +
        '<annotation-xml encoding="text/html"><script>steal()</script><img src="http://evil.example.com/x.png" onerror="p0wn()"></annotation-xml>' +
        "</semantics></math>" +
        "<math><mtext><script>evil()</script></mtext></math>",
    )
    expect(out).not.toContain("<script")
    expect(out).not.toContain("steal")
    expect(out).not.toContain("evil()")
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("evil.example.com")
  })
})
