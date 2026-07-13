"use client"

/**
 * M4 task-9 deviation from the design doc: the design doc names Milkdown
 * (@milkdown/react + @milkdown/kit) as the v1 body editor. Verified via
 * context7 (2026-07) that the current pattern is:
 *   npm install @milkdown/react @milkdown/kit
 *   <MilkdownProvider><Milkdown/></MilkdownProvider> + useEditor(root =>
 *     Editor.make().config(...).use(commonmark).use(listener)...)
 * plus a theme package (e.g. @milkdown/theme-nord) for baseline CSS, and the
 * listener plugin to read markdown back out on change.
 *
 * That's a WYSIWYG/ProseMirror editor: content lives as a ProseMirror doc
 * and is *serialized* to markdown on read, not edited as markdown text
 * directly. This task's wikilink contract needs `[[slug]]` syntax to survive
 * a round trip through the editor completely intact (edit -> save -> reload
 * -> still `[[slug]]`, not whatever Milkdown's markdown serializer decides
 * to emit for a rewritten link node) — that's a real risk with a rich-text
 * round trip and non-trivial to verify solidly within this task's scope.
 * Milkdown also ships its own theme CSS, which the brief asks not to invest
 * in (v1 wants "no design work beyond the existing app shell + monospace-ish
 * utilitarian styling").
 *
 * So per the brief's explicit fallback allowance: this is a split-pane
 * textarea (edits the raw markdown body, wikilinks included, byte for byte)
 * + a light read-only preview (markdown-preview.tsx) that resolves
 * `[[slug]]` -> real links for *display only*. No inverse-mapping is needed
 * because the raw body never leaves wikilink syntax. Isolated here so a
 * future Milkdown swap (M11 polish) only touches this file.
 */

import { useState } from "react"
import type { Bundle } from "@/lib/vault/bundle"
import { preprocessWikilinks, renderMarkdown } from "./markdown-preview"

interface PageEditorProps {
  value: string
  onChange: (value: string) => void
  bundle: Bundle
}

export function PageEditor({ value, onChange, bundle }: PageEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit")

  return (
    <div className="border border-border-warm rounded-card overflow-hidden">
      <div className="flex border-b border-border-warm bg-light-surface">
        <button
          onClick={() => setTab("edit")}
          className={`px-4 py-2 text-[13px] font-medium tracking-body transition-colors ${
            tab === "edit" ? "bg-card-surface text-espresso" : "text-muted-text hover:text-espresso"
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => setTab("preview")}
          className={`px-4 py-2 text-[13px] font-medium tracking-body transition-colors ${
            tab === "preview" ? "bg-card-surface text-espresso" : "text-muted-text hover:text-espresso"
          }`}
        >
          Preview
        </button>
      </div>

      {tab === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[420px] p-4 font-mono text-[13px] text-espresso bg-white outline-none resize-y leading-[1.6]"
          placeholder="Write markdown here. Use [[slug]] or [[slug|label]] to link other wiki pages."
        />
      ) : (
        <div className="min-h-[420px] p-4 bg-white overflow-y-auto">
          {value.trim() === "" ? (
            <p className="text-[13px] text-muted-text">Nothing to preview yet.</p>
          ) : (
            renderMarkdown(preprocessWikilinks(value, bundle))
          )}
        </div>
      )}
    </div>
  )
}
