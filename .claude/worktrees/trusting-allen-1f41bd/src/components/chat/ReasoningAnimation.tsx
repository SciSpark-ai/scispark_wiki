"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

interface ReasoningAnimationProps {
  isVisible: boolean;
  onComplete: () => void;
}

const MOCK_SOURCES = [
  "JAMA Psychiatry",
  "Nature Medicine",
  "Lancet Psychiatry",
  "Biological Psychiatry",
  "NEJM",
  "Brain Stimulation",
];

export default function ReasoningAnimation({
  isVisible,
  onComplete,
}: ReasoningAnimationProps) {
  const [phase, setPhase] = useState<1 | 2 | 3>(1);
  const [visibleSources, setVisibleSources] = useState(0);

  useEffect(() => {
    if (isVisible) {
      setPhase(1);
      setVisibleSources(0);
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    // Phase 1 -> Phase 2 after 1s
    const phase2Timer = setTimeout(() => {
      setPhase(2);
    }, 1000);

    // Phase 2 -> Phase 3 after 2.5s
    const phase3Timer = setTimeout(() => {
      setPhase(3);
    }, 2500);

    // onComplete after 3s
    const completeTimer = setTimeout(() => {
      onComplete();
    }, 3000);

    return () => {
      clearTimeout(phase2Timer);
      clearTimeout(phase3Timer);
      clearTimeout(completeTimer);
    };
  }, [isVisible, onComplete]);

  useEffect(() => {
    if (!isVisible || phase !== 2) return;

    const interval = setInterval(() => {
      setVisibleSources((prev) => {
        if (prev >= MOCK_SOURCES.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [isVisible, phase]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="py-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-[14px] text-muted-text tracking-body">
              {phase === 3
                ? "Analyzing 6 sources..."
                : "Searching clinical evidence..."}
            </span>
            {phase === 1 && (
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-muted-text"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {(phase === 2 || phase === 3) && visibleSources > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {MOCK_SOURCES.slice(0, visibleSources).map((source, index) => (
                <motion.span
                  key={source}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-card-surface rounded-pill px-2.5 py-1 text-[12px] text-muted-text"
                >
                  {source}
                </motion.span>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
