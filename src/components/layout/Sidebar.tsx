"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Home,
  Search as SearchIcon,
  TrendingUp,
  BookOpen,
  Network,
  FolderOpen,
  Sparkles,
  MessageSquarePlus,
  Clock,
  PanelLeftClose,
  type LucideIcon,
} from "lucide-react";
import { useUserStore } from "@/stores/user-store";
import { useUIStore } from "@/stores/ui-store";
import { getOpenVault } from "@/lib/vault/get-vault";
import { reviewCount } from "@/lib/wiki/review-queue";
import { Chip } from "@/components/ui/Chip";

function UserAvatar() {
  const user = useUserStore((s) => s.user);
  const initial = user?.name?.charAt(0).toUpperCase() ?? "U";
  return (
    <div className="w-9 h-9 rounded-full bg-orange text-white flex items-center justify-center text-[14px] font-medium flex-shrink-0">
      {initial}
    </div>
  );
}

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Discover",
    items: [
      { key: "home", label: "Home", href: "/", icon: Home },
      { key: "search", label: "Search", href: "/papers", icon: SearchIcon },
      { key: "trending", label: "Trending", href: "/trending", icon: TrendingUp },
    ],
  },
  {
    heading: "Knowledge",
    items: [
      { key: "wiki", label: "Wiki", href: "/wiki", icon: BookOpen },
      { key: "graph", label: "Graph", href: "/viz", icon: Network },
      { key: "projects", label: "Projects", href: "/projects", icon: FolderOpen },
    ],
  },
  {
    heading: "Tools",
    items: [
      { key: "spark", label: "Spark", href: "/spark", icon: Sparkles },
      { key: "chat", label: "Chat", href: "/chat", icon: MessageSquarePlus },
    ],
  },
];

const HISTORY_ITEM: NavItem = { key: "history", label: "History", href: "/history", icon: Clock };

interface SidebarProps {
  collapsed?: boolean;
}

function isItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);
  const toggleDesktopSidebar = useUIStore((s) => s.toggleDesktopSidebar);
  const openSettingsModal = useUIStore((s) => s.openSettingsModal);
  const isOnboarding = pathname === "/onboarding";
  const disabled = isOnboarding && !onboardingComplete;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Review-inbox count for the Wiki nav badge. Reloaded whenever pathname
  // changes so acting on the inbox (e.g. dismissing/undoing) refreshes the
  // count on return. Failures resolve to 0 silently — the nav must never
  // break on a vault hiccup.
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vault = await getOpenVault();
        const count = await reviewCount(vault);
        if (!cancelled) setInboxCount(count);
      } catch {
        if (!cancelled) setInboxCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const fadeLabel = `whitespace-nowrap transition-opacity duration-150 ${
    collapsed ? "opacity-0" : "opacity-100"
  }`;
  const fadeBlock = `transition-opacity duration-150 ${
    collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
  }`;

  function renderItem(item: NavItem) {
    const isActive = isItemActive(pathname, item.href);
    const Icon = item.icon;
    // Review-inbox badge is Wiki-only; attached here rather than in
    // NAV_GROUPS to keep the item data generic.
    const badge = item.key === "wiki" && !collapsed && inboxCount > 0 ? inboxCount : null;

    return (
      <Link
        key={item.key}
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[15px] tracking-body transition-colors ${
          isActive
            ? "bg-card-surface text-espresso font-medium"
            : "text-muted-text hover:bg-card-surface/50"
        }`}
      >
        <Icon size={18} strokeWidth={1.8} className="flex-shrink-0" />
        <span className={fadeLabel}>{item.label}</span>
        {badge !== null && (
          <Chip tone="accent" className="ml-auto flex-shrink-0">
            {badge}
          </Chip>
        )}
      </Link>
    );
  }

  return (
    <aside className="w-[240px] bg-page-warm flex flex-col h-full p-3 flex-shrink-0">
      {/* Toggle + logo — toggle at x=24 in both states, label fades */}
      <div className="mb-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={toggleDesktopSidebar}
          className="px-3 py-2.5 text-muted-text hover:text-espresso transition-colors rounded-[10px] hover:bg-card-surface/50 flex items-center flex-shrink-0"
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          <PanelLeftClose size={18} strokeWidth={1.8} />
        </button>
        <span
          className={`font-heading text-[26px] text-espresso tracking-heading leading-none ${fadeLabel}`}
        >
          SciSpark
        </span>
      </div>

      {/* Grouped nav — icons always at same position */}
      <nav className={`flex-1 min-h-0 overflow-y-auto ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            <div
              className={`px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide text-muted-text ${collapsed ? "hidden" : ""}`}
            >
              {group.heading}
            </div>
            {group.items.map(renderItem)}
          </div>
        ))}
        <hr className="border-border-warm mx-[10px] my-[14px]" />
        {renderItem(HISTORY_ITEM)}
      </nav>

      {/* Account menu — hidden when collapsed */}
      <div className={`${fadeBlock} ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
        <hr className="border-border-warm mx-[10px] my-[14px]" />
        <div ref={menuRef} className="relative">
          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-48 rounded-card border border-border-warm bg-light-surface py-1 shadow-lg">
              <Link
                href="/profile"
                className="block px-4 py-2 text-[13px] text-espresso hover:bg-card-surface"
                onClick={() => setMenuOpen(false)}
              >
                Profile
              </Link>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-[13px] text-espresso hover:bg-card-surface"
                onClick={() => {
                  setMenuOpen(false);
                  openSettingsModal("ai");
                }}
              >
                Settings
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors hover:bg-card-surface/50 w-full text-left"
          >
            <UserAvatar />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-espresso font-medium truncate tracking-body">
                {useUserStore.getState().user?.name ?? "User"}
              </p>
              <p className="text-[12px] text-muted-text truncate tracking-body">
                {useUserStore.getState().user?.email ?? ""}
              </p>
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
}
