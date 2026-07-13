"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { joinPageText } from "@/lib/reader/pdf-text";
import styles from "./PdfSurface.module.css";

export interface PdfSurfaceProps {
  bytes: Uint8Array;
  /** Concatenated selectable text for the whole document, emitted once
   * every page has rendered — the anchor core (DOM-agnostic) works
   * identically against this string as it does for the HTML surface. */
  onPlainText: (text: string) => void;
  /** Overlay hook: called with the same surface text passed to
   * `onPlainText` once it is known; its return value is rendered above the
   * pages (Task 7 supplies the actual highlight rendering). */
  renderHighlights: (surfaceText: string) => ReactNode;
  /** Called whenever the user completes a non-empty text selection inside
   * the surface, with `[start, end)` offsets into the same plain-text
   * string emitted via `onPlainText`. */
  onSelect: (start: number, end: number, selectedText: string) => void;
}

/** Separator inserted between pages' text in the concatenated surface
 * string. Chosen to be visually distinct in a plain-text dump without
 * perturbing single-page offset math (joinPageText itself never emits
 * anything but a single space). */
const PAGE_SEPARATOR = "\n\n";

/** Default render scale (CSS px per PDF unit) for canvas + text layer. */
const RENDER_SCALE = 1.5;

type LoadState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

interface PageLayout {
  /** This page's text as produced by joinPageText. */
  text: string;
  /** itemOffsets from joinPageText, one per getTextContent() item. */
  itemOffsets: number[];
  /** Offset of this page's text within the full concatenated surface
   * string (i.e. where `text` begins after all earlier pages + separators). */
  startOffset: number;
}

/** Minimal shape of the pdf.js namespace this component actually uses,
 * kept local so nothing here needs a value-level `import "pdfjs-dist"` at
 * module scope (pdf.js touches DOMMatrix/canvas and must never load outside
 * the browser — see the M6 plan's SSR constraint for this task). All real
 * typing comes from the dynamic `await import("pdfjs-dist")` below; this
 * alias only exists so callback closures don't have to repeat `awaited`
 * inline types. */
type PdfjsModule = typeof import("pdfjs-dist");
type PdfLoadingTask = ReturnType<PdfjsModule["getDocument"]>;

/**
 * Maps a DOM selection endpoint (a Range's start/end container + offset)
 * back to an index into the full concatenated surface string.
 *
 * Relies on two data attributes stamped onto pdf.js's own generated DOM
 * after each page's TextLayer.render() resolves:
 *  - `data-page-index` on the page's text-layer container.
 *  - `data-item-index` on each per-item <span> (TextLayer.textDivs, which
 *    is 1:1 and order-aligned with the getTextContent() items passed to
 *    joinPageText for that page — see PdfSurface's render loop).
 *
 * Returns null when the point isn't inside a tracked item (e.g. the
 * selection lands in page padding) rather than guessing.
 */
function domPointToOffset(node: Node, offset: number, layouts: PageLayout[]): number | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
  if (!element) return null;

  const itemEl = element.closest<HTMLElement>("[data-item-index]");
  const pageEl = element.closest<HTMLElement>("[data-page-index]");
  if (!itemEl || !pageEl) return null;

  const pageIndex = Number(pageEl.dataset.pageIndex);
  const itemIndex = Number(itemEl.dataset.itemIndex);
  const layout = layouts[pageIndex];
  if (!layout || Number.isNaN(itemIndex)) return null;

  const itemStart = layout.itemOffsets[itemIndex];
  if (itemStart == null) return null;

  // If the range point landed on the item's text node directly, `offset`
  // is already a character offset into that text. If it landed on the
  // <span> element itself (can happen at item boundaries), `offset`
  // counts child nodes instead: 0 means "before the text", anything else
  // means "after the text" (each item span has at most one text child).
  const withinItem =
    node.nodeType === Node.TEXT_NODE ? offset : offset > 0 ? (itemEl.textContent?.length ?? 0) : 0;

  return layout.startOffset + itemStart + withinItem;
}

/**
 * Renders a PDF's pages to canvas + a positioned, selectable text layer
 * (pdf.js's `TextLayer`), concatenates every page's text into one plain
 * string via `joinPageText`, and maps DOM text selections inside that text
 * layer back to `[start, end)` offsets in the concatenated string — the
 * same anchor-core contract the HTML reading surface uses.
 *
 * Must only ever run in the browser: pdf.js touches `DOMMatrix`/canvas, so
 * the pdfjs-dist import happens inside this effect (never at module scope),
 * and callers MUST load this component via
 * `next/dynamic(() => import("./PdfSurface"), { ssr: false })`.
 */
export default function PdfSurface({ bytes, onPlainText, renderHighlights, onSelect }: PdfSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutsRef = useRef<PageLayout[]>([]);
  const fullTextRef = useRef<string>("");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [plainText, setPlainText] = useState<string | null>(null);

  // Callback props are read from refs inside the load effect so the effect
  // itself only depends on `bytes` — a new function identity for
  // `onPlainText` on every parent render must not re-trigger a full PDF
  // reload.
  const onPlainTextRef = useRef(onPlainText);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onPlainTextRef.current = onPlainText;
  }, [onPlainText]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;

    async function run() {
      setState({ status: "loading" });
      setPlainText(null);
      fullTextRef.current = "";
      layoutsRef.current = [];

      const container = containerRef.current;
      if (!container) return;
      container.replaceChildren();

      try {
        const pdfjsLib = await import("pdfjs-dist");
        // The dynamic import always yields at least one microtask, during which
        // the effect may already have been torn down (guaranteed under React
        // Strict Mode's mount→cleanup→mount). Bail before creating a worker so
        // cleanup — which ran while loadingTask was still null — can't miss it.
        if (cancelled) return;
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        // getDocument({data}) transfers ownership of the TypedArray to the
        // worker thread (detaching its buffer) — copy so the caller's
        // `bytes` prop stays intact across StrictMode's double effect
        // invocation and any re-render that reuses the same array.
        const data = bytes.slice();
        loadingTask = pdfjsLib.getDocument({ data });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        const layouts: PageLayout[] = [];
        let runningOffset = 0;

        for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const outputScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

          const pageEl = document.createElement("div");
          pageEl.className = styles.page;
          pageEl.style.width = `${viewport.width}px`;
          pageEl.style.height = `${viewport.height}px`;

          const canvas = document.createElement("canvas");
          canvas.className = styles.canvas;
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          pageEl.appendChild(canvas);

          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = styles.textLayer;
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;
          textLayerDiv.dataset.pageIndex = String(layouts.length);
          pageEl.appendChild(textLayerDiv);

          container.appendChild(pageEl);

          const ctx = canvas.getContext("2d");
          if (ctx) {
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
            const renderTask = page.render({ canvas, canvasContext: ctx, viewport, transform });
            await renderTask.promise;
          }
          if (cancelled) return;

          const textContent = await page.getTextContent();
          // includeMarkedContent defaults to false, so every entry here is
          // a TextItem (has `str`) — the filter is defensive typing, not a
          // real filter in practice.
          const items = textContent.items.filter(
            (item): item is Extract<(typeof textContent.items)[number], { str: string }> =>
              typeof (item as { str?: unknown }).str === "string",
          );

          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          await textLayer.render();
          if (cancelled) return;

          textLayer.textDivs.forEach((div, idx) => {
            div.dataset.itemIndex = String(idx);
          });

          const { text: pageText, itemOffsets } = joinPageText(items);
          layouts.push({ text: pageText, itemOffsets, startOffset: runningOffset });
          runningOffset += pageText.length + PAGE_SEPARATOR.length;
        }

        if (cancelled) return;

        layoutsRef.current = layouts;
        const fullText = layouts.map((layout) => layout.text).join(PAGE_SEPARATOR);
        fullTextRef.current = fullText;
        setPlainText(fullText);
        onPlainTextRef.current(fullText);
        setState({ status: "ready" });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load PDF.",
          });
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
    // onPlainText/onSelect are read via refs, so their identity churn must not reload the PDF.
  }, [bytes]);

  const handleSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const layouts = layoutsRef.current;
    const startOffset = domPointToOffset(range.startContainer, range.startOffset, layouts);
    const endOffset = domPointToOffset(range.endContainer, range.endOffset, layouts);
    if (startOffset == null || endOffset == null) return;

    const start = Math.min(startOffset, endOffset);
    const end = Math.max(startOffset, endOffset);
    if (start === end) return;

    const selectedText = fullTextRef.current.slice(start, end);
    onSelectRef.current(start, end, selectedText);
  }, []);

  return (
    <div className={styles.root}>
      {state.status === "loading" && <div className={styles.status}>Loading PDF…</div>}
      {state.status === "error" && (
        <div className={styles.error} role="alert">
          Could not load PDF: {state.message}
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.pages}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
      />
      <div className={styles.highlightOverlay} aria-hidden={plainText == null}>
        {plainText != null ? renderHighlights(plainText) : null}
      </div>
    </div>
  );
}
