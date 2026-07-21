/**
 * Bottom padding every scrolling page adds so the companion mascot — which
 * is `fixed bottom-5 right-5` and therefore ALWAYS on top of whatever is at
 * the bottom-right of the viewport (see CompanionMascot) — can never cover
 * page content or its controls.
 *
 * Without it the last row of a list sits underneath the mascot and its
 * buttons are literally unclickable: the feed's bottom-right card swallowed
 * clicks during the 2026-07-19 walk.
 *
 * 7rem clears the 3rem button plus its 1.25rem inset with room to spare. The
 * companion's speech BUBBLE opens upward over page content by design (it is
 * transient and dismissible) and is deliberately not reserved for here —
 * reserving its full height would leave a large permanent gap on every page.
 */
export const COMPANION_CLEARANCE = "pb-28"
