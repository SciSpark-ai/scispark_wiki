"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ExternalLink,
  Heart,
  Bookmark,
  Clock,
  Sparkles,
  Copy,
  Code,
  FileText,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { ShareButton } from "@/components/shared/ShareButton";
import { SaveToProjectMenu } from "@/components/papers/SaveToProjectMenu";
import { mockPapers } from "@/lib/mock-data/papers";
import { usePaperActionsStore } from "@/stores/paper-actions-store";
import { useProjectPapersStore } from "@/stores/project-papers-store";

export default function PaperPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const paper = mockPapers.find((p) => p.id === id);

  const flags = usePaperActionsStore((s) =>
    id ? s.actions[id] : undefined
  );
  const toggleAction = usePaperActionsStore((s) => s.toggle);
  const isPaperInAnyProject = useProjectPapersStore(
    (s) => paper && Object.values(s.membership).some((arr) => arr.includes(paper.id))
  );
  const liked = flags?.liked ?? paper?.liked ?? false;
  const saved = (flags?.saved ?? paper?.saved ?? false) || !!isPaperInAnyProject;
  const readLater = flags?.readLater ?? paper?.readLater ?? false;
  const [summaryTab, setSummaryTab] = useState<"lay" | "abstract">("lay");
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);

  if (!paper) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[16px] text-espresso">Paper not found.</p>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[14px] text-muted-text hover:text-espresso transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto bg-page-bg">
        <div
          className="max-w-4xl mx-auto px-8 py-6"
          data-note-source="paper"
          data-note-source-id={paper.id}
          data-note-source-label={paper.title}
        >
          {/* Back button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-[14px] text-muted-text hover:text-espresso transition-colors mb-6"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          {/* Header */}
          <div>
            <h1 className="font-heading text-[28px] font-normal text-espresso leading-[1.3] tracking-heading">
              {paper.title}
            </h1>
            {paper.originalTitle && (
              <p className="font-heading text-[18px] text-muted-text tracking-heading-card leading-[1.4] mt-3">
                <span className="text-[12px] uppercase tracking-[0.12em] text-muted-text/70 align-middle mr-2">
                  Original title
                </span>
                {paper.originalTitle}
              </p>
            )}
            {paper.specialty && (
              <p className="text-[13px] text-muted-text mt-1">
                {paper.specialty}
              </p>
            )}

            {/* Published row */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-[14px] text-muted-text tracking-body">
                Published in{" "}
                <span className="text-orange font-medium">{paper.journal}</span>{" "}
                {paper.year}
                {paper.citations != null && (
                  <>
                    {" · "}
                    <span className="text-espresso font-bold">
                      {paper.citations.toLocaleString()}
                    </span>{" "}
                    citations
                  </>
                )}
              </p>
              <a
                href={paper.paperUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 border border-border-warm rounded-[10px] text-[13px] text-espresso hover:bg-card-surface transition-colors"
              >
                <ExternalLink size={14} />
                View Full Paper
              </a>
            </div>
          </div>

          {/* Author byline */}
          {paper.authors && paper.authors.length > 0 && (
            <p className="mt-3 text-[13px] text-muted-text tracking-body">
              <span className="text-muted-text/70">By </span>
              {paper.authors.join(" · ")}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => toggleAction(paper.id, "liked")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-pill text-[13px] transition-colors ${
                liked
                  ? "bg-orange text-white"
                  : "border border-border-warm text-espresso hover:bg-card-surface"
              }`}
            >
              <Heart size={14} className={liked ? "fill-current" : ""} />
              Like
            </button>
            <div className="relative">
              <button
                onClick={() => setSaveMenuOpen((v) => !v)}
                aria-expanded={saveMenuOpen}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-pill text-[13px] transition-colors ${
                  saved
                    ? "bg-orange text-white"
                    : "border border-border-warm text-espresso hover:bg-card-surface"
                }`}
              >
                <Bookmark size={14} className={saved ? "fill-current" : ""} />
                Save
              </button>
              <SaveToProjectMenu
                paperId={paper.id}
                open={saveMenuOpen}
                onClose={() => setSaveMenuOpen(false)}
              />
            </div>
            <button
              onClick={() => toggleAction(paper.id, "readLater")}
              aria-pressed={readLater}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-pill text-[13px] transition-colors ${
                readLater
                  ? "bg-orange text-white"
                  : "border border-border-warm text-espresso hover:bg-card-surface"
              }`}
            >
              <Clock size={14} />
              Read Later
            </button>
            <ShareButton title={`${(paper as { title?: string }).title ?? "Paper"} · SciSpark`} />
          </div>

          {/* AI Summary card */}
          <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-orange" />
              <h2 className="font-heading text-[18px] text-espresso">
                AI Summary
              </h2>
            </div>

            {/* Tab switcher */}
            <div className="flex border border-border-warm/30 rounded-[10px] overflow-hidden mb-4">
              <button
                onClick={() => setSummaryTab("lay")}
                className={`flex-1 py-2.5 text-[14px] text-center transition-colors ${
                  summaryTab === "lay"
                    ? "bg-white text-espresso font-medium"
                    : "bg-light-surface text-muted-text"
                }`}
              >
                Lay Summary
              </button>
              <button
                onClick={() => setSummaryTab("abstract")}
                className={`flex-1 py-2.5 text-[14px] text-center transition-colors ${
                  summaryTab === "abstract"
                    ? "bg-white text-espresso font-medium"
                    : "bg-light-surface text-muted-text"
                }`}
              >
                Original Abstract
              </button>
            </div>

            {/* Summary content */}
            <p className="text-[15px] text-espresso leading-[1.7] tracking-body">
              {summaryTab === "lay"
                ? paper.laySummary ?? paper.tldr ?? paper.summary
                : paper.originalAbstract ?? paper.summary}
            </p>

            {/* Copy button */}
            <button className="flex items-center gap-1.5 mt-4 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-muted-text hover:text-espresso transition-colors">
              <Copy size={14} />
              Copy Summary
            </button>
          </div>

          {/* Figure Digest card */}
          {paper.figureDigest && (
            <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-6">
              <h2 className="font-heading text-[18px] text-espresso mb-4">
                Figure Digest
              </h2>
              <div className="flex gap-6">
                <div className="w-[40%] bg-light-surface rounded-[10px] flex items-center justify-center min-h-[200px]">
                  <p className="text-[14px] text-muted-text text-center px-4">
                    {paper.figureDigest.caption}
                  </p>
                </div>
                <div className="flex-1 space-y-3">
                  {paper.figureDigest.findings.map((finding, i) => (
                    <div
                      key={i}
                      className="flex gap-2 text-[14px] text-espresso leading-[1.6]"
                    >
                      <span className="text-orange mt-0.5 flex-shrink-0">
                        •
                      </span>
                      {finding}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Key Breakpoints & Methods card */}
          {paper.breakpoints && paper.breakpoints.length > 0 && (
            <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-6">
              <h2 className="font-heading text-[18px] text-espresso mb-5">
                Key Breakpoints & Methods
              </h2>
              {paper.breakpoints.map((bp, i) => (
                <div key={i} className="flex gap-4 mb-5 last:mb-0">
                  <div className="w-7 h-7 rounded-full bg-orange text-white text-[12px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-[15px] text-orange font-medium">
                      {bp.label}
                    </p>
                    <p className="text-[14px] text-espresso leading-[1.6] tracking-body mt-1">
                      {bp.content}
                    </p>
                    {bp.evidence && (
                      <p className="text-[12px] text-muted-text mt-1">
                        {bp.evidence}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Bottom links */}
              {(paper.dataLinks?.code || paper.dataLinks?.data) && (
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border-warm/30">
                  {paper.dataLinks?.code && (
                    <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-espresso hover:bg-card-surface transition-colors">
                      <Code size={14} />
                      Code
                    </button>
                  )}
                  {paper.dataLinks?.data && (
                    <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-espresso hover:bg-card-surface transition-colors">
                      <FileText size={14} />
                      Data:{" "}
                      {paper.dataLinks.data.length > 40
                        ? paper.dataLinks.data.slice(0, 40) + "…"
                        : paper.dataLinks.data}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Related & Extended */}
          {paper.relatedPapers && paper.relatedPapers.length > 0 && (
            <div className="mt-8">
              <h2 className="font-heading text-[18px] text-espresso mb-4">
                Related & Extended
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {paper.relatedPapers.map((rel, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-[14px] border border-border-warm/30 overflow-hidden"
                  >
                    <div className="h-[140px] bg-light-surface relative">
                      <span className="absolute top-3 left-3 bg-[#0ea5e9] text-white text-[11px] font-medium px-2 py-0.5 rounded-[6px]">
                        Related
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="text-[14px] text-espresso font-medium leading-[1.4] line-clamp-2">
                        {rel.title}
                      </p>
                      <p className="text-[12px] text-muted-text mt-1.5">
                        {rel.journal} · {rel.year}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Citation card */}
          <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-6">
            <h2 className="font-heading text-[18px] text-espresso mb-4">
              Quick Citation
            </h2>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-espresso hover:bg-card-surface transition-colors">
                <Copy size={14} />
                Copy BibTeX
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-espresso hover:bg-card-surface transition-colors">
                <Copy size={14} />
                Copy APA
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border-warm rounded-[8px] text-[13px] text-espresso hover:bg-card-surface transition-colors">
                <ExternalLink size={14} />
                Export to Zotero
              </button>
            </div>
          </div>

          {/* Relevance feedback card */}
          <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-6 mb-8 text-center">
            <h3 className="font-heading text-[16px] text-espresso font-medium">
              Is this paper relevant to you?
            </h3>
            <p className="text-[13px] text-muted-text mt-1">
              Giving feedback helps us give you better paper recommendations.
            </p>
            <div className="flex items-center justify-center gap-4 mt-4">
              <button className="flex items-center gap-2 px-6 py-2.5 border border-border-warm rounded-[10px] text-[14px] text-espresso hover:bg-card-surface transition-colors">
                <ThumbsUp size={16} />
                Yes
              </button>
              <button className="flex items-center gap-2 px-6 py-2.5 border border-border-warm rounded-[10px] text-[14px] text-espresso hover:bg-card-surface transition-colors">
                <ThumbsDown size={16} />
                No
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pinned AI chat input */}
      <div className="border-t border-border-warm/30 bg-page-bg">
        <div className="max-w-4xl mx-auto px-8 py-4">
          <div className="bg-white border border-border-warm/25 rounded-[18px] px-5 pt-4 pb-3">
            <input
              type="text"
              placeholder="Ask a question about this paper"
              className="w-full text-[16px] text-espresso tracking-body placeholder:text-muted-text bg-transparent focus:outline-none mb-3"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-muted-text">
                <button type="button" className="hover:text-espresso transition">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
              <button className="w-10 h-10 rounded-full flex items-center justify-center bg-card-surface text-muted-text flex-shrink-0">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
