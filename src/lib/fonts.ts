import localFont from "next/font/local";

// Vendored with licenses in src/assets/fonts. Builds and browser font loading
// must not depend on Google Fonts or any other external font service.
export const geistSans = localFont({
  src: "../assets/fonts/Geist-Variable.ttf",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const geistMono = localFont({
  src: "../assets/fonts/GeistMono-Variable.ttf",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["monospace"],
  adjustFontFallback: false,
});

export const halant = localFont({
  src: [
    { path: "../assets/fonts/Halant-Regular.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/Halant-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-halant",
  display: "swap",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
});
