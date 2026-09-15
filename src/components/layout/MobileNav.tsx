"use client";

import { Menu, X } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { BrandLogo } from "@/components/brand/BrandLogo";

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
        <span className="flex-1 flex items-center justify-center">
          <BrandLogo />
        </span>
        <ThemeToggle />
      </div>

      {/* Slide-over sidebar: kept mounted so open and close both transition;
          `inert` keeps the closed drawer out of the tab order and screen readers. */}
      <div
        onClick={() => setSidebarOpen(false)}
        className={`lg:hidden fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm transition-[opacity,visibility] duration-200 ${sidebarOpen ? "opacity-100" : "invisible opacity-0"}`}
      />
      <div
        inert={!sidebarOpen}
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[240px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-full relative">
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-4 right-3 p-1 text-muted-text hover:text-espresso z-10"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          {sidebarOpen && <Sidebar />}
        </div>
      </div>
    </>
  );
}
