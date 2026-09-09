"use client"

import { useState } from "react"
import { MAX_ANCHORS, type AnchorDiscipline } from "@/lib/trending/anchors"
import { OPENALEX_FIELDS, canonicalAnchor } from "@/lib/trending/openalex-fields"
import { Button } from "@/components/ui/Button"
import { subfieldsForField, openAlexSubfield } from "@/lib/trending/openalex-subfields"

export function OpenAlexFieldSelector({ anchors, onChange }: {
  anchors: AnchorDiscipline[]
  onChange: (anchors: AnchorDiscipline[]) => void
}) {
  const [query, setQuery] = useState("")
  const selected = new Set(anchors.map((anchor) => canonicalAnchor(anchor.id)?.id ?? anchor.id))
  const matches = OPENALEX_FIELDS.filter((field) => field.label.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="space-y-3">
      {anchors.length > 0 && <ul aria-label="Selected general fields" className="flex flex-wrap gap-2">
        {anchors.map((anchor, index) => <li key={anchor.id} className="flex max-w-full items-center gap-2 rounded-btn bg-card-surface px-3 py-2 text-[13px] text-espresso">
          <span className="min-w-0 break-words text-pretty">
            {anchor.label}
            {!canonicalAnchor(anchor.id) && <span className="block text-[12px] text-muted-text">Choose an official field instead.</span>}
          </span>
          <button type="button" aria-label={"Remove " + anchor.label} className="shrink-0 rounded px-1 text-muted-text hover:text-espresso focus-visible:outline-2 focus-visible:outline-orange"
            onClick={() => onChange(anchors.filter((_, i) => i !== index))}>×</button>
        </li>)}
      </ul>}
      <label className="block space-y-1 text-[13px] text-secondary-dark">
        <span>Find a general field</span>
        <input type="search" value={query} placeholder="Search OpenAlex fields" maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault() }}
          className="block w-full min-w-0 rounded-btn border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:ring-2 focus:ring-orange" />
      </label>
      <div role="group" aria-label="OpenAlex fields" className="max-h-44 overflow-y-auto overscroll-contain rounded-btn border border-border-warm p-1">
        {matches.map((field) => {
          const checked = selected.has(field.id)
          return <label key={field.id} className="flex cursor-pointer items-start gap-3 rounded-btn px-3 py-2 text-[13px] leading-relaxed text-espresso hover:bg-card-surface has-disabled:cursor-default has-disabled:opacity-50">
            <input type="checkbox" checked={checked} disabled={!checked && anchors.length >= MAX_ANCHORS}
              onChange={() => onChange(checked ? anchors.filter((anchor) => canonicalAnchor(anchor.id)?.id !== field.id) : [...anchors, { id: field.id, label: field.label }])}
              className="mt-1 shrink-0 accent-orange" />
            <span className="text-pretty">{field.label}</span>
          </label>
        })}
        {!matches.length && <div className="space-y-2 p-3 text-[13px] text-secondary-dark">
          <p>No matching field.</p>
          <p>Specific topics belong in Your interests.</p>
          <Button type="button" size="sm" variant="quiet" onClick={() => setQuery("")}>Show all fields</Button>
        </div>}
      </div>
      <p className="text-[12px] text-muted-text">{anchors.length} of {MAX_ANCHORS} fields selected.</p>
      {anchors.filter((anchor) => canonicalAnchor(anchor.id)).map((anchor) => (
        <SubfieldSelection key={anchor.id} anchor={anchor}
          onChange={(next) => onChange(anchors.map((item) => item.id === anchor.id ? next : item))} />
      ))}
    </div>
  )
}

function SubfieldSelection({ anchor, onChange }: {
  anchor: AnchorDiscipline
  onChange: (anchor: AnchorDiscipline) => void
}) {
  const options = subfieldsForField(anchor.id)
  const [expanded, setExpanded] = useState(false)
  const selected = new Set(Array.isArray(anchor.subfieldIds) ? anchor.subfieldIds : [])
  const labels = [...selected].flatMap((id) => {
    const subfield = typeof id === "string" ? openAlexSubfield(id) : undefined
    return subfield ? [subfield.label] : []
  })
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="group rounded-btn border border-border-warm bg-light-surface">
      <summary className="cursor-pointer rounded-btn px-4 py-3 text-[13px] text-espresso focus-visible:outline-2 focus-visible:outline-orange">
        <span className="font-medium">{anchor.label}</span>
        <span className="ml-2 text-secondary-dark">{selected.size ? "Edit subfields" : "Choose subfields (optional)"}</span>
        <span className="mt-1 block pl-4 text-pretty text-[12px] text-muted-text">
          {selected.size ? labels.join(" · ") : "Entire field included."}
        </span>
      </summary>
      {expanded && <div className="space-y-3 border-t border-border-warm px-4 py-3">
        <p className="text-[12px] text-secondary-dark">
          <span className="inline-block">Select any subfields to narrow this field.</span>{" "}
          <span className="inline-block">Leave them unchecked to include it all.</span>
        </p>
        <div role="group" aria-label={anchor.label + " subfields"}
          className="max-h-52 space-y-1 overflow-y-auto overscroll-contain">
          {options.map((subfield) => <label key={subfield.id}
            className="flex cursor-pointer items-start gap-3 rounded-btn p-2 text-[13px] leading-relaxed text-espresso hover:bg-card-surface">
            <input type="checkbox" checked={selected.has(subfield.id)} className="mt-1 shrink-0 accent-orange"
              onChange={() => {
                const next = selected.has(subfield.id)
                  ? [...selected].filter((id) => id !== subfield.id)
                  : [...selected, subfield.id]
                onChange({ ...anchor, subfieldIds: next })
              }} />
            <span className="min-w-0 text-pretty">{subfield.label}</span>
          </label>)}
        </div>
        {anchor.subfieldIds !== undefined && <Button type="button" size="sm" variant="quiet"
          onClick={() => onChange({ ...anchor, subfieldIds: [] })}>Include entire field</Button>}
      </div>}
    </details>
  )
}
