"use client";

import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

export function MobileNav() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  return (
    <>
      {/* Top bar — mobile only */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-[50px] bg-page-bg border-b border-border-warm/20 flex items-center px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 text-espresso"
          aria-label="Open menu"
        >
          <Menu size={22} strokeWidth={1.8} />
        </button>
        <span className="flex-1 text-center font-heading text-[18px] text-espresso tracking-heading">
          SciSpark
        </span>
        <ThemeToggle />
      </div>

      {/* Slide-over sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[240px]"
            >
              <div className="h-full relative">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="absolute top-4 right-3 p-1 text-muted-text hover:text-espresso z-10"
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
                <Sidebar />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
