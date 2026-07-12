"use client";

import { useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/hooks/useOnboarding";
import { AIMessage } from "./AIMessage";
import { UserMessage } from "./UserMessage";
import { SelectionChips } from "./SelectionChips";
import { motion } from "framer-motion";

export function OnboardingChat() {
  const {
    messages,
    currentQuestion,
    completed,
    submitAnswer,
    finishOnboarding,
  } = useOnboarding();

  const bottomRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleInputSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inputValue.trim() && currentQuestion) {
      submitAnswer(inputValue.trim());
      setInputValue("");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-12 space-y-8">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.type === "ai" ? (
                <AIMessage text={msg.text} />
              ) : (
                <UserMessage text={msg.text} />
              )}
            </div>
          ))}

          {/* Chips inline in the flow */}
          {!completed && currentQuestion && (
            <SelectionChips
              key={currentQuestion.key}
              options={currentQuestion.options}
              multiSelect={currentQuestion.multiSelect}
              onSubmit={submitAnswer}
            />
          )}

          {/* Completion CTA */}
          {completed && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8"
            >
              <button
                onClick={finishOnboarding}
                className="px-8 py-3 rounded-pill bg-orange text-white text-[16px] font-medium hover:bg-orange/90 transition"
              >
                Explore your feed →
              </button>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Pinned bottom text input */}
      {!completed && (
        <div className="border-t border-border-warm/30 bg-page-bg">
          <div className="max-w-3xl mx-auto px-8 py-4">
            <form onSubmit={handleInputSubmit}>
              <div className="bg-white border border-border-warm/25 rounded-[18px] px-5 pt-4 pb-3">
                {/* Input row */}
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Type your answer..."
                  className="w-full text-[16px] text-espresso tracking-body placeholder:text-muted-text bg-transparent focus:outline-none mb-3"
                />
                {/* Action row */}
                <div className="flex items-center justify-between">
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
                      inputValue.trim()
                        ? "bg-orange text-white hover:bg-orange/90"
                        : "bg-card-surface text-muted-text"
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
