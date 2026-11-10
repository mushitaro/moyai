// EXPORT と SHARE の画面の写し（初めて使う人の目で見直すため）。MOYAI_SHOTS_DIR を渡したときだけ走る（ふだんの試験では飛ばす）。
// 写すもの：EXPORT（計画なし・未確定・確定して標準・署名のダイアログ・出力のあと）、SHARE（計画なし・未確定・確定して共有フォルダなし・
// 公開台帳で clone 未設定・共有フォルダを作って送る前・送ったあと・公開台帳で GitHub 未接続）。
// GitHub は試験の中だけで動く代わり（tests/helpers/github-stub.ts）。本物の GitHub には届かない。置き場所・共有フォルダ・台帳の clone は一時のフォルダ。
// 先に npm run build を走らせておく。例：MOYAI_SHOTS_DIR=/tmp/x npx playwright test --project=chrome tests/e2e/shots-export-share.spec.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { startGitHubStub, type GitHubStub } from "../helpers/github-stub";

const DIR = process.env.MOYAI_SHOTS_DIR ?? "";
test.skip(!DIR, "MOYAI_SHOTS_DIR を渡したときだけ写す");
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

let bridge: StartedBridge;
let stub: GitHubStub;
let work = "";
let repo = "";
test.beforeAll(async () => {
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-shots-"));
  repo = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: repo, state: join(work, "demo-state"), month: "2026-11" });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/ledger-owner/moyai.git\n');
  stub = await startGitHubStub();
  bridge = await startBuiltBridge("moyai-e2e-shots-state-", { MOYAI_GITHUB_WEB: stub.web, MOYAI_GITHUB_API: stub.api, MOYAI_GITHUB_CLIENT_ID: stub.clientId });
});
test.afterAll(async () => {
  bridge?.stop();
  await stub?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

const snap = (page: Page, name: string) => page.screenshot({ path: join(DIR, `${name}.png`), fullPage: true });
const go = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash);

/** 架空の様式：1 行目に題、3 行目に見出し */
function template(path: string): void {
  const heads = ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5", "備考"];
  const cells: Record<string, string> = { A1: "【架空】長寿命化計画 様式 3" };
  heads.forEach((h, i) => (cells[`${String.fromCharCode(65 + i)}3`] = h));
  const r = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", "write", path, JSON.stringify({ sheet: "様式3", cells })], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

async function answer(page: Page) {
  await page.getByTestId("q-national").selectOption("yes");
  await page.getByTestId("q-furnace").selectOption("STOKER");
  await page.getByTestId("q-capacity_t_per_day").selectOption("C100_200");
  await page.getByTestId("q-turbine").selectOption("YES");
  await page.getByTestId("q-ash").selectOption("OUT");
  await page.getByTestId("q-contract").selectOption("SINGLE");
}

test("EXPORT と SHARE の写し", async ({ page }) => {
  test.setTimeout(300_000);
  const root = join(work, "置き場所");
  const ringRoot = join(tmpdir(), `moyai-e2e-shots-ring-${Date.now()}`, "共有フォルダ");
  const tpl = join(work, "長寿命化計画_様式3.xlsx");
  template(tpl);

  await test.step("計画なし", async () => {
    await page.goto(`${bridge.base}/#/export`);
    await expect(page.getByTestId("export-page")).toBeVisible();
    await expect(page.getByTestId("export-excel")).toBeVisible();
    await snap(page, "01-export-no-plan");
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-no-plan")).toBeVisible();
    await snap(page, "02-share-no-plan");
  });

  await test.step("設定（保存先・送信者）と、未確定の計画", async () => {
    await go(page, "#/settings");
    await page.getByTestId("root-change").click();
    await page.getByTestId("root-input").fill(root);
    await page.getByTestId("name-change").click();
    await page.getByTestId("name-input").fill(E2E_NAME);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("current-name")).toHaveText(E2E_NAME);
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
    await expect(page.locator(".ag-row").first()).toBeVisible();
    await go(page, "#/export");
    await expect(page.getByTestId("export-page")).toBeVisible();
    await expect(page.getByTestId("template-export")).toBeVisible();
    // 確定版なし：主ボタンのすぐ左に「理由：確定版なし　| HOSHITORI へ」
    await expect(page.getByTestId("export-blocked")).toContainText("理由：確定版なし");
    await expect(page.getByTestId("export-blocked-to")).toHaveAttribute("href", "#/merge");
    await snap(page, "03-export-unconfirmed");
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    await expect(page.getByTestId("checkpoint-refused")).toBeVisible();
    await snap(page, "04-share-unconfirmed");
  });

  await test.step("確定して EXPORT", async () => {
    await go(page, "#/merge/chart");
    await expect(page.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("写しの第 1 版（e2e）");
    await signInDialog(page);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText(/第 1 版）を確定しました。/);
    await page.keyboard.press("Escape");
    await go(page, "#/export");
    await expect(page.getByTestId("export-excel")).toBeEnabled();
    await expect(page.getByTestId("export-sample")).toBeVisible();
    await snap(page, "05-export-confirmed-standard");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
    expect(download).toBeTruthy();
    // 出力のあとは、ファイル名の 1 行
    await expect(page.getByTestId("export-saved")).toHaveText(/^出力済み　.+_第1版_星取表\.xlsx$/);
    await snap(page, "06-export-after-download");
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("template-pick").click();
    // 道で渡すと、この PC（Linux）の Chrome では選んだファイルが画面に届かないので、中身で渡す
    await (await chooser).setFiles({ name: "長寿命化計画_様式3.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(tpl) });
    await expect(page.getByTestId("template-shared").filter({ hasText: "長寿命化計画_様式3" })).toHaveAttribute("data-active", "true");
    await snap(page, "07-export-template-selected");
    await page.getByTestId("export-sign").click();
    await expect(page.getByTestId("export-sign-dialog")).toContainText("長寿命化計画_様式3");
    await page.waitForTimeout(400);
    await snap(page, "08-export-sign-dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("SHARE：共有フォルダなし・公開台帳で clone 未設定", async () => {
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    await expect(page.getByTestId("q-furnace")).toBeVisible();
    await expect(page.getByTestId("ring-none-to-settings")).toHaveAttribute("href", "#/settings");
    await snap(page, "09-share-confirmed-no-ring");
    await page.getByTestId("share-dest").getByText("公開台帳").click();
    await expect(page.getByTestId("checkpoint-to-settings")).toHaveAttribute("href", "#/settings");
    await snap(page, "10-share-ledger-no-clone");
  });

  await test.step("設定：共有フォルダを作り、台帳の clone を選ぶ", async () => {
    await go(page, "#/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await page.getByTestId("ring-create-open").click();
    await page.getByTestId("ring-folder").fill(ringRoot);
    await page.getByTestId("ring-pack").selectOption("waste-incineration");
    await page.getByTestId("ring-create-submit").click();
    await expect(page.getByTestId("ring-created")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("ledger-change").click();
    await page.getByTestId("ledger-input").fill(repo);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("current-ledger")).toHaveText(repo);
  });

  await test.step("SHARE：共有フォルダへ送る前・送ったあと", async () => {
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    // 共有先は前に選んだ公開台帳のままのことがある
    await page.getByTestId("share-dest").getByText("共有フォルダ", { exact: true }).click();
    await expect(page.getByTestId("q-furnace")).toBeVisible();
    await answer(page);
    await expect(page.getByTestId("send")).toBeEnabled();
    await expect(page.getByTestId("ring-folder-path")).toContainText(ringRoot);
    await snap(page, "11-share-ring-before-send");
    await page.getByTestId("send").click();
    await expect(page.getByTestId("sent")).toContainText("共有ファイルを共有フォルダに置きました");
    await expect(page.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("sent")).toContainText(ringRoot);
    await expect(page.getByTestId("send-reason")).toHaveText("理由：送信済み");
    await snap(page, "12-share-ring-after-send");
  });

  await test.step("SHARE：公開台帳で GitHub 未接続", async () => {
    await page.getByTestId("share-dest").getByText("公開台帳").click();
    await expect(page.getByTestId("github-login")).toHaveText("GitHub　未接続");
    await expect(page.getByTestId("send-reason")).toBeVisible();
    await snap(page, "13-share-ledger-github-not-connected");
  });
  rmSync(join(ringRoot, ".."), { recursive: true, force: true });
});
