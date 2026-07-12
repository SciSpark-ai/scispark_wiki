"use client";

import { useState, useRef, useEffect } from "react";
import { Share2, Link2, Mail, Send, Briefcase, Check } from "lucide-react";

interface ShareButtonProps {
  title?: string;
  url?: string;
  variant?: "pill" | "icon" | "ghost";
  className?: string;
}

export function ShareButton({
  title = "Check this out on SciSpark",
  url,
  variant = "pill",
  className,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const getTargetUrl = () =>
    url ?? (typeof window !== "undefined" ? window.location.href : "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getTargetUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleShare = (target: "x" | "linkedin" | "email") => {
    const u = encodeURIComponent(getTargetUrl());
    const t = encodeURIComponent(title);
    const links: Record<typeof target, string> = {
      x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
      email: `mailto:?subject=${t}&body=${u}`,
    };
    if (typeof window !== "undefined") window.open(links[target], "_blank");
    setOpen(false);
  };

  const triggerClass =
    variant === "pill"
      ? "flex items-center gap-1.5 px-4 py-2 rounded-pill text-[13px] transition-colors border border-border-warm text-espresso hover:bg-card-surface"
      : variant === "ghost"
        ? "p-1.5 text-muted-text hover:text-orange transition-colors rounded-[6px]"
        : "hover:text-orange transition-colors";

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((p) => !p);
        }}
        aria-label="Share"
        className={triggerClass}
      >
        <Share2 size={variant === "pill" ? 14 : 16} />
        {variant === "pill" && "Share"}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-[10px] border border-border-warm/30 shadow-lg py-1 min-w-[180px]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
          >
            {copied ? <Check size={14} className="text-orange" /> : <Link2 size={14} />}
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleShare("x");
            }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
          >
            <Send size={14} />
            Share to X
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleShare("linkedin");
            }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
          >
            <Briefcase size={14} />
            Share to LinkedIn
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleShare("email");
            }}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-espresso hover:bg-light-surface transition-colors w-full text-left"
          >
            <Mail size={14} />
            Email
          </button>
        </div>
      )}
    </div>
  );
}
