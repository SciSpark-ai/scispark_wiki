"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { CompanionUtterance } from "@/lib/companion/run";

interface CompanionBubbleProps {
  utterance: CompanionUtterance;
  onDismiss: () => void;
  onAction: () => void;
  streaming?: boolean;
}

/**
 * The companion's speech bubble. `utterance.text` is rendered as plain text
 * (React's default child-text escaping — never dangerouslySetInnerHTML),
 * since it may ultimately be LLM-generated (src/lib/companion/skill.ts).
 */
export function CompanionBubble({ utterance, onDismiss, onAction, streaming = false }: CompanionBubbleProps) {
  return (
    <AnimatePresence>
      <motion.div
        key="companion-bubble"
        data-companion-bubble
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.96 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="absolute bottom-full right-0 mb-3 w-64 rounded-card border border-border-warm/60 bg-light-surface p-4 shadow-lg"
        role="status"
        aria-busy={streaming}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 p-0.5 text-muted-text hover:text-espresso transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>

        <p className="pr-5 text-[13px] leading-snug text-pretty text-espresso">{utterance.text}{streaming && <span aria-hidden="true" className="ml-1 inline-block h-3 w-1 rounded-full bg-orange motion-safe:animate-pulse" />}</p>

        {utterance.action ? (
          <Link
            href={utterance.action.href}
            onClick={onAction}
            className="mt-3 inline-flex items-center rounded-pill bg-orange px-3 py-1.5 text-[12px] font-medium text-white hover:bg-orange/90 transition-colors"
          >
            {utterance.action.label}
          </Link>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
