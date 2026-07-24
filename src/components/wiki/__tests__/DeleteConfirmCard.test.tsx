// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import DeleteConfirmCard from "../DeleteConfirmCard"

describe("DeleteConfirmCard", () => {
  it("shows the backlink count line when backlinks > 0", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmCard
        title="Attention Mechanism"
        backlinks={3}
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).toContain("3 pages link here")
  })

  it("hides the backlink line when backlinks is 0", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmCard
        title="Attention Mechanism"
        backlinks={0}
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).not.toContain("pages link here")
  })

  it("renders the error prop inline when set", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmCard
        title="Attention Mechanism"
        backlinks={0}
        busy={false}
        error="page is not deletable: wiki/profile"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).toContain("page is not deletable: wiki/profile")
  })

  it("disables the confirm button while busy", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmCard
        title="Attention Mechanism"
        backlinks={0}
        busy={true}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).toMatch(/<button[^>]*disabled[^>]*>/)
  })

  it("renders the page title in the confirm copy", () => {
    const html = renderToStaticMarkup(
      <DeleteConfirmCard
        title="Attention Mechanism"
        backlinks={0}
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(html).toContain("Attention Mechanism")
  })
})
