/**
 * UTC Monday of the week containing `d`, as a YYYY-MM-DD string.
 *
 * The sole survivor of this module: `completeWindows` (src/lib/trending/topics.ts)
 * uses it to find the in-progress week's Monday, the exclusive upper bound of
 * the recent window. A `buildWeekStarts` helper used to sit beside it for the
 * weekly-volume sparkline; SP4 dropped weekly series entirely (the rows compare
 * two windows instead), and it is deleted rather than kept as an unused export.
 */
export function isoWeekStart(d: Date): string {
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (day + 6) % 7 // Mon→0, Sun→6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - deltaToMonday))
  return monday.toISOString().slice(0, 10)
}
