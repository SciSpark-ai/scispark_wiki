"use client";

import { X } from "lucide-react";

interface ChatSource {
  title: string;
  journal: string;
  url: string;
}

interface SourcesPanelProps {
  sources: ChatSource[];
  onClose: () => void;
}

export function SourcesPanel({ sources, onClose }: SourcesPanelProps) {
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
        {sources.map((source, index) => (
          <div
            key={index}
            className="px-4 py-3 border-b border-border-warm/30 last:border-b-0 hover:bg-light-surface transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warm-tan flex-shrink-0" />
              <span className="text-[12px] text-muted-text">{source.journal}</span>
            </div>
            <p className="text-[14px] text-espresso leading-[1.4] mt-1">
              {source.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
