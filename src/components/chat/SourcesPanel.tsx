"use client";

import { X, ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";

interface ChatSource {
  title: string;
  journal: string;
  url: string;
}

interface SourcesPanelProps {
  sources: ChatSource[];
  onClose: () => void;
  highlightedIndex?: number;
}

export function SourcesPanel({
  sources,
  onClose,
  highlightedIndex,
}: SourcesPanelProps) {
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    if (highlightedIndex == null) return;
    itemRefs.current[highlightedIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [highlightedIndex]);

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b border-border-warm/30">
        <span className="text-[14px] text-espresso font-bold">
          {sources.length} sources
        </span>
        <button
          onClick={onClose}
          className="p-1.5 text-muted-text hover:text-espresso transition-colors rounded-[6px] hover:bg-card-surface/50"
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div>
        {sources.map((source, index) => {
          const isHighlighted = highlightedIndex === index;
          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={`group block px-4 py-3 border-b border-border-warm/30 last:border-b-0 cursor-pointer transition-colors ${
                isHighlighted
                  ? "bg-orange/10 border-l-2 border-l-orange"
                  : "hover:bg-light-surface"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-[2px] inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-[6px] text-[11px] font-semibold flex-shrink-0 transition-colors ${
                    isHighlighted
                      ? "bg-orange text-white"
                      : "bg-card-surface text-muted-text group-hover:bg-orange/10 group-hover:text-orange"
                  }`}
                >
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-muted-text truncate">
                      {source.journal}
                    </span>
                    <ExternalLink
                      size={11}
                      className="text-muted-text/60 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    />
                  </div>
                  <p
                    className={`text-[14px] leading-[1.4] mt-1 ${
                      isHighlighted ? "text-espresso font-medium" : "text-espresso"
                    }`}
                  >
                    {source.title}
                  </p>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
