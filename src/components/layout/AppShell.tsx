"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { RightPanel } from "./RightPanel";
import { useUIStore } from "@/stores/ui-store";
import { SelectionToNoteBubble } from "@/components/notes/SelectionToNoteBubble";
import { CompanionMascot } from "@/components/companion/CompanionMascot";
import SettingsModal from "@/components/settings/SettingsModal";
import ThemeApplier from "./ThemeApplier";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const showRightPanel = useUIStore((s) => s.showRightPanel);
  const rightPanelContent = useUIStore((s) => s.rightPanelContent);
  const desktopSidebarOpen = useUIStore((s) => s.desktopSidebarOpen);
  const pathname = usePathname();

  // Pages under /paper/[id], /chat/[id], /projects/[id] should still animate
  // as a single route group rather than per-segment to avoid blinking on
  // dynamic param changes inside the same section.
  const routeKey = pathname?.split("/").slice(0, 3).join("/") ?? "/";

  return (
    <div className="h-screen flex flex-col">
      <MobileNav />
      <div className="flex flex-1 overflow-hidden lg:pt-0 pt-[50px]">
        <motion.div
          className="hidden lg:block h-full flex-shrink-0 overflow-hidden border-r border-border-warm"
          initial={false}
          animate={{ width: desktopSidebarOpen ? 240 : 60 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        >
          <Sidebar collapsed={!desktopSidebarOpen} />
        </motion.div>

        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={routeKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        <RightPanel show={showRightPanel}>
          {rightPanelContent}
        </RightPanel>
      </div>
      <SelectionToNoteBubble />
      <CompanionMascot />
      <SettingsModal />
      <ThemeApplier />
    </div>
  );
}
