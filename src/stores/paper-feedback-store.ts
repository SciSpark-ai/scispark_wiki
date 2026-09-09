import { create } from "zustand"
import { loadRecommendationFeedback, type SavedFeedback } from "@/lib/recommendation/client"

let loading: Promise<void> | null = null
let generation = 0
interface FeedbackState {
  entries: Record<string, SavedFeedback>
  ready: boolean
  error: string | null
  pending: Record<string, boolean>
  reload: () => Promise<void>
  setEntry: (key: string, entry: SavedFeedback | null) => void
  setPending: (key: string, pending: boolean) => void
}
export const usePaperFeedbackStore = create<FeedbackState>((set) => ({
  entries: {}, ready: false, error: null, pending: {},
  reload: () => {
    if (loading) return loading
    const version = generation
    loading = loadRecommendationFeedback().then(({ entries, warning }) => {
      if (version === generation) set({ entries: Object.fromEntries(entries.map((entry) => [entry.paperKey, entry])), ready: true, error: warning })
    }).catch(() => {
      if (version === generation) set({ ready: false, error: "Saved feedback could not be loaded. Retry before rating papers." })
    })
      .finally(() => { loading = null })
    return loading
  },
  setEntry: (key, entry) => {
    generation++
    set((state) => {
      const entries = { ...state.entries }
      if (entry) entries[key] = entry
      else delete entries[key]
      return { entries, error: null }
    })
  },
  setPending: (key, pending) => set((state) => ({ pending: { ...state.pending, [key]: pending } })),
}))
