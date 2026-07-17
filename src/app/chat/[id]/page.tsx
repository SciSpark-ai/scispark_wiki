"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  Download,
  Copy,
  FileText,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  ArrowUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { useChat } from "@/hooks/useChat";
import { useUIStore } from "@/stores/ui-store";
import { SourcesPanel } from "@/components/chat/SourcesPanel";
import { ShareButton } from "@/components/shared/ShareButton";
import ReasoningAnimation, {
  CompletedReasoning,
} from "@/components/chat/ReasoningAnimation";
import type { ChatMessage, ChatSource } from "@/stores/chat-store";

export default function ChatThreadPage() {
  const params = useParams();
  const sessionId = params?.id as string;
  const { session, isLoading, sendMessage, streamingId, clearStreaming } =
    useChat(sessionId);

  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const setShowRightPanel = useUIStore((s) => s.setShowRightPanel);

  const [input, setInput] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or loading state
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages, isLoading]);

  // Keep view pinned to bottom while a message is streaming in
  useEffect(() => {
    if (!streamingId) return;
    const interval = setInterval(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 280);
    return () => clearInterval(interval);
  }, [streamingId]);

  // Clear right panel on unmount
  useEffect(() => {
    return () => {
      setRightPanel(null);
      setShowRightPanel(false);
    };
  }, [setRightPanel, setShowRightPanel]);

  // Show reasoning when loading starts
  useEffect(() => {
    if (isLoading) {
      setShowReasoning(true);
    }
  }, [isLoading]);

  function handleSubmit(text?: string) {
    const q = (text ?? input).trim();
    if (!q || isLoading) return;
    setInput("");
    sendMessage(q);
  }

  function openSources(sources: ChatSource[], highlightIndex?: number) {
    setRightPanel(
      <SourcesPanel
        sources={sources}
        highlightedIndex={highlightIndex}
        onClose={() => {
          setRightPanel(null);
          setShowRightPanel(false);
        }}
      />
    );
    setShowRightPanel(true);
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[16px] text-muted-text">Chat session not found.</p>
      </div>
    );
  }

  const messages = session.messages;
  const lastMessage = messages[messages.length - 1];
  const showFollowUps =
    !isLoading &&
    streamingId === null &&
    lastMessage?.role === "assistant" &&
    lastMessage.followUps &&
    lastMessage.followUps.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <UserBubble text={msg.content} />
              ) : (
                <AssistantMessage
                  message={msg}
                  isStreaming={streamingId === msg.id}
                  onStreamComplete={clearStreaming}
                  onOpenSources={(index?: number) =>
                    msg.sources && openSources(msg.sources, index)
                  }
                />
              )}
            </div>
          ))}

          {/* Reasoning animation */}
          <ReasoningAnimation
            isVisible={showReasoning && isLoading}
            onComplete={() => setShowReasoning(false)}
          />

          {/* Follow-up suggestions */}
          {showFollowUps && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="space-y-2"
            >
              {lastMessage.followUps!.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(suggestion)}
                  className="w-full border border-border-warm rounded-[10px] px-4 py-3 text-[14px] text-muted-text hover:bg-light-surface transition-colors cursor-pointer flex items-center gap-2 text-left"
                >
                  <ArrowRight size={14} className="text-orange flex-shrink-0" />
                  {suggestion}
                </button>
              ))}
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Pinned input bar */}
      <div className="border-t border-border-warm/30 bg-page-bg">
        <div className="max-w-3xl mx-auto px-8 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="bg-light-surface border border-border-warm/25 rounded-[18px] px-5 pt-4 pb-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a follow-up..."
                className="w-full text-[16px] text-espresso tracking-body placeholder:text-muted-text bg-transparent focus:outline-none mb-3"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-muted-text">
                  <button type="button" className="hover:text-espresso transition">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition flex-shrink-0 ${
                    input.trim()
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
      </div>
    </div>
  );
}

/* ── Inline-citation renderer: turns [N] tokens into clickable chips ── */

function renderWithCitations(
  text: string,
  sourceCount: number,
  onCite: (index: number) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const matches = Array.from(text.matchAll(/\[(\d+)\]/g));
  let cursor = 0;
  let keyCounter = 0;

  for (const m of matches) {
    const start = m.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const n = parseInt(m[1], 10);
    const idx = n - 1;
    if (idx >= 0 && idx < sourceCount) {
      nodes.push(
        <button
          key={`cite-${keyCounter++}-${start}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCite(idx);
          }}
          className="inline-flex items-center justify-center align-baseline mx-0.5 px-1.5 py-0 min-w-[20px] h-[18px] rounded-[5px] text-[11px] font-semibold text-orange bg-orange/10 hover:bg-orange hover:text-white transition-colors cursor-pointer leading-none"
          aria-label={`Citation ${n}`}
        >
          {n}
        </button>
      );
    } else {
      nodes.push(m[0]);
    }
    cursor = start + m[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/* ── Sub-components ── */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-page-warm rounded-[14px] px-6 py-3 max-w-lg">
        <p className="text-[15px] text-espresso font-medium tracking-body">
          {text}
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  isStreaming,
  onStreamComplete,
  onOpenSources,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  onStreamComplete: () => void;
  onOpenSources: (index?: number) => void;
}) {
  const sourceCount = message.sources?.length ?? 0;
  const sections = message.sections;
  const sources = message.sources ?? [];

  const { sectionIdx, partial, done } = useSectionTypewriter(
    sections ?? null,
    isStreaming
  );

  useEffect(() => {
    if (isStreaming && done) onStreamComplete();
  }, [isStreaming, done, onStreamComplete]);

  return (
    <div>
      {/* Persisted reasoning trace */}
      <CompletedReasoning />

      {/* Structured sections */}
      {sections ? (
        <div
          className="space-y-5"
          data-note-source="chat"
          data-note-source-id={message.id}
          data-note-source-label={`Chat answer · ${new Date(message.timestamp).toLocaleDateString()}`}
        >
          {sections.map((section, i) => {
            if (isStreaming && i > sectionIdx) return null;
            const isCurrent = isStreaming && i === sectionIdx;
            const bodyText = isCurrent ? partial : section.body;

            return (
              <div key={i}>
                <h3 className="font-heading text-[18px] text-espresso tracking-heading-card mb-2">
                  {section.heading}
                </h3>
                <p className="text-[15px] text-espresso leading-[1.75] tracking-body">
                  {renderWithCitations(bodyText, sources.length, (idx) =>
                    onOpenSources(idx)
                  )}
                  {isCurrent && (
                    <span className="inline-block w-[2px] h-[1em] bg-orange align-middle ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="text-[15px] text-espresso leading-[1.75] tracking-body whitespace-pre-line"
          data-note-source="chat"
          data-note-source-id={message.id}
          data-note-source-label={`Chat answer · ${new Date(message.timestamp).toLocaleDateString()}`}
        >
          {renderWithCitations(message.content, sources.length, (idx) =>
            onOpenSources(idx)
          )}
        </p>
      )}

      {/* Action bar — hidden until streaming finishes */}
      {!isStreaming && (
        <div className="border-t border-border-warm/30 pt-3 mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-muted-text">
            <ShareButton variant="icon" title="A SciSpark chat" />
            <button className="hover:text-orange transition-colors">
              <Download size={16} />
            </button>
            <button className="hover:text-orange transition-colors">
              <Copy size={16} />
            </button>
          </div>

          {sourceCount > 0 && (
            <button
              onClick={() => onOpenSources()}
              className="bg-orange text-white rounded-pill px-3 py-1 text-[12px] font-medium flex items-center gap-1.5 hover:bg-orange/90 transition-colors"
            >
              <FileText size={12} />
              {sourceCount} sources
            </button>
          )}

          <div className="flex items-center gap-3 text-muted-text">
            <button className="hover:text-orange transition-colors">
              <ThumbsUp size={16} />
            </button>
            <button className="hover:text-orange transition-colors">
              <ThumbsDown size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Streaming typewriter over multi-section content ──
   - rAF-driven reveal so each frame advances by exactly the elapsed time,
     not a fixed tick → no chunky stepping
   - Character-level so words don't pop in all at once
   - Tiny extra pauses on punctuation for natural breath
   - Soft inter-section gap (60 ms) almost imperceptible
*/

const CHARS_PER_SECOND = 110;
const SECTION_GAP_MS = 60;
const PUNCT_PAUSE_MS: Record<string, number> = {
  ",": 35,
  ";": 50,
  ":": 50,
  ".": 90,
  "!": 90,
  "?": 90,
};

function useSectionTypewriter(
  sections: { heading: string; body: string }[] | null,
  enabled: boolean
) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [partial, setPartial] = useState("");

  useEffect(() => {
    if (!enabled || !sections || sections.length === 0) {
      setSectionIdx(0);
      setPartial("");
      return;
    }

    let raf = 0;
    let currentSection = 0;
    let revealed = 0;
    let pausedUntil = 0;
    let lastFrameAt = performance.now();

    setSectionIdx(0);
    setPartial("");

    const tick = (now: number) => {
      if (currentSection >= sections.length) return;

      const body = sections[currentSection].body;

      // Honor any active pause without retracting text.
      if (now < pausedUntil) {
        lastFrameAt = now;
        raf = requestAnimationFrame(tick);
        return;
      }

      const dt = (now - lastFrameAt) / 1000;
      lastFrameAt = now;

      let nextRevealed = Math.min(
        revealed + Math.max(1, Math.ceil(dt * CHARS_PER_SECOND)),
        body.length
      );

      // If we just stepped over punctuation, stop there and schedule a hold.
      for (let i = revealed + 1; i <= nextRevealed; i++) {
        const ch = body[i - 1];
        const pause = PUNCT_PAUSE_MS[ch];
        if (pause) {
          nextRevealed = i;
          pausedUntil = now + pause;
          break;
        }
      }

      if (nextRevealed !== revealed) {
        revealed = nextRevealed;
        setSectionIdx(currentSection);
        setPartial(body.slice(0, revealed));
      }

      if (revealed >= body.length) {
        // Section complete → soft gap, then advance.
        const advanceAt = now + SECTION_GAP_MS;
        const wait = (innerNow: number) => {
          if (innerNow >= advanceAt) {
            currentSection += 1;
            if (currentSection >= sections.length) {
              setSectionIdx(currentSection);
              return;
            }
            revealed = 0;
            pausedUntil = 0;
            lastFrameAt = performance.now();
            raf = requestAnimationFrame(tick);
          } else {
            raf = requestAnimationFrame(wait);
          }
        };
        raf = requestAnimationFrame(wait);
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, sections]);

  const done = !enabled || !sections || sectionIdx >= sections.length;
  return { sectionIdx, partial, done };
}
