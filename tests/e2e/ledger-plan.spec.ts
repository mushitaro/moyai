// 公開の台帳を計画に使う（docs/plan.md §2.18.4）を、この PC の Chrome と Edge で端から端まで通す：
// 設定で台帳の clone と呼び名を選ぶ → 見本の計画を MERGE で開く → AI が peer_reference（place: ledger）で、人が比べを開かずに台帳だけを読む
// （見え方の答えが無ければ聞くことが返り、答えを添えて読み直す）→ AI が chart_propose で周期の案を置く → 決定のシートに「- 台帳からの案」が 1 行
// → 人（試験の台本が押した）が決定のシートで受け、合言葉で署名して確定する → 確定した版に、台帳から来た計画の印が残る。
// 台帳は架空の 10 施設（scripts/ledger/demo-core.ts）を一時のフォルダに作る。AI は本物の中継（dist/cli.js mcp）。先に npm run build を走らせておく。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, callTool as call, mcpClient, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const PASS = "架空の合言葉 台帳から計画へ";
const LEDGER_SOURCE = "ledger:公開の台帳";

let bridge: StartedBridge;
let work = "";
let repo = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-ledger-plan-"));
  repo = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: repo, state: join(work, "demo-state"), month: "2026-11" });
  bridge = await startBuiltBridge("moyai-e2e-ledger-plan-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("AI が台帳を読んで周期の案を置き、人が決定のシートで受けて署名する", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(bridge.stateDir, ["peer_reference", "chart_propose", "intake_survey"]);
  try {
    await test.step("人：設定で置き場所・呼び名・台帳の clone の場所を選ぶ", async () => {
      await page.goto(`${bridge.base}/#/settings`);
      await page.getByTestId("root-input").fill(root);
      await page.getByTestId("name-input").fill(E2E_NAME);
      await page.getByTestId("ledger-input").fill(repo);
      await page.getByTestId("settings-save").click();
      await expect(page.getByTestId("current-ledger")).toHaveText(repo);
    });

    await test.step("見本の計画を MERGE で開く", async () => {
      const body = JSON.stringify(DEV_PLANS["fictional-1"]());
      await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
      await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
      await expect(page.locator(".ag-row").first()).toBeVisible();
    });

    let interval: { commonItem: string; work: string; band: string; n: number } | null = null;
    let ledgerVersion: string | null = null;
    await test.step("AI：人が比べを開かずに、台帳だけを読む。見え方の答えが無ければ聞くことが返り、答えを添えて読み直す", async () => {
      const asked = await call(c, "peer_reference", { place: "ledger" });
      expect(asked).toMatchObject({ mode: "ledger", reason: "answersMissing", aggregates: [] });
      expect(asked.needs.map((q: any) => q.key)).toEqual(expect.arrayContaining(["furnace", "capacity_t_per_day"]));
      // 利用者がチャットで答えた見え方（架空の施設）
      const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C200_400", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
      const r = await call(c, "peer_reference", { place: "ledger", answers });
      expect(r).toMatchObject({ mode: "ledger", position: "municipal", reason: null });
      expect(r.places.map((p: any) => p.place)).toEqual(["ledger"]);
      // 計画にある項目 × 作業の属性で、実施のある作業の塊のうち、間隔の中央の帯が出たもの（AI は chart_rows の共通の行で同じことを見る）
      const plan = DEV_PLANS["fictional-1"]();
      const has = new Set<string>();
      for (const w of plan.works) {
        if (!plan.details.some((d: any) => d.workKey === w.workKey && d.planOrActual === "actual")) continue;
        for (const t of w.targets) {
          const asset = plan.assets.find((x: any) => x.nodeKey === t);
          if (asset?.commonItem && w.attribute) has.add(`${asset.commonItem}|${w.attribute}`);
        }
      }
      const a = r.aggregates.find((x: any) => x.interval.shown === "median" && has.has(`${x.commonItem}|${x.work}`));
      expect(a, "計画にある塊で、中央の帯の出たものがある").toBeTruthy();
      interval = { commonItem: a.commonItem, work: a.work, band: a.interval.median, n: a.interval.n };
      ledgerVersion = r.ledgerVersion ?? null;
    });

    let proposalId = "";
    await test.step("AI：中央の帯から周期を選び、chart_propose で周期の案を置く（足すだけ）", async () => {
      const iv = interval!;
      // 帯の名前の最初の数（I5_6 → 5 年）。AI が帯を読んで決めたことにする
      const years = Number(/\d+/.exec(iv.band)?.[0] ?? "5");
      const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
      const basis = `公開の台帳${ledgerVersion ? `（版 ${ledgerVersion}）` : ""}・似た施設 ${iv.n} の間隔の中央の帯 ${iv.band}`;
      const rules = [{ when: [{ field: "assetNode.commonItem", op: "equals", values: [iv.commonItem] }, { field: "work.attribute", op: "equals", values: [iv.work] }], set: { field: "work.trigger", value: years }, reason: "似た施設の間隔の中央の帯から" }];
      const r = await call(c, "chart_propose", { rules, basedOnVersion: version, basis });
      expect(r.proposals).toHaveLength(1);
      proposalId = r.proposals[0].id;
      expect(r.proposals[0].works).toBeGreaterThan(0);
      expect(r.matched).toBe(r.proposals[0].marks);
      // 台帳の案を、AI が版を元にせずに置き直すことはできない
      const stale: any = await c.callTool({ name: "chart_propose", arguments: { rules, basedOnVersion: version, basis } });
      expect(stale.isError).toBe(true);
    });

    await test.step("決定のシート：台帳からの案が案ごとに 1 行。人が受けて、合言葉で署名して確定する", async () => {
      await page.getByTestId("sheet-decisions").click();
      const row = page.locator('[data-testid="pending-row"][data-kind="ledger"]');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("- 台帳からの案");
      await expect(row).toContainText(`周期の案 ${proposalId}`);
      await expect(row).toContainText("Claude（台帳から）");
      await page.screenshot({ path: shot(`ledger-plan-decisions-${tag}`), fullPage: true });
      await acceptDecisions(page, "試験の台本が押した（似た施設の帯を見て、周期の案を受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("台帳の似た施設の周期を計画に入れる（e2e）");
      await signInDialog(page, PASS);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    });

    await test.step("確定した版に、台帳から来た計画の印が残る（作者は AI、根拠に台帳の版と集計、人が受けた）", async () => {
      const plans = readdirSync(join(root, "plans"));
      const rec = JSON.parse(readFileSync(join(root, "plans", plans[0]!, "versions", "000001.json"), "utf8"));
      const fromLedger = rec.plan.details.filter((d: any) => d.sources.some((s: any) => s.file === LEDGER_SOURCE));
      expect(fromLedger.length).toBeGreaterThan(0);
      expect(fromLedger.every((d: any) => d.author === "ai" && d.planOrActual === "plan" && d.basis.includes("公開の台帳"))).toBe(true);
      const accepted = new Set(rec.acceptances.map((a: any) => a.id));
      expect(fromLedger.every((d: any) => accepted.has(`detail:${d.detailKey}`))).toBe(true);
      // 費用は根拠に書かない
      expect(fromLedger.every((d: any) => !/円|費用/.test(d.basis))).toBe(true);
    });
  } finally {
    await c.close();
  }
});
