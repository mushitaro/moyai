// 業務システムとの連携を、本物の部品（@mxstage/eam-connectors）と偽の Maximo で、画面から端まで 1 本（運営者の指摘 2026-11-18）。
// connect.spec は偽の連携（MOYAI の芯の中。どこにも通信しない）なので、部品の読み込み・接続の保存（Windows は DPAPI）・HTTPS・
// 部品の書き込みエンジンは通らない。ここでは、利用者の橋渡しと同じく部品を読み（MOYAI_CONNECT_PACKAGE を off にしない）、
// 部品の /testing の createFakeMaximo を、試験の中だけ一時のポートの HTTPS で立てる（tests/helpers/fake-maximo.ts）。
//   人が設定で連携をオンにする → 「足す」でつなぎ先（偽の Maximo・テスト環境・API キー）を足す → 資料を落とし、連携のシートで「読む」
//   → AI が計画を作る → 人が確定・署名 → 連携のシートに突合と書き込みの差分 → 人が「送る」→ 偽の Maximo の PM が書き換わり、差分が 0 になる。
// 接続の保存の置き場所は、橋渡しの HOME（Windows は USERPROFILE）を一時のフォルダにして、そこに置く（利用者の ~/.config/mxstage は読まない・書かない）。
// 127.0.0.1 への HTTP は、偽の Maximo（橋渡しが送る）と、今の e2e の道具（画面・中継）だけ。本物の Maximo にはつながない。
// 現場の Maximo には施設の資産の木がもうある。試験では、確定した版の資産の木を、送る前に偽の Maximo に入れる（部品は、資産の木に無い資産の計画を書かない）。
// 先に npm run build を走らせておく。
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { planLinesOfPlan } from "../../src/shared/connect";
import { readHistory } from "../../src/plan/store";
import { acceptDecisions, callTool as call, chooseFirstSource, chooseRoot, mcpClient, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { assetTreeOf, eamTesting, maximoSeed, startFakeMaximo, type FakeMaximoServer } from "../helpers/fake-maximo";

const FACILITY = "【架空】連携の試験（偽の Maximo）";
const TARGET_NAME = "【架空】Maximo（テスト）";

/** 読む前の偽の Maximo（【架空】：場所 1・資産 6・PM 4・作業指示 2） */
const FIRST = maximoSeed({
  locations: [{ location: "PLANT", siteid: "MINATO", description: "【架空】みなと台清掃工場", type: "OPERATING" }],
  assets: [
    { assetnum: "BOILER", siteid: "MINATO", description: "ボイラ設備", location: "PLANT" },
    { assetnum: "P11", siteid: "MINATO", description: "ボイラ給水ポンプ A", parent: "BOILER" },
    { assetnum: "P12", siteid: "MINATO", description: "ボイラ給水ポンプ B", parent: "BOILER" },
    { assetnum: "SB13", siteid: "MINATO", description: "スートブロワ A", parent: "BOILER" },
    { assetnum: "DRAFT", siteid: "MINATO", description: "通風設備", location: "PLANT" },
    { assetnum: "FAN21", siteid: "MINATO", description: "二次押込送風機", parent: "DRAFT" },
  ],
  pms: [
    { pmnum: "PM1", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P11", nextdate: "2028-05-01T00:00:00+09:00" },
    { pmnum: "PM2", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P12", nextdate: "2028-05-01T00:00:00+09:00" },
    { pmnum: "PM3", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", nextdate: "2026-06-01T00:00:00+09:00" },
    { pmnum: "PM4", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", nextdate: "2027-06-01T00:00:00+09:00" },
  ],
  wos: [
    { wonum: "W1", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P11", actfinish: "2024-04-06T17:00:00+09:00", actlabhrs: 32 },
    { wonum: "W2", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", actfinish: "2025-05-12T17:00:00+09:00", actlabhrs: 16 },
  ],
});

let testing: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
let maximo: FakeMaximoServer | null = null;
let bridge: StartedBridge | null = null;
let home = "";
let work = "";

test.beforeAll(async () => {
  // macOS は、部品の SecretBox が利用者のキーチェーンの項目（"MX Stage"）に鍵を置く。一時の HOME では分けられないので走らせない（CI に macOS は無い）
  if (process.platform === "darwin") return;
  testing = await eamTesting();
  // CI では部品が無ければ落とす（黙って飛ばさない）。手元で部品が入っていなければ飛ばす
  if (!testing) {
    if (process.env.CI) throw new Error("連携の部品（@mxstage/eam-connectors）が入っていない");
    return;
  }
  home = mkdtempSync(join(tmpdir(), "moyai-e2e-maximo-home-"));
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-maximo-"));
  maximo = await startFakeMaximo(testing, FIRST);
  // 部品を読む（off にしない）。接続の保存は一時の HOME の .config/mxstage。偽の Maximo の証明書だけを足す
  bridge = await startBuiltBridge("moyai-e2e-maximo-state-", { MOYAI_CONNECT_PACKAGE: "on", HOME: home, USERPROFILE: home, NODE_EXTRA_CA_CERTS: maximo.caFile });
});
test.afterAll(async () => {
  bridge?.stop();
  await maximo?.stop();
  for (const d of [home, work]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("本物の部品と偽の Maximo で、つなぎ先を足す → 読む → 確定・署名 → 突合と差分 → 人が送る（テスト環境）", async ({ page }, info) => {
  test.skip(process.platform === "darwin", "macOS は利用者のキーチェーンに触れるので走らせない");
  test.skip(!testing, "連携の部品が入っていない（手元だけ。CI では落ちる）");
  test.setTimeout(600_000);
  const b = bridge!;
  const m = maximo!;
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  let targetId = "";

  await test.step("人：置き場所を選び、設定で連携をオンにする（部品が入っているので、連携の欄が出る）。つなぎ先はまだ無い", async () => {
    await chooseRoot(page, b.base, root);
    await expect(page.getByTestId("connect-choice")).toBeVisible();
    await page.getByTestId("connect-choice").getByText("オン").click();
    // つなぎ先が 0 のあいだ、一覧の表は行が無く高さ 0（見えない扱い）なので、あること・行が 0・「足す」が見えることを見る
    await expect(page.getByTestId("connect-targets")).toHaveCount(1);
    await expect(page.getByTestId("connect-target-row")).toHaveCount(0);
    await expect(page.getByTestId("connect-add-open")).toBeVisible();
  });

  await test.step("人：「足す」で偽の Maximo（テスト環境）を足す。キーは部品の保存に暗号化して置かれ、画面にも保存のファイルにも出ない", async () => {
    await page.getByTestId("connect-add-open").click();
    await page.getByTestId("connect-add-name").fill(TARGET_NAME);
    await page.getByTestId("connect-add-url").fill(m.origin);
    await page.getByTestId("connect-add-key").fill(m.apiKey);
    await page.getByTestId("connect-add-env").getByText("テスト").click();
    await page.getByTestId("connect-add-submit").click();
    await expect(page.getByTestId("connect-target-row")).toHaveCount(1, { timeout: 30_000 });
    const row = page.getByTestId("connect-target-row");
    await expect(row).toHaveAttribute("data-env", "test");
    await expect(row).toContainText(new URL(m.origin).host);
    await expect(row.getByTestId("connect-target-write")).toHaveText("読み書き");
    targetId = (await row.getAttribute("data-target")) ?? "";
    expect(targetId).toMatch(/^c_[0-9a-f]+$/);
    expect(await page.content()).not.toContain(m.apiKey);
    const store = join(home, ".config", "mxstage");
    expect(existsSync(join(store, "connections.json"))).toBe(true);
    for (const f of readdirSync(store)) expect(readFileSync(join(store, f), "utf8")).not.toContain(m.apiKey);
    await page.screenshot({ path: shot(`connect-maximo-settings-${tag}`), fullPage: true });
  });

  const c = await mcpClient(b.stateDir, ["intake_survey", "intake_settle", "intake_compose", "connect_read", "connect_plan"]);
  try {
    await test.step("人：資料を落とし、連携のシートで「読む」。偽の Maximo の作業の実績が資料として 1 つ入る", async () => {
      await openIntakeAndDrop(page, b.base, FACILITY, undefined, undefined, root);
      const before = Number(await page.getByTestId("source-picker").getAttribute("data-count"));
      await page.getByTestId("sheet-connect").click();
      await expect(page.getByTestId("connect-sheet")).toBeVisible();
      await page.getByTestId("connect-target").selectOption(targetId);
      await expect(page.getByTestId("connect-primary")).toHaveText("読む");
      await page.getByTestId("connect-primary").click();
      await expect(page.getByTestId("connect-read")).toContainText("読込　資産 7・保全計画 4・作業の実績 2", { timeout: 60_000 });
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", String(before + 1), { timeout: 20_000 });
      // 読んだだけで、偽の Maximo には何も書いていない
      expect(m.fake().writeCount()).toBe(0);
      await page.screenshot({ path: shot(`connect-maximo-read-${tag}`), fullPage: true });
    });

    await test.step("AI：既定の答えを置いて計画を作る。人が決定を受け、署名して確定する", async () => {
      await chooseFirstSource(page);
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        await call(c, "intake_settle", {
          decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })),
        });
      }
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
      await page.getByTestId("sheet-chart").click();
      await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 30_000 });
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("連携へ送る前の確定（e2e・偽の Maximo）");
      await signInDialog(page);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/（第 1 版）を確定しました。/);
      await page.getByTestId("confirm-close").click();
    });

    // 確定した版の保全計画の行（送る中身）。試験の一時の置き場所から読む
    const plans = readdirSync(join(root, "plans")).filter((d) => !d.startsWith("intake--"));
    expect(plans).toHaveLength(1);
    const h = await readHistory(root, plans[0]!);
    const lines = planLinesOfPlan(h.latest!.plan);
    expect(lines.length).toBeGreaterThan(2);

    await test.step("偽の Maximo に、確定した版と同じ資産の木を入れる。1 行は年度が食い違う PM、1 行は同じ年度の PM", async () => {
      const { assets, numOf } = assetTreeOf(
        lines.map((l) => l.assetPath),
        "E2E",
      );
      const [diff, same] = [lines[0]!, lines[1]!];
      const offYear = Math.max(...diff.fiscalYears) + 1;
      const pms = [
        { pmnum: "PMD1", siteid: "E2E", description: diff.work, assetnum: numOf.get(diff.assetPath), nextdate: `${offYear}-04-01T00:00:00+09:00` },
        ...same.fiscalYears.map((y, i) => ({ pmnum: `PMS${i + 1}`, siteid: "E2E", description: same.work, assetnum: numOf.get(same.assetPath), nextdate: `${y}-04-01T00:00:00+09:00` })),
      ];
      m.use(maximoSeed({ assets, pms }));
    });

    await test.step("連携のシート：突合と書き込みの差分（足す・変える）。AI は案まで", async () => {
      // AI の案：部品の書き込みエンジンが書ける形（資産の木に無い資産の計画は無い）
      const plan = await call(c, "connect_plan", { target: targetId });
      expect(plan.refused, plan.note).toBeNull();
      expect(plan.write).toEqual({ needed: false, ok: true });
      expect(plan.counts).toMatchObject({ ok: 1, diff: 1, add: lines.length - 2, change: 1 });
      expect((await c.listTools()).tools.map((t) => t.name).some((n) => /send|commit/.test(n))).toBe(false);
      await page.getByTestId("sheet-connect").click();
      await page.getByTestId("connect-target").selectOption(targetId);
      await expect(page.getByTestId("connect-sheet")).toHaveAttribute("data-target", targetId);
      await expect(page.getByTestId("connect-match")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("connect-diff")).toHaveText(`書き込みの差分　足す ${lines.length - 2}・変える 1`, { timeout: 60_000 });
      await expect(page.getByTestId("connect-primary")).toHaveText("送る");
      await expect(page.getByTestId("connect-primary")).toBeEnabled();
      expect(m.fake().writeCount()).toBe(0);
      await page.screenshot({ path: shot(`connect-maximo-diff-${tag}`), fullPage: true });
    });

    await test.step("人が「送る」を押すと、部品が偽の Maximo に PM を書き、読み直した差分が 0 になる", async () => {
      await page.getByTestId("connect-primary").click();
      await expect(page.getByTestId("connect-sent")).toHaveText(`✓ 送信　${lines.length - 1} 件（1 件目を読み直して確かめてから残りを送った）`, { timeout: 300_000 });
      await expect(page.getByTestId("connect-diff")).toHaveText("書き込みの差分　足す 0・変える 0", { timeout: 60_000 });
      expect(m.fake().writeCount()).toBeGreaterThan(0);
      // 読み直した偽の Maximo の PM の年度は、確定した版と同じ（橋渡しの外から、部品の記録を直に見る）
      const after = await call(c, "connect_plan", { target: targetId });
      expect(after.counts).toMatchObject({ add: 0, change: 0, diff: 0, ok: lines.length });
      // API キーは要求の URL に載らない
      expect(m.requests.some((q) => q.path.includes(m.apiKey))).toBe(false);
      await page.screenshot({ path: shot(`connect-maximo-sent-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});
