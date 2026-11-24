// 受け入れの試験（tests/acceptance）：利用者と同じ道を、一時のフォルダで通す（運営者の指摘 2026-11-18）。
// CI の install の仕事（.github/workflows/ci.yml）が、ビルドのあとに走らせる。setup が版のフォルダに本物の npm ci と build をするので、数分かかる。
// ブラウザはこの PC に入っている Chrome（channel）。本物の Claude Desktop の設定・本物の状態フォルダは触らない（試験が一時の HOME などを渡す）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

process.env.MOYAI_NO_AUTO_OPEN = "1";
process.env.MOYAI_LEDGER_INTAKE_URL ??= "off";

export default defineConfig({
  testDir: "tests/acceptance",
  // 本物の npm ci と build（Windows の CI で 5〜10 分）を含む
  timeout: 40 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), "moyai-playwright-acceptance"),
  use: { viewport: { width: 1280, height: 800 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
});
