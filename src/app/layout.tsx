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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
