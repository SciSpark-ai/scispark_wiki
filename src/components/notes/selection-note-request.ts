export const SELECTION_NOTE_REQUEST = "scispark:selection-note-request"

export interface SelectionNoteRequest {
  text: string
  top: number
  left: number
  kind: "paper" | "chat" | "manual"
  refId?: string
  refLabel?: string
}

/** Hand a snapshotted passage to the app's project-note picker. */
export function openSelectionNote(request: SelectionNoteRequest) {
  document.dispatchEvent(new CustomEvent(SELECTION_NOTE_REQUEST, { detail: request }))
}
