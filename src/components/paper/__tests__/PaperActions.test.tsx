// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PaperActions, type PaperActionsProps } from "../PaperActions"

const BASE_PROPS: PaperActionsProps = {
  pageState: { state: "saved", status: "saved" },
  saveState: { status: "idle" },
  onSave: () => {},
  enrichState: { status: "idle" },
  digestState: { status: "idle" },
  onGenerateDigest: () => {},
  ingestState: { phase: "idle" },
  onIngest: () => {},
  onUndo: () => {},
  onReadFullText: () => {},
}

describe("PaperActions — Read full text", () => {
  it("keeps feedback in the action row while status messages remain below it", () => {
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <PaperActions
        {...BASE_PROPS}
        enrichState={{ status: "loading" }}
        feedback={<button aria-label="More like this">Thumbs up</button>}
      />,
    )
    const row = container.querySelector('[role="group"][aria-label="Paper actions"]')!
    const feedback = row.querySelector('[aria-label="More like this"]')!
    expect(row.textContent).toContain("Generate digest")
    expect(row.textContent).toContain("Read full text")
    expect(feedback.parentElement?.classList.contains("ml-auto")).toBe(true)
    expect(row.textContent).not.toContain("No open-access full text")
    expect(container.textContent).toContain("Summarizing…")
  })

  it("leaves Read full text enabled and shows no note when full-text availability is unknown", () => {
    const html = renderToStaticMarkup(<PaperActions {...BASE_PROPS} />)
    const readButton = html.match(/<button[^>]*>Read full text<\/button>/)?.[0] ?? ""
    // React renders a falsy `disabled` prop by omitting the attribute
    // entirely (not `disabled="false"`), so a plain substring check is exact.
    expect(readButton).not.toContain("disabled=")
    expect(html).not.toContain("No open-access full text")
  })

  it("lets an ingested paper retry reading despite an earlier unsuccessful acquisition", () => {
    const html = renderToStaticMarkup(<PaperActions {...BASE_PROPS} pageState={{ state: "ingested", status: "ingested" }} />)
    const readButton = html.match(/<button[^>]*>Read full text<\/button>/)?.[0] ?? ""
    expect(readButton).not.toContain("disabled=")
    expect(html).not.toContain("No open-access full text")
  })

  it("shows a non-clickable generated state when a full-text digest is already available", () => {
    const html = renderToStaticMarkup(
      <PaperActions
        {...BASE_PROPS}
        digestState={{
          status: "done",
          fromCache: true,
          source: { access: "full-text", locator: "PDF", checkedAt: "2026-10-04T00:00:00.000Z", truncated: false, notes: [] },
          digest: {
            summary: "Summary",
            laySummary: "Lay summary",
            keyPoints: ["Point"],
            methods: "Methods",
            limitations: "Limitations",
            fieldContext: "Context",
          },
        }}
      />,
    )
    const digestButton = html.match(/<button[^>]*>Digest generated<\/button>/)?.[0] ?? ""
    expect(digestButton).toContain('disabled=""')
  })
  it("lets a legacy digest be upgraded from full text", () => {
    const html = renderToStaticMarkup(<PaperActions {...BASE_PROPS} digestState={{ status: "done", fromCache: true, digest: { summary: "Old", laySummary: "Old", keyPoints: [], methods: "Old", limitations: "Abstract only", fieldContext: "Old" } }} />)
    const button = html.match(/<button[^>]*>Update digest from full text<\/button>/)?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain("disabled=")
  })

})
