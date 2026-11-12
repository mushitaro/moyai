// 取り込みの画面で、文字のある PDF を読む（この PC の Chrome と Edge）：工場の報告書の PDF と、埋め込みの無い日本語の書体の PDF を落とし、
// 格子に文字が出て、全セルに行き先が付くこと。pdf.js の worker・cMap・標準の書体は、ビルドに入れたファイルから読み、外のサーバーへは行かないこと。
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { chooseSource, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { pdfOf } from "../unit/import/pdf-helpers";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-intake-pdf-");
});
test.afterAll(() => bridge?.stop());

async function dropFiles(page: Page, files: { name: string; bytes: Uint8Array }[]) {
  const payload = files.map((f) => ({ name: f.name, b64: Buffer.from(f.bytes).toString("base64") }));
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, payload);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
}

test("文字のある PDF を落とすと、格子に文字が出て行き先が付く（pdf.js はビルドに入れたファイルだけを読む）", async ({ page }, info) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${bridge.base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  // Skillパックは画面で選ばない（Claude が会話で置く。ここではパックなしで読む。mushitaro/moyai#67）
  await page.getByTestId("facility-name").fill("【架空】第一清掃工場");

  const font = "【架空】定期整備の報告書（第１号炉）";
  await dropFiles(page, [
    { name: "report-f1-fy2019.pdf", bytes: new Uint8Array(readFileSync("samples/out/waste-incineration/fictional-1/reports/report-f1-fy2019.pdf")) },
    { name: "font.pdf", bytes: pdfOf([{ texts: [{ x: 50, y: 60, text: font, size: 12 }] }]) },
  ]);
  // 資料の選び（白紙でも同じ。資料ごとのタブは並べない。docs/screens.md 3.2「資料の選び」）。どれか 1 つが開いている。報告書を選ぶ
  await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "2", { timeout: 30_000 });
  await expect(page.getByTestId("source-picker")).not.toHaveAttribute("data-file", "");
  await chooseSource(page, "report-f1-fy2019.pdf");
  await expect(page.locator('[data-testid="source-tab"][data-file="report-f1-fy2019.pdf"]')).toBeVisible();

  // 報告書：機器の名前が格子に出る（行き先が付いている）。資料のシートの既定は未確定行なので、全行にする
  const grid = page.getByTestId("sheet-grid");
  await page.getByTestId("source-filter").locator("button", { hasText: "全行" }).click();
  await expect(grid.locator('td[title="ストーカ（STK-1）"]')).toHaveCount(1);
  await expect(grid.locator('td[title="ストーカ（STK-1）"]')).not.toHaveAttribute("data-s", "");
  await page.screenshot({ path: shot(`intake-pdf-${info.project.name}`), fullPage: true });

  // 埋め込みの無い書体の PDF：同梱の cMap で読めた文字が出る（資料の選びで選ぶ）
  await chooseSource(page, "font.pdf");
  await expect(page.locator('[data-testid="source-tab"][data-file="font.pdf"]')).toBeVisible();
  await page.getByTestId("source-filter").locator("button", { hasText: "全行" }).click();
  await expect(grid.locator(`td[title="${font}"]`)).toHaveCount(1);

  // pdf.js の worker と cMap は、橋渡しが配るビルドの資産から読んだ。外のサーバーには行っていない
  expect(requests.some((u) => /\/assets\/pdf\.worker\.min-[^/]+\.mjs$/.test(u))).toBe(true);
  expect(requests.some((u) => /\/assets\/UniJIS-UCS2-H-[^/]+\.bcmap$/.test(u))).toBe(true);
  const outside = requests.filter((u) => !u.startsWith(bridge.base) && !u.startsWith("data:") && !u.startsWith("blob:"));
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
