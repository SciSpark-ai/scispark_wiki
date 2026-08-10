// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProjectNote } from "@/stores/notes-store";
import { NoteEditorModal } from "../NoteEditorModal";

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function note(id: string, title: string, content: string): ProjectNote {
  return {
    id,
    projectId: "project-1",
    title,
    content,
    createdAt: 1,
    updatedAt: 1,
  };
}

function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  roots.push(root);
  return {
    host,
    rerender: (next: React.ReactElement) => act(() => root.render(next)),
  };
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.innerHTML = "";
});

describe("NoteEditorModal", () => {
  it("starts a fresh draft when a different note is loaded", async () => {
    const first = note("note-1", "First title", "First content");
    const second = note("note-2", "Second title", "Second content");
    const props = { open: true, onClose: vi.fn(), onDelete: vi.fn() };
    const { host, rerender } = mount(<NoteEditorModal note={first} {...props} />);

    const firstInput = host.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(firstInput, "Unsaved first draft");
      firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    rerender(<NoteEditorModal note={second} {...props} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect((host.querySelector("input") as HTMLInputElement).value).toBe("Second title");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Second content");
  });
});
