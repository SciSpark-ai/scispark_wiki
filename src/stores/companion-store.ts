import { create } from "zustand";
import type { CompanionUtterance } from "@/lib/companion/run";

/**
 * Companion UI + anti-Clippy session state (M7 Task 6). This is the
 * caller-owned bookkeeping `runCompanion` (src/lib/companion/run.ts) expects:
 * it only *reads* `sessionShownCount`/`lastShownTs` to decide whether to
 * speak — this store is what persists those between calls for the life of
 * the tab. Deliberately NOT persisted to localStorage: "session" here means
 * "this browser session," so a reload starting fresh is correct.
 */
export interface CompanionStore {
  current: CompanionUtterance | null;
  sessionShownCount: number;
  lastShownTs: Record<string, string>;
  /** Sets current, increments sessionShownCount, stamps lastShownTs[u.trigger]. */
  show: (u: CompanionUtterance) => void;
  /** Clears current only (session count / lastShownTs are untouched). */
  dismiss: () => void;
}

export const useCompanionStore = create<CompanionStore>((set) => ({
  current: null,
  sessionShownCount: 0,
  lastShownTs: {},
  show: (u) =>
    set((s) => ({
      current: u,
      sessionShownCount: s.sessionShownCount + 1,
      lastShownTs: { ...s.lastShownTs, [u.trigger]: new Date().toISOString() },
    })),
  dismiss: () => set({ current: null }),
}));
