const DAY_MS = 24 * 60 * 60 * 1000

/** UTC Monday of the week containing `d`, as a YYYY-MM-DD string. */
export function isoWeekStart(d: Date): string {
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (day + 6) % 7 // Mon→0, Sun→6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - deltaToMonday))
  return monday.toISOString().slice(0, 10)
}

/**
 * Builds a fixed-length series of ISO week-start (Monday UTC) dates, oldest → newest,
 * ending on the ISO week containing `now`. Length is exactly `weeks`.
 */
export function buildWeekStarts(now: Date, weeks: number): string[] {
  const thisWeekStart = isoWeekStart(now)
  const anchor = new Date(`${thisWeekStart}T00:00:00.000Z`)
  const weekStarts: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(anchor.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10)
    weekStarts.push(ws)
  }
  return weekStarts
}
