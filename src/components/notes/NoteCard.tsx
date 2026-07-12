"use client";

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
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
import { NoteEditorModal } from "./NoteEditorModal";

interface NoteCardProps {
  note: ProjectNote;
  autoOpen?: boolean;
}

function sourceMeta(kind: NoteSourceKind | undefined) {
  if (kind === "paper") return { Icon: FileText, label: "From paper" };
  if (kind === "chat") return { Icon: MessageSquare, label: "From chat" };
  return { Icon: Pencil, label: "Note" };
}

export function NoteCard({ note, autoOpen = false }: NoteCardProps) {
  const deleteNote = useNotesStore((s) => s.deleteNote);

  const [open, setOpen] = useState(autoOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const { Icon, label } = sourceMeta(note.source?.kind);
  const displayTitle = note.title.trim() || "Untitled note";
  const displayBody = note.content.trim() || "(empty)";

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="bg-white border border-border-warm/30 rounded-[12px] p-4 flex flex-col cursor-pointer hover:shadow-sm transition-shadow group min-h-[240px]"
      >
        <div className="flex items-start justify-between gap-2">
          <p
            className={`flex-1 text-[15px] font-medium leading-[1.35] line-clamp-2 ${
              note.title.trim() ? "text-espresso" : "text-muted-text/60"
            }`}
          >
            {displayTitle}
          </p>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-1 text-muted-text hover:text-espresso opacity-0 group-hover:opacity-100 transition-all"
              aria-label="Note actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-10 bg-white border border-border-warm/40 rounded-[10px] shadow-md py-1 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    deleteNote(note.id);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-espresso hover:bg-page-warm transition-colors"
                >
                  <Trash2 size={13} className="text-muted-text" />
                  Delete note
                </button>
              </div>
            )}
          </div>
        </div>

        <p
          className={`mt-2 text-[13px] leading-[1.55] whitespace-pre-wrap line-clamp-6 ${
            note.content.trim() ? "text-espresso" : "text-muted-text/50 italic"
          }`}
        >
          {displayBody}
        </p>

        <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-warm/20">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-text/70">
            <Icon size={11} />
            {label}
          </span>
          <span className="text-[12px] text-muted-text/60">
            {relativeTime(note.updatedAt)}
          </span>
        </div>
      </div>

      <NoteEditorModal
        note={note}
        open={open}
        onClose={() => setOpen(false)}
        onDelete={() => {
          deleteNote(note.id);
          setOpen(false);
        }}
      />
    </>
  );
}
