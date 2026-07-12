"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";

interface RightPanelProps {
  children: React.ReactNode;
  show: boolean;
}

const EASE_CARD = [0.22, 1, 0.36, 1] as const;

export function RightPanel({ children, show }: RightPanelProps) {
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);

  return (
    <AnimatePresence>
      {show && (
        <motion.aside
          initial={{ x: 260, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 260, opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_CARD }}
          className="w-[260px] bg-page-warm border-l border-border-warm flex-shrink-0 overflow-y-auto hidden lg:block"
        >
          <div className="flex justify-end p-2">
            <button
              onClick={toggleRightPanel}
              className="p-1.5 text-muted-text hover:text-espresso transition-colors rounded-[6px] hover:bg-card-surface/50"
              aria-label="Close panel"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
