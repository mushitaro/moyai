// vitest の設定。node:test の試験（*.test.mjs）は scripts/run-tests.mjs が別に走らせる。
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __MOYAI_BUILD__: JSON.stringify({ time: "2026-11-03 00:00", commit: "test" }),
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // 工場の資料を計画 §2.5 の厚さ（機器 217・作業 2,120）にしたので、取り込みを端まで動かす試験は、並べて走らせると 20 秒を越える。
    // windows-latest の CI では fictional-1 を端まで読む試験（tab-tools・crosswalk・photo・photo-measure）が 61〜75 秒かかる（11-05 に測った）ので、上限は測った値に合わせる
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
