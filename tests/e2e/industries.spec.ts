// pack.map の画面の側（docs/plan.md §2.7・§5.1）：設定の画面のリンクから【業種】を開くと、設備の地図の全行が群（A〜H）ごとに並ぶ。
// 中身のある 2 つには印、空のパックを選ぶと「まだ中身がありません」と出どころの候補が出る。作らない行は名前と理由。数は packs/ から数える。
// 先に npm run build を走らせておく。
import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const folders = readdirSync("packs", { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name);
const packOf = (id: string) => JSON.parse(readFileSync(`packs/${id}/pack.json`, "utf8")) as { name: string; group: string | null; content?: string; reason?: string; sourceCandidates?: { title: string }[] };

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-industries-");
});
test.afterAll(() => bridge?.stop());

test("設定 → 業種：地図の全行が群ごとに並び、空のパックを選ぶと中身が無いことと出どころの候補が出る", async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto(`${bridge.base}/#/settings`);
  await page.getByTestId("industries-link").click();
  await expect(page.getByTestId("industries-page")).toBeVisible();

  await test.step("数は packs/ のフォルダの数。どの行も画面にある", async () => {
    await expect(page.getByTestId("industries-total")).toHaveText(String(folders.length));
    for (const id of folders) await expect(page.getByTestId(`industry-${id}`)).toContainText(packOf(id).name);
    for (const g of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      const n = folders.filter((id) => packOf(id).group === g).length;
      await expect(page.getByTestId(`industry-count-${g}`)).toHaveText(String(n));
    }
    await expect(page.getByTestId("industries-invalid")).toHaveCount(0);
    await page.screenshot({ path: shot(`industries-${tag}`), fullPage: true });
  });

  await test.step("中身のある行には印。空の行を選ぶと、中身が無い 1 行と出どころの候補", async () => {
    await expect(page.getByTestId("industry-waste-incineration")).toContainText("中身あり");
    await expect(page.getByTestId("industry-night-soil")).toContainText("中身あり");
    // 地図の並びで最初の空の行（A の 3 つ目。画面の上の方）
    const order = (JSON.parse(readFileSync("packs/_kinds/groups.json", "utf8")) as { groups: { order: string[] }[] }).groups.flatMap((g) => g.order);
    const empty = order.find((id) => packOf(id).content === "empty")!;
    await page.getByTestId(`industry-${empty}`).click();
    const detail = page.getByTestId(`industry-detail-${empty}`);
    await expect(detail).toContainText("この業種のパックはまだ中身がありません。出どころの候補：");
    for (const c of packOf(empty).sourceCandidates ?? []) await expect(detail).toContainText(c.title);
    await expect(detail).toContainText("未確認");
    await page.screenshot({ path: shot(`industries-selected-${tag}`), fullPage: true });
  });

  await test.step("作らない行は、名前と理由", async () => {
    const nb = folders.filter((id) => packOf(id).group === null);
    expect(nb.length).toBe(1);
    for (const id of nb) await expect(page.getByTestId(`industry-${id}`)).toContainText(packOf(id).reason!);
  });
});
