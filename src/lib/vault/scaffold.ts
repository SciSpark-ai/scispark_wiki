import type { VaultStorage } from "./storage"
import { PAGE_TYPES } from "./types"
import { appendLog } from "./index-builder"

export class VaultExistsError extends Error {}

const TYPE_DIRS: Record<string, string> = {
  paper: "wiki/papers", concept: "wiki/concepts", method: "wiki/methods",
  finding: "wiki/findings", comparison: "wiki/comparisons", author: "wiki/authors",
  topic: "wiki/topics", note: "wiki/notes", idea: "wiki/ideas", project: "wiki/projects",
}

export async function createVault(
  storage: VaultStorage,
  opts: { purpose: string; today: string },
): Promise<void> {
  if ((await storage.read("schema.md")) !== null) throw new VaultExistsError("vault already initialized")

  const rows = PAGE_TYPES.map((t) => `| ${t} | ${TYPE_DIRS[t]} |`).join("\n")
  await storage.write(
    "schema.md",
    `# Vault Schema

## Page Types

| type | directory |
|---|---|
${rows}

## Frontmatter contract

Every page requires: \`type\`, \`title\`, \`created\`, \`updated\`, \`tags\` (array), \`related\` (array of bare slugs), \`sources\` (array of source identifiers). Wikilinks (\`[[slug]]\`) belong in the body only. \`index.md\` and \`log.md\` are maintained by the application — never edit them by hand or by model output.
`,
  )
  await storage.write("purpose.md", `# Purpose\n\n${opts.purpose}\n`)
  await storage.write("index.md", "# Index\n")
  await appendLog(storage, { date: opts.today, op: "init", summary: "vault created" })
}
