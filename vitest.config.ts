// vitest の設定。node:test の試験（*.test.mjs）は scripts/run-tests.mjs が別に走らせる。
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __MOYAI_BUILD__: JSON.stringify({ time: "2026-11-03 00:00", commit: "test" }),
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
