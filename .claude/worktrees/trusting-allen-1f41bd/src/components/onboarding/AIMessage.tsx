"use client";

import { motion } from "framer-motion";

interface AIMessageProps {
  text: string;
}

export function AIMessage({ text }: AIMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="text-[16px] text-espresso leading-[1.7] tracking-body whitespace-pre-line">
        {text}
      </p>
    </motion.div>
  );
}
