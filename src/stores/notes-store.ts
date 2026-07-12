import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NoteSourceKind = "paper" | "chat" | "manual";

export interface NoteSource {
  kind: NoteSourceKind;
  refId?: string;
  refLabel?: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source?: NoteSource;
  createdAt: number;
  updatedAt: number;
}

interface NotesState {
  notes: ProjectNote[];
  lastProjectId: string | null;
  addNote: (
    note: Omit<ProjectNote, "id" | "createdAt" | "updatedAt">
  ) => string;
  updateNote: (
    id: string,
    patch: Partial<Pick<ProjectNote, "title" | "content">>
  ) => void;
  deleteNote: (id: string) => void;
  setLastProjectId: (id: string) => void;
  getByProject: (projectId: string) => ProjectNote[];
}

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const now = Date.now();
const HOUR = 60 * 60 * 1000;
const seedNotes: ProjectNote[] = [
  {
    id: "note-1",
    projectId: "proj-1",
    title: "Key takeaways for presentation",
    content:
      "1. Psilocybin 25mg single-dose produces durable remission (~37%) at 8wk\n2. Effect mediated by DMN entropy increase — correlates with mystical experience\n3. Safety profile favorable: no SAEs, transient AEs resolve in session\n4. Cost-effectiveness superior to 3rd-line antidepressants\n5. Need more data on elderly populations (only 1 pilot)",
    createdAt: now - 2 * HOUR,
    updatedAt: now - 2 * HOUR,
  },
  {
    id: "note-2",
    projectId: "proj-1",
    title: "Questions for Dr. Carhart-Harris",
    content:
      "- What is the minimum therapist training needed for supervised sessions?\n- Are there biomarkers that predict non-response?\n- Plans for phase IV / real-world evidence studies?\n- View on microdosing protocols as maintenance therapy?",
    createdAt: now - 24 * HOUR,
    updatedAt: now - 24 * HOUR,
  },
  {
    id: "note-3",
    projectId: "proj-1",
    title: "Gaps in the literature",
    content:
      "- No head-to-head vs ketamine/esketamine\n- Limited data in comorbid anxiety + TRD\n- No studies in adolescents\n- Long-term (>12mo) durability unknown\n- Interaction with ongoing SSRIs poorly characterized",
    createdAt: now - 3 * 24 * HOUR,
    updatedAt: now - 3 * 24 * HOUR,
  },
];

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: seedNotes,
      lastProjectId: null,
      addNote: (note) => {
        const id = uid();
        const ts = Date.now();
        set((s) => ({
          notes: [
            { ...note, id, createdAt: ts, updatedAt: ts },
            ...s.notes,
          ],
        }));
        return id;
      },
      updateNote: (id, patch) => {
        const ts = Date.now();
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: ts } : n
          ),
        }));
      },
      deleteNote: (id) =>
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      setLastProjectId: (id) => set({ lastProjectId: id }),
      getByProject: (projectId) =>
        get().notes.filter((n) => n.projectId === projectId),
    }),
    { name: "scispark-notes" }
  )
);

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / (60 * 1000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
