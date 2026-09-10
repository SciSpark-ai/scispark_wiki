"use client";

import { useEffect, useRef, useState } from "react";
import { QuickChat } from "./QuickChat";
import { SparkyBadge } from "@/components/brand/SparkyBadge";
import { useCompanionStore } from "@/stores/companion-store";
import { getOpenVault } from "@/lib/vault/get-vault";
import { logEvent } from "@/lib/events/log";
import { CompanionBubble } from "./CompanionBubble";
import { FeedbackQuestion } from "./FeedbackQuestion";

/** Fire-and-forget Tier-1 companion event. Never blocks or throws into render —
 * logEvent already swallows its own storage errors. */
function logCompanionEvent(type: "companion_dismiss" | "companion_action", trigger: string, eventId?: string) {
  void getOpenVault()
    .then((storage) => logEvent(storage, { type, trigger, eventId }))
    .catch(() => undefined);
}

/** Persistent companion control; the approved spark stays still when idle. */
export function CompanionMascot() {
  const current = useCompanionStore((s) => s.current);
  const question = useCompanionStore((s) => s.feedbackQuestions[0]);
  const dismiss = useCompanionStore((s) => s.dismiss);
  const streaming = useCompanionStore((s) => s.streamId !== null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const hasCurrent = current !== null;

  // A fresh utterance always opens the bubble; dismissing/clearing closes it.
  useEffect(() => {
    setBubbleOpen(hasCurrent);
  }, [hasCurrent]);

  useEffect(() => {
    if (!current?.expiresAt) return;
    const delay = Math.max(0, Date.parse(current.expiresAt) - Date.now());
    const timeout = window.setTimeout(dismiss, delay);
    return () => window.clearTimeout(timeout);
  }, [current?.expiresAt, dismiss]);

  function handleMascotClick() {
    setChatOpen((open) => !open);
    setBubbleOpen(false);
  }

  // Dismiss (x) clears the store and logs a `companion_dismiss` Tier-1 event so
  // Memory-Consolidation can learn what to stop suggesting (anti-Clippy loop).
  function handleDismiss() {
    if (current) logCompanionEvent("companion_dismiss", current.trigger, current.eventId);
    setBubbleOpen(false);
    dismiss();
  }

  // Action click logs `companion_action` (positive signal), then the bubble's
  // next/link navigates and this closes the bubble.
  function handleAction() {
    if (current) logCompanionEvent("companion_action", current.trigger, current.eventId);
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
        <QuickChat open={chatOpen} onClose={() => { setChatOpen(false); launcher.current?.focus(); }} />
        {!chatOpen && (question ? <FeedbackQuestion key={question.paperKey} question={question} /> : bubbleOpen && current ? (
          <CompanionBubble utterance={current} streaming={streaming} onDismiss={handleDismiss} onAction={handleAction} />
        ) : null)}

        <button
          ref={launcher}
          type="button"
          aria-expanded={chatOpen}
          aria-controls="sparky-quick-chat"
          onClick={handleMascotClick}
          aria-label={chatOpen ? "Close Sparky chat" : "Open Sparky chat"}
          data-companion-toggle
          className="flex h-12 w-12 items-center justify-center rounded-pill shadow-md cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-ink"
        >
          <SparkyBadge size="companion" state={streaming ? (current?.text ? "responding" : "thinking") : "idle"} />
        </button>
      </div>
    </div>
  );
}
