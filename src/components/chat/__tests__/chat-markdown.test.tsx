// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageBubble } from "../MessageBubble"
import { StreamingReply } from "../StreamingReply"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const answer = "1. **General background on CNNT's design.** This is *background*.\n\n2. **This paper's results.** Uses `EEG`."

function bubble(content: string, role: "assistant" | "user" = "assistant") {
  return <MessageBubble message={{ role, content }} pageTitleById={{}} onSave={() => {}} saving={false} />
}

describe("Sparky Markdown", () => {
  it("formats saved answers with bold, italics, inline code and numbered options", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(bubble(answer))
    expect(host.querySelector("li strong")?.textContent).toBe("General background on CNNT's design.")
    expect(host.querySelector("em")?.textContent).toBe("background")
    expect(host.querySelector("code")?.textContent).toBe("EEG")
    expect(host.querySelector('ol[start="2"] li strong')?.textContent).toBe("This paper's results.")
    expect(host.textContent).not.toContain("**")
    expect(host.textContent).toContain("Save to knowledge base")
    host.innerHTML = renderToStaticMarkup(bubble("**What the paper covers**\nThe study uses EEG."))
    expect(host.querySelector("p")?.textContent).toBe("What the paper covers\nThe study uses EEG.")
  })

  it("updates incomplete streaming Markdown and keeps the final formatting", () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    try {
      act(() => root.render(<StreamingReply text="1. **General background" />))
      expect(host.textContent).toContain("General background")
      act(() => root.render(<StreamingReply text={answer} />))
      expect(host.querySelector("[data-streaming-text] strong")?.textContent).toBe("General background on CNNT's design.")
      expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
      expect(host.querySelector("button, a")).toBeNull()
      act(() => root.render(bubble(answer)))
      expect(host.querySelector("li strong")?.textContent).toBe("General background on CNNT's design.")
    } finally { act(() => root.unmount()) }
  })

  it("keeps raw HTML inert and model-written links separate from verified citations", () => {
    const content = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[Unsafe](javascript:alert) [Unverified source](/wiki/made-up)'
    for (const element of [bubble(content), <StreamingReply key="stream" text={content} />]) {
      const host = document.createElement("div")
      host.innerHTML = renderToStaticMarkup(element)
      expect(host.querySelector("script, img, a")).toBeNull()
      expect(host.textContent).toContain("<script>alert(1)</script>")
      expect(host.textContent).toContain("Unverified source")
    }
  })

  it("preserves literal formatting in user messages", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(bubble("What does **this notation** mean?", "user"))
    expect(host.querySelector("strong")).toBeNull()
    expect(host.textContent).toContain("**this notation**")
  })
})
