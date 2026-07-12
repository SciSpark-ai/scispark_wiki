import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProjectPapersState {
  // projectId -> array of paperId (Sets don't serialize, so we use arrays)
  membership: Record<string, string[]>;
  addPaperToProject: (projectId: string, paperId: string) => void;
  removePaperFromProject: (projectId: string, paperId: string) => void;
  isPaperInProject: (projectId: string, paperId: string) => boolean;
  isPaperInAnyProject: (paperId: string) => boolean;
  getProjectsForPaper: (paperId: string) => string[];
}

// Seed: proj-1 already has 8 papers in its mock detail — we don't need to
// duplicate that data here. Membership in the store is the authoritative
// source going forward and starts empty so user actions are visible.
const initialMembership: Record<string, string[]> = {};

export const useProjectPapersStore = create<ProjectPapersState>()(
  persist(
    (set, get) => ({
      membership: initialMembership,
      addPaperToProject: (projectId, paperId) => {
        set((s) => {
          const current = s.membership[projectId] ?? [];
          if (current.includes(paperId)) return s;
          return {
            membership: { ...s.membership, [projectId]: [...current, paperId] },
          };
        });
      },
      removePaperFromProject: (projectId, paperId) => {
        set((s) => {
          const current = s.membership[projectId] ?? [];
          if (!current.includes(paperId)) return s;
          return {
            membership: {
              ...s.membership,
              [projectId]: current.filter((id) => id !== paperId),
            },
          };
        });
      },
      isPaperInProject: (projectId, paperId) =>
        get().membership[projectId]?.includes(paperId) ?? false,
      isPaperInAnyProject: (paperId) =>
        Object.values(get().membership).some((arr) => arr.includes(paperId)),
      getProjectsForPaper: (paperId) =>
        Object.entries(get().membership)
          .filter(([, arr]) => arr.includes(paperId))
          .map(([projectId]) => projectId),
    }),
    { name: "scispark-project-papers" }
  )
);
