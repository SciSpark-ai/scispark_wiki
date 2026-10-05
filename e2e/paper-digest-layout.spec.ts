import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH, type FeedResult } from "../src/lib/skills/feed-cache"
import { buildPaperPage } from "../src/lib/wiki/authoring"
import { serializeDocument } from "../src/lib/vault/frontmatter"

// Deliberately long synthetic content exercises the same reading problem as the
// reported paper. No source searches, model calls or real-vault writes.
test("digest stays readable across viewport sizes, preserves source and selection actions", async ({ page, request }, info) => {
  test.setTimeout(120_000)
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const slug = "digest-layout-fixture"
  const digestPath = `.scispark/digests/${slug}.json`
  const paper = { ids: { arxiv: slug }, title: "A State-Guided Adaptive Decision Framework for Robust EEG-Based Auditory Attention Switch Decoding", authors: [{ name: "Y. Researcher" }, { name: "X. Researcher" }],
    abstract: "This original abstract describes a synthetic study of auditory attention. Researchers compare attention decoding across audio, speakers and listeners, using six evaluation protocols to examine the effects of data partitioning. This is test content for the reading interface, not research evidence.",
    fields: ["Neuroscience"], source: "arxiv" as const, venue: "arXiv", year: 2026 }
  const digest = {
    summary: "A state-guided framework adapts temporal smoothing to track changes in auditory attention from EEG. The study compares six evaluation protocols to explore generalization across recordings, speakers and listeners. It reports improved decoding stability, while showing that the way recordings are divided can change the apparent performance.",
    keyPoints: ["Adaptive gating responds to changes in attention while maintaining stable predictions.", "Six evaluation protocols separate different sources of variation in the recordings.", "Reported differences across protocols motivate closer examination of data partitioning."],
    laySummary: "The researchers explore a way to track when a listener shifts attention between voices using electrical signals recorded from the scalp. Their method adjusts how much it smooths predictions to keep them steady while reacting to changes. How recordings are divided for testing can affect the apparent results.",
    methods: "The framework infers attention transition states through a causal state detector and uses these states to dynamically modulate temporal smoothing through adaptive gating. Evaluation uses six hierarchical protocols designed to assess generalization across audio, speakers, and subjects. Reported outcomes concern decoding accuracy, stability, and response latency, while comparisons across protocols probe sensitivity to data partitioning. The supplied abstract does not specify the EEG datasets, participant counts, preprocessing, underlying decoder, state-detection algorithm, gating function, protocol definitions, baselines, or statistical tests.",
    limitations: "Only the abstract is available, preventing assessment of experimental quality, reproducibility, and the size or statistical reliability of the reported gains. The absence of exact partitioning rules makes it unclear how thoroughly the six protocols isolate audio, speaker, and subject confounds. Protocol-dependent performance suggests possible partition-related bias but does not establish its source or magnitude. Computational cost, practical latency, and validation in everyday listening conditions are not described.",
    fieldContext: "This work sits within EEG-based auditory attention decoding for neuro-steered hearing devices, focusing on tracking changes in attention over time. Its methodological contribution is to make temporal smoothing depend on inferred attention transition states, addressing the tension between prediction stability and responsiveness. Its evaluation examines generalization across multiple sources of variation rather than treating familiar recordings and unseen listeners as equivalent.",
  }
  const saved = buildPaperPage(paper, { fullText: false, today: "2026-10-04", status: "saved" })
  const paths = [FEED_CACHE_PATH, digestPath, saved.path]
  const originals = await Promise.all(paths.map(async path => ({ path, content: await storage.read(path) })))
  const settings = await (await request.get("/api/settings")).json()
  const mutations: string[] = []
  page.on("request", req => {
    if (req.method() === "POST" && /\/api\/(?:skills\/(?:digest|enrich|ingest)|reading)/.test(req.url())) mutations.push(req.url())
  })
  const feed: FeedResult = { generatedAt: new Date().toISOString(), costUsd: 0,
    strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "Layout fixture" }] },
    stats: { retrieved: 1, ranked: 1 }, items: [{ paper, score: 1, whyThis: "Methods for attention decoding.", whyYou: "Matches auditory research.", whyNow: "A recent preprint." }] }
  try {
    await storage.write(FEED_CACHE_PATH, JSON.stringify(feed))
    await storage.write(digestPath, JSON.stringify(digest))
    for (const theme of ["light", "dark"]) {
      await request.put("/api/settings", { data: { ui: { theme } } })
      for (const width of [1600, 1280, 1200, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`/paper/${slug}`)
        await expect(page.getByText(digest.summary, { exact: true })).toBeVisible()
        await expect(page.getByRole("button", { name: "Update digest from full text", exact: true })).toBeEnabled()
        await page.screenshot({ path: info.outputPath(`digest-${theme}-${width}.png`) })
        const methods = await page.getByText(digest.methods, { exact: true }).boundingBox()
        const limits = await page.getByText(digest.limitations, { exact: true }).boundingBox()
        expect(methods!.width).toBeLessThanOrEqual(720)
        expect(limits!.y).toBeGreaterThan(methods!.y + methods!.height)
        expect(Math.abs(methods!.x - limits!.x)).toBeLessThan(2)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        // The digest begins before the original abstract; opening the source
        // remains native keyboard interaction, with all text preserved.
        const abstract = page.getByText("Original abstract", { exact: true })
        await expect(page.getByText(paper.abstract, { exact: true })).toBeHidden()
        await abstract.focus()
        await page.keyboard.press("Enter")
        await expect(page.getByText(paper.abstract, { exact: true })).toBeVisible()
        const compact = page.locator("summary").filter({ hasText: "On this page" })
        if (await compact.isVisible()) await compact.click()
        const methodLink = page.getByRole("link", { name: "Methods", exact: true }).filter({ visible: true })
        await methodLink.click()
        const target = page.locator("#digest-methods")
        await expect(target).toBeFocused()
        const position = await target.boundingBox()
        expect(position!.y).toBeGreaterThanOrEqual(0)
        expect(position!.y).toBeLessThan(150)
        if (width === 1600 || width === 390) await page.screenshot({ path: info.outputPath(`digest-reading-${theme}-${width}.png`) })
      }
    }
    // Saved papers retain their context; cached reading never triggers enrich.
    await storage.write(saved.path, serializeDocument({ ...saved.frontmatter, tldr: "A compact view of the synthetic attention method.", tags: ["Auditory attention"] }, saved.body))
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.reload()
    await expect(page.getByText("Project membership", { exact: true })).toBeVisible()
    await expect(page.getByText("A compact view of the synthetic attention method.", { exact: true })).toBeVisible()
    await page.getByText(digest.summary, { exact: true }).click({ clickCount: 3 })
    const selection = page.getByRole("toolbar", { name: "Selection actions" })
    await expect(selection.getByRole("button", { name: "Ask", exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath("digest-saved-selection.png") })
    expect(mutations).toEqual([])
    // Without a cached digest the source opens by default.
    await storage.delete(digestPath)
    await page.reload()
    await expect(page.getByText(paper.abstract, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Generate digest", exact: true })).toBeEnabled()
  } finally {
    for (const { path, content } of originals) {
      if (content === null) await storage.delete(path)
      else await storage.write(path, content)
    }
    await request.put("/api/settings", { data: { ui: { theme: settings.ui.theme } } })
  }
})
