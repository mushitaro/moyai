// 様式に写す（docs/screens.md 3.5、P2 の 7）を、この PC の Chrome と Edge で通す：
// 見本の計画を第 1 版として署名 → EXPORT で「別の様式を落とす」（試験の台本が作った架空の様式）→ 見出しの言葉から列ごとに写すもの
// （← 項目・← 作業・← 周期・← 年度の印・- 写すものが未定）が出る → 違う列は人が直す → 「この様式で落とす」で、確定した版の作業が写った Excel。
// AI は使わない。先に npm run build を走らせておく。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const PASS = "架空の合言葉 様式に写す";

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

/** 架空の様式：1 行目に題、3 行目に見出し（設備名・作業区分・周期・R3〜R5・備考・点検者） */
async function template(path: string): Promise<void> {
  const heads = ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5", "備考", "点検者"];
  const cells: Record<string, string> = { A1: "【架空】長寿命化計画 様式 3" };
  heads.forEach((h, i) => (cells[`${String.fromCharCode(65 + i)}3`] = h));
  xlsx(["write", path, JSON.stringify({ sheet: "様式3", cells })]);
}

test("利用者の様式の見出しを読み、列ごとに写すものを決めて、確定した版の作業を写した Excel を落とす", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");
  const tpl = join(work, tag, "長寿命化計画_様式3.xlsx");
  mkdirSync(join(work, tag), { recursive: true });
  await template(tpl);

  await test.step("人：設定。見本の計画を第 1 版として署名する", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-input").fill(root);
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
    await signInDialog(page, PASS);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    await page.keyboard.press("Escape");
  });

  await test.step("EXPORT：別の様式を落とすと、見出しの言葉から列ごとに写すものが出る（決まらない列は未定）", async () => {
    await page.evaluate(() => (location.hash = "#/export"));
    await expect(page.getByTestId("template-pick")).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("template-pick").click();
    await (await chooser).setFiles(tpl);
    await expect(page.getByTestId("template-name")).toHaveText("長寿命化計画_様式3.xlsx");
    // 同じ機器の同じ作業は 1 行（見本の行の「項目 › 作業」が重ならない）
    const firstTwo = await page.getByTestId("template-row").evaluateAll((els) => els.slice(0, 4).map((e) => [...e.querySelectorAll("td")].slice(1, 3).map((td) => td.textContent).join("|")));
    expect(new Set(firstTwo).size).toBe(firstTwo.length);
    const roles = page.getByTestId("template-role");
    await expect(roles).toHaveCount(8);
    expect(await roles.evaluateAll((els) => els.map((e) => e.getAttribute("data-role")))).toEqual(["item", "work", "cycle", "year:2021", "year:2022", "year:2023", "none", "none"]);
    // 「点検者」は作業の列と読める言葉ではないので未定のまま。人が「未定」のままにする列は、何も写さない
    await expect(page.getByTestId("template-row").first()).toBeVisible();
    await page.screenshot({ path: shot(`template-${tag}`), fullPage: true });
  });

  await test.step("人：列の役目を直せる。「この様式で落とす」で、見出しの行の下に作業が写った Excel", async () => {
    // 3 列目（周期）を未定に直してから戻す（列の上の字を押すと選ぶ欄が開く）
    const third = page.getByTestId("template-role").nth(2);
    await third.getByRole("button").click();
    await page.locator('[data-testid="template-role-item"][data-value="none"]').click();
    await expect(third).toHaveAttribute("data-role", "none");
    await third.getByRole("button").click();
    await page.locator('[data-testid="template-role-item"][data-value="cycle"]').click();
    await expect(third).toHaveAttribute("data-role", "cycle");
    // 落とすのは下の帯の「Excel を落とす」1 つ（様式を選んでいれば、その様式に写す）
    await expect(page.getByTestId("template-download")).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
    expect(download.suggestedFilename()).toMatch(/^長寿命化計画_様式3_【架空】.+_第1版\.xlsx$/);
    const out = join(work, tag, "写した様式.xlsx");
    await download.saveAs(out);
    const rows = JSON.parse(xlsx(["read", out])) as (string | number | null)[][];
    // 題と見出しはそのまま。4 行目から作業が写る
    expect(rows[0]![0]).toBe("【架空】長寿命化計画 様式 3");
    expect(rows[2]![0]).toBe("設備名");
    expect(String(rows[3]![0] ?? "")).not.toBe("");
    expect(String(rows[3]![1] ?? "")).not.toBe("");
    // 年度の列には ○ ● ◎ か空。未定の列（備考・点検者）には何も写さない
    const marks = new Set<string>();
    for (const row of rows.slice(3)) {
      for (const c of [3, 4, 5]) marks.add(String(row[c] ?? ""));
      expect(row[6] ?? null).toBeNull();
      expect(row[7] ?? null).toBeNull();
    }
    expect([...marks].every((m) => ["", "○", "●", "◎"].includes(m))).toBe(true);
    expect([...marks].some((m) => m !== "")).toBe(true);
  });
});
