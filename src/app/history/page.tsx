"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getOpenVault } from "@/lib/vault/get-vault";
import { listSessions } from "@/lib/chat/session";
import type { ChatSession } from "@/lib/chat/session";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

function getDateGroup(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0 && date.getDate() === now.getDate()) return "Today";
  if (diffDays <= 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  return "Earlier";
}

function formatSessionTime(iso: string, group: string): string {
  const date = new Date(iso);
  if (group === "Today") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  if (group === "Yesterday" || group === "This Week") {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const GROUP_ORDER = ["Today", "Yesterday", "This Week", "Earlier"];

/**
 * `/history` — real KB-chat conversation history (SP5 Task 9 ride-along).
 * Deleting the fork's mock chat store left this page with a dangling
 * import; rather than gut it to a placeholder, it now lists real sessions
 * off the vault via `listSessions` (the same interface `/chat` uses for its
 * "Recent conversations" list) — no new backend surface, just wired to the
 * data that already exists. A fuller history/undo surface remains SP6 scope.
 */
export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vault = await getOpenVault();
        const loaded = await listSessions(vault);
        if (!cancelled) setSessions(loaded);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (sessions === null) {
    return (
      <div className="p-7">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">History</h1>
        <LoadingState label="Loading…" />
      </div>
    );
  }

  const grouped = GROUP_ORDER.reduce<Record<string, ChatSession[]>>((acc, group) => {
    const items = sessions
      .filter((s) => getDateGroup(s.updatedAt) === group)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (items.length > 0) acc[group] = items;
    return acc;
  }, {});

  const hasAny = sessions.length > 0;

  return (
    <div className="p-7">
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">History</h1>

      {!hasAny ? (
        <EmptyState message="No conversations yet. Start a new chat to explore research." actionLabel="New Chat" actionHref="/chat" />
      ) : (
        <div>
          {GROUP_ORDER.filter((g) => grouped[g]).map((group, groupIndex) => (
            <div key={group}>
              <p
                className={`text-[12px] uppercase text-muted-text font-medium tracking-[0.06em] mb-2 ${
                  groupIndex === 0 ? "mt-4" : "mt-6"
                }`}
              >
                {group}
              </p>
              <div>
                {grouped[group].map((session) => {
                  const displayTitle =
                    session.title.length > 60 ? session.title.slice(0, 60) + "…" : session.title;
                  return (
                    <div
                      key={session.id}
                      className="flex items-center justify-between py-3 px-3 -mx-3 rounded-[10px] cursor-pointer hover:bg-light-surface transition-colors"
                      onClick={() => router.push(`/chat/${session.id}`)}
                    >
                      <span className="text-[14px] text-espresso tracking-body truncate mr-4">{displayTitle}</span>
                      <span className="text-[12px] text-muted-text shrink-0">
                        {formatSessionTime(session.updatedAt, group)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
