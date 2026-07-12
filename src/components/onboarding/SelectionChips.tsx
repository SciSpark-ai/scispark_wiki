"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface SelectionChipsProps {
  options: string[];
  multiSelect?: boolean;
  onSubmit: (answer: string | string[]) => void;
}

export function SelectionChips({ options, multiSelect = false, onSubmit }: SelectionChipsProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function handleChipClick(option: string) {
    if (multiSelect) {
      setSelected((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
      );
    } else {
      onSubmit(option);
    }
  }

  function handleMultiSubmit() {
    if (selected.length > 0) {
      onSubmit(selected);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex flex-wrap gap-2.5">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => handleChipClick(option)}
              className={`px-4 py-2 rounded-pill text-[14px] tracking-body border transition-colors ${
                isSelected
                  ? "bg-orange text-white border-orange"
                  : "bg-light-surface text-espresso border-border-warm hover:bg-card-surface"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>

      {multiSelect && selected.length > 0 && (
        <button
          onClick={handleMultiSubmit}
          className="mt-4 px-6 py-2.5 rounded-pill bg-orange text-white text-[14px] font-medium hover:bg-orange/90 transition"
        >
          Continue with {selected.length} selected
        </button>
      )}
    </motion.div>
  );
}
