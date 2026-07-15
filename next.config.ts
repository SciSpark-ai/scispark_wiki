import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets scripts/live-local-runtime.mjs (M11 Task 12) spawn a second, fully
  // isolated `next dev` instance for the same project directory alongside a
  // developer's own dev server: Next's dev-server lockfile lives under
  // `distDir` (default `.next`), so two servers sharing the default distDir
  // collide ("Another next dev server is already running") regardless of
  // port. Unset in normal runs — this only takes effect when the live gate
  // sets SCISPARK_LIVE_GATE_DIST_DIR.
  ...(process.env.SCISPARK_LIVE_GATE_DIST_DIR
    ? { distDir: process.env.SCISPARK_LIVE_GATE_DIST_DIR }
    : {}),
};

export default nextConfig;
