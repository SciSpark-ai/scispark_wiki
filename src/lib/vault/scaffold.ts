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

// Module-level promise-chain mutex: the fallback serialization path when the
// Web Locks API isn't available (Node/tests). Each queued task attaches to
// the tail via .then on both success and failure so one caller's rejection
// never skips or blocks the callers queued behind it.
let bootstrapMutexTail: Promise<void> = Promise.resolve()

function withBootstrapMutex<T>(fn: () => Promise<T>): Promise<T> {
  const result = bootstrapMutexTail.then(fn, fn)
  bootstrapMutexTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/**
 * Idempotent production bootstrap: creates the vault if it doesn't exist yet
 * (schema.md missing), otherwise no-ops. Concurrent callers are serialized —
 * via navigator.locks when available (browser), otherwise via an in-process
 * mutex (Node/tests) — so only one caller ever runs createVault.
 */
export async function openVault(
  storage: VaultStorage,
  opts: { purpose?: string; now?: () => Date } = {},
): Promise<void> {
  const run = async () => {
    if ((await storage.read("schema.md")) !== null) return
    const now = opts.now ?? (() => new Date())
    const today = now().toISOString().slice(0, 10)
    await createVault(storage, {
      purpose: opts.purpose ?? "Personal research knowledge base.",
      today,
    })
  }

  const locks = globalThis.navigator?.locks
  if (locks) {
    await locks.request("scispark-vault-init", run)
  } else {
    await withBootstrapMutex(run)
  }
}
