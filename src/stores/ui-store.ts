import { create } from "zustand";

interface UIState {
  /** Mobile slide-over sidebar (MobileNav). */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Desktop sidebar expanded (240px) vs collapsed (60px) — AppShell/Sidebar. */
  desktopSidebarOpen: boolean;
  toggleDesktopSidebar: () => void;
  /** Which settings-modal section is open, or null when closed. */
  settingsModalSection: string | null;
  openSettingsModal: (section?: string) => void;
  closeSettingsModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  desktopSidebarOpen: true,
  toggleDesktopSidebar: () => set((s) => ({ desktopSidebarOpen: !s.desktopSidebarOpen })),
  settingsModalSection: null,
  openSettingsModal: (section = "ai") => set({ settingsModalSection: section }),
  closeSettingsModal: () => set({ settingsModalSection: null }),
}));
