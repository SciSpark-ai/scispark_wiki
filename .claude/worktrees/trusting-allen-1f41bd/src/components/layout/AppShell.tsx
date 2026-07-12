"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { RightPanel } from "./RightPanel";
import { useUIStore } from "@/stores/ui-store";
import { PanelLeft } from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const showRightPanel = useUIStore((s) => s.showRightPanel);
  const rightPanelContent = useUIStore((s) => s.rightPanelContent);
  const desktopSidebarOpen = useUIStore((s) => s.desktopSidebarOpen);
  const toggleDesktopSidebar = useUIStore((s) => s.toggleDesktopSidebar);

  return (
    <div className="h-screen flex flex-col">
      <MobileNav />
      <div className="flex flex-1 overflow-hidden lg:pt-0 pt-[50px]">
        {/* Desktop sidebar — collapsible */}
        {desktopSidebarOpen ? (
          <div className="hidden lg:block h-full">
            <Sidebar />
          </div>
        ) : (
          <div className="hidden lg:flex h-full w-12 flex-col items-center pt-4 bg-page-warm border-r border-border-warm flex-shrink-0">
            <button
              onClick={toggleDesktopSidebar}
              className="p-2 text-muted-text hover:text-espresso transition-colors rounded-[8px] hover:bg-card-surface/50"
              aria-label="Open sidebar"
            >
              <PanelLeft size={18} strokeWidth={1.8} />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        <RightPanel show={showRightPanel}>
          {rightPanelContent}
        </RightPanel>
      </div>
    </div>
  );
}
