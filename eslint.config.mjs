import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sibling sessions' git worktrees under .claude/worktrees/ are separate
    // checkouts (their own node_modules/.next build artifacts) that flat
    // config's default ignores don't reach since they live outside this
    // repo's own .next/out/build paths. Without this, a worktree's build
    // output gets linted as if it were part of this branch, drowning the
    // real baseline in noise from code this branch never touched.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
