import { createHash } from "node:crypto"
import { ToolManifestSchema, type ToolManifest } from "./contracts"

/** Stable native identities; these declarations do not install or execute adapters. */
export const NATIVE_TOOL_MANIFESTS: readonly ToolManifest[] = [
  ["trending", "Trending", "Discover trends in your research fields.", "field-trends", "markdown"],
  ["find-papers", "Find papers", "Find literature for a research question.", "paper-search", "papers"],
  ["deep-review", "Deep review", "Review literature with grounded sources.", "literature-review", "markdown"],
  ["idea-spark", "Idea Spark", "Develop research ideas from your knowledge base.", "research-ideas", "markdown"],
].map(([skillId, name, description, capability, outputKind]) => {
  const declaration = {
    packageId: "scispark.builtin", skillId, version: "1.0.0", name, description,
    capability, outputKind,
  }
  return ToolManifestSchema.parse({
    ref: { packageId: declaration.packageId, skillId, version: declaration.version, digest: createHash("sha256").update(JSON.stringify(declaration)).digest("hex") },
    name, description, capabilities: [capability], kind: "native", entrypoint: skillId,
    dependencies: [], resources: [], connections: [], engines: [], inputSchema: {}, outputKinds: [outputKind],
    provenance: { source: "builtin", locator: "scispark.builtin", revision: declaration.version },
  })
})
