"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Search,
  Filter,
  Microscope,
  Brain,
  Sparkles,
  CheckCircle,
  ChevronDown,
} from "lucide-react";

type LucideIcon = React.ComponentType<{ size?: number; className?: string }>;

interface Step {
  icon: LucideIcon;
  text: string;
  duration: number;
}

export const REASONING_STEPS: Step[] = [
  { icon: Search,     text: "Parsing your question…",                  duration: 650 },
  { icon: Filter,     text: "Searching 14,200 clinical papers…",       duration: 900 },
  { icon: Microscope, text: "Screening 18 RCTs and meta-analyses…",    duration: 850 },
  { icon: Brain,      text: "Extracting effect sizes & key findings…", duration: 950 },
  { icon: Sparkles,   text: "Synthesizing evidence…",                  duration: 900 },
];

const TOTAL_DURATION_S = Math.round(
  REASONING_STEPS.reduce((s, st) => s + st.duration, 0) / 1000
);

/* ─────────────  LIVE  ───────────── */

interface ReasoningAnimationProps {
  isVisible: boolean;
  onComplete: () => void;
}

export default function ReasoningAnimation({
  isVisible,
  onComplete,
}: ReasoningAnimationProps) {
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<boolean[]>(() =>
    REASONING_STEPS.map(() => false)
  );

  useEffect(() => {
    if (!isVisible) {
      setActive(0);
      setDone(REASONING_STEPS.map(() => false));
      return;
    }

    let cumulative = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    REASONING_STEPS.forEach((step, idx) => {
      cumulative += step.duration;
      const at = cumulative;
      timers.push(
        setTimeout(() => {
          setDone((prev) => {
            if (prev[idx]) return prev;
            const next = [...prev];
            next[idx] = true;
            return next;
          });
          if (idx < REASONING_STEPS.length - 1) {
            setActive((cur) => (cur < idx + 1 ? idx + 1 : cur));
          }
        }, at)
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) onComplete();
  }, [isVisible, onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="bg-light-surface border border-border-warm/30 rounded-[14px] shadow-sm px-5 py-4 max-w-md"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted-text/70">
              Thinking
            </span>
            <span className="flex-1 h-px bg-border-warm/40" />
          </div>

          <div className="space-y-2.5">
            {REASONING_STEPS.map((step, idx) => {
              if (idx > active) return null;
              const isDone = done[idx];
              const Icon = step.icon;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex items-center gap-2.5"
                >
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {isDone ? (
                      <CheckCircle size={14} className="text-emerald-600" />
                    ) : (
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 1.4,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="inline-flex"
                      >
                        <Icon size={14} className="text-orange" />
                      </motion.span>
                    )}
                  </div>
                  <span
                    className={`text-[13px] tracking-body leading-snug ${
                      isDone ? "text-muted-text/60" : "text-espresso"
                    }`}
                  >
                    {step.text}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────  PERSISTED (collapsible)  ───────────── */

export function CompletedReasoning() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-light-surface border border-border-warm/30 rounded-[14px] shadow-sm max-w-md mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-5 py-3 group"
      >
        <CheckCircle
          size={14}
          className="text-emerald-600 flex-shrink-0"
        />
        <span className="text-[12px] uppercase tracking-[0.12em] text-muted-text/70">
          Thought for ~{TOTAL_DURATION_S}s · {REASONING_STEPS.length} steps
        </span>
        <span className="flex-1" />
        <ChevronDown
          size={14}
          className={`text-muted-text/60 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="trace"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-warm/30 px-5 py-3 space-y-2.5">
              {REASONING_STEPS.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2.5">
                  <CheckCircle
                    size={14}
                    className="text-emerald-600 flex-shrink-0"
                  />
                  <span className="text-[13px] tracking-body leading-snug text-muted-text/70">
                    {step.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
