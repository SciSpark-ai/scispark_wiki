"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { mockPapers, type Paper } from "@/lib/mock-data/papers";
import { StarsRating } from "@/components/shared/StarsRating";
import { EmptyState } from "@/components/shared/EmptyState";

type Tab = "saved" | "liked" | "readLater";

const tabs: { id: Tab; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "liked", label: "Liked" },
  { id: "readLater", label: "Read Later" },
];

const emptyStateConfig: Record<
  Tab,
  { message: string; actionLabel: string; href: string }
> = {
  saved: {
    message: "No saved papers yet. Browse your feed to start saving.",
    actionLabel: "Go to feed →",
    href: "/",
  },
  liked: {
    message: "No liked papers yet. Like papers from your feed to see them here.",
    actionLabel: "Go to feed →",
    href: "/",
  },
  readLater: {
    message:
      "Nothing in your reading list. Mark papers as 'Read Later' from your feed.",
    actionLabel: "Go to feed →",
    href: "/",
  },
};

export default function LibraryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("saved");

  const filteredPapers = mockPapers.filter((paper: Paper) => {
    if (activeTab === "saved") return paper.saved;
    if (activeTab === "liked") return paper.liked;
    if (activeTab === "readLater") return paper.readLater;
    return false;
  });

  const empty = emptyStateConfig[activeTab];

  return (
    <div className="p-7">
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">
        Library
      </h1>

      <div className="flex gap-2 mt-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-[7px] text-[13px] font-medium rounded-pill transition-colors ${
              activeTab === tab.id
                ? "bg-orange text-white"
                : "bg-card-surface text-muted-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredPapers.length === 0 ? (
        <EmptyState
          message={empty.message}
          actionLabel={empty.actionLabel}
          actionHref={empty.href}
        />
      ) : (
        <div className="mt-6 space-y-0">
          {filteredPapers.map((paper: Paper) => (
            <div
              key={paper.id}
              onClick={() => router.push(`/paper/${paper.id}`)}
              className="flex items-center gap-4 py-4 border-b border-border-warm/30 cursor-pointer hover:bg-light-surface/50 transition-colors px-2 -mx-2 rounded-[8px]"
            >
              <div
                className="w-1 h-10 rounded-[2px] flex-shrink-0"
                style={{ backgroundColor: paper.specialtyColor }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-heading text-[16px] text-espresso tracking-heading-card leading-[1.35]">
                  {paper.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[12px] text-muted-text tracking-body">
                    {paper.journal} · {paper.year} · {paper.specialty}
                  </span>
                  <StarsRating rating={paper.evidenceRating} size={11} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
