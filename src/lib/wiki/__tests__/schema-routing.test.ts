import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import {
  DEFAULT_ROUTING,
  parseSchemaRouting,
  loadRouting,
  validateFilesAgainstRouting,
} from "../schema-routing"

describe("DEFAULT_ROUTING", () => {
  it("matches exactly what createVault writes into schema.md", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "p", today: "2026-07-11" })
    const schema = (await s.read("schema.md")) as string
    expect(parseSchemaRouting(schema)).toEqual(DEFAULT_ROUTING)
  })
})

describe("parseSchemaRouting", () => {
  it("returns {} when there is no Page Types heading", () => {
    expect(parseSchemaRouting("# Vault Schema\n\nJust some prose, no table here.\n")).toEqual({})
  })

  it("returns {} when the heading is present but the table is empty", () => {
    const md = "## Page Types\n\nNo rows here yet.\n\n## Next Section\n"
    expect(parseSchemaRouting(md)).toEqual({})
  })

  it("honors a custom extra row alongside the standard ones", () => {
    const md = `## Page Types

| type | directory |
|---|---|
| paper | wiki/papers |
| meeting | wiki/meetings |

## Frontmatter contract
`
    const routing = parseSchemaRouting(md)
    expect(routing.paper).toBe("wiki/papers")
    expect(routing.meeting).toBe("wiki/meetings")
  })

  it("skips rows with an invalid type or a directory not rooted at wiki/", () => {
    const md = `## Page Types

| type | directory |
|---|---|
| paper | wiki/papers |
| 1bad | wiki/bad |
| Bad Type | wiki/bad2 |
| ok-type | not-wiki/ok |
| another | somewhere/else |

## Next
`
    const routing = parseSchemaRouting(md)
    expect(routing).toEqual({ paper: "wiki/papers" })
  })

  it("matches heading case-insensitively and at any level ##-######", () => {
    const md = `### page TYPES

| type | directory |
|---|---|
| note | wiki/notes |

### Next
`
    expect(parseSchemaRouting(md)).toEqual({ note: "wiki/notes" })
  })

  it("stops at the next heading of the same or shallower level", () => {
    const md = `## Page Types

| type | directory |
|---|---|
| note | wiki/notes |

## Next Section

| type | directory |
|---|---|
| leaked | wiki/leaked |
`
    expect(parseSchemaRouting(md)).toEqual({ note: "wiki/notes" })
  })

  it("keeps scanning through a deeper subheading within the section", () => {
    const md = `## Page Types

### Subsection

| type | directory |
|---|---|
| note | wiki/notes |

## Next Section
`
    expect(parseSchemaRouting(md)).toEqual({ note: "wiki/notes" })
  })

  it("accepts a bare 'wiki' directory and strips trailing slashes", () => {
    const md = `## Page Types

| root | wiki |
| paper | wiki/papers/ |
`
    expect(parseSchemaRouting(md)).toEqual({ root: "wiki", paper: "wiki/papers" })
  })
})

describe("loadRouting", () => {
  it("returns DEFAULT_ROUTING when schema.md is missing", async () => {
    const s = new MemoryVaultStorage()
    expect(await loadRouting(s)).toEqual(DEFAULT_ROUTING)
  })

  it("returns DEFAULT_ROUTING when schema.md has no parseable table", async () => {
    const s = new MemoryVaultStorage()
    await s.write("schema.md", "# Vault Schema\n\nNo page types table.\n")
    expect(await loadRouting(s)).toEqual(DEFAULT_ROUTING)
  })

  it("returns the parsed routing from a real scaffolded vault", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "p", today: "2026-07-11" })
    expect(await loadRouting(s)).toEqual(DEFAULT_ROUTING)
  })

  it("returns the parsed routing (including custom rows) when present", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      "schema.md",
      "## Page Types\n\n| paper | wiki/papers |\n| meeting | wiki/meetings |\n",
    )
    expect(await loadRouting(s)).toEqual({ paper: "wiki/papers", meeting: "wiki/meetings" })
  })
})

describe("validateFilesAgainstRouting", () => {
  it("passes all 10 default types with correctly routed, valid paths", () => {
    const files = Object.entries(DEFAULT_ROUTING).map(([type, dir]) => ({
      type,
      path: `${dir}/example-${type}.md`,
    }))
    expect(validateFilesAgainstRouting(files, DEFAULT_ROUTING)).toEqual([])
  })

  it("flags an unknown type", () => {
    const errors = validateFilesAgainstRouting(
      [{ path: "wiki/meetings/standup.md", type: "meeting" }],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([`unknown type "meeting" for wiki/meetings/standup.md`])
  })

  it("flags a directory that doesn't match the routing for its type", () => {
    const errors = validateFilesAgainstRouting(
      [{ path: "wiki/notes/foo.md", type: "paper" }],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([`type "paper" pages belong in wiki/papers/ — got wiki/notes/foo.md`])
  })

  it("flags a path that doesn't end in .md", () => {
    const errors = validateFilesAgainstRouting(
      [{ path: "wiki/papers/foo.txt", type: "paper" }],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([`wiki/papers/foo.txt is not a markdown file (.md required)`])
  })

  it("rejects an uppercase, spaced slug", () => {
    const errors = validateFilesAgainstRouting(
      [{ path: "wiki/papers/Foo Bar.md", type: "paper" }],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([`wiki/papers/Foo Bar.md has an invalid filename slug: "Foo Bar"`])
  })

  it("accepts a CJK slug", () => {
    const errors = validateFilesAgainstRouting(
      [{ path: "wiki/papers/深度学习.md", type: "paper" }],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([])
  })

  it("rejects underscores, leading dots, and '..' in the slug", () => {
    const errors = validateFilesAgainstRouting(
      [
        { path: "wiki/papers/foo_bar.md", type: "paper" },
        { path: "wiki/papers/.hidden.md", type: "paper" },
        { path: "wiki/papers/foo..bar.md", type: "paper" },
      ],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([
      `wiki/papers/foo_bar.md has an invalid filename slug: "foo_bar"`,
      `wiki/papers/.hidden.md has an invalid filename slug: ".hidden"`,
      `wiki/papers/foo..bar.md has an invalid filename slug: "foo..bar"`,
    ])
  })

  it("accumulates multiple error classes for a single file, and across files", () => {
    const errors = validateFilesAgainstRouting(
      [
        { path: "wiki/notes/Bad Name.txt", type: "meeting" },
        { path: "wiki/papers/ok-paper.md", type: "paper" },
      ],
      DEFAULT_ROUTING,
    )
    expect(errors).toEqual([
      `unknown type "meeting" for wiki/notes/Bad Name.txt`,
      `wiki/notes/Bad Name.txt is not a markdown file (.md required)`,
    ])
  })

  it("returns an empty array for an empty file list", () => {
    expect(validateFilesAgainstRouting([], DEFAULT_ROUTING)).toEqual([])
  })
})
