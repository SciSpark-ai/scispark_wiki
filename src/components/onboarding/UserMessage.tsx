"use client";

import { motion } from "framer-motion";

interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex justify-center"
    >
      <div className="bg-page-warm rounded-[14px] px-6 py-3 max-w-lg">
        <p className="text-[15px] text-espresso font-medium tracking-body text-center">
          {text}
        </p>
      </div>
    </motion.div>
  );
}
