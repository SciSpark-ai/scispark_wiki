import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mockPapers } from "@/lib/mock-data/papers";

export type PaperActionKind = "liked" | "saved" | "readLater";

export interface PaperActionFlags {
  liked: boolean;
  saved: boolean;
  readLater: boolean;
}

interface PaperActionsState {
  actions: Record<string, PaperActionFlags>;
  toggle: (id: string, kind: PaperActionKind) => void;
  getActions: (id: string) => PaperActionFlags;
  getIdsWhere: (kind: PaperActionKind) => string[];
}

const emptyFlags: PaperActionFlags = {
  liked: false,
  saved: false,
  readLater: false,
};

function seedFromMockPapers(): Record<string, PaperActionFlags> {
  const seeded: Record<string, PaperActionFlags> = {};
  for (const paper of mockPapers) {
    if (paper.liked || paper.saved || paper.readLater) {
      seeded[paper.id] = {
        liked: paper.liked,
        saved: paper.saved,
        readLater: paper.readLater,
      };
    }
  }
  return seeded;
}

export const usePaperActionsStore = create<PaperActionsState>()(
  persist(
    (set, get) => ({
      actions: seedFromMockPapers(),
      toggle: (id, kind) => {
        set((state) => {
          const current = state.actions[id] ?? emptyFlags;
          return {
            actions: {
              ...state.actions,
              [id]: { ...current, [kind]: !current[kind] },
            },
          };
        });
      },
      getActions: (id) => get().actions[id] ?? emptyFlags,
      getIdsWhere: (kind) =>
        Object.entries(get().actions)
          .filter(([, flags]) => flags[kind])
          .map(([id]) => id),
    }),
    { name: "scispark-paper-actions" }
  )
);
