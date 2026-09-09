import { create } from "zustand";
import type { CompanionUtterance } from "@/lib/companion/run";

/**
 * Companion UI state and legacy page-lifetime counters. Counters no longer
 * control proactive delivery: event claims and frequency limits are persisted
 * by the server in companion-delivery.json. Stream identities here guard
 * against late replies reopening bubbles after dismissal or navigation.
 */
export interface CompanionStore {
  feedbackQuestions: Array<{ paperKey: string; title: string; revision: string }>;
  askFeedback: (question: CompanionStore["feedbackQuestions"][number]) => void;
  closeFeedback: (paperKey: string) => void;
  streamId: number | null;
  streamShown: boolean;
  beginStream: () => number | null;
  updateStream: (id: number, u: CompanionUtterance) => void;
  finishStream: (id: number, u: CompanionUtterance | null) => void;
  current: CompanionUtterance | null;
  sessionShownCount: number;
  lastShownTs: Record<string, string>;
  /** Sets current, increments sessionShownCount, stamps lastShownTs[u.trigger]. */
  show: (u: CompanionUtterance) => void;
  /** Clears current only (session count / lastShownTs are untouched). */
  dismiss: () => void;
}

let nextStreamId = 0;
export const useCompanionStore = create<CompanionStore>((set, get) => ({
  feedbackQuestions: [],
  // User-triggered questions take priority over unsolicited utterances and do
  // not spend a proactive/LLM budget. Queue different papers without losing drafts.
  askFeedback: (question) => set((s) => ({
    feedbackQuestions: s.feedbackQuestions.some((entry) => entry.paperKey === question.paperKey)
      ? s.feedbackQuestions : [...s.feedbackQuestions, question],
    current: null, streamId: null, streamShown: false,
  })),
  closeFeedback: (paperKey) => set((s) => ({ feedbackQuestions: s.feedbackQuestions.filter((entry) => entry.paperKey !== paperKey) })),
  streamId: null,
  streamShown: false,
  beginStream: () => {
    if (get().streamId !== null || get().current !== null || get().feedbackQuestions.length) return null;
    const id = ++nextStreamId;
    set({ streamId: id, streamShown: false });
    return id;
  },
  updateStream: (id, u) => set((s) => {
    if (s.streamId !== id) return s;
    if (u.expiresAt && Date.parse(u.expiresAt) <= Date.now()) return s;
    const first = !s.streamShown && u.text.length > 0;
    return {
      current: u.text ? u : null,
      streamShown: s.streamShown || first,
      sessionShownCount: s.sessionShownCount + (first ? 1 : 0),
      lastShownTs: first ? { ...s.lastShownTs, [u.trigger]: new Date().toISOString() } : s.lastShownTs,
    };
  }),
  finishStream: (id, u) => {
    if (get().streamId !== id) return;
    if (u?.expiresAt && Date.parse(u.expiresAt) <= Date.now()) u = null;
    if (u) get().updateStream(id, u);
    set({ streamId: null, streamShown: false, current: u });
  },
  current: null,
  sessionShownCount: 0,
  lastShownTs: {},
  show: (u) =>
    set((s) => s.feedbackQuestions.length ? s : ({
      current: u,
      streamId: null,
      streamShown: false,
      sessionShownCount: s.sessionShownCount + 1,
      lastShownTs: { ...s.lastShownTs, [u.trigger]: new Date().toISOString() },
    })),
  dismiss: () => set({ current: null, streamId: null, streamShown: false }),
}));
