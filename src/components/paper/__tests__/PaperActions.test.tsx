// @vitest-environment jsdom
//
// C1 (whole-branch review): "Read full text" must stay enabled for a saved
// (not-yet-ingested) paper, and disabling it must always come with a "No
// open-access full text" note — a disabled button with no explanation reads
// as a dead end. See src/lib/papers/page-state.ts's isFullTextKnownUnavailable
// for the pure predicate this component's `fullTextKnownFalse` prop carries.
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PaperActions, type PaperActionsProps } from "../PaperActions"

const BASE_PROPS: PaperActionsProps = {
  pageState: { state: "saved", status: "saved" },
  fullTextKnownFalse: false,
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

describe("PaperActions — Read full text (C1)", () => {
  it("leaves Read full text enabled and shows no note when full-text availability is unknown", () => {
    const html = renderToStaticMarkup(<PaperActions {...BASE_PROPS} fullTextKnownFalse={false} />)
    const readButton = html.match(/<button[^>]*>Read full text<\/button>/)?.[0] ?? ""
    // React renders a falsy `disabled` prop by omitting the attribute
    // entirely (not `disabled="false"`), so a plain substring check is exact.
    expect(readButton).not.toContain("disabled=")
    expect(html).not.toContain("No open-access full text")
  })

  it("disables Read full text and shows the note when full text is known-unavailable", () => {
    const html = renderToStaticMarkup(<PaperActions {...BASE_PROPS} fullTextKnownFalse={true} />)
    const readButton = html.match(/<button[^>]*>Read full text<\/button>/)?.[0] ?? ""
    expect(readButton).toContain('disabled=""')
    expect(html).toContain("No open-access full text")
  })

  it("shows a non-clickable generated state when a digest is already available", () => {
    const html = renderToStaticMarkup(
      <PaperActions
        {...BASE_PROPS}
        digestState={{
          status: "done",
          fromCache: true,
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
})
