// デモの通し：試験と同じ台本を、画面に出した Chrome で、人が目で追える速さで流す（docs/plan.md §6.1）。
// 使い方：npx playwright test -c playwright.demo.config.ts <台本>。MOYAI_DEMO_SLOWMO（ミリ秒）で 1 操作ごとの間を変えられる。
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

const slowMo = Number(process.env.MOYAI_DEMO_SLOWMO ?? 350);

export default defineConfig({
  ...base,
  // ゆっくり流すので、1 つの台本の上限を広げる
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  use: { ...base.use, headless: false, launchOptions: { slowMo } },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
});
