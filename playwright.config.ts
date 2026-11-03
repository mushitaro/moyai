// Playwright：この PC に入っている Chrome と Edge を channel で使う（ブラウザを新しく落とさない）。
// 試験は dist/cli.js start を空きのポートで起こし、一時の状態フォルダに向ける（tests/e2e/）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), "moyai-playwright"),
  use: { viewport: { width: 1280, height: 800 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" },
  projects: [
    { name: "chrome", use: { channel: "chrome" } },
    { name: "msedge", use: { channel: "msedge" } },
  ],
});
