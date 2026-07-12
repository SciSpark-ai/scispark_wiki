"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquarePlus,
  BookOpen,
  Clock,
  FolderOpen,
  PanelLeftClose,
} from "lucide-react";
import { useUserStore } from "@/stores/user-store";
import { useUIStore } from "@/stores/ui-store";
import { useChatStore } from "@/stores/chat-store";

function UserAvatar() {
  const user = useUserStore((s) => s.user);
  const initial = user?.name?.charAt(0).toUpperCase() ?? "U";
  return (
    <div className="w-9 h-9 rounded-full bg-orange text-white flex items-center justify-center text-[14px] font-medium flex-shrink-0">
      {initial}
    </div>
  );
}

const navItems = [
  { key: "home", label: "Home", href: "/", icon: Home },
  { key: "chat", label: "New Chat", href: "/chat", icon: MessageSquarePlus },
  { key: "projects", label: "Projects", href: "/projects", icon: FolderOpen },
  { key: "library", label: "Library", href: "/library", icon: BookOpen },
  { key: "history", label: "History", href: "/history", icon: Clock },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);
  const toggleDesktopSidebar = useUIStore((s) => s.toggleDesktopSidebar);
  const sessions = useChatStore((s) => s.sessions);
  const recentChats = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  const isOnboarding = pathname === "/onboarding";
  const disabled = isOnboarding && !onboardingComplete;

  return (
    <aside className="w-[240px] bg-page-warm border-r border-border-warm flex flex-col h-full p-3 flex-shrink-0">
      {/* Logo + collapse */}
      <div className="px-3 mt-[16px] mb-3 flex items-center justify-between flex-shrink-0">
        <span className="font-heading text-[32px] text-espresso tracking-heading">
          SciSpark
        </span>
        <button
          onClick={toggleDesktopSidebar}
          className="p-1.5 text-muted-text hover:text-espresso transition-colors rounded-[6px] hover:bg-card-surface/50"
          aria-label="Close sidebar"
        >
          <PanelLeftClose size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Nav items */}
      <nav className={disabled ? "opacity-40 pointer-events-none" : ""}>
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

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
              <Icon size={18} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <hr className="border-border-warm mx-[10px] my-[14px]" />

      {/* Recent chats */}
      <div className={`flex-1 overflow-y-auto min-h-0 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
        <p className="text-[13px] uppercase tracking-[0.06em] text-muted-text font-medium px-3 pb-2">
          Recent Chats
        </p>
        {recentChats.length === 0 ? (
          <p className="text-[13px] text-muted-text/60 px-3 py-1">
            No conversations yet
          </p>
        ) : (
          recentChats.map((chat) => (
            <Link
              key={chat.id}
              href={`/chat/${chat.id}`}
              className={`block text-[14px] text-muted-text px-3 py-1.5 rounded-[6px] truncate leading-[1.4] hover:bg-card-surface/50 transition-colors ${
                pathname === `/chat/${chat.id}`
                  ? "bg-card-surface text-espresso font-medium"
                  : ""
              }`}
            >
              {chat.title}
            </Link>
          ))
        )}
      </div>

      {/* User profile at bottom */}
      <div className={disabled ? "opacity-40 pointer-events-none" : ""}>
        <hr className="border-border-warm mx-[10px] my-[14px]" />
        <Link
          href="/profile"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors ${
            pathname === "/profile"
              ? "bg-card-surface"
              : "hover:bg-card-surface/50"
          }`}
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
        </Link>
      </div>
    </aside>
  );
}
