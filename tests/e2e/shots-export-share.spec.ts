// EXPORT と SHARE の画面の写し（初めて使う人の目で見直すため）。MOYAI_SHOTS_DIR を渡したときだけ走る（ふだんの試験では飛ばす）。
// 写すもの：EXPORT（計画なし・未確定・確定して標準・出力のあと・列対応が未定の様式・下書きの様式・署名して出力したあと・Claude の入力）、SHARE（計画なし・未確定・確定して共有フォルダなし・
// Claude が共有先を公開台帳にして clone 未設定・共有フォルダを作って見え方が未確定・Claude が答えを置いて送る前・送ったあと・公開台帳で GitHub 未接続）。
// SHARE に見え方の選びは無い（2026-11-10）：答えは Claude が share_preview の answers で置く（本物の中継 dist/cli.js mcp を通す）。
// GitHub は試験の中だけで動く代わり（tests/helpers/github-stub.ts）。本物の GitHub には届かない。置き場所・共有フォルダ・台帳の clone は一時のフォルダ。
// 先に npm run build を走らせておく。例：MOYAI_SHOTS_DIR=/tmp/x npx playwright test --project=chrome tests/e2e/shots-export-share.spec.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, callTool, mcpClient, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
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
function template(path: string, heads = ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5", "備考"]): void {
  const cells: Record<string, string> = { A1: "【架空】長寿命化計画 様式 3" };
  heads.forEach((h, i) => (cells[`${String.fromCharCode(65 + i)}3`] = h));
  const r = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", "write", path, JSON.stringify({ sheet: "様式3", cells })], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** Claude が会話で聞いた見え方の答え（架空の施設） */
const ANSWERS = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

test("EXPORT と SHARE の写し", async ({ page }) => {
  test.setTimeout(300_000);
  const root = join(work, "置き場所");
  const ringRoot = join(tmpdir(), `moyai-e2e-shots-ring-${Date.now()}`, "共有フォルダ");
  const tpl = join(work, "長寿命化計画_様式3.xlsx");
  template(tpl);
  const c = await mcpClient(bridge.stateDir, ["share_preview"]);

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
    await expect(page.getByTestId("export-saved")).toHaveText(/^✓ 出力　.+_第1版_星取表\.xlsx$/);
    await snap(page, "06-export-after-download");
    // 道で渡すと、この PC（Linux）の Chrome では選んだファイルが画面に届かないので、中身で渡す
    const add = async (name: string, path: string) => {
      const chooser = page.waitForEvent("filechooser");
      await page.getByTestId("template-pick").click();
      await (await chooser).setFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(path) });
    };
    // 未定の列（備考）がある様式：列対応は読むだけの字、未定は朱。未定の列は様式のまま残すので、主ボタンは止まらない
    await add("長寿命化計画_様式3.xlsx", tpl);
    await expect(page.getByTestId("template-shared").filter({ hasText: "長寿命化計画_様式3" })).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("export-blocked")).toHaveCount(0);
    await expect(page.getByTestId("export-sign")).toBeEnabled();
    await snap(page, "07-export-template-undecided");
    // 列対応が決まった様式：「列対応 下書き」、主ボタン「署名して出力」
    const decided = join(work, "年次計画.xlsx");
    template(decided, ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5"]);
    await add("年次計画.xlsx", decided);
    const row = page.getByTestId("template-shared").filter({ hasText: "年次計画" });
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(row).toContainText("列対応 下書き");
    await expect(page.getByTestId("export-sign")).toHaveText("署名して出力");
    await snap(page, "08-export-template-draft");
    // 押した 1 回で署名して落とす（ダイアログは無い）。下の帯の左に「✓ 出力　ファイル名」、行は承認済み・出力済み、主ボタンは「Excel を出力」
    const [signed] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-sign").click()]);
    expect(signed).toBeTruthy();
    // ファイル名は画面が渡した名前で確かめる（この PC〔Linux〕の Chrome は、blob の名前を「download」にする）
    await expect(page.getByTestId("export-saved")).toHaveText(/^✓ 出力　年次計画_.+_第1版\.xlsx$/);
    await expect(row).toContainText("承認済み");
    await expect(page.getByTestId("export-excel")).toHaveText("Excel を出力");
    await snap(page, "08b-export-template-signed");
    // Claude が会話で列対応を置く（screen_set の templateLayout）：行に朱の「- Claude の入力」、主ボタンは「署名して出力」。押さずに写すだけ
    const c = await mcpClient(bridge.stateDir, ["screen_set"]);
    try {
      const sheet = {
        sheet: "様式3",
        headerRows: [3],
        years: { row: 3, from: "D", to: "F", startCell: null },
        levels: { mode: "flat", columns: [{ level: 1, col: "A" }] },
        group: { labelCol: null, rows: [{ label: "", content: "marks", col: null }, { label: "", content: "cycle", col: "C" }] },
        insertBefore: 40,
        continues: null,
      };
      const r = await callTool(c, "screen_set", { templateLayout: { template: "年次計画", schema: "moyai.layout/0", levelOrder: "asset-first", startYear: null, amount: { unit: "yen", tax: "unknown" }, sheets: [sheet], facility: null } });
      expect(r.refused ?? [], JSON.stringify(r).slice(0, 400)).toEqual([]);
    } finally {
      await c.close();
    }
    await go(page, "#/export");
    await expect(row.getByTestId("template-claude")).toHaveText("- Claude の入力");
    await expect(page.getByTestId("layout-output")).toHaveText("署名して出力");
    await expect(page.getByTestId("layout-preview")).toBeVisible();
    await snap(page, "09-export-claude-input");
  });

  await test.step("SHARE：共有フォルダなし・（Claude が共有先を公開台帳にして）clone 未設定", async () => {
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    await expect(page.locator('[data-testid^="q-"]')).toHaveCount(0);
    await expect(page.getByTestId("share-dest")).toHaveCount(0);
    await expect(page.getByTestId("ring-none-to-settings")).toHaveAttribute("href", "#/settings");
    await snap(page, "09-share-confirmed-no-ring");
    expect((await callTool(c, "share_preview", { dest: "ledger" })).needs?.reason).toBe("no_ledger");
    await expect(page.getByTestId("checkpoint-to-settings")).toHaveAttribute("href", "#/settings");
    await snap(page, "10-share-ledger-no-clone");
    await callTool(c, "share_preview", { dest: "ring" });
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

  await test.step("SHARE：見え方が未確定・Claude が答えを置いて送る前・送ったあと", async () => {
    await go(page, "#/share");
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    // 共有フォルダと台帳の clone の両方があるので、共有先の切り替えが出る
    await expect(page.getByTestId("share-dest")).toBeVisible();
    await expect(page.getByTestId("ring-label")).toHaveText("共有フォルダ");
    await expect(page.getByTestId("you-profile")).toHaveAttribute("data-state", "undetermined");
    await expect(page.getByTestId("send-reason")).toHaveText("理由：全国の表に載る施設かが未確定");
    await snap(page, "11-share-ring-undetermined");
    expect((await callTool(c, "share_preview", { answers: ANSWERS })).blocked).toEqual([]);
    await expect(page.getByTestId("ai-answers-mark")).toHaveText("- Claude の入力");
    await expect(page.getByTestId("send")).toBeEnabled();
    await expect(page.getByTestId("share-note")).toHaveText(/^共有フォルダの \d+ 施設に公開$/);
    await snap(page, "12-share-ring-before-send");
    await page.getByTestId("send").click();
    await expect(page.getByTestId("sent")).toHaveText(/^✓ 送信　共有ファイル 1　/);
    await expect(page.getByTestId("send-reason")).toHaveText("理由：送信済み");
    await expect(page.getByTestId("ai-answers-mark")).toHaveCount(0);
    await snap(page, "13-share-ring-after-send");
  });

  await test.step("SHARE：公開台帳で GitHub 未接続", async () => {
    await page.getByTestId("share-dest").getByText("公開台帳").click();
    await expect(page.getByTestId("github-login")).toHaveText("GitHub　未接続");
    await expect(page.getByTestId("send-reason")).toHaveText("理由：GitHub　未接続GitHub につなぐ");
    await snap(page, "14-share-ledger-github-not-connected");
  });
  await c.close();
  rmSync(join(ringRoot, ".."), { recursive: true, force: true });
});
