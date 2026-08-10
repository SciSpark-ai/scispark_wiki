"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Trash2,
  FileText,
  MessageSquare,
  Pencil,
} from "lucide-react";
import {
  relativeTime,
  useNotesStore,
  type NoteSourceKind,
  type ProjectNote,
} from "@/stores/notes-store";

interface NoteEditorModalProps {
  note: ProjectNote;
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
}

function sourceMeta(kind: NoteSourceKind | undefined) {
  if (kind === "paper") return { Icon: FileText, label: "From paper" };
  if (kind === "chat") return { Icon: MessageSquare, label: "From chat" };
  return { Icon: Pencil, label: "Manual note" };
}

function NoteEditorDialog({
  note,
  onClose,
  onDelete,
}: Omit<NoteEditorModalProps, "open">) {
  const updateNote = useNotesStore((s) => s.updateNote);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 600) + "px";
  }, [content]);

  // Focus management + ESC to close
  useEffect(() => {
    const focusTarget =
      note.title.trim() === "" ? titleRef.current : textareaRef.current;
    focusTarget?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [note.id, note.title, onClose]);

  function commit() {
    if (title !== note.title || content !== note.content) {
      updateNote(note.id, { title, content });
    }
  }

  function handleClose() {
    commit();
    onClose();
  }

  const { Icon, label } = sourceMeta(note.source?.kind);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="bg-page-bg border border-border-warm/40 rounded-[18px] shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-3 border-b border-border-warm/30">
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-text/70">
            <Icon size={12} />
            {label}
            {note.source?.refLabel && (
              <span className="ml-1 text-muted-text/60 normal-case tracking-normal truncate max-w-[260px]">
                · {note.source.refLabel}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 text-muted-text hover:text-red-600 transition-colors rounded-[6px] hover:bg-page-warm"
              aria-label="Delete note"
            >
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-muted-text hover:text-espresso transition-colors rounded-[6px] hover:bg-page-warm"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-6 pt-5 pb-6 flex-1 overflow-y-auto">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            placeholder="Untitled note"
            className="w-full font-heading text-[22px] text-espresso tracking-heading bg-transparent focus:outline-none placeholder:text-muted-text/50"
          />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={commit}
            placeholder="Write your note…"
            rows={6}
            className="w-full mt-4 text-[15px] text-espresso leading-[1.7] tracking-body bg-transparent resize-none focus:outline-none placeholder:text-muted-text/50 whitespace-pre-wrap"
          />
        </div>

        <div className="px-6 py-2.5 border-t border-border-warm/30 text-[12px] text-muted-text/60 flex items-center justify-between">
          <span>Edits save automatically</span>
          <span>Updated {relativeTime(note.updatedAt)}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function NoteEditorModal({
  note,
  open,
  onClose,
  onDelete,
}: NoteEditorModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <NoteEditorDialog
          key={note.id}
          note={note}
          onClose={onClose}
          onDelete={onDelete}
        />
      )}
    </AnimatePresence>
  );
}
