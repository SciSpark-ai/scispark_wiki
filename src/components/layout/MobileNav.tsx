"use client";

import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useModalFocus } from "@/components/ui/useModalFocus";

export function MobileNav() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);
  useModalFocus(panel, sidebarOpen, close);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const dismissOnDesktop = () => { if (desktop.matches) close(); };
    dismissOnDesktop();
    desktop.addEventListener("change", dismissOnDesktop);
    return () => desktop.removeEventListener("change", dismissOnDesktop);
  }, [close]);

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
        <span className="flex-1 flex items-center justify-center">
          <BrandLogo />
        </span>
        <ThemeToggle />
      </div>

      {/* Slide-over sidebar: kept mounted so open and close both transition;
          `inert` keeps the closed drawer out of the tab order and screen readers. */}
      <div
        ref={panel}
        role="dialog"
        aria-label="Navigation menu"
        aria-modal={sidebarOpen ? true : undefined}
        tabIndex={-1}
        inert={!sidebarOpen}
        className={`lg:hidden fixed inset-0 z-50 ${sidebarOpen ? "visible" : "invisible"}`}
      >
        <div
          onClick={close}
          className={`absolute inset-0 bg-espresso/30 backdrop-blur-sm transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "opacity-0"}`}
        />
        <div className={`relative h-full w-[240px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          {sidebarOpen && <Sidebar onNavigate={close} />}
        </div>
      </div>
    </>
  );
}
