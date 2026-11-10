// 様式に写す（docs/screens.md 3.5、P2 の 7）を、この PC の Chrome と Edge で通す：
// 見本の計画を第 1 版として署名 → EXPORT で「＋ 様式を追加」（試験の台本が作った架空の様式。保存先に下書きで置く）→ 見出しの言葉から
// 列の上に列対応（← 項目・← 作業・← 周期・← 年度の星取。決まらない列は朱の「- 未定」）が読むだけの字で出る。
// 未定の列がある様式は、主ボタンが「理由：列対応 未定 n」で止まる（列対応を決めるのは Claude との会話。画面にメニューは無い。運営者 2026-11-10）。
// 列対応が決まっている様式は、主ボタン「署名して出力」の 1 回で、書き出しに署名して Excel を落とす（ダイアログは無い）→ 承認済み・出力済み →
// 次からは「Excel を出力」。
// AI は使わない。先に npm run build を走らせておく。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-template-"));
  bridge = await startBuiltBridge("moyai-e2e-template-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** Excel を作る・読むのは別のプロセス（tests/helpers/xlsx-cli.mjs。exceljs を Playwright の中で読み込まないため） */
function xlsx(args: string[]): string {
  const r = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

/** 架空の様式：1 行目に題、3 行目に見出し */
function template(path: string, heads: string[]): void {
  const cells: Record<string, string> = { A1: "【架空】長寿命化計画 様式 3" };
  heads.forEach((h, i) => (cells[`${String.fromCharCode(65 + i)}3`] = h));
  xlsx(["write", path, JSON.stringify({ sheet: "様式3", cells })]);
}

/** ＋ 様式を追加。道で渡すと、Linux の Chrome では選んだファイルが画面に届かないので、中身で渡す */
async function addTemplate(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("template-pick").click();
  await (await chooser).setFiles({ name: path.split(/[\\/]/).pop()!, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(path) });
}

test("利用者の様式の見出しから列対応を読み、決まっていれば「署名して出力」の 1 回で、確定した版の作業を写した Excel を落とす", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");
  const open = join(work, tag, "長寿命化計画_様式3_備考あり.xlsx");
  const tpl = join(work, tag, "長寿命化計画_様式3.xlsx");
  mkdirSync(join(work, tag), { recursive: true });
  template(open, ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5", "備考", "点検者"]);
  template(tpl, ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5"]);

  await test.step("人：設定。見本の計画を第 1 版として署名する", async () => {
    await page.goto(`${bridge.base}/#/settings`);
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
    await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("様式に写す試験の第 1 版（e2e）");
    await signInDialog(page);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 1 版）を確定しました。/);
    await page.keyboard.press("Escape");
  });

  await test.step("EXPORT：未定の列がある様式は、列対応が読むだけの字で出て、主ボタンは「理由：列対応 未定 2」で止まる", async () => {
    await page.evaluate(() => (location.hash = "#/export"));
    await expect(page.getByTestId("template-pick")).toBeVisible();
    // 様式の行の並び：標準・（保存先の様式）・＋ 様式を追加。第 1 版なので差分の行は無い
    await expect(page.getByTestId("template-standard")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("export-report")).toHaveCount(0);
    await addTemplate(page, open);
    const row = page.getByTestId("template-shared").filter({ hasText: "長寿命化計画_様式3_備考あり" });
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(row).toContainText("列対応 未定 2");
    // 同じ機器の同じ作業は 1 行（見本の行の「項目 › 作業」が重ならない）
    const firstTwo = await page.getByTestId("template-row").evaluateAll((els) => els.slice(0, 4).map((e) => [...e.querySelectorAll("td")].slice(1, 3).map((td) => td.textContent).join("|")));
    expect(new Set(firstTwo).size).toBe(firstTwo.length);
    const roles = page.getByTestId("template-role");
    await expect(roles).toHaveCount(8);
    expect(await roles.evaluateAll((els) => els.map((e) => e.getAttribute("data-role")))).toEqual(["item", "work", "cycle", "year:2021", "year:2022", "year:2023", "none", "none"]);
    await expect(roles.nth(6)).toHaveText("- 未定");
    // 列対応は読むだけ：列の上に押せるものは無い
    await expect(page.getByTestId("template-preview").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("export-sign")).toBeDisabled();
    await expect(page.getByTestId("export-blocked")).toHaveText("理由：列対応 未定 2");
    await page.screenshot({ path: shot(`template-undecided-${tag}`), fullPage: true });
  });

  await test.step("列対応が決まった様式：「署名して出力」の 1 回で署名して落とす。行は承認済み・出力済み、主ボタンは「Excel を出力」", async () => {
    await addTemplate(page, tpl);
    const row = page.getByTestId("template-shared").filter({ hasText: /^長寿命化計画_様式3(?!_)/ });
    await expect(row).toHaveAttribute("data-active", "true");
    await expect(row).toContainText("列対応 下書き");
    await expect(page.getByTestId("export-blocked")).toHaveCount(0);
    const button = page.getByTestId("export-sign");
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("署名して出力");
    await expect(page.getByTestId("export-excel")).toHaveCount(0);
    await page.screenshot({ path: shot(`template-sign-${tag}`), fullPage: true });
    // 押した 1 回で署名して落とす（ダイアログは開かない）
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 承認を頼んでいないので、名前の末尾に「_承認待ち」は付かない（名前は画面が渡した名前で確かめる。Linux の Chrome は blob の名前を「download」にする）
    await expect(page.getByTestId("export-saved")).toHaveText(/^✓ 出力　長寿命化計画_様式3_【架空】.+_第1版\.xlsx$/);
    const done = page.getByTestId("template-shared").filter({ hasText: "出力済み" }).filter({ hasText: /^長寿命化計画_様式3(?!_)/ });
    await expect(done).toContainText(`承認済み　第 1 版で　${E2E_NAME}`);
    await expect(page.getByTestId("export-sign")).toHaveCount(0);
    await expect(page.getByTestId("export-excel")).toHaveText("Excel を出力");
    await page.screenshot({ path: shot(`template-signed-${tag}`), fullPage: true });
    const out = join(work, tag, "写した様式.xlsx");
    await download.saveAs(out);
    const rows = JSON.parse(xlsx(["read", out])) as (string | number | null)[][];
    // 題と見出しはそのまま。4 行目から作業が写る
    expect(rows[0]![0]).toBe("【架空】長寿命化計画 様式 3");
    expect(rows[2]![0]).toBe("設備名");
    expect(String(rows[3]![0] ?? "")).not.toBe("");
    expect(String(rows[3]![1] ?? "")).not.toBe("");
    // 年度の列には ○ ● ◎ か空
    const marks = new Set<string>();
    for (const row of rows.slice(3)) for (const c of [3, 4, 5]) marks.add(String(row[c] ?? ""));
    expect([...marks].every((m) => ["", "○", "●", "◎"].includes(m))).toBe(true);
    expect([...marks].some((m) => m !== "")).toBe(true);
    // 署名済みの書き出しは「Excel を出力」でもう一度落とせる（署名は増やさない）
    const before = await page.getByTestId("export-saved").textContent();
    const [again] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
    expect(again).toBeTruthy();
    await expect(page.getByTestId("export-saved")).toHaveText(before!);
  });
});
