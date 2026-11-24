// Maximo との連携のデモ（運営者の困りごと 2026-11-24）：AI の道具 connect_demo が足す、橋渡しの中の架空の Maximo（通信しない・鍵なし）で、
// デモの施設（【架空】さくら坂焼却場）を端から端まで 1 本。
//   AI が connect_demo（オフなら断って、人にオンを頼む）→ 人が設定で連携をオンにする → AI が connect_demo で架空の Maximo（テスト環境）を足す
//   → AI がデモの資料（source: demo）を入れ、connect_read で架空の Maximo の作業の実績を資料として入れる → 質問・計画 → 人が確定・署名
//   → AI の connect_plan で突合と差分 → 人が「送る」（テスト環境なので鍵なし）→ 架空の Maximo に書かれ、差分が 0 になる。
// 利用者の資料のある作業画面には、架空の Maximo の資料を入れない（混ぜない）ことも確かめる。
// 本物の Maximo には一切つながない：架空の Maximo の行き先は予約のオリジン（.invalid）だけで、そのことは単体の試験（tests/unit/connect-demo.test.ts）が
// 部品の偽の Maximo の要求の URL と橋渡しの網で確かめる。ここでは部品の接続の保存（~/.config/mxstage）を読まない（MOYAI_CONNECT_PACKAGE は off のまま）。
// 先に npm run build を走らせておく。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDecisions, callTool as call, chooseFirstSource, chooseRoot, closeConfirmAndReopen, mcpClient, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const DEMO = join("packs", "waste-incineration", "demo");
const SEED = JSON.parse(readFileSync(join(DEMO, "maximo.json"), "utf8")) as { label: string; plans: { fiscalYears: number[] }[]; results: unknown[] };
const DEMO_ID = "demo-maximo";

/** 利用者がチャットで答えたことにする答え（デモの通しと同じ：既定の答え・「済」は実績・円・新しい機器・選べるのが 1 つ。数は 1 人・日 8 時間） */
function demoDecision(q: any, all: any[]) {
  const say = (answer: string) => ({ questionId: q.questionId, answer, author: "ai_relayed_human" as const, reason: "利用者がチャットで答えた（e2e・架空の Maximo のデモ）" });
  if (q.defaultAnswer) return say(q.defaultAnswer);
  if (q.valueKind === "number") return say("8");
  const options: { id: string }[] = q.options?.length ? q.options : (all.find((x) => x.questionId === q.sameOptionsAs)?.options ?? []);
  const has = (id: string) => options.some((o) => o.id === id);
  if ((q.kind === "unknownSymbol" || q.kind === "planActualConflict") && has(/済/.test(q.text) ? "actual" : "plan")) return say(/済/.test(q.text) ? "actual" : "plan");
  if (q.kind === "costUnit" && has("1")) return say("1");
  if (q.kind === "eventAsset" && has("new")) return say("new");
  return say(options[0]!.id);
}
const isReferenceOnly = (q: any): boolean => q.options?.length === 1 && q.options[0].id === "reference";

let bridge: StartedBridge | null = null;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-connect-demo-"));
  bridge = await startBuiltBridge("moyai-e2e-connect-demo-state-");
});
test.afterAll(async () => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("架空の Maximo のデモ：AI が足す → デモの資料と読む → 確定・署名 → 突合と差分 → 人が送る（テスト環境・鍵なし）→ 差分 0", async ({ page }, info) => {
  test.setTimeout(600_000);
  const b = bridge!;
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(b.stateDir, ["connect_demo", "intake_add_files", "intake_survey", "intake_settle", "intake_compose"]);
  try {
    await test.step("AI：連携がオフなら、connect_demo は足さず、人にオンを頼む文を返す", async () => {
      await chooseRoot(page, b.base, root);
      const off = await call(c, "connect_demo");
      expect(off).toMatchObject({ target: null, added: false, refused: "connect_off" });
      expect(off.note).toContain("Settings");
      // 連携の道具（読む・案）は、オフのあいだ一覧に出ない
      expect((await c.listTools()).tools.map((t) => t.name)).not.toContain("connect_read");
    });

    await test.step("人：設定で連携をオンにする（部品が無くても、デモを足せるので連携の欄が出る）", async () => {
      await expect(page.getByTestId("connect-choice")).toBeVisible();
      await page.getByTestId("connect-choice").getByText("オン").click();
      await expect(page.getByTestId("connect-targets")).toHaveCount(1);
    });

    let counts: { assets: number; plans: number; results: number };
    await test.step("AI：connect_demo で架空の Maximo（テスト環境・鍵なし）を足す。設定の一覧に出る（予約の host）", async () => {
      const on = await call(c, "connect_demo");
      expect(on).toMatchObject({ target: { id: DEMO_ID, label: SEED.label, env: "test" }, added: true, refused: null });
      counts = on.counts;
      expect(counts.results).toBe(SEED.results.length);
      expect(counts.plans).toBe(SEED.plans.reduce((n, p) => n + p.fiscalYears.length, 0));
      await page.reload();
      const row = page.locator(`[data-testid="connect-target-row"][data-target="${DEMO_ID}"]`);
      await expect(row).toHaveCount(1, { timeout: 20_000 });
      await expect(row).toHaveAttribute("data-env", "test");
      await expect(row).toContainText("demo-maximo.moyai.invalid");
      await expect(row.getByTestId("connect-target-write")).toHaveText("読み書き");
      // 連携がオンになったので、連携の道具が一覧に出る
      await expect.poll(async () => (await c.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["connect_read", "connect_plan"]));
      await page.screenshot({ path: shot(`connect-demo-settings-${tag}`), fullPage: true });
    });

    await test.step("AI：空の作業画面にデモの資料を入れ、connect_read で架空の Maximo の作業の実績を資料として 1 つ足す", async () => {
      await page.goto(`${b.base}/#/intake`);
      await expect(page.getByTestId("intake-page")).toBeVisible();
      const added = await call(c, "intake_add_files", { source: "demo" });
      expect(added.added).toHaveLength(3);
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "3", { timeout: 20_000 });
      const read = await call(c, "connect_read", { target: DEMO_ID });
      expect(read.refused, read.note).toBeNull();
      expect(read.counts).toEqual(counts);
      expect(read.file).toContain("【架空】");
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "4", { timeout: 20_000 });
      await expect(page.getByTestId("connect-read")).toContainText(`資産 ${counts.assets}・保全計画 ${counts.plans}・作業の実績 ${counts.results}`);
      await page.screenshot({ path: shot(`connect-demo-read-${tag}`), fullPage: true });
    });

    await test.step("AI：質問に答えて計画を作る。人が決定を受け、署名して確定する", async () => {
      await chooseFirstSource(page);
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        const open = s.questions.filter((q: any) => !isReferenceOnly(q));
        if (!open.length) break;
        await call(c, "intake_settle", { decisions: open.slice(0, 50).map((q: any) => demoDecision(q, s.questions)) });
      }
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 120_000 });
      await page.getByTestId("sheet-chart").click();
      await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 30_000 });
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("架空の Maximo のデモの前の確定（e2e）");
      await signInDialog(page);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/（第 1 版）を確定しました。/, { timeout: 60_000 });
      await closeConfirmAndReopen(page);
    });

    let plan: any;
    await test.step("AI：connect_plan で突合と差分。連携のシートに一致・食い違いと書き込みの差分（足す・変える）が出る。AI は送らない", async () => {
      expect(readdirSync(join(root, "plans")).filter((d) => !d.startsWith("intake--"))).toHaveLength(1);
      plan = await call(c, "connect_plan", { target: DEMO_ID });
      expect(plan.refused, plan.note).toBeNull();
      expect(plan.write).toEqual({ needed: false, ok: true });
      // 架空の Maximo の PM は、デモの施設の計画の行に合わせてある：一致と食い違いがあり、足すものもある
      expect(plan.counts.ok).toBeGreaterThan(0);
      expect(plan.counts.diff).toBeGreaterThan(0);
      expect(plan.counts.add).toBeGreaterThan(0);
      expect((await c.listTools()).tools.map((t) => t.name).some((n) => /send|commit/.test(n))).toBe(false);
      await page.getByTestId("sheet-connect").click();
      await expect(page.getByTestId("connect-sheet")).toHaveAttribute("data-target", DEMO_ID);
      await expect(page.getByTestId("connect-match")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("connect-diff")).toHaveText(`書き込みの差分　足す ${plan.counts.add}・変える ${plan.counts.change}`, { timeout: 60_000 });
      await expect(page.getByTestId("connect-primary")).toHaveText("送る");
      await expect(page.getByTestId("connect-primary")).toBeEnabled();
      await page.screenshot({ path: shot(`connect-demo-diff-${tag}`), fullPage: true });
    });

    await test.step("人が「送る」を押すと、架空の Maximo に書かれ、読み直した差分が 0 になる", async () => {
      await page.getByTestId("connect-primary").click();
      await expect(page.getByTestId("connect-sent")).toHaveText(`✓ 送信　${plan.counts.add + plan.counts.change} 件（1 件目を読み直して確かめてから残りを送った）`, { timeout: 120_000 });
      await expect(page.getByTestId("connect-diff")).toHaveText("書き込みの差分　足す 0・変える 0", { timeout: 60_000 });
      const after = await call(c, "connect_plan", { target: DEMO_ID });
      expect(after.counts).toMatchObject({ add: 0, change: 0, diff: 0 });
      expect(after.counts.ok).toBe(plan.counts.ok + plan.counts.add + plan.counts.change);
      await page.screenshot({ path: shot(`connect-demo-sent-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});

test("利用者の資料のある作業画面には、架空の Maximo の資料を入れない（混ぜない）", async ({ page }, info) => {
  test.setTimeout(180_000);
  const b = bridge!;
  const root = join(work, `${info.project.name}-mixed`, "置き場所");
  await chooseRoot(page, b.base, root);
  // 人が連携をオンにする（前の試験でオンなら、そのまま）。ここでは人が資料を落とした作業画面
  await expect(page.getByTestId("connect-choice")).toBeVisible();
  if ((await page.getByTestId("connect-targets").count()) === 0) await page.getByTestId("connect-choice").getByText("オン").click();
  await expect(page.getByTestId("connect-targets")).toHaveCount(1);
  await openIntakeAndDrop(page, b.base, "【架空】利用者の資料の施設", undefined, undefined, root);
  const c = await mcpClient(b.stateDir, ["connect_demo"]);
  try {
    expect((await call(c, "connect_demo")).target.id).toBe(DEMO_ID);
    const before = await page.getByTestId("source-picker").getAttribute("data-count");
    const read = await call(c, "connect_read", { target: DEMO_ID });
    expect(read).toMatchObject({ refused: "mixed", file: expect.stringContaining("【架空】"), counts: null });
    expect(read.note).toContain("intake_add_files (source: demo)");
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", before ?? "");
  } finally {
    await c.close();
  }
});
