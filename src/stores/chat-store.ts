import { create } from "zustand";

export interface ChatSource {
  title: string;
  journal: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  sections?: { heading: string; body: string }[];
  followUps?: string[];
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  sessions: ChatSession[];
  createSession: (question: string) => string;
  addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => string;
  getSession: (id: string) => ChatSession | undefined;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // No seed sessions: KB chat (/chat, /history) is still fork-mock and not part
  // of the v1 real surface, so the clinical seed conversations must not surface
  // as "Recent Chats" on the real pages. Real sessions are created on demand.
  sessions: [],

  createSession: (question: string) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const now = Date.now();
    const session: ChatSession = {
      id,
      title: question.slice(0, 50),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ sessions: [...state.sessions, session] }));
    return id;
  },

  addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => {
    const msgId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const now = Date.now();
    const newMessage: ChatMessage = {
      ...message,
      id: msgId,
      timestamp: now,
    };
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [...session.messages, newMessage],
              updatedAt: now,
            }
          : session
      ),
    }));
    return msgId;
  },

  getSession: (id: string) => {
    return get().sessions.find((session) => session.id === id);
  },

  renameSession: (id: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }));
  },

  deleteSession: (id: string) => {
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
    }));
  },
}));
