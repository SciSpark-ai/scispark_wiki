import { useState, useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat-store";
import { getMockResponse } from "@/lib/mock-data/chat-responses";

const MOCK_DELAY = 3000;

export function useChat(sessionId: string) {
  const session = useChatStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const addMessage = useChatStore((s) => s.addMessage);
  const [isLoading, setIsLoading] = useState(false);
  const hasTriggeredRef = useRef(false);

  // Auto-trigger AI response if last message is from user and no assistant reply yet
  useEffect(() => {
    if (!session || isLoading || hasTriggeredRef.current) return;

    const messages = session.messages;
    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    // Only auto-trigger if last message is user and there's no assistant message after it
    if (lastMsg.role === "user") {
      const hasAssistantReply = messages.some(
        (m) => m.role === "assistant" && m.timestamp > lastMsg.timestamp
      );
      if (!hasAssistantReply) {
        hasTriggeredRef.current = true;
        setIsLoading(true);
        setTimeout(() => {
          const mock = getMockResponse(lastMsg.content);
          const contentParts = mock.sections.map(
            (s) => `## ${s.heading}\n\n${s.body}`
          );
          addMessage(sessionId, {
            role: "assistant",
            content: contentParts.join("\n\n"),
            sources: mock.sources,
            sections: mock.sections,
            followUps: mock.followUps,
          });
          setIsLoading(false);
        }, MOCK_DELAY);
      }
    }
  }, [session, sessionId, addMessage, isLoading]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;

      addMessage(sessionId, {
        role: "user",
        content: text.trim(),
      });

      setIsLoading(true);
      hasTriggeredRef.current = false; // Allow auto-trigger for the new message
      setTimeout(() => {
        const mock = getMockResponse(text);
        const contentParts = mock.sections.map(
          (s) => `## ${s.heading}\n\n${s.body}`
        );
        addMessage(sessionId, {
          role: "assistant",
          content: contentParts.join("\n\n"),
          sources: mock.sources,
          sections: mock.sections,
          followUps: mock.followUps,
        });
        setIsLoading(false);
      }, MOCK_DELAY);
    },
    [sessionId, addMessage, isLoading]
  );

  return {
    session,
    isLoading,
    sendMessage,
  };
}
