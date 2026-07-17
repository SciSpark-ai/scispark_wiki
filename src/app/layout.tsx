import type { Metadata, Viewport } from "next";
import { geistSans, geistMono, halant } from "@/lib/fonts";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "SciSpark",
  description: "AI-powered research radar and knowledge base. Personalized papers daily, AI-digested, grounded in sources.",
};

// Module-level, referentially stable — React 19.2 re-applies
// dangerouslySetInnerHTML (destroying and recreating child nodes) whenever
// the wrapper OBJECT identity changes, even with an identical __html string
// (see CLAUDE.md's 2026-07-16 reader-interaction entry). Runs before
// hydration to set data-theme="dark" synchronously from localStorage/OS
// preference, so there's no flash of the wrong theme on first paint.
const THEME_INIT_SCRIPT = {
  __html:
    "(function(){try{var m=localStorage.getItem('scispark-theme');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.dataset.theme='dark'}catch(e){}})()",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full w-full" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${halant.variable} antialiased h-full w-full m-0 p-0`}
      >
        <script dangerouslySetInnerHTML={THEME_INIT_SCRIPT} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
