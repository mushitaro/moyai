// 物差し ④ 検査の正しさ（docs/plan.md §2.6・§5.1 checks）：工場の fictional-1 の資料を取り込み（crosswalk.test.ts と同じ道）、
// 当てはめの規則を試験の台本が人の代わりに受けた計画に、ごみ焼却のパックの検査を走らせ、工場が入れた欠け（正解の gaps）と比べる。
// 合格：欠けはすべて notMet、誤検出 0、欠けを埋めた計画では met。
// 正解の世界（samples/truth）は試験だけが読む。欠けと検査の対応（検査 ID ↔ 正解の検査の印）も、この試験だけが持つ（src/ は正解を知らない）。
// 欠けに当たらない検査の結果も、正解の世界から期待を作って照らす（計画の窓・保全方式・判定の値の有無）。
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { fiscalYearOfDate, runChecks, type CheckRun } from "../../../src/review/checks";
import { loadPackChecks } from "../../../src/review/spec";
import type { Plan } from "../../../src/shared/plan";
import { Entities, loadTruth, type Truth } from "../import/truth";
import { FACILITY, PACK, composeFictional1 } from "./compose";

/** 正解の検査の印 → パックの検査（この試験だけが持つ対応） */
const GAP_CHECK: Record<string, string> = {
  "INSP-INTERVAL": "WI-PRECISION-INTERVAL",
  "INSP-NOACTUAL": "WI-PLAN-DONE",
  "INSP-NOPLAN": "WI-PLAN-COVERAGE",
};

interface Gap {
  id: string;
  inspection_id: string;
  equipment_id: string;
  fiscal_year: number;
}

let truth: Truth;
let plan: Plan;
let nodeOf: Map<string, string>;
let reference: string;
const loaded = (() => {
  const l = loadPackChecks(JSON.parse(readFileSync(`packs/${PACK}/checks.json`, "utf8")), JSON.parse(readFileSync(`packs/${PACK}/sources.json`, "utf8")));
  if (!l.ok) throw new Error(`パックの検査を読めない：${l.reason}`);
  return l;
})();
const run = (p: Plan): CheckRun => runChecks(loaded, { plan: p, referenceDate: reference, approvals: [] });
const resultOf = (r: CheckRun, id: string) => r.results.find((x) => x.checkId === id)!;

beforeAll(async () => {
  truth = loadTruth(PACK, FACILITY);
  reference = truth.world.today as string;
  await composeFictional1(truth.world.facility.name);
  plan = structuredClone(getWorkingPlan()!.plan);
  // 正解の機器 → 計画の資産の節（台帳のセルの出どころで結ぶ）
  const ents = new Entities(truth);
  nodeOf = new Map();
  for (const a of plan.assets) {
    const hit = a.sources.map((s) => (s.cell ? ents.of(s.file, s.cell) : null)).find((k) => k?.startsWith("e:"));
    if (hit) nodeOf.set(hit.slice(2), a.nodeKey);
  }
}, 60_000);
afterAll(() => clearWorkingPlan());

/** 欠けを埋めた計画：入れた欠けごとに、正解の世界にあるはずの印を 1 つ足す（ほかは変えない） */
function corrected(p: Plan, gaps: Gap[]): Plan {
  const out = structuredClone(p);
  let n = 0;
  const add = (workKey: string, fy: number, kind: "plan" | "actual") => {
    const like = out.details.find((d) => d.workKey === workKey)!;
    out.details.push({
      ...like,
      detailKey: `fix-${++n}`,
      planOrActual: kind,
      fiscalYear: fy,
      startDate: null,
      endDate: null,
      basis: "試験の台本が直した（入れた欠けを埋めた）",
      author: "human",
    });
  };
  for (const g of gaps) {
    const node = nodeOf.get(g.equipment_id)!;
    const onNode = out.works.filter((w) => w.targets.includes(node));
    if (g.inspection_id === "INSP-INTERVAL") add(onNode.find((w) => w.kind === truth.world.rules.patterns.find((x: any) => x.id === "P-PREC").label)!.workKey, g.fiscal_year, "actual");
    else if (g.inspection_id === "INSP-NOACTUAL") {
      const planned = out.details.find((d) => d.planOrActual === "plan" && d.fiscalYear === g.fiscal_year && onNode.some((w) => w.workKey === d.workKey))!;
      add(planned.workKey, g.fiscal_year, "actual");
    } else add(onNode[0]!.workKey, g.fiscal_year, "plan");
  }
  return out;
}

describe("④ 検査の正しさ：fictional-1 の入れた欠けと比べる", () => {
  test("入れた欠けはすべて notMet、欠けに当たる検査の誤検出は 0、欠けを埋めた計画では met", () => {
    const gaps = truth.world.gaps as Gap[];
    expect(gaps.length).toBeGreaterThanOrEqual(5);
    for (const g of gaps) expect(GAP_CHECK[g.inspection_id], g.inspection_id).toBeTruthy();
    for (const g of gaps) expect(nodeOf.get(g.equipment_id), g.equipment_id).toBeTruthy();
    const r = run(plan);
    expect(r.referenceFiscalYear).toBe(fiscalYearOfDate(reference, 4));

    let detected = 0;
    let falsePositives = 0;
    for (const [insp, checkId] of Object.entries(GAP_CHECK)) {
      const c = resultOf(r, checkId);
      const mine = gaps.filter((g) => g.inspection_id === insp);
      expect(c.result, checkId).toBe("notMet");
      // 例は 10 件までなので、件数が 10 を越えないことを先に見る（越えれば、全部を照らせない）
      expect(c.count, checkId).toBeLessThanOrEqual(10);
      const hit = (g: Gap) =>
        c.examples.some((e) => {
          if (e.nodeKey !== nodeOf.get(g.equipment_id)) return false;
          if (insp === "INSP-INTERVAL") return e.fiscalYears.length === 2 && e.fiscalYears[0]! < g.fiscal_year && g.fiscal_year < e.fiscalYears[1]!;
          if (insp === "INSP-NOACTUAL") return e.fiscalYears[0] === g.fiscal_year;
          return e.fiscalYears[0]! <= g.fiscal_year && g.fiscal_year <= e.fiscalYears[1]!;
        });
      for (const g of mine) {
        expect(hit(g), `${g.id} を見つけられない`).toBe(true);
        detected++;
      }
      // 誤検出：どの欠けにも当たらない例
      const fp = c.examples.filter((e) => !mine.some((g) => e.nodeKey === nodeOf.get(g.equipment_id)));
      falsePositives += fp.length;
      expect(fp, `${checkId} の誤検出`).toEqual([]);
      expect(c.count).toBe(mine.length);
    }
    expect(detected).toBe(gaps.length);
    expect(falsePositives).toBe(0);

    // 欠けを埋めた計画：欠けに当たる検査は met、ほかの検査の結果は変わらない
    const fixed = run(corrected(plan, gaps));
    let metAfter = 0;
    for (const checkId of Object.values(GAP_CHECK)) {
      expect(resultOf(fixed, checkId).result, checkId).toBe("met");
      metAfter++;
    }
    for (const c of r.results.filter((x) => !Object.values(GAP_CHECK).includes(x.checkId))) expect(resultOf(fixed, c.checkId).result, c.checkId).toBe(c.result);
    // 測った数（行の値は出さない）
    console.log(`checks ④：入れた欠け ${gaps.length}、notMet で見つけた ${detected}、誤検出 ${falsePositives}、欠けを埋めた計画で met ${metAfter}/${Object.keys(GAP_CHECK).length}（欠けに当たる検査）`);
  });

  test("欠けに当たらない検査も、正解の世界から作った期待のとおり", () => {
    const r = run(plan);
    const w = truth.world;
    // 計画の年数：正解の計画の窓は基準日の年度から fy_to まで。アプリの目安の 10 年度に届かない
    const horizon = w.plan_window.fy_to - fiscalYearOfDate(reference, 4) + 1;
    const h = resultOf(r, "WI-PLAN-HORIZON");
    expect(h.numbers.horizonYears).toBe(horizon);
    expect(h.result).toBe(horizon >= 10 ? "met" : "notMet");
    // 計画の窓の期間（coverage の期間）も、正解の窓と同じ
    expect(resultOf(r, "WI-PLAN-COVERAGE").numbers).toMatchObject({ fromFiscalYear: w.plan_window.fy_from, toFiscalYear: w.plan_window.fy_to });
    // 保全方式ときっかけ：正解の世界の作業に保全方式の欄は無く、星取表にも機器別管理基準の列は無い → 見た作業のすべてが notMet
    expect((w.works as Record<string, unknown>[]).every((x) => !("strategy" in x))).toBe(true);
    const f = resultOf(r, "WI-PLAN-FIELDS");
    expect(f.result).toBe("notMet");
    expect(f.count).toBe(f.examined);
    // 健全度：正解の世界に判定の値は無い → どちらも notApplicable（判定の値が無い）
    expect((w.works as Record<string, unknown>[]).some((x) => "grade" in x || "result" in x)).toBe(false);
    for (const id of ["WI-HEALTH-SCALE", "WI-HEALTH-FOLLOWUP"]) expect(resultOf(r, id)).toMatchObject({ result: "notApplicable", notApplicable: "noValues" });
    // パックの検査はどれも結果を持つ（落とした検査が無い）
    expect(r.results.map((x) => x.checkId)).toEqual(loaded.checks.checks.map((c) => c.id));
  });

  test("同じ計画と同じ基準日なら、2 回走らせても同じ結果", () => {
    expect(run(structuredClone(plan))).toEqual(run(plan));
  });
});
