# Bundled application fonts

SciSpark uses `next/font/local` with these checked-in, unmodified TrueType files.
There is no font download during development, production builds, or page loads.
Next.js emits same-origin static assets and preloads them. All original glyphs
are retained; no subset or format conversion is performed.

Source: [Google Fonts repository at 5e35378](https://github.com/google/fonts/tree/5e35378e6bda803962ee6fd257e444a7d459660d/ofl).
Downloaded 2026-09-05. Local filenames are simplified; the font binaries and
embedded family names are unchanged.

| Local file | Upstream file | Weights | License |
| --- | --- | --- | --- |
| Geist-Variable.ttf | [ofl/geist/Geist[wght].ttf](https://github.com/google/fonts/blob/5e35378e6bda803962ee6fd257e444a7d459660d/ofl/geist/Geist%5Bwght%5D.ttf) | 100–900 | geist-OFL.txt |
| GeistMono-Variable.ttf | [ofl/geistmono/GeistMono[wght].ttf](https://github.com/google/fonts/blob/5e35378e6bda803962ee6fd257e444a7d459660d/ofl/geistmono/GeistMono%5Bwght%5D.ttf) | 100–900 | geist-OFL.txt |
| Halant-Regular.ttf | [ofl/halant/Halant-Regular.ttf](https://github.com/google/fonts/blob/5e35378e6bda803962ee6fd257e444a7d459660d/ofl/halant/Halant-Regular.ttf) | 400 | halant-OFL.txt |
| Halant-Bold.ttf | [ofl/halant/Halant-Bold.ttf](https://github.com/google/fonts/blob/5e35378e6bda803962ee6fd257e444a7d459660d/ofl/halant/Halant-Bold.ttf) | 700 | halant-OFL.txt |

The licenses are SIL Open Font License 1.1. Geist and Geist Mono share the same
upstream license text. Include these notices when distributing the font assets.
The application CSS variables remain `--font-geist-sans`, `--font-geist-mono`
and `--font-halant`.

SHA-256 (also checked by the font regression test):

```text
73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659  Geist-Variable.ttf
d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196  GeistMono-Variable.ttf
f646ffa1cdf2d4ab36326943d3494c98416264f4df40f8e7bf86211de571df07  Halant-Regular.ttf
ee33e5ad2f8b8ff03ef91b286ea3bf93583cc162b614790e2ddcfd5772939daf  Halant-Bold.ttf
```

For an intentional font upgrade, verify the upstream license, replace the local
binary, update this provenance and the regression checksums, then verify the
production build and the desktop/mobile typography tests.
