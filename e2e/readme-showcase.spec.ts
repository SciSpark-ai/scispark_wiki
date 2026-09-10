/** Opt-in documentation capture. Uses only the harness's disposable vault. */
import { test, expect } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel } from "../src/lib/usermodel/pages"
import { buildPaperPage, composePage, slugifyTitle } from "../src/lib/wiki/authoring"
import { buildIdeaPage } from "../src/lib/spark/idea-page"
import { createProject, addProjectMember, createProjectNote } from "../src/lib/projects/repository"
import { revisionOf } from "../src/lib/projects/revision"
import { createReview, updateReview } from "../src/lib/review/store"
import { loadSession, saveSession } from "../src/lib/chat/session"
import { runFeed } from "../src/lib/skills/feed"
import { MockProvider } from "../src/lib/llm/mock-provider"
import { writeIndex } from "../src/lib/vault/index-builder"
import { loadBundle } from "../src/lib/vault/bundle"
import type { LLMResult } from "../src/lib/llm/types"
import type { PaperRecord } from "../src/lib/papers/types"

const structured = (json: unknown): LLMResult => ({ text: JSON.stringify(json), json,
  usage: { inputTokens: 0, outputTokens: 0 }, model: "gpt-5.4-mini", provider: "openai", stopReason: "end_turn" })

test("capture README product showcase with illustrative data", async ({ page, request }) => {
  test.skip(process.env.SCISPARK_CAPTURE_README !== "1", "Documentation capture is opt-in")
  test.setTimeout(180_000)
  const root = process.env.SCISPARK_E2E_VAULT_PATH
  if (!root?.includes("scispark-e2e-")) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(root)
  const output = resolve("docs/assets/readme")
  await mkdir(output, { recursive: true })
  await request.put("/api/settings", { data: { ui: { theme: "light" }, companion: { chattiness: "off" } } })
  await seedUserModel(storage, { name: "Alex", role: "Researcher · example workspace", fields: "Machine learning, neuroscience",
    topics: "generalization, representation learning, auditory attention", feedPrefs: "Methods, reproducible experiments, and ideas across fields",
    recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null } })
  await storage.delete("wiki/papers/e2e-grounding-paper.md")
  const today = new Date().toISOString().slice(0, 10)
  const titles = ["Learning from limited labels", "Robust decoding across recording sessions", "When neural models generalize",
    "A toolkit for reproducible EEG analysis", "Comparing representations across tasks", "Attention in natural listening environments",
    "Evaluating transfer across participants", "A benchmark for data-efficient decoding", "Reviewing robust neural representations"]
  const papers: PaperRecord[] = titles.map((title, i) => ({ ids: {}, title,
    abstract: ["Explore label efficiency and evaluation beyond the training distribution.", "Compare within-session and cross-session evaluation designs.",
      "Investigate which learned representations transfer to new conditions.", "Connect preprocessing choices with transparent evaluation and reporting.",
      "Compare representations, tasks, and the assumptions behind each metric.", "Study attention under realistic listening conditions and changing contexts.",
      "Separate participant-specific patterns from representations that transfer.", "Evaluate label budgets with shared baselines and reproducible splits.",
      "Compare evidence for stable representations across datasets and tasks."][i],
    authors: [{ name: "Example Research Group" }], year: Number(today.slice(0, 4)), date: today,
    venue: "Illustrative example", source: "openalex", fields: [i % 2 ? "Neuroscience" : "Machine learning"],
    publicationTypes: [i === 3 ? "dataset" : "article"] }))
  await runFeed(storage, { searchFn: async () => papers,
    providerOverride: { strong: new MockProvider([structured({ queries: [{ source: "openalex", query: "representation learning generalization", rationale: "Example research interests" }] })]),
      fast: new MockProvider([structured({ assessments: papers.map((paper, index) => ({ index,
        question: { grade: 3, evidence: paper.abstract }, topic: { grade: 4, evidence: paper.title }, approach: { grade: 3, evidence: paper.abstract },
        matches: [{ topic: "generalization", evidence: paper.abstract }], excluded: false, memoryMatches: [] })) })]) } })

  const concepts = ["Generalization", "Representation learning", "Auditory attention", "Reproducibility", "Transfer learning", "Data efficiency"]
  const methods = ["Cross-validation", "Contrastive learning", "Neural decoding", "Ablation studies"]
  for (const [i, paper] of papers.entries()) {
    const draft = buildPaperPage(paper, { today, status: "ingested", sources: ["demo:illustrative-workspace"] })
    draft.frontmatter.related = [slugifyTitle(concepts[i % concepts.length]), slugifyTitle(methods[i % methods.length])]
    draft.frontmatter.tags = ["example-workspace", "methods"]
    draft.body += `\n## Research connections\n\nConnects [[${slugifyTitle(concepts[i % concepts.length])}]] with [[${slugifyTitle(methods[i % methods.length])}]].\n\n> Illustrative content for the product walkthrough; this is not a real publication.\n`
    await storage.write(draft.path, composePage(draft))
  }
  for (const [i, title] of [...concepts, ...methods].entries()) {
    const type = i < concepts.length ? "concept" : "method"
    const related = [slugifyTitle(titles[i % titles.length]), slugifyTitle(concepts[(i + 1) % concepts.length])]
    await storage.write(`wiki/${type === "concept" ? "concepts" : "methods"}/${slugifyTitle(title)}.md`, composePage({
      path: "unused", frontmatter: { type, title, created: today, updated: today, tags: ["example-workspace"], related, sources: ["demo:illustrative-workspace"] },
      body: `# ${title}\n\nA research thread connecting methods, evidence, and open questions in this example workspace.\n\n## Working questions\n\n- What changes when the evaluation setting changes?\n- Which assumptions should be tested independently?\n- What evidence would challenge the current explanation?\n\n## Connections\n\n${related.map((id) => `- [[${id}]]`).join("\n")}\n\n## Reading notes\n\nKeep the original source, methodological choices, and limitations together. Follow each connection to compare approaches across the library.\n\n> Illustrative notes for demonstrating SciSpark; no scientific conclusion is asserted.\n`,
    }))
  }
  for (const [i, title] of ["Test representation stability across sessions", "Use disagreement to guide the next experiment", "Compare transfer under limited supervision"].entries()) {
    const draft = buildIdeaPage({ slugSeed: title, title, today, status: i === 0 ? "in-progress" : "sparked", depth: i === 0 ? "deep" : "quick",
      groundingPageIds: ["generalization", "representation-learning", "cross-validation"],
      body: `# ${title}\n\nAn illustrative idea seed linking the methods and open questions in this workspace.\n\n## Proposed next step\n\nDefine a baseline, pre-specify the evaluation conditions, and test whether the proposed explanation survives an independent comparison.\n\n## What would disprove it?\n\nAn effect that disappears under the agreed evaluation would challenge this idea.\n\n> Example content, not a validated proposal or a claim of novelty.\n` })
    await storage.write(draft.path, draft.content)
  }
  let project = (await createProject(storage, { title: "Generalization across sessions", description: "Bring the evidence, methods, and next experiments into one research question.",
    instructions: "Distinguish evidence from interpretation. Compare evaluation conditions and retain limitations.",
    overview: "Research question\n\nHow can we tell whether a representation transfers beyond the session in which it was learned?\n\nWorking plan\n\n1. Compare the evaluation designs in the reading set.\n2. Record shared assumptions and unanswered questions.\n3. Develop a falsifiable follow-up experiment.\n\nIllustrative project for the SciSpark walkthrough." })).result
  for (const title of titles.slice(0, 3)) {
    const path = `wiki/papers/${slugifyTitle(title)}.md`
    project = (await addProjectMember(storage, project.id, { pageId: path.slice(0, -3), revision: await revisionOf((await storage.read(path))!) })).result
  }
  await createProjectNote(storage, project.id, { title: "Questions for the next lab meeting", content: "Compare session boundaries, label budgets, and evaluation metrics before interpreting a difference as generalization.", sources: [] })
  await createProject(storage, { title: "Learning with fewer labels", description: "Collect methods and questions about data-efficient learning.", instructions: "Keep evaluation assumptions explicit.", overview: "An illustrative reading project about supervision, transfer, and evaluation." })
  await writeIndex(storage, await loadBundle(storage))

  const review = await createReview(storage, { sessionId: "chat_readme_demo", operationId: "readme-demo", question: "How should we compare generalization across recording sessions?", sources: ["openalex"] })
  await updateReview(storage, review.id, (run) => {
    run.status = "partial"; run.stage = "Illustrative report · source checks required"
    run.versions = [{ id: "readme_demo_v1", parent: null, createdAt: new Date().toISOString(), verification: "edited", author: "user", sourceIds: [],
      markdown: "# Comparing generalization across sessions\n\n> Example report for the product walkthrough. The notes below illustrate the report structure; they are not findings from a live literature review.\n\n## The question\n\nWhich evaluation choices help separate within-session performance from transfer to a new recording session?\n\n## Comparison framework\n\n| Dimension | What to compare | Why retain it |\n|---|---|---|\n| Evaluation split | Within-session and held-out sessions | Clarifies the generalization claim |\n| Supervision | Label budget and fine-tuning | Makes comparisons interpretable |\n| Baseline | Simple and adapted models | Grounds the proposed improvement |\n\n## Open questions\n\n- Are the same participants represented in training and evaluation?\n- Which preprocessing steps depend on the held-out data?\n- What result would falsify the proposed explanation?\n\n## Next reading step\n\nFind direct comparisons with transparent evaluation protocols, then inspect the retained source passages before drawing conclusions.\n" }]
  })
  const session = (await loadSession(storage, review.sessionId))!
  session.messages[1].content = "Here is an illustrative review workspace. Open the report to explore its structure, versions, and export controls."
  await saveSession(storage, session)

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  // Screenshots can read only this disposable app. They never contact research
  // indexes or external model endpoints, including from an accidental UI action.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    return url.hostname === "127.0.0.1" || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort()
  })
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" })
  }
  await page.setViewportSize({ width: 1440, height: 1120 })
  await page.goto("/")
  for (const title of titles) await expect(page.getByRole("heading", { name: title, exact: true })).toBeInViewport()
  await capture("feed")
  await page.getByRole("button", { name: "Open Sparky chat", exact: true }).click()
  await expect(page.getByRole("heading", { name: "What are you exploring?", exact: true })).toBeVisible()
  await capture("quick-chat")
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto("/chat")
  await expect(page.getByRole("heading", { name: "What would you like to explore?", exact: true })).toBeVisible()
  await capture("sparky")
  await page.setViewportSize({ width: 1440, height: 1120 })
  await request.put("/api/settings", { data: { ui: { theme: "dark" } } })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: titles[0], exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await capture("feed-dark")
  await page.setViewportSize({ width: 1440, height: 960 })
  await request.put("/api/settings", { data: { ui: { theme: "light" } } })
  await page.goto("/wiki/concepts/generalization")
  await expect(page.getByRole("heading", { name: "Generalization", exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Preview", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Working questions", exact: true })).toBeVisible()
  await capture("wiki")
  await page.goto("/viz")
  await expect(page.locator("canvas").first()).toBeVisible()
  await page.waitForTimeout(1500) // Allow the graph's layout to settle for the screenshot.
  await capture("graph")
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole("heading", { name: project.title, exact: true })).toBeVisible()
  await capture("projects")
  await page.goto("/spark")
  await expect(page.getByRole("heading", { name: "Idea gallery", exact: true })).toBeVisible()
  await expect(page.getByText("Test representation stability across sessions", { exact: true })).toBeVisible()
  await page.getByPlaceholder("What direction should Spark explore?", { exact: false }).fill("Explore how learned representations transfer across recording sessions.")
  await page.getByRole("heading", { name: "Idea gallery", exact: true }).click()
  await capture("spark")
  await page.goto(`/chat/${review.sessionId}`)
  await page.getByRole("button", { name: "Open report", exact: true }).click()
  await expect(page.getByRole("complementary", { name: "Review report" })).toBeVisible()
  await expect(page.getByLabel("Report version")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Comparing generalization across sessions", exact: true })).toBeVisible()
  await capture("deep-research")

  // A documentation masthead, laid out in Chromium using the shipped artwork.
  // The paper background keeps the black wordmark readable in either GitHub theme.
  const logoUrl = new URL("/brand/scispark-wordmark-transparent.png", page.url()).href
  await page.setViewportSize({ width: 1200, height: 300 })
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; } body { margin: 0; background: #fffaf5; color: #302015;
      height: 300px; display: grid; place-content: center; justify-items: center; gap: 28px; }
    .logo { width: 360px; height: 130px; position: relative; overflow: hidden; }
    img { position: absolute; width: 377.89px; max-width: none; left: -8.95px; top: -31.53px; }
    p { margin: 0; font: 16px Arial, sans-serif; letter-spacing: 3px; text-transform: uppercase; }
    .rule { width: 48px; height: 3px; background: #e7803f; }
  </style></head><body><div class="logo"><img src="${logoUrl}" alt="SciSpark"></div>
    <p>Discover. Connect. Explore.</p><div class="rule"></div></body></html>`)
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode())
  await capture("brand-banner")
})
