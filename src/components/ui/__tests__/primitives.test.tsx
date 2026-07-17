// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../Button"
import { Card } from "../Card"
import { Chip } from "../Chip"
import { PageHeader } from "../PageHeader"
import { EmptyState } from "../EmptyState"
import { LoadingState } from "../LoadingState"

describe("ui primitives", () => {
  it("Button variants render token classes", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain("bg-orange")
    expect(renderToStaticMarkup(<Button variant="secondary">Go</Button>)).toContain("border-border-warm")
    expect(renderToStaticMarkup(<Button variant="quiet">Go</Button>)).toContain("text-muted-text")
  })
  it("Card, Chip, PageHeader, EmptyState, LoadingState render", () => {
    expect(renderToStaticMarkup(<Card>x</Card>)).toContain("rounded-card")
    expect(renderToStaticMarkup(<Chip>tag</Chip>)).toContain("rounded-pill")
    const header = renderToStaticMarkup(<PageHeader title="Papers" description="d" actions={<span>a</span>} />)
    expect(header).toContain("Papers")
    expect(header).toContain("font-heading")
    expect(renderToStaticMarkup(<EmptyState title="Nothing yet" hint="h" />)).toContain("Nothing yet")
    expect(renderToStaticMarkup(<LoadingState label="Loading…" />)).toContain("Loading…")
  })
})
