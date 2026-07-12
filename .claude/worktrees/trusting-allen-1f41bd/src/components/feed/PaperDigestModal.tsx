"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Heart, Bookmark, Clock, Copy, Share2, ExternalLink } from "lucide-react";
import { GrainOverlay } from "@/components/shared/GrainOverlay";
import { StarsRating } from "@/components/shared/StarsRating";
import type { Paper } from "@/lib/mock-data/papers";

interface PaperDigestModalProps {
  paper: Paper | null;
  onClose: () => void;
}

const EASE_CARD = [0.22, 1, 0.36, 1] as const;

export function PaperDigestModal({ paper, onClose }: PaperDigestModalProps) {
  return (
    <AnimatePresence>
      {paper !== null && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ duration: 0.4, ease: EASE_CARD }}
          className="fixed inset-0 z-50 bg-page-bg overflow-y-auto"
        >
          {/* Back button */}
          <div className="px-8 pt-6">
            <button
              onClick={onClose}
              className="flex items-center gap-2 text-[14px] text-muted-text hover:text-espresso transition-colors"
            >
              <ArrowLeft size={16} />
              Back to feed
            </button>
          </div>

          {/* Specialty header bar */}
          <div
            className="h-12 relative flex items-center px-8 mt-4"
            style={{ backgroundColor: paper.specialtyColor }}
          >
            <GrainOverlay intensity="heavy" />
            <span className="relative text-white/90 text-[10px] font-medium uppercase tracking-[0.06em]">
              {paper.specialty}
            </span>
          </div>

          {/* Content area */}
          <div className="max-w-3xl mx-auto px-8 py-8">
            {/* Title */}
            <h1 className="font-heading text-[24px] font-normal text-espresso leading-[1.3]">
              {paper.title}
            </h1>

            {/* Authors + meta */}
            <p className="text-[14px] text-muted-text tracking-body mt-2">
              {paper.journal} · {paper.year} · {paper.authors.join(", ")}
            </p>

            {/* TL;DR */}
            <div className="bg-light-surface rounded-[14px] p-5 mt-6">
              <p className="text-[12px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
                TL;DR
              </p>
              <p className="text-[16px] text-espresso leading-[1.7] tracking-body">
                {paper.tldr}
              </p>
            </div>

            {/* Key Findings */}
            <div className="mt-6">
              <h2 className="font-heading text-[18px] text-espresso mb-3">Key Findings</h2>
              <ul className="space-y-2">
                {paper.keyFindings.map((finding, index) => (
                  <li key={index} className="flex gap-2 text-[15px] text-espresso leading-[1.6] tracking-body">
                    <span className="text-orange mt-1 flex-shrink-0">•</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Evidence */}
            <div className="mt-6 flex items-center gap-3">
              <StarsRating rating={paper.evidenceRating} size={14} />
              <span className="text-[13px] text-muted-text">Evidence Quality</span>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 mt-4">
              {paper.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-card-surface text-muted-text rounded-pill text-[12px] px-3 py-1"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Action bar */}
            <div className="border-t border-border-warm/30 mt-8 pt-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button className="text-muted-text hover:text-orange transition-colors">
                  <Heart size={16} />
                </button>
                <button className="text-muted-text hover:text-orange transition-colors">
                  <Bookmark size={16} />
                </button>
                <button className="text-muted-text hover:text-orange transition-colors">
                  <Clock size={16} />
                </button>
                <button className="text-muted-text hover:text-orange transition-colors">
                  <Copy size={16} />
                </button>
                <button className="text-muted-text hover:text-orange transition-colors">
                  <Share2 size={16} />
                </button>
              </div>
              <a
                href={paper.paperUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] text-orange font-medium flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                View Original <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
