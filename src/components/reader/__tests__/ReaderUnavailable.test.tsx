// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import type { PaperRecord } from "@/lib/papers/types"
import ReaderView from "../ReaderView"

const PAPER: PaperRecord = {
  ids: { doi: "10.21203/rs.3.rs-10788928/v1" },
  title: "A voice-and-avatar AI companion supports skill development in autistic children",
  authors: [{ name: "Rohan Dhameja" }],
  fields: [],
  source: "openalex",
}

describe("ReaderView unavailable state", () => {
  it("centers a publisher action and keeps the paper-details return secondary", () => {
    const html = renderToStaticMarkup(
      <ReaderView
        paper={PAPER}
        content={{ kind: "none", reason: "Full text unavailable (paywalled or no open-access HTML)." }}
        storage={new MemoryVaultStorage()}
      />,
    )
    const host = document.createElement("div")
    host.innerHTML = html

    const sourceLink = host.querySelector<HTMLAnchorElement>('a[href^="https://doi.org/"]')
    expect(sourceLink?.textContent).toContain("Open original paper")
    expect(sourceLink?.target).toBe("_blank")
    expect(sourceLink?.rel).toContain("noopener")

    const returnLink = Array.from(host.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("Back to paper details"),
    )
    expect(returnLink?.getAttribute("href")).toBe("/paper/10-21203-rs-3-rs-10788928-v1")
    expect(host.textContent).toContain("Full text is not available inside SciSpark")
    expect(host.textContent).not.toContain("paywalled or no open-access HTML")
    expect(host.querySelector("main")?.className).toContain("items-center")
    expect(host.querySelector("main")?.className).toContain("justify-center")
  })
})
