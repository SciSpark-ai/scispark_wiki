"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, FolderOpen, Check, X } from "lucide-react";
import { mockProjects } from "@/lib/mock-data/projects";
import {
  useNotesStore,
  type NoteSourceKind,
} from "@/stores/notes-store";

interface BubbleState {
  text: string;
  top: number;
  left: number;
  kind: NoteSourceKind;
  refId?: string;
  refLabel?: string;
}

export function SelectionToNoteBubble() {
  const [state, setState] = useState<BubbleState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [chosenProject, setChosenProject] = useState<string>("");
  const bubbleRef = useRef<HTMLDivElement>(null);

  const addNote = useNotesStore((s) => s.addNote);
  const lastProjectId = useNotesStore((s) => s.lastProjectId);
  const setLastProjectId = useNotesStore((s) => s.setLastProjectId);

  useEffect(() => {
    if (!chosenProject) {
      setChosenProject(lastProjectId ?? mockProjects[0].id);
    }
  }, [lastProjectId, chosenProject]);

  useEffect(() => {
    const onMouseUp = () => {
      // Defer so the selection is finalized.
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const text = sel.toString().trim();
        if (text.length < 2) return;

        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node instanceof Element ? node : node.parentElement;
        const source = el?.closest("[data-note-source]");
        if (!source) return;

        const kind =
          (source.getAttribute("data-note-source") as NoteSourceKind) ||
          "manual";
        const refId = source.getAttribute("data-note-source-id") ?? undefined;
        const refLabel =
          source.getAttribute("data-note-source-label") ?? undefined;

        const r = range.getBoundingClientRect();
        setState({
          text,
          top: r.top - 44,
          left: r.left + r.width / 2,
          kind,
          refId,
          refLabel,
        });
        setExpanded(false);
        setShowConfirm(false);
      }, 0);
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.("[data-selection-bubble]")) return;
      // Outside click — clear after the browser updates selection.
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setState(null);
          setExpanded(false);
          setShowConfirm(false);
        }
      }, 0);
    };

    const onScroll = () => {
      setState(null);
      setExpanded(false);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  function save() {
    if (!state || !chosenProject) return;
    const firstLine = state.text.split("\n")[0].trim();
    const title =
      firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
    addNote({
      projectId: chosenProject,
      title: title || "Untitled note",
      content: state.text,
      source: {
        kind: state.kind,
        refId: state.refId,
        refLabel: state.refLabel,
      },
    });
    setLastProjectId(chosenProject);
    setShowConfirm(true);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => {
      setState(null);
      setExpanded(false);
      setShowConfirm(false);
    }, 1100);
  }

  if (!state) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="bubble"
        data-selection-bubble
        ref={bubbleRef}
        initial={{ opacity: 0, y: 6, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.94 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={{
          position: "fixed",
          top: state.top,
          left: state.left,
          transform: "translate(-50%, 0)",
          zIndex: 70,
        }}
        className="bg-light-surface border border-border-warm/40 rounded-pill shadow-md whitespace-nowrap"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {showConfirm ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
            <Check size={14} />
            Saved to{" "}
            {mockProjects.find((p) => p.id === chosenProject)?.name ??
              "project"}
          </div>
        ) : !expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-espresso hover:bg-page-warm transition-colors rounded-pill cursor-pointer"
          >
            <Plus size={14} className="text-orange" />
            Save to note
          </button>
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <FolderOpen size={14} className="text-orange ml-1.5" />
            <select
              value={chosenProject}
              onChange={(e) => setChosenProject(e.target.value)}
              className="text-[13px] text-espresso bg-transparent focus:outline-none cursor-pointer max-w-[180px] truncate"
            >
              {mockProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={save}
              className="px-3 py-1 bg-orange text-white text-[12px] font-medium rounded-pill hover:bg-orange/90 transition-colors cursor-pointer"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setState(null);
                setExpanded(false);
                window.getSelection()?.removeAllRanges();
              }}
              className="text-muted-text hover:text-espresso transition-colors p-0.5 cursor-pointer"
              aria-label="Cancel"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
