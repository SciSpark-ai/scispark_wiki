"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  Share2,
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
import ReasoningAnimation from "@/components/chat/ReasoningAnimation";
import type { ChatMessage, ChatSource } from "@/stores/chat-store";

export default function ChatThreadPage() {
  const params = useParams();
  const sessionId = params?.id as string;
  const { session, isLoading, sendMessage } = useChat(sessionId);

  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const setShowRightPanel = useUIStore((s) => s.setShowRightPanel);

  const [input, setInput] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or loading state
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages, isLoading]);

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

  function openSources(sources: ChatSource[]) {
    setRightPanel(
      <SourcesPanel
        sources={sources}
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
                  onOpenSources={() =>
                    msg.sources && openSources(msg.sources)
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
            <div className="bg-white border border-border-warm/25 rounded-[18px] px-5 pt-4 pb-3">
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
  onOpenSources,
}: {
  message: ChatMessage;
  onOpenSources: () => void;
}) {
  const sourceCount = message.sources?.length ?? 0;

  return (
    <div>
      {/* Structured sections */}
      {message.sections ? (
        <div className="space-y-5">
          {message.sections.map((section, i) => (
            <div key={i}>
              <h3 className="font-heading text-[18px] text-espresso tracking-heading-card mb-2">
                {section.heading}
              </h3>
              <p className="text-[15px] text-espresso leading-[1.75] tracking-body">
                {section.body}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[15px] text-espresso leading-[1.75] tracking-body whitespace-pre-line">
          {message.content}
        </p>
      )}

      {/* Action bar */}
      <div className="border-t border-border-warm/30 pt-3 mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-muted-text">
          <button className="hover:text-orange transition-colors">
            <Share2 size={16} />
          </button>
          <button className="hover:text-orange transition-colors">
            <Download size={16} />
          </button>
          <button className="hover:text-orange transition-colors">
            <Copy size={16} />
          </button>
        </div>

        {sourceCount > 0 && (
          <button
            onClick={onOpenSources}
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
    </div>
  );
}
