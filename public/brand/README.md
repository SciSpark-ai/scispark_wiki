# SciSpark header artwork

## Current asset

`scispark-wordmark-transparent.png` is a 1774×887 RGBA PNG extracted from the
user's original editorial concept using the built-in imagegen tool on 2026-09-09.
The output has real alpha, including letter counters. It is an edited raster
asset, not a claim of original vector art or a byte-identical pixel extraction.

BrandLogo frames its transparent safety margin (x=42, y=148, w=1690, h=612) at
the existing 108px header width. No background or mix-blend-mode is used. Dark
mode reverses the ink while preserving alpha. Next Image keeps its alpha intact.

Source reference: `design/SciSpark Logo Concept - Editorial #1.png`.
Built-in output retained at:
`~/.codex/generated_images/01a08869-6f5f-7420-a59c-cf38bc674972/exec-cb627df4-9e3c-4f6b-a493-94caaa2179fa.png`.

### Extraction prompt

Edit target: the supplied SciSpark original logo concept. Task: background-extraction for a production app-header asset. Extract ONLY the exact black SciSpark wordmark and its four-point spark above the i onto a genuinely transparent alpha background. Remove the paper/white background entirely, including inside letter counters. Remove the horizontal rule and IGNITING KNOWLEDGE tagline below. Preserve the original letterforms, capitalization (SciSpark), kerning, wordmark proportions, stroke weights, and exact spark position and shape as faithfully as possible. Do not redesign, reinterpret, change fonts, re-letter, add outlines, shadows, glow, grain, gradients, or a white matte. The ink should be solid black with clean antialiased alpha edges. Crop closely around the wordmark and spark with a small even transparent safety margin. Output a high-resolution wide transparent PNG suitable for sharp display at 108px CSS width. No explanatory text or contact sheet.

## Superseded source-backed rendering

`scispark-editorial-source.png` is the unchanged original source copy retained
for provenance. It is no longer consumed by BrandLogo. Its SHA-256 matches the
source: `ed8cf8132e5a3ebc3a1ab568f5489ff8b0a3312b50b020e76f7087f5cef18e74`.
The old multiply/screen compositing approach did not remove the paper background
and produced a visible surface mismatch. Do not restore it.
