// 業務システムとの連携（運営者の判断 2026-11-16：変換の精度より、仕組みが完成することを優先。絵は Wire Frame の ConnectSheet・ConnectSettings）：
// 偽の連携（src/bridge/connect/fake.ts。どこにも通信しない。MOYAI_CONNECT_FAKE=1）で、端から端まで 1 本：
// 人が設定で連携をオンにする → 資料を落とす → 連携のシートで「読む」（作業の実績が資料として入る）→ AI が計画を作る → 星取表 →
// 人が確定・署名 → 連携のシートに突合と書き込みの差分 → AI は案（connect_plan）まで → 人が「送る」→ テスト環境は鍵なしで送れる。
// 本番のつなぎ先は、その host の鍵が無いので、主ボタンの左に「理由：」の 1 行だけで押せない（鍵の確かめは橋渡しも送る直前に通す。単体の試験）。
// オフのあいだは、シートも AI の連携の道具も出ない。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDecisions, callTool as call, chooseFirstSource, chooseRoot, mcpClient, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】連携の試験";

let bridge: StartedBridge;
let work = "";

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-connect-"));
  // 偽の連携。本番の書き込みの試験用の鍵は渡さない（本番は鍵が要ることを画面で見る）
  bridge = await startBuiltBridge("moyai-e2e-connect-state-", { MOYAI_CONNECT_FAKE: "1" });
});
test.afterAll(async () => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("偽の連携で、読む → 星取表 → 確定・署名 → 突合と差分 → 人が送る（テストは鍵なし、本番は鍵が要る）", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");

  await test.step("人：置き場所を選ぶ。連携はオフで、シートも AI の連携の道具も出ない", async () => {
    await chooseRoot(page, bridge.base, root);
    await expect(page.getByTestId("connect-choice")).toBeVisible();
    await expect(page.getByTestId("connect-targets")).toHaveCount(0);
    const off = await mcpClient(bridge.stateDir);
    try {
      const names = (await off.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("connect_read");
      expect(names).not.toContain("connect_plan");
    } finally {
      await off.close();
    }
    await page.goto(`${bridge.base}/#/merge`);
    await expect(page.getByTestId("merge-page")).toBeVisible();
    await expect(page.getByTestId("sheet-connect")).toHaveCount(0);
  });

  await test.step("人：設定で連携をオンにすると、つなぎ先の一覧（キーは出ない）。本番は読むだけ", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("connect-choice").getByText("オン").click();
    await expect(page.getByTestId("connect-targets")).toBeVisible();
    await expect(page.getByTestId("connect-target-row")).toHaveCount(2);
    await expect(page.locator('[data-testid="connect-target-row"][data-env="test"] [data-testid="connect-target-write"]')).toHaveText("読み書き");
    await expect(page.locator('[data-testid="connect-target-row"][data-env="production"] [data-testid="connect-target-write"]')).toHaveText("読むだけ（書き込みの鍵なし）");
    await page.screenshot({ path: shot(`connect-settings-${tag}`), fullPage: true });
  });

  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "connect_read", "connect_plan"]);
  try {
    await test.step("人：資料を落とし、連携のシートで「読む」。読んだ作業の実績が資料として 1 つ入る", async () => {
      await openIntakeAndDrop(page, bridge.base, FACILITY, undefined, undefined, root);
      const before = Number(await page.getByTestId("source-picker").getAttribute("data-count"));
      await page.getByTestId("sheet-connect").click();
      await expect(page.getByTestId("connect-sheet")).toBeVisible();
      await page.getByTestId("connect-target").selectOption("fake-test");
      // 確定・署名した版が無いあいだ、主ボタンは「読む」の 1 つ
      await expect(page.getByTestId("connect-primary")).toHaveCount(1);
      await expect(page.getByTestId("connect-primary")).toHaveText("読む");
      await page.getByTestId("connect-primary").click();
      await expect(page.getByTestId("connect-read")).toContainText("読込　資産 7・保全計画 3・作業の実績 5");
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", String(before + 1), { timeout: 20_000 });
      await page.screenshot({ path: shot(`connect-read-${tag}`), fullPage: true });
    });

    await test.step("AI：既定の答えを置いて計画を作る。星取表が出る", async () => {
      // 資料のシートに戻る（読んだ資料も、資料の選びに並ぶ）
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
      // 確定・署名した版が無いので、AI の書き込みの案は出せない
      const none = await call(c, "connect_plan", { target: "fake-test" });
      expect(none.refused).toBe("no_signed_version");
    });

    await test.step("人：決定を受けて、署名して確定する", async () => {
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("連携へ送る前の確定（e2e）");
      await signInDialog(page);
      await expect(page.getByTestId("confirm-submit")).toBeEnabled();
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/（第 1 版）を確定しました。/);
      await page.getByTestId("confirm-close").click();
    });

    await test.step("連携のシート：突合（突合のシートと同じ形）と書き込みの差分。主ボタンは「送る」の 1 つ", async () => {
      await page.getByTestId("sheet-connect").click();
      await expect(page.getByTestId("connect-sheet")).toHaveAttribute("data-target", "fake-test");
      await expect(page.getByTestId("connect-match")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("connect-row").first()).toBeVisible();
      await expect(page.getByTestId("connect-diff")).toContainText(/書き込みの差分　足す \d+・変える \d+/);
      expect(Number(await page.getByTestId("connect-diff").getAttribute("data-add"))).toBeGreaterThan(0);
      await expect(page.getByTestId("connect-primary")).toHaveCount(1);
      await expect(page.getByTestId("connect-primary")).toHaveText("送る");
      await expect(page.getByTestId("connect-primary")).toBeEnabled();
      await expect(page.getByTestId("connect-send-note")).toHaveText("つなぎ先の保全計画が書き換わる。");
      // AI は案まで（数だけが返る。送る道具は無い）
      const plan = await call(c, "connect_plan", { target: "fake-test" });
      expect(plan.version).toBe(1);
      expect(plan.write).toEqual({ needed: false, ok: true });
      expect(plan.counts.add).toBeGreaterThan(0);
      expect((await c.listTools()).tools.map((t) => t.name).some((n) => /send|commit/.test(n))).toBe(false);
      await page.screenshot({ path: shot(`connect-diff-${tag}`), fullPage: true });
    });

    await test.step("人が「送る」を押すと、テスト環境に送り、差分が 0 になる", async () => {
      const add = Number(await page.getByTestId("connect-diff").getAttribute("data-add"));
      const change = Number(await page.getByTestId("connect-diff").getAttribute("data-change"));
      await page.getByTestId("connect-primary").click();
      await expect(page.getByTestId("connect-sent")).toHaveText(`✓ 送信　${add + change} 件（1 件目を読み直して確かめてから残りを送った）`);
      await expect(page.getByTestId("connect-primary")).toBeDisabled();
      await expect(page.getByTestId("connect-reason")).toHaveText("理由：送信済み");
      await expect(page.getByTestId("connect-diff")).toHaveText("書き込みの差分　足す 0・変える 0");
      await page.screenshot({ path: shot(`connect-sent-${tag}`), fullPage: true });
    });

    await test.step("本番のつなぎ先は、その host の鍵が無いので、理由の 1 行だけで押せない", async () => {
      await page.getByTestId("connect-target").selectOption("fake-production");
      await expect(page.getByTestId("connect-sheet")).toHaveAttribute("data-target", "fake-production");
      await expect(page.getByTestId("connect-match")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("connect-reason")).toHaveText("理由：本番への書き込みには、この host の鍵が要る");
      await expect(page.getByTestId("connect-primary")).toBeDisabled();
      const prod = await call(c, "connect_plan", { target: "fake-production" });
      expect(prod.write).toEqual({ needed: true, ok: false });
      await page.screenshot({ path: shot(`connect-production-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});

test("人：設定でつなぎ先を足す（テストか本番かを必ず選ぶ。API キーは画面に二度と出ない。絵は Wire Frame の ConnectAdd）", async ({ page }, info) => {
  test.setTimeout(120_000);
  const tag = info.project.name;
  const KEY = "e2e-key-never-shown-0123456789";
  await page.goto(`${bridge.base}/#/settings`);
  await expect(page.getByTestId("connect-choice")).toBeVisible();
  // この試験だけを走らせたときも、連携をオンにしてから
  if ((await page.getByTestId("connect-targets").count()) === 0) await page.getByTestId("connect-choice").getByText("オン").click();
  await expect(page.getByTestId("connect-targets")).toBeVisible();
  const before = await page.getByTestId("connect-target-row").count();
  await page.getByTestId("connect-add-open").click();
  // 主ボタンは「足す」の 1 つ。欄が埋まるまで押せず、左に理由の 1 行
  await expect(page.getByTestId("connect-add-submit")).toBeDisabled();
  await page.getByTestId("connect-add-name").fill("保全システム（本番 2）");
  await page.getByTestId("connect-add-url").fill("https://maximo2.example");
  await page.getByTestId("connect-add-key").fill(KEY);
  // テストか本番かは既定を置かない：選ぶまで押せない
  await expect(page.getByTestId("connect-add-stop")).toHaveText("理由：テストか本番かを選んでください");
  await expect(page.getByTestId("connect-add-submit")).toBeDisabled();
  await page.getByTestId("connect-add-env").getByText("本番").click();
  await expect(page.getByTestId("connect-add-stop")).toHaveCount(0);
  await page.screenshot({ path: shot(`connect-add-filled-${tag}`), fullPage: true });
  await page.getByTestId("connect-add-submit").click();
  await expect(page.getByTestId("connect-target-row")).toHaveCount(before + 1);
  await expect(page.locator('[data-testid="connect-target-row"]').last()).toContainText("maximo2.example");
  await expect(page.getByTestId("connect-add")).toHaveCount(0);
  // キーは画面のどこにも残らない（欄を閉じ、一覧にも出ない）
  expect(await page.content()).not.toContain(KEY);
  // URL の形が違えば、理由を出して足さない
  await page.getByTestId("connect-add-open").click();
  await page.getByTestId("connect-add-name").fill("x");
  await page.getByTestId("connect-add-url").fill("https://maximo3.example/maximo");
  await page.getByTestId("connect-add-env").getByText("テスト").click();
  await page.getByTestId("connect-add-key").fill(KEY);
  await page.getByTestId("connect-add-submit").click();
  await expect(page.getByTestId("connect-add-stop")).toContainText("https://");
  await expect(page.getByTestId("connect-add-key")).toHaveValue("");
  await expect(page.getByTestId("connect-target-row")).toHaveCount(before + 1);
  await page.screenshot({ path: shot(`connect-add-${tag}`), fullPage: true });
});
