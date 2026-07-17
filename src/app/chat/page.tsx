"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUp, Sparkles, GitCompare, FileText, Scale } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";

const suggestions = [
  { label: "Compare treatments", icon: GitCompare },
  { label: "Summarize RCT", icon: FileText },
  { label: "Find guidelines", icon: Search },
  { label: "Risk vs benefit", icon: Scale },
];

export default function NewChatPage() {
  const router = useRouter();
  const createSession = useChatStore((s) => s.createSession);
  const addMessage = useChatStore((s) => s.addMessage);
  const [query, setQuery] = useState("");

  function handleSubmit(text?: string) {
    const q = (text ?? query).trim();
    if (!q) return;
    const sessionId = createSession(q);
    addMessage(sessionId, { role: "user", content: q });
    router.push(`/chat/${sessionId}`);
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-[720px] px-6 text-center">
        {/* Logo */}
        <h1 className="font-heading text-[56px] text-espresso tracking-heading-tight">
          SciSpark
        </h1>
        <p className="text-[14px] text-muted-text tracking-body mt-1">
          AI-powered research assistant
        </p>

        {/* Search box */}
        <div className="mt-8">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="bg-light-surface border border-border-warm rounded-[16px] px-5 pt-4 pb-3">
              <div className="flex items-start gap-3">
                <Search size={18} className="text-muted-text flex-shrink-0 mt-1" />
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="Ask about papers, methods, or your research questions"
                  rows={2}
                  className="flex-1 text-[16px] text-espresso tracking-body placeholder:text-muted-text bg-transparent focus:outline-none resize-none"
                />
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-3 text-muted-text">
                  <button type="button" className="hover:text-espresso transition">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition flex-shrink-0 ${
                    query.trim()
                      ? "bg-orange text-white hover:bg-orange/90"
                      : "bg-card-surface text-muted-text"
                  }`}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Suggestion chips */}
        <div className="flex justify-center gap-2 mt-5">
          {suggestions.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                onClick={() => handleSubmit(s.label)}
                className="bg-card-surface border border-border-warm rounded-pill px-3 py-1.5 text-[13px] text-espresso hover:bg-border-warm transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Icon size={14} className="text-orange" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
