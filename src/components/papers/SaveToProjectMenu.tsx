"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bookmark, Plus, Lock, BookmarkPlus } from "lucide-react";
import { mockProjects } from "@/lib/mock-data/projects";
import { useProjectPapersStore } from "@/stores/project-papers-store";
import { usePaperActionsStore } from "@/stores/paper-actions-store";

interface SaveToProjectMenuProps {
  paperId: string;
  open: boolean;
  onClose: () => void;
}

export function SaveToProjectMenu({
  paperId,
  open,
  onClose,
}: SaveToProjectMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  const membership = useProjectPapersStore((s) => s.membership);
  const addPaperToProject = useProjectPapersStore((s) => s.addPaperToProject);
  const removePaperFromProject = useProjectPapersStore(
    (s) => s.removePaperFromProject
  );
  const toggleAction = usePaperActionsStore((s) => s.toggle);
  const savedFlag = usePaperActionsStore(
    (s) => s.actions[paperId]?.saved ?? false
  );

  // Click outside / ESC to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  function toggleProject(projectId: string) {
    const isIn = membership[projectId]?.includes(paperId) ?? false;
    if (isIn) removePaperFromProject(projectId, paperId);
    else addPaperToProject(projectId, paperId);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -2, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-full left-0 mt-2 z-40 bg-white border border-border-warm/40 rounded-[14px] shadow-xl w-[300px] overflow-hidden"
        >
          <p className="px-4 pt-3 pb-2 text-[15px] font-semibold text-espresso">
            Save to…
          </p>

          {/* Save without a project — goes to Library only */}
          <button
            type="button"
            onClick={() => toggleAction(paperId, "saved")}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-page-warm transition-colors"
          >
            <span className="w-1.5 h-9 rounded-[3px] flex-shrink-0 bg-warm-tan" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-espresso font-medium leading-tight truncate">
                Library
              </p>
              <p className="flex items-center gap-1 text-[11px] text-muted-text/70 mt-0.5">
                <BookmarkPlus size={10} strokeWidth={2} />
                Save without a project
              </p>
            </div>
            <Bookmark
              size={16}
              strokeWidth={1.8}
              className={
                savedFlag ? "fill-orange text-orange" : "text-muted-text/60"
              }
            />
          </button>

          <div className="border-t border-border-warm/20 my-1" />

          <div className="max-h-[260px] overflow-y-auto">
            {mockProjects.map((p) => {
              const isIn = membership[p.id]?.includes(paperId) ?? false;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProject(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-page-warm transition-colors"
                >
                  <span
                    className="w-1.5 h-9 rounded-[3px] flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-espresso font-medium leading-tight truncate">
                      {p.name}
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-muted-text/70 mt-0.5">
                      <Lock size={10} strokeWidth={2} />
                      Private
                    </p>
                  </div>
                  <Bookmark
                    size={16}
                    strokeWidth={1.8}
                    className={
                      isIn
                        ? "fill-orange text-orange"
                        : "text-muted-text/60"
                    }
                  />
                </button>
              );
            })}
          </div>
          <div className="border-t border-border-warm/30">
            <button
              type="button"
              onClick={() => {
                // Placeholder — new-project creation flow not wired yet
              }}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-3 text-[13px] font-medium text-espresso hover:bg-page-warm transition-colors"
            >
              <Plus size={14} className="text-orange" />
              New project
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
