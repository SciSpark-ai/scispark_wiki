import type { PaperRecord } from "../papers/types"

export function paperDate(p: PaperRecord): Date | null {
  if (p.date) {
    const d = new Date(p.date)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (p.year !== undefined) return new Date(Date.UTC(p.year, 0, 1))
  return null
}
