import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: [
      "src/app/**/__tests__/**/*.test.ts",
      "src/app/**/__tests__/**/*.test.tsx",
      "src/lib/**/__tests__/**/*.test.ts",
      "src/stores/**/__tests__/**/*.test.ts",
      "src/components/**/__tests__/**/*.test.ts",
      "src/components/**/__tests__/**/*.test.tsx",
    ],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
})
