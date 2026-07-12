import { useState, useMemo, useEffect } from "react";
import { useUserStore } from "@/stores/user-store";
import { mockPapers, type Paper } from "@/lib/mock-data/papers";

export type FeedTab = "for-you" | "trending" | "by-specialty";

type PaperAction = {
  liked: boolean;
  saved: boolean;
  readLater: boolean;
};

export function useFeed() {
  const [activeTab, setActiveTab] = useState<FeedTab>("for-you");
  const [specialtyFilter, setSpecialtyFilter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [paperActions, setPaperActions] = useState<Record<string, PaperAction>>({});

  const userSpecialty = useUserStore((s) => s.preferences.specialty);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [activeTab, specialtyFilter]);

  const papers = useMemo<Paper[]>(() => {
    const merged = mockPapers.map((paper) => {
      const actions = paperActions[paper.id];
      if (!actions) return paper;
      return { ...paper, ...actions };
    });

    if (activeTab === "for-you") {
      return [...merged].sort((a, b) => {
        const aMatch = a.specialty === userSpecialty ? 0 : 1;
        const bMatch = b.specialty === userSpecialty ? 0 : 1;
        return aMatch - bMatch;
      });
    }

    if (activeTab === "trending") {
      return [...merged].sort((a, b) => b.evidenceRating - a.evidenceRating);
    }

    if (activeTab === "by-specialty") {
      if (specialtyFilter === null) return merged;
      return merged.filter((p) => p.specialty === specialtyFilter);
    }

    return merged;
  }, [activeTab, specialtyFilter, paperActions, userSpecialty]);

  const specialties = useMemo<string[]>(() => {
    const seen = new Set<string>();
    for (const paper of mockPapers) {
      if (paper.specialty) seen.add(paper.specialty);
    }
    return Array.from(seen);
  }, []);

  function toggleAction(id: string, action: "liked" | "saved" | "readLater") {
    setPaperActions((prev) => {
      const current: PaperAction = prev[id] ?? {
        liked: false,
        saved: false,
        readLater: false,
      };
      return {
        ...prev,
        [id]: {
          ...current,
          [action]: !current[action],
        },
      };
    });
  }

  return {
    papers,
    isLoading,
    activeTab,
    setActiveTab,
    specialtyFilter,
    setSpecialtyFilter,
    specialties,
    toggleAction,
  };
}
