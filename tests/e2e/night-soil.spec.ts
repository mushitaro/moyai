// ほかの設備へ（docs/plan.md §6.1 の 7・§2.7）：し尿処理のパック（packs/night-soil/ を足しただけ。src/ は変えていない）で、
// ごみ焼却と同じ画面・同じ道のまま、取り込み → 計画 → 当てはめ → 星取表（共通の設備項目 × 作業の属性の行）が出る。
// 人が資料を落とし、AI は本物の中継（dist/cli.js mcp）で要約を読み、既定の答えを置き、当てはめの規則を置く。
// 規則は、星取表の段の道にある名前が、パックの 1 段目の項目の名前と同じものだけ（AI の代わりにこの試験が書く）。
// 人の受けるは、試験の台本が画面で押す。先に npm run build を走らせておく。
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { acceptRules, callTool as call, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const PACK = "night-soil";
const FACILITY = "【架空】し尿処理の一施設";
const SET = { dir: "samples/out/night-soil/fictional-ns-1", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"] };
const HUMAN = "試験の台本が押した（台帳の名前とパックの項目の名前が同じ）";

/** パックの 1 段目の項目（コードと名前） */
function packItems(): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    for (const v of Object.values(n as Record<string, unknown>))
      if (Array.isArray(v))
        for (const x of v) {
          const o = x as { code?: unknown; name?: unknown };
          if (typeof o.code === "string" && typeof o.name === "string" && o.code.split(".").length > 2) out.push({ code: o.code, name: o.name });
          walk(x);
        }
  };
  walk(JSON.parse(readFileSync(`packs/${PACK}/common.json`, "utf8")));
  return out;
}

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-night-soil-");
});
test.afterAll(() => bridge?.stop());

test("し尿処理のパックで、同じ画面のまま取り込み → 計画 → 当てはめ → 星取表", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "crosswalk_propose"]);
  try {
    await test.step("人：し尿処理のパックを選び、資料を取り込みの画面に落とす", async () => {
      await openIntakeAndDrop(page, bridge.base, FACILITY, SET, PACK);
      await page.screenshot({ path: shot(`night-soil-dropped-${tag}`), fullPage: true });
    });

    await test.step("AI は既定の答えでよいと言われたものを置き、既定の答えの無い質問（同じ名前の機器が 2 系統にある）には人が画面で答える", async () => {
      // 人（試験の台本が押した）：星取表の上の行から順に、1 系・2 系の機器（選択肢の 1 つ目・2 つ目）と結ぶ。答えは正解の世界と同じ（確かめ済み）
      const seen = new Map<string, number>();
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(30);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        const withDefault = s.questions.filter((q: any) => q.defaultAnswer !== null);
        if (withDefault.length) {
          await call(c, "intake_settle", {
            decisions: withDefault.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })),
          });
          continue;
        }
        const first = page.getByTestId("question").filter({ hasText: "既定の答えはありません" }).first();
        await expect(first).toBeVisible();
        const id = await first.getAttribute("data-question");
        const q = page.locator(`[data-question="${id}"]`);
        const name = /「(.+?)」/.exec((await q.textContent()) ?? "")?.[1] ?? "";
        const n = seen.get(name) ?? 0;
        seen.set(name, n + 1);
        await q.scrollIntoViewIfNeeded();
        await q.getByRole("radio").nth(n).check();
        await q.getByTestId("answer").click();
        await expect(q).toHaveCount(0);
      }
      await expect(page.getByTestId("question")).toHaveCount(0);
      const authors = await page.getByTestId("decision").evaluateAll((els) => els.map((e) => e.getAttribute("data-author")));
      expect(authors).toContain("human");
    });

    await test.step("AI：計画を作る", async () => {
      expect((await call(c, "intake_survey", { part: "questions" })).questions).toEqual([]);
      expect((await call(c, "intake_compose")).started).toBe(true);
      let state = "running";
      for (let i = 0; i < 80 && state === "running"; i++) {
        state = (await call(c, "intake_survey", { part: "compose" })).compose.state;
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state).toBe("done");
      await expect(page.getByTestId("composed")).toContainText("AI が作りました");
    });

    let ruleCount = 0;
    await test.step("AI：パックの項目と段の道を読み、名前が同じ節に規則を置く（どれも案）", async () => {
      const cw = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk;
      expect(cw.packId).toBe(PACK);
      const items = packItems();
      expect(cw.items.length).toBe(items.length);
      const rows = await call(c, "chart_rows", { limit: 200 });
      const names = new Set<string>(rows.rows.flatMap((r: any) => String(r.cells["段の道"] ?? "").split(" › ")));
      const rules = items
        .filter((i) => names.has(i.name))
        .slice(0, 50)
        .map((i) => ({ when: [{ field: "assetNode.name", op: "equals", values: [i.name] }], set: { field: "assetNode.commonItem", value: i.code }, reason: "台帳の名前がパックの項目の名前と同じ" }));
      expect(rules.length).toBeGreaterThan(5);
      // 作業の属性：要約の欄ごとの多い値（作業の種類）の名前から（点検 → INSPECT など。決まらない名前は当てない）
      const kinds: string[] = (cw.fields.find((f: any) => f.field === "work.kind")?.top ?? []).map((t: any) => String(t.value)).filter((k: string) => k !== "");
      const attrOf = (k: string) => (/点検|検査|測定/.test(k) ? "INSPECT" : /整備|分解|オーバーホール/.test(k) ? "OVERHAUL" : /更新|取替|交換/.test(k) ? "REPLACE" : null);
      const works = (["INSPECT", "OVERHAUL", "REPLACE"] as const)
        .map((a) => ({ a, ks: kinds.filter((k) => attrOf(k) === a) }))
        .filter((x) => x.ks.length > 0)
        .map((x) => ({ when: [{ field: "work.kind", op: "in", values: x.ks.slice(0, 20) }], set: { field: "work.attribute", value: x.a }, reason: "作業の名前から" }));
      expect(works.length).toBeGreaterThan(0);
      ruleCount = rules.length + works.length;
      const r = await call(c, "crosswalk_propose", { rules: [...rules, ...works], basedOnVersion: cw.version });
      expect(r.conflicts).toBe(0);
      // 当てはめの案は、MERGE の決定のシートに 1 規則 1 行で並ぶ
      await page.getByTestId("sheet-decisions").click();
      await expect(page.locator('[data-testid="crosswalk-rule"][data-state="proposed"]')).toHaveCount(ruleCount);
    });

    await test.step("人（試験の台本が押した）：画面で規則ごとに一言の理由を書いて受ける", async () => {
      expect(await acceptRules(page, HUMAN)).toBe(ruleCount);
      await page.screenshot({ path: shot(`night-soil-crosswalk-accepted-${tag}`), fullPage: true });
    });

    await test.step("星取表：ごみ焼却と同じ画面で、し尿処理のパックの設備と項目の行が出る", async () => {
      await page.getByTestId("sheet-chart").click();
      await expect(page.getByTestId("plan-name")).toHaveText(FACILITY);
      await page.getByTestId("rows-mode").getByText("共通の設備項目 × 作業の属性").click();
      await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
      await expect(page.locator(".ag-row").first()).toBeVisible();
      await page.screenshot({ path: shot(`night-soil-chart-common-${tag}`) });
      // 1 段目の列には、し尿処理のパックの設備の名前が出る（ごみ焼却の名前ではない）
      const firstLevel = (JSON.parse(readFileSync(`packs/${PACK}/common.json`, "utf8")) as { systems?: { name: string }[] }).systems?.map((e) => e.name) ?? [];
      const shown = (await page.locator(".ag-row [col-id='lv1']").allTextContents()).map((t) => t.trim()).filter(Boolean);
      const mapped = shown.filter((t) => !t.startsWith("未当てはめ"));
      expect(mapped.length, `出た 1 段目：${shown.join("・")}`).toBeGreaterThan(0);
      expect(mapped.every((t) => firstLevel.includes(t)), `出た 1 段目：${shown.join("・")}`).toBe(true);
      expect(Number(await page.getByTestId("chart-rows-count").getAttribute("data-total"))).toBeGreaterThan(10);
    });
  } finally {
    await c.close();
  }
});
