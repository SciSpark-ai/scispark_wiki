"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { RightPanel } from "./RightPanel";
import { useUIStore } from "@/stores/ui-store";
import { SelectionToNoteBubble } from "@/components/notes/SelectionToNoteBubble";
import { CompanionMascot } from "@/components/companion/CompanionMascot";
import { useCompanion } from "@/components/companion/useCompanion";
import SettingsModal from "@/components/settings/SettingsModal";
import ThemeApplier from "./ThemeApplier";
import NavHistoryTracker from "./NavHistoryTracker";
import { LegacyPrototypeWarning } from "@/components/projects/LegacyPrototypeWarning";
import { UserIdentityHydrator } from "./UserIdentityHydrator";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  useCompanion();
  const showRightPanel = useUIStore((s) => s.showRightPanel);
  const rightPanelContent = useUIStore((s) => s.rightPanelContent);
  const desktopSidebarOpen = useUIStore((s) => s.desktopSidebarOpen);
  const pathname = usePathname();

  return (
    <div className="h-dvh flex flex-col">
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

        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* App Router owns page identity. A keyed exit animation can receive
              the destination children before it exits, then mount them again,
              erasing inputs/selections and duplicating initialization. */}
          <div className="h-full">{children}</div>
        </main>

        <RightPanel show={showRightPanel}>
          {rightPanelContent}
        </RightPanel>
      </div>
      <SelectionToNoteBubble />
      {/* Sparky is already in the onboarding panel; avoid covering its composer. */}
      {pathname !== "/onboarding" && !pathname.startsWith("/chat") && pathname !== "/papers" && <CompanionMascot />}
      <SettingsModal />
      <ThemeApplier />
      <NavHistoryTracker />
      <LegacyPrototypeWarning />
      <UserIdentityHydrator />
    </div>
  );
}
