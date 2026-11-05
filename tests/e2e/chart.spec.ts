// 星取表 v0 を、この PC の Chrome と Edge で開く：工場の正解から組んだ架空の計画（試験の道具）を読み、
// 段で畳む・畳んだ深さを覚える・畳んだ行の明細・出どころ・編集欄（Enter）・共通の設備項目の行・月の表・厚い計画の重さ。
// 試しの計画は、ビルドの横のファイルの代わりに、試験の中で tests/fixtures/chart/truth-to-plan.mjs から返す。
// スクリーンショットは一時のフォルダの moyai-shots/<走らせた日（日本時間）>/（日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付> を渡す）chart-*.png。前の画像は上書きしない。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";

const jst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const SHOTS = process.env.MOYAI_SHOTS_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/moyai-shots/${jst}`;

function shot(name: string): string {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  if (!existsSync(p)) return p;
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date())
    .replace(/:/g, "");
  return `${SHOTS}/${name}-${t}.png`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

let child: ChildProcess;
let base = "";
let stateDir = "";
const planJson = new Map<string, string>();

test.beforeAll(async () => {
  for (const [name, make] of Object.entries(DEV_PLANS)) planJson.set(name, JSON.stringify(make()));
  stateDir = mkdtempSync(join(tmpdir(), "moyai-e2e-chart-"));
  const port = await freePort();
  child = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], {
    env: { ...process.env, MOYAI_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動しない: ${out}`)), 15_000);
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const m = /橋渡しを起こしました：(\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        base = (m[1] as string).replace(/\/$/, "");
        resolve();
      }
    });
    child.once("exit", (c) => reject(new Error(`止まった ${c}: ${out}`)));
  });
});

test.afterAll(async () => {
  child?.kill();
  rmSync(stateDir, { recursive: true, force: true });
});

async function openPlan(page: Page, name: string) {
  await page.route("**/assets/dev-plans/*.json", (route) => {
    const n = /dev-plans\/([a-z0-9-]+)\.json/.exec(route.request().url())?.[1] ?? "";
    const body = planJson.get(n);
    return body ? route.fulfill({ status: 200, contentType: "application/json", body }) : route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${base}/?plan=${name}#/chart`);
  await expect(page.getByTestId("chart-page")).toBeVisible();
  await expect(page.locator(".ag-row").first()).toBeVisible();
}

const cell = (page: Page, aria: string) => page.locator(`[role="gridcell"][aria-label^="${aria}"]`);
const visibleRows = async (page: Page) => Number(await page.getByTestId("chart-rows-count").getAttribute("data-visible"));

test("計画が無いときは、MERGE は白紙（新しい施設。資料のシートだけ）", async ({ page }) => {
  await page.goto(`${base}/#/chart`);
  await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
  await expect(page.getByTestId("sheet-chart")).toHaveCount(0);
  await expect(page.getByTestId("plan-name")).toHaveText("新しい施設");
  await expect(page.getByTestId("tab-merge")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("build-stamp")).toBeVisible();
});

test("台帳の段・出どころ・畳む・覚える・明細・編集欄・共通の行・月", async ({ page }, info) => {
  const tag = info.project.name;
  await openPlan(page, "fictional-1");

  await test.step("見出しの行：【架空】、ビルドの印、右端の主ボタン", async () => {
    await expect(page.getByTestId("fiction-mark")).toBeVisible();
    await expect(page.getByTestId("build-stamp")).toHaveText(/^MOYAI · build /);
    // 主ボタン「署名して確定する…」は MERGE の下の帯の右端。受けていない決定があるうちは押せず、理由を横に出す（確定の流れは checkpoint.spec.ts）
    await expect(page.getByTestId("confirm-open")).toHaveText("署名して確定する…");
    await expect(page.getByTestId("confirm-open")).toBeDisabled();
    await expect(page.getByTestId("confirm-disabled-reason")).toContainText("受けていない決定が");
    const btn = await page.getByTestId("confirm-open").boundingBox();
    const vp = page.viewportSize();
    expect(btn && vp && vp.width - (btn.x + btn.width)).toBeLessThan(40);
    // 段の列は左に固定
    await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='lv1']")).toBeVisible();
    await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='lv3']")).toBeVisible();
    await page.screenshot({ path: shot(`chart-ledger-${tag}`) });
  });

  await test.step("セルの aria-label に階層の道。上の行と同じ名前は空ける", async () => {
    await expect(cell(page, "受入供給設備 › ごみクレーン · 2020 年度 · 実施")).toHaveText("●");
    const crane = page.locator('.ag-row[row-index="2"]');
    await expect(crane.locator("[col-id='lv1']")).toHaveText("");
    await expect(crane.locator("[col-id='lv2']")).toHaveText("ごみクレーン");
  });

  await test.step("印を選ぶと、出どころ（資料・シート・セル）を横に出す", async () => {
    await cell(page, "受入供給設備 › ごみクレーン · 2020 年度").click();
    await expect(page.getByTestId("source-cell")).toContainText("ごみクレーン");
    await expect(page.getByTestId("source-ref").first()).toContainText("plan-hoshitori.xlsx · 星取表 · F6");
    await page.screenshot({ path: shot(`chart-source-${tag}`) });
  });

  await test.step("Enter で編集欄を開く。打った字では開かない。保存は未実装と言う", async () => {
    await cell(page, "受入供給設備 › ごみクレーン · 2021 年度").click();
    await page.keyboard.press("a");
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);
    await expect(page.getByTestId("edit-not-saved")).toBeVisible();
    await page.keyboard.press("F2");
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  await test.step("段の見出しを押すとその段で畳み、薄い印と台数。もう一度押すと開く", async () => {
    const all = await visibleRows(page);
    await page.getByTestId("fold-1").click();
    await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "1");
    expect(await visibleRows(page)).toBeLessThan(all);
    await expect(page.locator(".moyai-lv-folded").first()).toContainText("台）");
    await expect(page.locator(".moyai-mark-summary").first()).toBeVisible();
    await page.screenshot({ path: shot(`chart-folded-${tag}`) });
  });

  await test.step("畳んだ行のダブルクリックで、中の作業の明細", async () => {
    await cell(page, "燃焼設備 · 2019 年度").dblclick();
    await expect(page.getByTestId("folded-details")).toBeVisible();
    expect(await page.getByTestId("folded-details").locator("tbody tr").count()).toBeGreaterThan(3);
    await page.waitForTimeout(400); // ダイアログの開く動きが終わってから撮る
    await page.screenshot({ path: shot(`chart-folded-details-${tag}`) });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("folded-details")).toHaveCount(0);
  });

  await test.step("畳んだ深さはブラウザに覚える", async () => {
    await page.reload();
    await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "1");
    await page.getByTestId("fold-1").click();
    await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "");
  });

  await test.step("共通の設備項目 × 作業の属性の行に切り替え、未当てはめを 1 行に集める", async () => {
    await page.getByText("共通の設備項目 × 作業の属性").click();
    await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
    // 行の見出しは 1 列（「共通の設備項目 › 作業」。Wire、2026-11-05）：設備は見出しの行、その下は「項目 › 作業」の行
    await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='lv1']")).toContainText("共通の設備項目 › 作業");
    await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='lv2']")).toHaveCount(0);
    await expect(page.locator(".ag-row [col-id='lv1']").filter({ hasText: " › " }).first()).toBeVisible();
    await page.screenshot({ path: shot(`chart-common-${tag}`) });
    // 未当てはめの行は最後。表の下まで送って見る
    await page.locator(".ag-grid-viewport").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator(".moyai-row-unmapped [col-id='lv1']")).toHaveText(/^未当てはめ（\d+ 件）$/);
    await page.screenshot({ path: shot(`chart-common-unmapped-${tag}`) });
    await page.locator(".ag-grid-viewport").evaluate((el) => (el.scrollTop = 0));
  });

  await test.step("月までの表（年度の下に月）", async () => {
    await page.getByText("月まで").click();
    await expect(page.locator(".moyai-fy-group").first()).toContainText("年度");
    await page.screenshot({ path: shot(`chart-month-${tag}`) });
  });

  // 暗が既定（デザイン定義 §2.2）。明に切り替えて撮り、暗に戻す
  await test.step("明るい表示", async () => {
    await page.getByTestId("theme-light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: shot(`chart-light-${tag}`) });
    await page.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test("4 段の施設（fictional-2）", async ({ page }, info) => {
  const tag = info.project.name;
  await openPlan(page, "fictional-2");
  await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='lv4']")).toBeVisible();
  await page.screenshot({ path: shot(`chart-4levels-${tag}`) });
  await page.getByTestId("fold-2").click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "2");
  await page.screenshot({ path: shot(`chart-4levels-folded-${tag}`) });
});

test("厚い計画（機器 1,000 余り）の重さを測る", async ({ page }, info) => {
  const tag = info.project.name;
  const t0 = Date.now();
  await openPlan(page, "fictional-1-x5");
  const firstVisible = Date.now() - t0;
  const rows = await visibleRows(page);
  expect(rows).toBeGreaterThan(1000);

  const measure = async (name: string): Promise<number> => {
    await expect.poll(async () => page.evaluate((n) => performance.getEntriesByName(n, "measure").length, name)).toBeGreaterThan(0);
    return page.evaluate((n) => {
      const es = performance.getEntriesByName(n, "measure");
      return Math.round((es[es.length - 1] as PerformanceEntry).duration);
    }, name);
  };
  const clear = () => page.evaluate(() => performance.clearMeasures());

  const first = await measure("moyai-chart-first-render");
  const build = await measure("moyai-chart-build");

  await clear();
  await page.getByTestId("fold-1").click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "1");
  const fold = await measure("moyai-chart-update");
  await clear();
  await page.getByTestId("fold-1").click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-fold", "");
  const unfold = await measure("moyai-chart-update");

  await clear();
  await page.getByText("月まで").click();
  await expect(page.locator(".moyai-fy-group").first()).toBeVisible();
  const month = await measure("moyai-chart-update");
  const monthBuild = await measure("moyai-chart-build");
  const periods = await page.locator(".ag-header-row-column [col-id^='fy']").count(); // 描いている月の列（横は見える所だけ描く）

  await clear();
  await page.getByText("共通の設備項目 × 作業の属性").click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
  const common = await measure("moyai-chart-update");

  // 縦に端まで送って、描き直しが追いつくか
  const s0 = Date.now();
  await page.getByText("自分の台帳の段").click();
  await page.locator(".ag-grid-viewport").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator(`.ag-row[row-index="${rows - 1}"]`)).toBeVisible();
  const scroll = Date.now() - s0;

  const result = { rows, monthColumnsRendered: periods, firstVisibleMs: firstVisible, firstRenderMs: first, buildMs: build, foldMs: fold, unfoldMs: unfold, monthMs: month, monthBuildMs: monthBuild, commonMs: common, scrollToEndMs: scroll };
  info.annotations.push({ type: "perf", description: JSON.stringify(result) });
  console.log(`[${tag}] 星取表の重さ ${JSON.stringify(result)}`);
  await page.screenshot({ path: shot(`chart-thick-${tag}`) });
  // 目安：畳む・開くは 1 秒以内
  expect(fold).toBeLessThan(1000);
  expect(unfold).toBeLessThan(1000);
});

test("次回の列：作業の行だけに起点の粒度で。行を選ぶと横に次回・根拠・起点・備考（台帳の重-8b）", async ({ page }, info) => {
  const tag = info.project.name;
  // fictional-1 の作業を、機器と作業の名前が同じものどうし 1 つにまとめ（試しの計画は 1 回ごとに作業を作るため）、
  // 「3 年ごと（暦）」のきっかけを置いた見本（試験の中で作る）
  const p = JSON.parse(planJson.get("fictional-1")!);
  const first = new Map<string, string>();
  const to = new Map<string, string>();
  for (const w of p.works) {
    const k = `${w.targets.join(",")}|${w.kind}`;
    if (!first.has(k)) first.set(k, w.workKey);
    to.set(w.workKey, first.get(k)!);
  }
  p.works = p.works.filter((w: { workKey: string }) => to.get(w.workKey) === w.workKey);
  for (const d of p.details) d.workKey = to.get(d.workKey);
  for (const w of p.works) w.trigger = { branches: [{ kind: "calendar", years: 3 }], combine: "earliest" };
  // ごみクレーンには作業を 2 つ足す：5 年ごとの分解整備（実績あり）と、きっかけの無い作業（決まらない。列の備考に「未確定 1」）
  const craneAsset = p.assets.find((a: { name: string; level: number }) => a.name === "ごみクレーン" && a.level === 2);
  const base = p.works.find((w: { targets: string[] }) => w.targets.includes(craneAsset.nodeKey));
  p.works.push({ ...base, workKey: "e2e-overhaul", kind: "ごみクレーンの分解整備", attribute: "OVERHAUL", trigger: { branches: [{ kind: "calendar", years: 5 }], combine: "earliest" } });
  p.works.push({ ...base, workKey: "e2e-none", kind: "ごみクレーンのワイヤ交換", attribute: "REPLACE", trigger: null });
  const d0 = p.details.find((d: { workKey: string }) => d.workKey === base.workKey);
  p.details.push({ ...d0, detailKey: "e2e-overhaul.1", workKey: "e2e-overhaul", fiscalYear: 2021, startDate: "2021-10-04", endDate: "2021-10-20" });
  planJson.set("due-1", JSON.stringify(p));
  await openPlan(page, "due-1");
  await expect(page.locator(".ag-header .ag-grid-pinned-left-cells [col-id='next']")).toHaveText("次回");
  const crane = page.locator('.ag-row[row-index="2"]');
  await expect(crane.locator("[col-id='lv2']")).toHaveText("ごみクレーン");
  await expect(crane.locator("[col-id='next']")).toHaveText(/^(\d{4}-\d{2}-\d{2}|\d{4} 年度)$/);
  // 1 段目の行（設備）には作業が無いので空ける
  await expect(page.locator('.ag-row[row-index="0"] [col-id="next"]')).toHaveText("");
  await crane.locator("[col-id='next']").click();
  await expect(page.getByTestId("due-side")).toBeVisible();
  await expect(page.getByTestId("due-side")).toContainText("根拠　暦");
  await expect(page.getByTestId("due-side")).toContainText("起点　");
  // 作業ごとに、次回の早い順。決まらない作業は最後
  await expect(page.getByTestId("due-work")).toHaveCount(3);
  await expect(page.getByTestId("due-work").last()).toHaveAttribute("data-work", "e2e-none");
  await expect(page.getByTestId("due-work").last()).toContainText("備考　起点なし");
  await page.screenshot({ path: shot(`chart-next-${tag}`) });
});
