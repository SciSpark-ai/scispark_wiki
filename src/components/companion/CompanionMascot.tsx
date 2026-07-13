"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useCompanionStore } from "@/stores/companion-store";
import { CompanionBubble } from "./CompanionBubble";

/** Reads (and subscribes to) the user's OS-level reduced-motion preference. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * The companion's persistent, fixed-position mascot (M7 Task 6) — the
 * "presentation layer of the skill system" (docs/design/04-agent-harness.md).
 * Mounted once in AppShell so it survives route changes.
 *
 * The art is a hand-drawn placeholder spark/star, not commissioned character
 * art (see docs/superpowers/plans/2026-07-13-m7-companion.md Global
 * Constraints: mascot art is provisional until M11 branding).
 * TODO(branding): swap for Tong's final companion character design.
 */
export function CompanionMascot() {
  const current = useCompanionStore((s) => s.current);
  const dismiss = useCompanionStore((s) => s.dismiss);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // A fresh utterance always opens the bubble; dismissing/clearing closes it.
  useEffect(() => {
    setBubbleOpen(current !== null);
  }, [current]);

  function handleMascotClick() {
    if (!current) return; // idle: clicking does nothing, per spec
    setBubbleOpen((open) => !open);
  }

  // Dismiss (x) just clears the store. Task 7 wires this into the trigger
  // engine's caller so it also logs a `companion_dismiss` Tier-1 event.
  function handleDismiss() {
    setBubbleOpen(false);
    dismiss();
  }

  // Action click navigates (plain next/link, below) and closes the bubble.
  // Task 7 adds the `companion_action` log around this.
  function handleAction() {
    setBubbleOpen(false);
    dismiss();
  }

  return (
    <div
      data-companion-mascot
      className="fixed bottom-5 right-5 z-40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative">
        {bubbleOpen && current ? (
          <CompanionBubble utterance={current} onDismiss={handleDismiss} onAction={handleAction} />
        ) : null}

        <motion.button
          type="button"
          onClick={handleMascotClick}
          aria-label={current ? "Toggle companion message" : "Companion"}
          className="flex h-12 w-12 items-center justify-center rounded-pill bg-orange text-white shadow-md cursor-pointer"
          animate={
            reducedMotion
              ? undefined
              : current
                ? { scale: [1, 1.18, 0.95, 1.06, 1] } // celebration pulse
                : { y: [0, -4, 0] } // idle bob
          }
          transition={
            current
              ? { duration: 0.55, ease: "easeOut" }
              : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          {/* TODO(branding): provisional spark/star mark — swap for the final companion mascot. */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
              fill="currentColor"
            />
          </svg>
        </motion.button>
      </div>
    </div>
  );
}
