// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ChatMessage } from "@/lib/chat/session"
import { CitationChips } from "../CitationChips"
import { MessageBubble } from "../MessageBubble"
import { MessageList } from "../MessageList"
import { Composer } from "../Composer"
import { SourcesToggle } from "../SourcesToggle"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  roots.push(root)
  return {
    host,
    rerender: (next: React.ReactElement) => act(() => root.render(next)),
  }
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: "assistant",
    content: "Diffusion models learn a denoising process.",
    citedPageIds: [],
    ...overrides,
  }
}

const PAGE_TITLES: Record<string, string> = {
  "wiki/papers/diffusion-model": "Denoising <i>Diffusion</i> Models",
  "wiki/concepts/attention": "Attention Mechanism",
}

describe("CitationChips", () => {
  it("renders one chip per id with the right href per type (paper vs wiki page)", () => {
    const html = renderToStaticMarkup(
      <CitationChips
        pageIds={["wiki/papers/diffusion-model", "wiki/concepts/attention"]}
        pageTitleById={PAGE_TITLES}
      />,
    )
    expect(html).toMatch(/<a[^>]+href="\/paper\/diffusion-model"/)
    expect(html).toMatch(/<a[^>]+href="\/wiki\/concepts\/attention"/)
    // displayTitle strips markup on the paper chip's label
    expect(html).toContain("Denoising Diffusion Models")
    expect(html).not.toContain("<i>Diffusion</i>")
    expect(html).toContain("Attention Mechanism")
  })

  it("renders an id with no known title using its slug rather than dropping it", () => {
    const html = renderToStaticMarkup(
      <CitationChips pageIds={["wiki/methods/unknown-method"]} pageTitleById={{}} />,
    )
    expect(html).toMatch(/<a[^>]+href="\/wiki\/methods\/unknown-method"/)
    expect(html).toContain("unknown-method")
  })

  it("renders nothing for an empty id list", () => {
    const html = renderToStaticMarkup(<CitationChips pageIds={[]} pageTitleById={{}} />)
    expect(html).toBe("")
  })
})

describe("MessageBubble", () => {
  it("renders CitationChips for an assistant message with non-empty citedPageIds", () => {
    const message = assistantMessage({ citedPageIds: ["wiki/papers/diffusion-model"] })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toMatch(/<a[^>]+href="\/paper\/diffusion-model"/)
  })

  it("renders no CitationChips when citedPageIds is empty", () => {
    const message = assistantMessage({ citedPageIds: [] })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).not.toMatch(/<a[^>]+href="\/paper\//)
  })

  it("renders the reason and no empty body when error is set with no content", () => {
    const message = assistantMessage({ content: "", error: "the answer step failed: 500 from provider" })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("the answer step failed: 500 from provider")
    // Still has real text content beyond the role label — never an empty bubble.
    expect(html.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan("Assistant".length)
  })

  it("renders the reason alongside real content when both are set (a degraded-but-answered turn)", () => {
    const message = assistantMessage({
      content: "Here is a partial answer.",
      error: "one selected page could not be read",
    })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Here is a partial answer.")
    expect(html).toContain("one selected page could not be read")
  })

  it("renders a quiet note when selectionFallback is set", () => {
    const message = assistantMessage({ selectionFallback: true })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toMatch(/keyword/i)
  })

  it("renders no selectionFallback note when unset", () => {
    const message = assistantMessage()
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).not.toMatch(/keyword/i)
  })

  it("notes what was skipped when skippedPageIds is set, using known titles and falling back to slugs", () => {
    const message = assistantMessage({
      skippedPageIds: ["wiki/concepts/attention", "wiki/methods/unknown-method"],
    })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Attention Mechanism")
    expect(html).toContain("unknown-method")
  })

  it("names pages affected by deterministic context truncation", () => {
    const message = assistantMessage({
      truncatedPageIds: ["wiki/concepts/attention", "wiki/methods/unknown-method"],
    })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Context limit reached")
    expect(html).toContain("Attention Mechanism")
    expect(html).toContain("unknown-method")
  })

  it("renders the Save to knowledge base control on an assistant message", () => {
    const message = assistantMessage()
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Save to knowledge base")
  })

  it("hides the Save control on an error-only message (nothing was actually answered)", () => {
    const message = assistantMessage({ content: "", error: "the answer step failed: 500 from provider" })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).not.toContain("Save to knowledge base")
  })

  it("hides the Save control when content is only a generic apology alongside a real error", () => {
    // Mirrors the orchestrator's actual failure shape (SP5 Task 6): a
    // non-empty but non-saveable apology string paired with `error` — the
    // presence check alone (hasContent) must not be enough to offer Save.
    const message = assistantMessage({
      content: "I couldn't answer that just now — the answer step failed. Your question is saved; try again.",
      error: "GMI 500",
    })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).not.toContain("Save to knowledge base")
  })

  it("still offers Save on a degraded-but-answered turn (selectionFallback set, real content, no error)", () => {
    const message = assistantMessage({ content: "Here is a real answer.", selectionFallback: true })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Save to knowledge base")
  })

  it("still offers Save on a degraded-but-answered turn (skippedPageIds set, real content, no error)", () => {
    const message = assistantMessage({
      content: "Here is a real answer, minus one page.",
      skippedPageIds: ["wiki/concepts/attention"],
    })
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).toContain("Save to knowledge base")
  })

  it("shows a Saving… state and disables the control while saving", () => {
    const message = assistantMessage()
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={true} />,
    )
    expect(html).toContain("Saving…")
    expect(html).toMatch(/<button[^>]+disabled/)
  })

  it("renders no Save control and no citation chips on a user message", () => {
    const message: ChatMessage = { role: "user", content: "What is a TRF?" }
    const html = renderToStaticMarkup(
      <MessageBubble
        message={message}
        pageTitleById={PAGE_TITLES}
        onSave={() => {}}
        saving={false}
      />,
    )
    expect(html).not.toContain("Save to knowledge base")
    expect(html).not.toMatch(/<a[^>]+href="\/(paper|wiki)\//)
  })

  it("ignores assistant-only fields on a user message even if a caller passes an odd shape", () => {
    // ChatMessage's type doesn't forbid a "user" message from carrying
    // citedPageIds/error/selectionFallback/skippedPageIds — defensive
    // isAssistant gating means none of these render regardless.
    const message: ChatMessage = {
      role: "user",
      content: "What is a TRF?",
      citedPageIds: ["wiki/papers/diffusion-model"],
      error: "should never surface",
      selectionFallback: true,
      skippedPageIds: ["wiki/concepts/attention"],
    }
    const html = renderToStaticMarkup(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={() => {}} saving={false} />,
    )
    expect(html).not.toContain("Save to knowledge base")
    expect(html).not.toMatch(/<a[^>]+href="\/(paper|wiki)\//)
    expect(html).not.toContain("should never surface")
    expect(html).not.toMatch(/keyword/i)
    expect(html).not.toMatch(/Couldn.t read/)
  })

  it("calls onSave when the Save control is clicked", () => {
    const onSave = vi.fn()
    const message = assistantMessage()
    const { host } = mount(
      <MessageBubble message={message} pageTitleById={PAGE_TITLES} onSave={onSave} saving={false} />,
    )
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save to knowledge base")!
    act(() => save.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe("MessageList", () => {
  it("renders one bubble per message, in order", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is a TRF?" },
      assistantMessage({ content: "A TRF is a temporal response function." }),
    ]
    const html = renderToStaticMarkup(
      <MessageList messages={messages} pageTitleById={{}} onSaveMessage={() => {}} savingIndex={null} />,
    )
    const userIdx = html.indexOf("What is a TRF?")
    const assistantIdx = html.indexOf("A TRF is a temporal response function.")
    expect(userIdx).toBeGreaterThanOrEqual(0)
    expect(assistantIdx).toBeGreaterThan(userIdx)
  })

  it("renders an empty state for an empty message list", () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[]} pageTitleById={{}} onSaveMessage={() => {}} savingIndex={null} />,
    )
    expect(html).toMatch(/no messages/i)
  })

  it("marks only the message at savingIndex as saving", () => {
    const messages: ChatMessage[] = [assistantMessage({ content: "first" }), assistantMessage({ content: "second" })]
    const html = renderToStaticMarkup(
      <MessageList messages={messages} pageTitleById={{}} onSaveMessage={() => {}} savingIndex={1} />,
    )
    expect((html.match(/Saving…/g) ?? []).length).toBe(1)
  })

  it("routes each bubble's save click through onSaveMessage with its own index", () => {
    const onSaveMessage = vi.fn()
    const messages: ChatMessage[] = [assistantMessage({ content: "first" }), assistantMessage({ content: "second" })]
    const { host } = mount(
      <MessageList messages={messages} pageTitleById={{}} onSaveMessage={onSaveMessage} savingIndex={null} />,
    )
    const saveButtons = Array.from(host.querySelectorAll("button")).filter(
      (b) => b.textContent === "Save to knowledge base",
    )
    expect(saveButtons).toHaveLength(2)
    act(() => saveButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onSaveMessage).toHaveBeenCalledWith(1)
  })
})

describe("Composer", () => {
  it("disables the textarea and submit while busy", () => {
    const html = renderToStaticMarkup(<Composer value="" onChange={() => {}} onSubmit={() => {}} busy={true} />)
    expect(html).toMatch(/<textarea[^>]+disabled/)
    expect(html).toMatch(/<button[^>]+disabled/)
  })

  it("submits on Enter", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="What is a TRF?" onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("does not submit on Shift+Enter (newline instead)", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="What is a TRF?" onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("does not submit on Enter when the value is empty", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="   " onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("does not submit on the Enter that commits an IME composition (isComposing)", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="你好" onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      // `isComposing` is a real KeyboardEventInit field (fired by a real IME
      // as the compose-committing Enter) — this is the same signal React
      // exposes as e.nativeEvent.isComposing.
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("does not submit on the Enter that commits an IME composition (keyCode 229 fallback)", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="你好" onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, keyCode: 229 }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("still submits a plain Enter once composition has ended", () => {
    const onSubmit = vi.fn()
    const { host } = mount(<Composer value="What is a TRF?" onChange={() => {}} onSubmit={onSubmit} busy={false} />)
    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: false }),
      )
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe("SourcesToggle", () => {
  it("reflects an off state", () => {
    const html = renderToStaticMarkup(<SourcesToggle value={false} onChange={() => {}} />)
    expect(html).toContain('aria-checked="false"')
    expect(html).toMatch(/saved papers only/i)
  })

  it("reflects an on state", () => {
    const html = renderToStaticMarkup(<SourcesToggle value={true} onChange={() => {}} />)
    expect(html).toContain('aria-checked="true"')
  })

  it("includes a one-line explanation of what the switch does", () => {
    const html = renderToStaticMarkup(<SourcesToggle value={false} onChange={() => {}} />)
    const text = html.replace(/<[^>]+>/g, " ")
    expect(text).toMatch(/paper/i)
  })

  it("calls onChange with the new value when toggled", () => {
    const onChange = vi.fn()
    const { host } = mount(<SourcesToggle value={false} onChange={onChange} />)
    const input = host.querySelector("input")! as HTMLInputElement
    // A real click toggles `checked` before firing "change" — matches how a
    // user actually interacts with a checkbox (jsdom doesn't do this for a
    // hand-fired "change" event, since setting `.checked` doesn't fire one).
    act(() => input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
