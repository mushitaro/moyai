// pack.second の後半（docs/plan.md §2.7・§5.1）：し尿処理のパック（packs/night-soil/ を足しただけ。src/ は変えていない）で、
// 取り込み → 当てはめ → 星取表（共通の設備項目 × 作業の属性の行）が、ごみ焼却と同じコードのまま通る。
// 資料は工場の架空の 1 施設（samples/out/night-soil/fictional-ns-1）。質問には既定の答えを置き、当てはめの規則は
// この試験が AI の代わりに書く（節の名前 → パックの項目の名前が同じもの）。人が受ける道は画面の関数を試験の台本が押す。
// 正解の世界（samples/truth）は、当てた結果を照らすためだけに読む。前半（src/ の差分 0）は tests/packs/pack-second.test.mjs。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { acceptByHuman } from "../../../src/app/state/crosswalk";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { catalogFor } from "../../../src/app/chart/catalog";
import { buildChart } from "../../../src/plan/chart";
import { crosswalkSummary } from "../../../src/plan/crosswalk";
import type { Plan } from "../../../src/shared/plan";
import type { Rule } from "../../../src/shared/tools";
import { Entities, answer, loadTruth } from "../import/truth";

const PACK = "night-soil";
const FACILITY = "fictional-ns-1";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
const CTX = { conversation: "c-night-soil", rowsRemaining: 2000 };
const LABELS = { levelFallback: (n: number) => `L${n}`, commonLevels: ["S", "I", "A"] as [string, string, string], unmapped: "UNMAPPED", series: (s: string) => s };

afterEach(() => clearWorkingPlan());

function ok(r: ReturnType<typeof runTabTool>): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

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

describe("pack.second：し尿処理のパックで、取り込み → 当てはめ → 星取表", () => {
  test("同じコードのまま通り、節の当てはめは正解と一致し、共通の行がパックの項目で出る", async () => {
    const t = loadTruth(PACK, FACILITY);
    const ws = new IntakeWorkspace({ packId: PACK, facilityName: t.world.facility.name, fiscalYearStartMonth: 4, fictional: true });
    const dir = `samples/out/${PACK}/${FACILITY}/`;
    await ws.addFiles(
      FILES.map((n) => {
        const b = new Uint8Array(readFileSync(dir + n));
        return { name: n, size: b.length, bytes: async () => b };
      }),
    );
    expect(ws.skippedFiles).toEqual([]);
    // 質問：決まらないものは人に聞く。試験の台本が、正解の世界から人の代わりに答える（AI には渡さない）
    const ents0 = new Entities(t);
    const asked = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const open = ws.analysis().questions.filter((q) => !q.decision);
      for (const q of open) asked.add(q.questionId);
      const answers = open.map((q) => ({ q, a: answer(q, t, ents0) })).filter((x): x is { q: typeof x.q; a: string } => x.a !== null);
      if (!answers.length) break;
      for (const { q, a } of answers) expect(ws.answerAsHuman(q.questionId, a, "試験の台本が押した（正解の世界から）").ok, q.text).toBe(true);
    }
    expect(ws.analysis().questions.filter((q) => !q.decision).map((q) => q.text)).toEqual([]);
    expect(ws.composeBlockers()).toEqual([]);
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    const plan = (): Plan => getWorkingPlan()!.plan;
    expect(plan().packId).toBe(PACK);
    expect(plan().assets.length).toBeGreaterThanOrEqual(40);
    expect(plan().details.length).toBeGreaterThan(200);

    // 当てはめの要約：パックの 46 項目が見える
    const cw = ok(runTabTool(ws, "intake_survey", { part: "crosswalk" }, CTX)).crosswalk;
    expect(cw.packId).toBe(PACK);
    expect(cw.items.length).toBe(packItems().length);

    // AI の代わりの規則：節の名前がパックの項目の名前と同じなら、その項目
    const names = new Set(plan().assets.map((a) => a.name));
    const rules: Rule[] = packItems()
      .filter((i) => names.has(i.name))
      .map((i) => ({ when: [{ field: "assetNode.name", op: "equals", values: [i.name] }], set: { field: "assetNode.commonItem", value: i.code }, reason: "名前がパックの項目と同じ" }));
    expect(rules.length).toBeGreaterThan(10);
    const r = ok(runTabTool(ws, "crosswalk_propose", { rules, basedOnVersion: getWorkingPlan()!.revision }, CTX));
    expect(r.conflicts).toBe(0);
    // 作業の属性：作業の種類の名前から（点検 → INSPECT など。名前の無い作業は当てない）
    const kinds = [...new Set(plan().works.map((w) => w.kind).filter((k) => k !== ""))];
    const attrOf = (k: string) => (/点検|検査|測定/.test(k) ? "INSPECT" : /整備|分解|オーバーホール/.test(k) ? "OVERHAUL" : /更新|取替|交換/.test(k) ? "REPLACE" : null);
    const wr: Rule[] = (["INSPECT", "OVERHAUL", "REPLACE"] as const)
      .map((a) => ({ a, ks: kinds.filter((k) => attrOf(k) === a) }))
      .filter((x) => x.ks.length > 0)
      .map((x) => ({ when: [{ field: "work.kind", op: "in", values: x.ks.slice(0, 20) }], set: { field: "work.attribute", value: x.a }, reason: "作業の名前から" }));
    expect(wr.length).toBeGreaterThan(0);
    ok(runTabTool(ws, "crosswalk_propose", { rules: wr, basedOnVersion: getWorkingPlan()!.revision }, CTX));
    // 人（試験の台本）が受ける
    for (const p of getWorkingPlan()!.proposals) expect(acceptByHuman(p.ruleId, "試験の台本が押した").ok).toBe(true);

    // 受けた節は、正解の機器のコードと一致する
    const ents = new Entities(t);
    const codeOf = t.world.equipment_to_code as Record<string, string>;
    let checked = 0;
    for (const a of plan().assets.filter((x) => x.commonItemAccepted)) {
      const hit = a.sources.map((x) => (x.cell ? ents.of(x.file, x.cell) : null)).find((k) => k?.startsWith("e:"));
      if (!hit) continue;
      expect(a.commonItem, a.name).toBe(codeOf[hit.slice(2)]);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);

    // 星取表：共通の行はパックの設備と項目の名前で出る（コードに業種の語は無い）
    const catalog = catalogFor(PACK);
    expect(catalog).not.toBeNull();
    const chart = buildChart(plan(), catalog!, LABELS, { mode: "common", period: "year", layer: "original", foldLevel: null });
    const firstLevel = new Set(chart.rows.map((row) => row.levelCells[0]).filter((x) => x));
    expect([...firstLevel].some((n) => n === "受入貯留設備")).toBe(true);
    const s = crosswalkSummary(plan());
    expect(s.nodes.accepted).toBeGreaterThan(10);
    expect(s.works.accepted).toBeGreaterThan(0);
    // 測った値を残す（目標ではない）：質問の数と未当てはめの記録
    console.log(`し尿処理 ${FACILITY}：質問 ${asked.size}、節 受けた ${s.nodes.accepted}/${s.nodes.targeted}、作業 受けた ${s.works.accepted}/${s.works.total}、未当てはめの記録 ${s.unmappedRecords}`);
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});
