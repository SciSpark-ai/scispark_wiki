import { create } from "zustand";
import type { ReactNode } from "react";

interface UIState {
  sidebarOpen: boolean;
  desktopSidebarOpen: boolean;
  sourcesPanelOpen: boolean;
  activeNav: string;
  rightPanelContent: ReactNode | null;
  showRightPanel: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setDesktopSidebarOpen: (open: boolean) => void;
  toggleDesktopSidebar: () => void;
  setSourcesPanelOpen: (open: boolean) => void;
  toggleSourcesPanel: () => void;
  setActiveNav: (nav: string) => void;
  setRightPanel: (content: ReactNode | null) => void;
  setShowRightPanel: (show: boolean) => void;
  toggleRightPanel: () => void;
  settingsModalSection: string | null;
  openSettingsModal: (section?: string) => void;
  closeSettingsModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  desktopSidebarOpen: true,
  sourcesPanelOpen: false,
  activeNav: "home",
  rightPanelContent: null,
  showRightPanel: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setDesktopSidebarOpen: (open) => set({ desktopSidebarOpen: open }),
  toggleDesktopSidebar: () =>
    set((s) => ({ desktopSidebarOpen: !s.desktopSidebarOpen })),
  setSourcesPanelOpen: (open) => set({ sourcesPanelOpen: open }),
  toggleSourcesPanel: () =>
    set((s) => ({ sourcesPanelOpen: !s.sourcesPanelOpen })),
  setActiveNav: (nav) => set({ activeNav: nav }),
  setRightPanel: (content) => set({ rightPanelContent: content }),
  setShowRightPanel: (show) => set({ showRightPanel: show }),
  toggleRightPanel: () =>
    set((s) => ({ showRightPanel: !s.showRightPanel })),
  settingsModalSection: null,
  openSettingsModal: (section = "ai") => set({ settingsModalSection: section }),
  closeSettingsModal: () => set({ settingsModalSection: null }),
}));
