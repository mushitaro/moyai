// 動画の撮り直し用の通し（video/world/walkthrough.spec.ts）を、画面に出した Chrome で、人が目で追える速さで流す。
// 今のデモの設定（playwright.demo.config.ts）と同じで、台本の置き場だけ video/world/ にした。
// 使い方：npm run build のあと、npx playwright test -c video/world/playwright.config.ts。MOYAI_DEMO_SLOWMO（ミリ秒）で 1 操作ごとの間を変えられる。
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

const slowMo = Number(process.env.MOYAI_DEMO_SLOWMO ?? 350);

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "walkthrough.spec.ts",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  use: { ...base.use, headless: process.env.MOYAI_DEMO_HEADLESS === "1", launchOptions: { slowMo } },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
});
