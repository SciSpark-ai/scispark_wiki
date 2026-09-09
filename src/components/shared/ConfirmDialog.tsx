"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-light-surface rounded-card p-6 shadow-2xl max-w-sm w-full"
          >
            <h3 className="font-heading text-[18px] text-espresso tracking-heading-card">
              {title}
            </h3>
            <p className="text-[14px] text-muted-text tracking-body mt-2">
              {message}
            </p>
            <div className="flex gap-3 mt-6 justify-end">
              <button
                onClick={onCancel}
                className="px-5 py-2 text-[14px] text-muted-text rounded-pill border border-border-warm hover:bg-light-surface transition"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-5 py-2 text-[14px] text-on-accent bg-orange rounded-pill hover:bg-orange/90 transition"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
