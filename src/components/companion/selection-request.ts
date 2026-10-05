import type { ChatSelection } from "@/lib/chat/blocks"

export const SPARKY_SELECTION_REQUEST = "scispark:ask-selection"
export interface SparkySelectionRequest {
  id: string
  paperSlug: string
  selection: ChatSelection
}

/** The global companion owns the conversation; reading surfaces only hand off context. */
export function askSparkyAboutSelection(request: Omit<SparkySelectionRequest, "id">) {
  document.dispatchEvent(new CustomEvent<SparkySelectionRequest>(SPARKY_SELECTION_REQUEST, {
    detail: { ...request, id: crypto.randomUUID() },
  }))
}
