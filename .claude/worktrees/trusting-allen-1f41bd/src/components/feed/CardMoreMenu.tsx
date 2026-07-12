"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, X, Copy, Share2 } from "lucide-react";

export default function CardMoreMenu({ paperId }: { paperId: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        aria-label="More options"
        className="text-muted-text hover:text-orange transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-white rounded-[10px] border border-border-warm/30 shadow-lg py-1 min-w-[160px]">
          <button
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              console.log("Not Interested", paperId);
            }}
          >
            <X size={14} />
            Not Interested
          </button>

          <button
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              console.log("Copy Citation", paperId);
            }}
          >
            <Copy size={14} />
            Copy Citation
          </button>

          <button
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              console.log("Share", paperId);
            }}
          >
            <Share2 size={14} />
            Share
          </button>
        </div>
      )}
    </div>
  );
}
