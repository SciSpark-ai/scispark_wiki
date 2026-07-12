import { Geist, Geist_Mono, Halant } from "next/font/google";

export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const halant = Halant({
  variable: "--font-halant",
  subsets: ["latin"],
  weight: ["400", "700"],
});
