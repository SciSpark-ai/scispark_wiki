"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { useCompanionStore } from "@/stores/companion-store";
import { getOpenVault } from "@/lib/vault/get-vault";
import { logEvent } from "@/lib/events/log";
import { CompanionBubble } from "./CompanionBubble";

/** Fire-and-forget Tier-1 companion event. Never blocks or throws into render —
 * logEvent already swallows its own storage errors. */
function logCompanionEvent(type: "companion_dismiss" | "companion_action", trigger: string) {
  void getOpenVault()
    .then((storage) => logEvent(storage, { type, trigger }))
    .catch(() => undefined);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Reads (and subscribes to) the user's OS-level reduced-motion preference.
 * useSyncExternalStore keeps SSR (false) and client in sync without a
 * setState-in-effect. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false),
    () => false, // server snapshot
  );
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

  // Dismiss (x) clears the store and logs a `companion_dismiss` Tier-1 event so
  // Memory-Consolidation can learn what to stop suggesting (anti-Clippy loop).
  function handleDismiss() {
    if (current) logCompanionEvent("companion_dismiss", current.trigger);
    setBubbleOpen(false);
    dismiss();
  }

  // Action click logs `companion_action` (positive signal), then the bubble's
  // next/link navigates and this closes the bubble.
  function handleAction() {
    if (current) logCompanionEvent("companion_action", current.trigger);
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
