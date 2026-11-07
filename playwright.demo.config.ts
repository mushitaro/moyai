// デモの通し：試験と同じ台本を、画面に出した Chrome で、人が目で追える速さで流す（docs/plan.md §6.1）。
// 使い方：npx playwright test -c playwright.demo.config.ts <台本>。MOYAI_DEMO_SLOWMO（ミリ秒）で 1 操作ごとの間を変えられる。
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

// 試験の橋渡しは、作業画面が開いていなくても本物のブラウザを開かない（src/cli/main.ts）
process.env.MOYAI_NO_AUTO_OPEN = "1";

const slowMo = Number(process.env.MOYAI_DEMO_SLOWMO ?? 350);

export default defineConfig({
  ...base,
  // tests/demo の台本（デモの通し）も、tests/e2e の台本も流せるように
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  // ゆっくり流すので、1 つの台本の上限を広げる
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  // 先に画面を出さずに試すときは MOYAI_DEMO_HEADLESS=1（MOYAI_DEMO_SLOWMO=0 と合わせて）
  use: { ...base.use, headless: process.env.MOYAI_DEMO_HEADLESS === "1", launchOptions: { slowMo } },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
});
