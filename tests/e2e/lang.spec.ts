// 作業画面の言語（2026-11-16、運営者「グローバル対応」。絵：Wire Frame の Settings の「言語　English | 日本語」）。
// - 設定が無ければ PC の言語（navigator.languages[0]）：ja-JP は日本語、en-US は英語
// - 設定の「English」を押すと、読み込み直しなしで英語に描き直り、設定に保存される（別の PC の言語のブラウザで開いても英語）
// 先に npm run build を走らせておく。
import { expect, test } from "@playwright/test";
import { HUMAN_TEXT } from "../../src/app/text";
import { withLang } from "../../src/app/text/i18n";
import { startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const title = (lang: "en" | "ja") => withLang(lang, () => HUMAN_TEXT.settings.langTitle);
const themeTitle = (lang: "en" | "ja") => withLang(lang, () => HUMAN_TEXT.settings.themeTitle);

// 2 つ目の試験は、1 つ目で置いた設定（日本語に戻した）を使う
test.describe.configure({ mode: "serial" });

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-lang-");
});
test.afterAll(() => bridge?.stop());

test("設定が無ければ PC の言語。English を押すと読み込み直しなしで英語になり、設定に残る", async ({ browser }) => {
  const ja = await browser.newContext({ locale: "ja-JP" });
  const page = await ja.newPage();
  await page.goto(`${bridge.base}/#/settings`);
  // 設定を読めた（ブリッジ接続中）ほうの行が出るまで待つ（読めるまでの行は描き直すだけで保存しない。保存した言語 data-saved は読めた行だけにある）
  const row = page.getByTestId("lang-setting");
  await expect(row).toHaveAttribute("data-saved", "");
  await expect(row).toContainText(title("ja"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByTestId("lang-choice").getByRole("button", { name: "日本語" })).toHaveAttribute("aria-pressed", "true");

  // 押すとすぐ英語に（読み込み直しなし：同じページのまま、印を置いた window が残る）
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
  await page.getByTestId("lang-choice").getByRole("button", { name: "English" }).click();
  await expect(row).toContainText(title("en"));
  await expect(page.getByTestId("theme-setting")).toContainText(themeTitle("en"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(1);
  // 保存が終わるのを待つ（描き直しは保存より先。保存は人だけの経路で往復する）
  await expect(row).toHaveAttribute("data-saved", "en");
  await ja.close();

  // 設定に保存された：日本語の PC のブラウザ（覚えた写しの無い新しい窓）で開いても英語
  const fresh = await browser.newContext({ locale: "ja-JP" });
  const p2 = await fresh.newPage();
  await p2.goto(`${bridge.base}/#/settings`);
  await expect(p2.getByTestId("lang-setting")).toHaveAttribute("data-saved", "en");
  await expect(p2.getByTestId("lang-setting")).toContainText(title("en"));
  await expect(p2.locator("html")).toHaveAttribute("lang", "en");
  // 日本語に戻すと、すぐ日本語
  await p2.getByTestId("lang-choice").getByRole("button", { name: "日本語" }).click();
  await expect(p2.getByTestId("lang-setting")).toContainText(title("ja"));
  await expect(p2.getByTestId("lang-setting")).toHaveAttribute("data-saved", "ja");
  await fresh.close();
});

test("英語の PC のブラウザは、設定が日本語ならそのまま日本語", async ({ browser }) => {
  // 前の試験で日本語に戻した（設定は ja）
  const en = await browser.newContext({ locale: "en-US" });
  const page = await en.newPage();
  await page.goto(`${bridge.base}/#/settings`);
  await expect(page.getByTestId("lang-setting")).toHaveAttribute("data-saved", "ja");
  await expect(page.getByTestId("lang-setting")).toContainText(title("ja"));
  await en.close();
});
