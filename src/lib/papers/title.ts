const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

/**
 * Source APIs (arXiv/OpenAlex/JATS) ship titles containing presentation
 * markup (<i>, <sub>, …) and entities. We render titles as plain text, so
 * strip tags and decode the common entities at the DISPLAY layer only —
 * stored metadata keeps the original string. Never renders HTML: output is
 * a plain string handed to React text children.
 */
export function displayTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim()
}
