import { XMLParser } from "fast-xml-parser"

// Mixed-content abstracts cannot use the ordinary object parser: it separates
// #text from <i>/<sub> children, losing both symbols and their reading order.
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false })
type Node = Record<string, unknown>
const children = (nodes: Node[], tag: string): Node[] => (nodes.find((node) => Array.isArray(node[tag]))?.[tag] as Node[] | undefined) ?? []
const tidy = (text: string) => text.replace(/\s+/g, " ").trim()

function text(nodes: Node[]): string {
  return nodes.map((node) => Object.entries(node).map(([tag, value]) => {
    if (tag === ":@" || tag.startsWith("@_") || tag.startsWith("?")) return ""
    if (tag === "#text") return String(value)
    if (!Array.isArray(value)) return ""
    const localName = tag.split(":").at(-1)
    // Keep explicit scripts/operators; do not convert r^2 into the value r2.
    if (localName === "sup") return `^(${text(value)})`
    if (localName === "sub") return `_(${text(value)})`
    if (localName === "annotation" || localName === "annotation-xml") return ""
    if (localName === "msup" || localName === "msub" || localName === "mfrac") {
      const operands = value.filter((child: Node) => !("#text" in child))
      if (operands.length !== 2) return " [formula unavailable] "
      const a = text([operands[0]]), b = text([operands[1]])
      return localName === "mfrac" ? `(${a})/(${b})` : `${a}${localName === "msup" ? "^" : "_"}(${b})`
    }
    return text(value)
  }).join("")).join("")
}

/** Parallel text view only; metadata continues through the existing parser.
 * Returns article order unchanged, including records with no abstract. */
export function pubmedOrderedText(xml: string): Array<{ title: string; abstract?: string }> {
  const root = parser.parse(xml) as Node[]
  return children(root, "PubmedArticleSet").filter((node) => Array.isArray(node.PubmedArticle)).map((entry) => {
    const citation = children(entry.PubmedArticle as Node[], "MedlineCitation")
    const article = children(citation, "Article")
    const sections = children(article, "Abstract").filter((node) => Array.isArray(node.AbstractText)).map((section) => {
      const content = tidy(text(section.AbstractText as Node[]))
      const label = (section[":@"] as Record<string, unknown> | undefined)?.["@_Label"]
      return content ? (label ? `${String(label)}: ${content}` : content) : ""
    }).filter(Boolean)
    return { title: tidy(text(children(article, "ArticleTitle"))), abstract: sections.length ? sections.join("\n\n") : undefined }
  })
}
