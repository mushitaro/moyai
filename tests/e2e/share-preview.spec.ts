// AI の share_preview（仕事 share-preview-v1）を、本物の中継（dist/cli.js mcp）と、この PC の Chrome と Edge で通す：
// 確定の前は needs（「確定した版がありません。…」）→ 人が確定する → SHARE は見え方が決まらない（朱の 1 行と理由。選びは無い）
// → Claude が会話で聞いた答えを answers で置くと「- Claude の入力」、share_preview の数が SHARE の画面の数と同じ → 画面を離れて呼んでも同じ答え。どの答えにも行の値は無い。
// 署名して送るのはこの試験でもしない（人だけ。ツールに道は無い）。置き場所と共有フォルダは一時のフォルダに作る。先に npm run build を走らせておく。
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, callTool, chooseRootAndCreateRing, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const fmt = (n: number) => n.toLocaleString("ja-JP");

let bridge: StartedBridge;
const made: string[] = [];
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-share-preview-state-");
});
test.afterAll(() => {
  bridge?.stop();
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function openPlan(page: Page) {
  const body = JSON.stringify(DEV_PLANS["fictional-1"]());
  await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  await page.goto(`${bridge.base}/?plan=fictional-1#/chart`);
  await expect(page.getByTestId("chart-page")).toBeVisible();
  await expect(page.locator(".ag-row").first()).toBeVisible();
}

/** 答えに行の値（年度・見え方のコード・施設の名前）と共有ファイルの中身が無いこと */
function noRowValues(out: unknown) {
  const text = JSON.stringify(out);
  expect(text).not.toMatch(/FY\d{4}/);
  for (const code of ["STOKER", "C100_200", "SINGLE"]) expect(text).not.toContain(code);
  expect(text).not.toContain(DEV_PLANS["fictional-1"]().facility.name);
  expect(text).not.toContain('"chunks":[');
}

test("確定した版で、share_preview の数が SHARE の画面の数と同じ", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  // 共有フォルダの道も固有名詞の照らす相手なので、乱数の文字（計画の語と偶然重なる）を入れない名前にする
  const base = join(tmpdir(), `moyai-e2e-sp-${tag}-${Date.now()}`);
  made.push(base);
  const c = await mcpClient(bridge.stateDir, ["share_preview"]);
  try {
    await test.step("設定：置き場所と共有フォルダを作る（人の操作）", async () => {
      await chooseRootAndCreateRing(page, bridge.base, join(base, "置き場所"), join(base, "共有フォルダ"));
    });

    await test.step("確定の前：share_preview は needs を返し、SHARE を開く（画面も確定していないと出す）", async () => {
      await openPlan(page);
      const out = await callTool(c, "share_preview");
      expect(out.needs).toEqual({ reason: "not_confirmed", text: "確定した版がありません。HOSHITORI の確定のシートで確定してから" });
      expect(out.screen).toBe(true);
      expect(out.version).toBeNull();
      expect(out.counts).toBeNull();
      await expect(page.getByTestId("checkpoint-page")).toBeVisible();
      await expect(page.getByTestId("checkpoint-refused")).toContainText("まだ確定していません");
    });

    await test.step("人が確定する（受けていない決定を理由つきで受け、一言の理由で署名する）", async () => {
      await page.getByTestId("tab-merge").click();
      const n = await acceptDecisions(page, "台帳の名前と表Ⅱ-4 を見て、人が受けた");
      expect(n).toBeGreaterThan(0);
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("試しの計画を確定する（e2e）");
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 1 版）を確定しました。/);
      await page.getByTestId("confirm-close").click();
    });

    await test.step("SHARE を開くと、見え方が決まらない（全国の表に載るかを答えていない）：朱の 1 行と押せない理由だけで、選びは無い", async () => {
      await page.getByTestId("tab-share").click();
      await expect(page.getByTestId("checkpoint-page")).toBeVisible();
      const out = await callTool(c, "share_preview");
      expect(out.needs).toBeNull();
      expect(out.aiAxes).toEqual([]);
      await expect(page.getByTestId("you-profile")).toHaveAttribute("data-state", "undetermined");
      await expect(page.getByTestId("you-profile")).toContainText("施設 ― 見え方 未確定 1（全国の表に載る施設か）");
      // 画面が出ていくものを作り終えるまで待つ（作っているあいだの理由は「出ていくものがまだ無い」）
      await expect(page.getByTestId("send-reason")).toHaveText("理由：全国の表に載る施設かが未確定");
      expect(out.blocked).toContain("全国の表に載る施設かが未確定");
      await expect(page.getByTestId("send")).toBeDisabled();
      // 見え方の選び（q-*）も、ほかの入力も無い。表も出さない
      await expect(page.locator('[data-testid^="q-"]')).toHaveCount(0);
      await expect(page.getByTestId("you").locator("select, input")).toHaveCount(0);
      await expect(page.getByTestId("plain-chunk")).toHaveCount(0);
      await expect(page.getByTestId("ai-answers-mark")).toHaveCount(0);
      expect(out.you).toBeNull();
      expect(out.counts.equipment.shared).toBeNull();
      expect(out.counts.costRows.shared).toBe(0);
      noRowValues(out);
    });

    await test.step("Claude が会話で聞いた答えを answers で置くと、画面の見え方の 1 行に「- Claude の入力」。share_preview の数が SHARE の画面の数と同じ", async () => {
      const out = await callTool(c, "share_preview", {
        answers: { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true },
      });
      expect(out.needs).toBeNull();
      expect(out.aiAxes).toContain("全国の表に載る施設か");
      await expect(page.getByTestId("ai-answers-mark")).toHaveText("- Claude の入力");
      await expect(page.getByTestId("body-hash")).toHaveText(/^[0-9a-f]{64}$/);
      await expect(page.getByTestId("send")).toBeEnabled();
      await expect(page.getByTestId("send-reason")).toHaveCount(0);
      // 共有先と版
      expect(out.destination).toEqual({ kind: "ring", name: "共有フォルダ" });
      await expect(page.getByTestId("dest-name")).toHaveText(out.destination.name);
      await expect(page.getByTestId("send")).toContainText(out.destination.name);
      expect(out.version.number).toBe(1);
      await expect(page.locator(".moyai-merge-ver")).toHaveText(`第 ${out.version.number} 版`);
      expect(out.version.name).toMatch(/^令和 \d+ 年度版（第 1 版）$/);
      expect(out.version.hashHead).toMatch(/^[0-9a-f]{16}$/);
      // 相手から見たあなた：見え方の 1 行と同区分の施設（全国）。全国 → 見え方 → この行は「共有ファイルの中身」の中
      expect(String(out.you.k)).toBe(await page.getByTestId("you-k").getAttribute("data-k"));
      await expect(page.getByTestId("you-k")).toHaveText(`同区分の施設 ${fmt(out.you.k)}（全国 ${fmt(out.you.steps.all)}）`);
      await expect(page.getByTestId("you-steps")).toHaveText(`全国の ${fmt(out.you.steps.all)} 施設のどれか → 見え方で ${fmt(out.you.steps.profile)} → この行で ${fmt(out.you.steps.rows)}`);
      const profile = ((await page.getByTestId("you-profile").textContent()) ?? "").trim();
      expect(profile.length).toBeGreaterThan(0);
      expect(out.you.label.startsWith(profile), `${out.you.label} / ${profile}`).toBe(true);
      // 塊の数・共有ファイルのハッシュの頭・大きさ・連番・数え直し（0 ばかりなので、上には出さず、中身の中だけ）
      await expect(page.getByTestId("plain-chunk")).toHaveCount(out.file.chunks);
      expect(((await page.getByTestId("body-hash").textContent()) ?? "").startsWith(out.file.hashHead)).toBe(true);
      expect(await page.getByTestId("col-outgoing").textContent()).toContain(`${fmt(out.file.bytes)} バイト · 連番 ${out.file.seq}`);
      await expect(page.getByTestId("share-chain")).toHaveText(`共有ファイル ${out.file.seq}`);
      const ch = out.checks;
      await expect(page.getByTestId("counts")).toHaveCount(0);
      await expect(page.getByTestId("counts-all")).toHaveText(`形 ${ch.shape}｜固有名詞 ${ch.properNoun}｜金額 ${ch.money}｜自由記述 ${ch.freeText}｜正確な日付 ${ch.exactDate}`);
      await expect(page.getByTestId("share-contents").locator("summary")).toHaveText("共有ファイルの中身");
      // 写した行・写さなかった理由・欄ごと写さなかったもの（「共有ファイルの中身」の ① 原本。閉じていても DOM にある）
      await expect(page.getByTestId("copied")).toHaveText(`写した ${fmt(out.copy.copied)}／写さなかった ${fmt(out.copy.rows - out.copy.copied)}（行の総数 ${fmt(out.copy.rows)}）`);
      const original = (await page.getByTestId("col-original").textContent()) ?? "";
      for (const [reason, n] of Object.entries(out.copy.skippedByReason as Record<string, number>)) expect(original).toContain(`${reason}：${n}`);
      const hidden = (out.hidden as { field: string; values: number }[]).filter((x) => x.values > 0).map((x) => `${x.field} ${x.values}`).join("　");
      expect(original).toContain(hidden);
      // 写る数：確定した版の中の数以下。費用はいつも 0。主ボタンを押せる（押せない理由が無い）
      for (const k of ["equipment", "works", "yearValues"]) {
        expect(out.counts[k].shared).toBeGreaterThan(0);
        expect(out.counts[k].shared).toBeLessThanOrEqual(out.counts[k].inPlan);
      }
      expect(out.counts.costRows.shared).toBe(0);
      expect(out.blocked).toEqual([]);
      noRowValues(out);
      await page.screenshot({ path: shot(`share-preview-${tag}`), fullPage: true });
    });

    await test.step("画面を離れて呼ぶと、ツールが SHARE を開き、このタブで Claude が置いた答えのまま数える（送るのは人。ツールは送らない）", async () => {
      await page.getByTestId("tab-merge").click();
      await expect(page.getByTestId("checkpoint-page")).toHaveCount(0);
      const out = await callTool(c, "share_preview");
      await expect(page.getByTestId("checkpoint-page")).toBeVisible();
      expect(out.screen).toBe(true);
      expect(out.needs).toBeNull();
      expect(out.blocked).toEqual([]);
      await expect(page.getByTestId("ai-answers-mark")).toBeVisible();
      await expect(page.getByTestId("send")).toBeEnabled();
      await expect(page.getByTestId("sent")).toHaveCount(0);
      expect(out.version.number).toBe(1);
      noRowValues(out);
    });
  } finally {
    await c.close();
  }
});
