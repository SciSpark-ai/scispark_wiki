import type { VaultStorage } from "./storage"
import type { Bundle } from "./bundle"

const TYPE_HEADINGS: Record<string, string> = {
  paper: "Papers", concept: "Concepts", method: "Methods", finding: "Findings",
  comparison: "Comparisons", author: "Authors", topic: "Topics", note: "Notes",
  query: "Saved answers", idea: "Ideas", project: "Projects",
}

export function buildIndexMarkdown(bundle: Bundle): string {
  const byType = new Map<string, Array<{ slug: string; title: string }>>()
  for (const page of bundle.pages.values()) {
    const slug = page.id.split("/").pop() as string
    const rows = byType.get(page.frontmatter.type) ?? []
    rows.push({ slug, title: page.frontmatter.title })
    byType.set(page.frontmatter.type, rows)
  }
  const sections = [...byType.keys()].sort().map((type) => {
    const heading = TYPE_HEADINGS[type] ?? type
    const rows = (byType.get(type) as Array<{ slug: string; title: string }>)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => `- [[${r.slug}]] — ${r.title}`)
    return `## ${heading}\n\n${rows.join("\n")}`
  })
  return `# Index\n\n${sections.join("\n\n")}\n`
}

export async function writeIndex(storage: VaultStorage, bundle: Bundle): Promise<void> {
  await storage.write("index.md", buildIndexMarkdown(bundle))
}

export async function appendLog(
  storage: VaultStorage,
  entry: { date: string; op: string; summary: string },
): Promise<void> {
  const existing = (await storage.read("log.md")) ?? "# Log\n"
  const line = `\n## [${entry.date}] ${entry.op} | ${entry.summary}\n`
  await storage.write("log.md", existing.trimEnd() + "\n" + line.trimStart())
}
