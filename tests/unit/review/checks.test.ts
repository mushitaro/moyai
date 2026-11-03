// 検査の種類ごとの試験（docs/plan.md §2.4・§5.1 checks）：met / notMet / notApplicable の境目、承認の無い延長、
// 年度の粒度、純粋さ（同じ入力なら同じ結果、計画を書き換えない）、パックの検査の読み込み。
// 計画は試験の中で小さく組む（工場の計画を使う ④ の物差しは measure.test.ts）。
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fiscalYearOfDate, runCheck, runChecks, type CheckInput, type ExtensionApproval } from "../../../src/review/checks";
import { checkSpecSchema, loadPackChecks, type CheckSpec, type PackChecks, type PackSources } from "../../../src/review/spec";
import type { Plan } from "../../../src/shared/plan";
import { CHECK_KINDS } from "../../../src/shared/tools";

const REF = "2026-10-01"; // 年度は 2026（4 月始まり）
const SRC: PackSources = {
  schema: "moyai.sources/0",
  pack: "test",
  sources: [
    { id: "S-OK", name: "照らした資料", url: "https://www.env.go.jp/x.html", state: "原典照合済" },
    { id: "S-SUM", name: "要約だけの資料", url: "https://www.env.go.jp/y.html", state: "要約のみ" },
  ],
};

type Mark = { fy: number; kind?: "plan" | "actual"; date?: string | null; value?: string | null; scale?: string | null; step?: "inspection" | "diagnosis" | "action" | null };
type W = { key: string; kind?: string; attribute?: Plan["works"][number]["attribute"]; targets: string[]; strategy?: Plan["works"][number]["strategy"]; trigger?: unknown; marks: Mark[] };

/** 設備 S の下に機器 A・B（どちらも 1 段目に当て、人が受けた）、A の下に部位 A1、受けていない機器 C、撤去した機器 R */
function makePlan(works: W[], opts: { start?: number; extraAssets?: Plan["assets"] } = {}): Plan {
  const node = (nodeKey: string, level: number, parentKey: string | null, commonItem: string | null, accepted: boolean, removedOn: string | null = null): Plan["assets"][number] => ({
    nodeKey,
    tag: null,
    name: `節 ${nodeKey}`,
    level,
    parentKey,
    classCode: null,
    commonItem,
    commonItemAuthor: commonItem ? "human" : null,
    commonItemBasis: commonItem ? "試験" : null,
    commonItemAccepted: accepted,
    specs: [],
    installedOn: null,
    removedOn,
    replacedOn: null,
    series: null,
    sources: [],
  });
  let n = 0;
  return {
    schema: "moyai.plan/0",
    planId: "p-test",
    displayName: "試験の計画",
    packId: "test",
    version: 0,
    levelNames: ["設備", "機器", "部位"],
    facility: { facilityKey: "f", name: "【架空】試験", fiscalYearStartMonth: opts.start ?? 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    assets: [
      node("S", 1, null, null, false),
      node("A", 2, "S", "TT.X.A", true),
      node("A1", 3, "A", null, false),
      node("B", 2, "S", "TT.X.B", true),
      node("C", 2, "S", "TT.X.C", false),
      node("R", 2, "S", "TT.X.R", true, "2020-03-31"),
      ...(opts.extraAssets ?? []),
    ],
    works: works.map((w) => ({
      workKey: w.key,
      kind: w.kind ?? "",
      attribute: w.attribute === undefined ? "INSPECT" : w.attribute,
      attributeAuthor: "human",
      attributeBasis: "試験",
      attributeAccepted: true,
      strategy: w.strategy ?? null,
      targets: w.targets,
      trigger: w.trigger ?? null,
      checkIds: [],
      contractor: null,
      parentWorkKey: null,
      tagRange: null,
      tagList: [],
    })),
    details: works.flatMap((w) =>
      w.marks.map((m) => ({
        detailKey: `d${++n}`,
        workKey: w.key,
        planOrActual: m.kind ?? "actual",
        step: m.step ?? null,
        startDate: m.date ?? null,
        endDate: null,
        fiscalYear: m.fy,
        cost: null,
        manDays: null,
        days: null,
        resultScale: m.scale ?? null,
        resultValue: m.value ?? null,
        measuredValue: null,
        previousValue: null,
        performer: null,
        sources: [{ file: "x.xlsx", sheet: null, page: null, cell: null, box: null }],
        basis: "試験",
        author: "human" as const,
        needsReview: false,
      })),
    ),
  };
}

const spec = (params: CheckSpec["params"], over: Partial<CheckSpec> = {}): CheckSpec =>
  checkSpecSchema.parse({ id: "T-CHECK", name: "試験の検査", what: "試験", level: "app", thresholdOrigin: "app", source: null, unimplemented: null, note: null, params, ...over });
const loaded = (checks: CheckSpec[]) => ({ ok: true as const, checks: { schema: "moyai.checks/0" as const, pack: "test", version: 1, checks, notMade: [] } satisfies PackChecks, sources: SRC });
const run = (s: CheckSpec, plan: Plan, approvals: ExtensionApproval[] = [], referenceDate = REF) => runCheck(s, loaded([s]), { plan, referenceDate, approvals });

const a = (fy: number, date: string | null = null): Mark => ({ fy, kind: "actual", date });
const p = (fy: number, date: string | null = null): Mark => ({ fy, kind: "plan", date });

// ─── interval_max ───────────────────────────────────────────

describe("interval_max：対象の機器ごとの実施の間", () => {
  const S = spec({ kind: "interval_max", works: [{ field: "work.kind", op: "in", values: ["検査イ"] }], years: 3, extensionCapYears: null });
  const one = (marks: Mark[], extra: W[] = []) => makePlan([{ key: "w1", kind: "検査イ", targets: ["A"], marks }, ...extra]);

  test("間がちょうど 3 年度なら met、4 年度なら notMet（前と後の年度と年数を例に出す）", () => {
    expect(run(S, one([a(2020), a(2023), a(2026)])).result).toBe("met");
    const r = run(S, one([a(2019), a(2023), a(2026)]));
    expect(r.result).toBe("notMet");
    expect(r.count).toBe(1);
    expect(r.examples[0]).toMatchObject({ nodeKey: "A", fiscalYears: [2019, 2023], years: 4, why: "gap" });
    expect(r.numbers).toMatchObject({ thresholdYears: 3, longestYears: 4, examined: 1, notMet: 1 });
  });

  test("最後の実施から基準日の年度までが空きすぎれば notMet（まだ来ない次回でも、もう過ぎている）", () => {
    const r = run(S, one([a(2020)]));
    expect(r.result).toBe("notMet");
    expect(r.examples[0]).toMatchObject({ fiscalYears: [2020], years: 6, why: "gapToEnd" });
    expect(run(S, one([a(2023)])).result).toBe("met");
  });

  test("これからの予定は実施に数えるが、過ぎた予定で実績の無いものは数えない", () => {
    expect(run(S, one([a(2024), p(2027)])).result).toBe("met");
    const r = run(S, one([a(2019), p(2022), a(2025)]));
    expect(r.result).toBe("notMet");
    expect(r.examples[0]).toMatchObject({ fiscalYears: [2019, 2025], years: 6 });
  });

  test("計画の最後の年度まで、この作業の予定が無ければ、その先の間も見る", () => {
    // ほかの作業が 2030 年度まで予定を持つ。この作業は 2025 年度が最後 → 2030 年度までに 5 年度空く
    const r = run(S, one([a(2025)], [{ key: "w2", kind: "別の作業", targets: ["B"], marks: [p(2030)] }]));
    expect(r.result).toBe("notMet");
    expect(r.examples[0]).toMatchObject({ fiscalYears: [2025], years: 5, why: "gapToEnd" });
    expect(r.numbers.toFiscalYear).toBe(2030);
  });

  test("対象の作業が無ければ notApplicable。作業の種類は全角・半角と空白をそろえて比べる", () => {
    const none = run(S, makePlan([{ key: "w1", kind: "別の作業", targets: ["A"], marks: [a(2019)] }]));
    expect(none).toMatchObject({ result: "notApplicable", notApplicable: "noTargets", examined: 0, count: 0, examples: [] });
    const half = spec({ kind: "interval_max", works: [{ field: "work.kind", op: "equals", values: ["ｹﾝｻ イ"] }], years: 3, extensionCapYears: null });
    expect(run(half, makePlan([{ key: "w1", kind: "ケンサイ", targets: ["A"], marks: [a(2019)] }])).result).toBe("notMet");
  });

  test("実施も今後の予定も無い機器（過ぎた予定だけ）は notMet（never）", () => {
    const r = run(S, one([p(2021)]));
    expect(r.examples[0]).toMatchObject({ nodeKey: "A", fiscalYears: [], why: "never" });
  });

  describe("承認による延長：記録の無い延長は notMet", () => {
    const capped = spec({ kind: "interval_max", works: [{ field: "work.kind", op: "in", values: ["検査イ"] }], years: 3, extensionCapYears: 5 });
    const plan = one([a(2019), a(2023), a(2026)]); // 間 4
    const ok: ExtensionApproval = { checkId: "T-CHECK", nodeKey: "A", upToYears: 4, author: "human", reason: "工事の都合で 1 年延ばすと決めた", approvedOn: "2022-03-01" };

    test("上限の内でも、承認の記録が無ければ notMet（extensionNotApproved）", () => {
      const r = run(capped, plan);
      expect(r.result).toBe("notMet");
      expect(r.examples[0]?.why).toBe("extensionNotApproved");
    });
    test("人の承認があり、上限の内なら met（認めた延長の数を出す）", () => {
      const r = run(capped, plan, [ok]);
      expect(r.result).toBe("met");
      expect(r.numbers.approvedExtensions).toBe(1);
    });
    test("承認の年数が足りない・ほかの機器・ほかの検査・理由が空・上限を越える間は notMet", () => {
      expect(run(capped, plan, [{ ...ok, upToYears: 3 }]).result).toBe("notMet");
      expect(run(capped, plan, [{ ...ok, nodeKey: "B" }]).result).toBe("notMet");
      expect(run(capped, plan, [{ ...ok, checkId: "OTHER" }]).result).toBe("notMet");
      expect(run(capped, plan, [{ ...ok, reason: " " }]).result).toBe("notMet");
      const long = one([a(2019), a(2025)]); // 間 6 > 上限 5
      const r = run(capped, long, [{ ...ok, upToYears: 6 }]);
      expect(r.result).toBe("notMet");
      expect(r.examples[0]?.why).toBe("gap");
    });
    test("延長の定めが無い（上限 null）なら、承認があっても notMet", () => {
      expect(run(S, plan, [ok]).result).toBe("notMet");
    });
    test("AI の作者の承認は型で受けない（作者は人だけ）", () => {
      const ai = { ...ok, author: "ai" } as unknown as ExtensionApproval;
      expect(run(capped, plan, [ai]).result).toBe("notMet");
    });
  });
});

// ─── next_due ───────────────────────────────────────────────

describe("next_due（予定の印）：過ぎた予定に実績があるか", () => {
  const S = spec({ kind: "next_due", due: "plan_mark", works: [] });

  test("過ぎた年度の予定に、同じ機器・同じ年度の実績が無ければ notMet", () => {
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2022), a(2023)] }]));
    expect(r.result).toBe("notMet");
    expect(r.examples[0]).toMatchObject({ nodeKey: "A", workKey: "w1", fiscalYears: [2022], why: "noActual" });
  });

  test("実績が別の作業（名前の違う同じ属性の作業）にあっても実施とする。属性が違えば実施としない", () => {
    const met = makePlan([
      { key: "w1", targets: ["A"], marks: [p(2022)] },
      { key: "w2", kind: "名前のある作業", targets: ["A"], marks: [a(2022, "2022-05-12")] },
    ]);
    expect(run(S, met).result).toBe("met");
    const other = makePlan([
      { key: "w1", targets: ["A"], marks: [p(2022)] },
      { key: "w2", attribute: "OVERHAUL", targets: ["A"], marks: [a(2022)] },
    ]);
    expect(run(S, other).result).toBe("notMet");
    // 属性の決まっていない作業の予定は、どの属性の実績でもよい
    const none = makePlan([
      { key: "w1", attribute: null, targets: ["A"], marks: [p(2022)] },
      { key: "w2", attribute: "OVERHAUL", targets: ["A"], marks: [a(2022)] },
    ]);
    expect(run(S, none).result).toBe("met");
    // ほかの機器の実績では実施としない
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2022)] }, { key: "w2", targets: ["B"], marks: [a(2022)] }])).result).toBe("notMet");
  });

  test("日付の無い予定は年度が終わるまで過ぎない。日付のある予定は、その日が基準日より前なら過ぎた", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2026)] }]))).toMatchObject({ result: "notApplicable", notApplicable: "noPastPlans" });
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2026, "2026-09-30")] }])).result).toBe("notMet");
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2026, "2026-10-01")] }])).result).toBe("notApplicable");
    // 同じ計画でも、基準日を 1 年進めると過ぎた予定になる
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2026)] }]), [], "2027-04-01").result).toBe("notMet");
  });
});

// ─── coverage ───────────────────────────────────────────────

describe("coverage：受けた機器のすべてに、計画の期間の予定があるか", () => {
  const S = spec({ kind: "coverage", needs: "plan_in_horizon" });

  test("どちらの機器にも予定があれば met。部位の予定は機器の予定に数える", () => {
    const r = run(S, makePlan([{ key: "w1", targets: ["A1"], marks: [p(2027)] }, { key: "w2", targets: ["B"], marks: [p(2028)] }]));
    expect(r.result).toBe("met");
    expect(r.examined).toBe(2); // 受けていない C と、撤去した R は見ない
    expect(r.numbers).toMatchObject({ fromFiscalYear: 2026, toFiscalYear: 2028 });
  });

  test("予定の無い機器があれば notMet。実績だけ・期間の前の予定は数えない", () => {
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2028)] }, { key: "w2", targets: ["B"], marks: [a(2026), p(2024)] }]));
    expect(r.result).toBe("notMet");
    expect(r.examples).toEqual([expect.objectContaining({ nodeKey: "B", fiscalYears: [2026, 2028], why: "noPlanInHorizon" })]);
  });

  test("これからの予定が 1 つも無ければ notApplicable（期間が決まらない）。受けた機器が無ければ noTargets", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [a(2025)] }])).notApplicable).toBe("noFuturePlans");
    const noMapped = makePlan([{ key: "w1", targets: ["A"], marks: [p(2027)] }]);
    noMapped.assets.forEach((x) => (x.commonItemAccepted = false));
    expect(run(S, noMapped).notApplicable).toBe("noTargets");
  });
});

// ─── plan_horizon ───────────────────────────────────────────

describe("plan_horizon：基準日の年度から最後の予定の年度まで", () => {
  const S = spec({ kind: "plan_horizon", years: 10 });
  test("ちょうど 10 年度なら met、9 年度なら notMet、これからの予定が無ければ 0 年度で notMet", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2035)] }])).result).toBe("met");
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [p(2034)] }]));
    expect(r).toMatchObject({ result: "notMet", numbers: { horizonYears: 9, thresholdYears: 10, fromFiscalYear: 2026, toFiscalYear: 2034 } });
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [a(2025)] }])).numbers.horizonYears).toBe(0);
  });
  test("作業明細が無い計画は notApplicable", () => {
    expect(run(S, makePlan([])).notApplicable).toBe("noDetails");
  });
});

// ─── plan_fields ────────────────────────────────────────────

describe("plan_fields：受けた機器の作業に、保全方式ときっかけの欄があるか", () => {
  const S = spec({ kind: "plan_fields", fields: ["strategy", "trigger"] });
  test("どちらもあれば met。片方でも空なら notMet で、欄ごとの空の数を出す", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], strategy: "time_based", trigger: { every: 3 }, marks: [p(2027)] }])).result).toBe("met");
    const r = run(S, makePlan([
      { key: "w1", targets: ["A"], strategy: "time_based", marks: [p(2027)] },
      { key: "w2", targets: ["A1"], marks: [p(2027)] },
      { key: "w3", targets: ["C"], marks: [p(2027)] }, // 受けていない機器の作業は見ない
    ]));
    expect(r).toMatchObject({ result: "notMet", examined: 2, count: 2, numbers: { "missing.work.strategy": 1, "missing.work.trigger": 2 } });
    expect(r.examples.map((e) => [e.workKey, e.fields])).toEqual([
      ["w1", ["work.trigger"]],
      ["w2", ["work.strategy", "work.trigger"]],
    ]);
  });
  test("受けた機器の作業が無ければ notApplicable", () => {
    expect(run(S, makePlan([{ key: "w3", targets: ["C"], marks: [p(2027)] }])).notApplicable).toBe("noTargets");
  });
});

// ─── record_fields ──────────────────────────────────────────

describe("record_fields：記録に決められた欄があるか", () => {
  test("実績の日付が空なら notMet。予定は of が plan のときだけ見る。見る記録が無ければ notApplicable", () => {
    const S = spec({ kind: "record_fields", of: "actual", fields: ["startDate"], works: [] });
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [a(2024, "2024-05-01"), a(2025), p(2027)] }]));
    expect(r).toMatchObject({ result: "notMet", examined: 2, count: 1, numbers: { "missing.workDetail.startDate": 1 } });
    expect(r.examples[0]).toMatchObject({ fiscalYears: [2025], fields: ["workDetail.startDate"] });
    const plans = spec({ kind: "record_fields", of: "plan", fields: ["startDate"], works: [] });
    expect(run(plans, makePlan([{ key: "w1", targets: ["A"], marks: [a(2025)] }])).notApplicable).toBe("noDetails");
  });
});

// ─── scale_valid と followup ────────────────────────────────

const graded = (value: string, fy = 2024, scale: string | null = null): Mark => ({ fy, kind: "actual", value, scale, step: "diagnosis" });

describe("scale_valid：判定の値が尺度に属するか", () => {
  const S = spec({ kind: "scale_valid", scale: "尺度イ", values: ["4", "3", "2", "1"] });
  test("判定の値のある記録が無ければ notApplicable", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [a(2024)] }])).notApplicable).toBe("noValues");
  });
  test("段の内なら met（全角の数字も NFKC でそろえる）。段の外の値・ほかの尺度の名前は notMet", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("3"), graded("１", 2025, "尺度イ")] }])).result).toBe("met");
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("5"), graded("2", 2025, "別の尺度"), graded("4", 2026)] }]));
    expect(r).toMatchObject({ result: "notMet", examined: 3, count: 2 });
    expect(r.examples.map((e) => e.value)).toEqual(["5", "2"]);
  });
});

describe("followup：悪い判定のあとに要る作業があるか", () => {
  const S = spec({
    kind: "followup",
    scale: "尺度イ",
    rules: [
      { values: ["2"], needs: ["OVERHAUL", "REPLACE", "UPGRADE"] },
      { values: ["1"], needs: ["REPLACE", "UPGRADE"] },
    ],
  });
  test("判定 2 のあとに分解整備の予定があれば met。無ければ notMet。前の年度の作業は数えない", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("2")] }, { key: "w2", attribute: "OVERHAUL", targets: ["A"], marks: [p(2027)] }])).result).toBe("met");
    const r = run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("2")] }, { key: "w2", attribute: "OVERHAUL", targets: ["A"], marks: [a(2023)] }]));
    expect(r).toMatchObject({ result: "notMet", count: 1 });
    expect(r.examples[0]).toMatchObject({ nodeKey: "A", fiscalYears: [2024], value: "2", why: "noFollowup" });
  });
  test("判定 1 には更新か基幹改良が要る（分解整備では足りない）。部位の措置の段取りの記録も措置に数える", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("1")] }, { key: "w2", attribute: "OVERHAUL", targets: ["A"], marks: [p(2027)] }])).result).toBe("notMet");
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("1")] }, { key: "w2", attribute: "REPLACE", targets: ["A1"], marks: [p(2028)] }])).result).toBe("met");
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("1"), { fy: 2025, kind: "plan", step: "action" }] }])).result).toBe("met");
  });
  test("悪くない判定だけなら met（見た数 0）。判定の値が無ければ notApplicable", () => {
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [graded("4")] }]))).toMatchObject({ result: "met", examined: 0 });
    expect(run(S, makePlan([{ key: "w1", targets: ["A"], marks: [a(2024)] }])).notApplicable).toBe("noValues");
  });
});

// ─── 共通：純粋さ・年度・閉じた一覧 ───────────────────────────

describe("どの種類も純粋な関数で、閉じた一覧のとおり", () => {
  const all: CheckSpec[] = [
    spec({ kind: "interval_max", works: [{ field: "work.attribute", op: "equals", values: ["INSPECT"] }], years: 3, extensionCapYears: null }, { id: "K-1" }),
    spec({ kind: "next_due", due: "plan_mark", works: [] }, { id: "K-2" }),
    spec({ kind: "coverage", needs: "plan_in_horizon" }, { id: "K-3" }),
    spec({ kind: "record_fields", of: "both", fields: ["startDate"], works: [] }, { id: "K-4" }),
    spec({ kind: "followup", scale: "尺度イ", rules: [{ values: ["1"], needs: ["REPLACE"] }] }, { id: "K-5" }),
    spec({ kind: "plan_fields", fields: ["strategy"] }, { id: "K-6" }),
    spec({ kind: "plan_horizon", years: 5 }, { id: "K-7" }),
    spec({ kind: "scale_valid", scale: "尺度イ", values: ["1"] }, { id: "K-8" }),
  ];

  test("パックの種類の型は、shared の CHECK_KINDS の 8 種と同じ。ほかの種類は型で断る", () => {
    expect(all.map((s) => s.params.kind).sort()).toEqual([...CHECK_KINDS].sort());
    expect(checkSpecSchema.safeParse({ ...all[0], params: { kind: "guess", years: 3 } }).success).toBe(false);
  });

  test("同じ計画と同じ基準日なら同じ結果。計画を書き換えない。基準日が変われば年度も変わる", () => {
    const plan = makePlan([
      { key: "w1", targets: ["A"], marks: [a(2019), p(2022), graded("1", 2023)] },
      { key: "w2", targets: ["B"], marks: [p(2028)] },
    ]);
    const before = JSON.stringify(plan);
    const input: CheckInput = { plan, referenceDate: REF, approvals: [] };
    const r1 = runChecks(loaded(all), input);
    const r2 = runChecks(loaded(all), structuredClone(input));
    expect(r2).toEqual(r1);
    expect(JSON.stringify(plan)).toBe(before);
    expect(r1.results.map((r) => r.checkId)).toEqual(all.map((s) => s.id));
    expect(r1.referenceFiscalYear).toBe(2026);
    expect(runChecks(loaded(all), { ...input, referenceDate: "2027-04-01" }).referenceFiscalYear).toBe(2027);
  });

  test("年度は計画の年度の始まりの月から数える", () => {
    expect(fiscalYearOfDate("2027-03-31", 4)).toBe(2026);
    expect(fiscalYearOfDate("2027-04-01", 4)).toBe(2027);
    expect(fiscalYearOfDate("2026-12-31", 1)).toBe(2026);
    expect(() => fiscalYearOfDate("2026/10/01", 4)).toThrow();
  });

  test("例は 10 件まで、件数は全部の数。並びは計画の資産の順と年度", () => {
    const extra = Array.from({ length: 12 }, (_, i) => ({
      nodeKey: `M${String(i).padStart(2, "0")}`,
      tag: null,
      name: `機器 ${i}`,
      level: 2,
      parentKey: "S",
      classCode: null,
      commonItem: "TT.X.M",
      commonItemAuthor: "human" as const,
      commonItemBasis: "試験",
      commonItemAccepted: true,
      specs: [],
      installedOn: null,
      removedOn: null,
      replacedOn: null,
      series: null,
      sources: [],
    }));
    const r = run(spec({ kind: "coverage", needs: "plan_in_horizon" }), makePlan([{ key: "w1", targets: ["A"], marks: [p(2027)] }], { extraAssets: extra }));
    expect(r.count).toBe(13); // B と M00〜M11
    expect(r.examples).toHaveLength(10);
    expect(r.examples.map((e) => e.nodeKey)).toEqual(["B", "M00", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]);
  });

  test("出典・水準・閾値の出どころ・確かめた度合いが結果に入る（出典の無いアプリの目安は null）", () => {
    const withSrc = spec({ kind: "plan_horizon", years: 5 }, { level: "recommendation", thresholdOrigin: "source", source: { id: "S-OK", clause: "第一の 1", page: "3 頁" } });
    const r = run(withSrc, makePlan([{ key: "w1", targets: ["A"], marks: [p(2027)] }]));
    expect(r).toMatchObject({ level: "recommendation", thresholdOrigin: "source", verification: "原典照合済", source: { document: "照らした資料", clause: "第一の 1", page: "3 頁", url: "https://www.env.go.jp/x.html" } });
    const app = run(spec({ kind: "plan_horizon", years: 5 }), makePlan([{ key: "w1", targets: ["A"], marks: [p(2027)] }]));
    expect(app).toMatchObject({ level: "app", thresholdOrigin: "app", verification: null, source: null });
  });
});

// ─── パックの検査の読み込み ─────────────────────────────────

describe("パックの検査（checks.json）を読む", () => {
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const pack = read("packs/waste-incineration/checks.json");
  const sources = read("packs/waste-incineration/sources.json");

  test("ごみ焼却の検査は 5 件以上で、すべてに水準・閾値の出どころがあり、出典は一覧にあって、要件と推奨の出典は原典照合済", () => {
    const l = loadPackChecks(pack, sources);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.checks.checks.length).toBeGreaterThanOrEqual(5);
    for (const c of l.checks.checks) {
      if (c.level !== "app") {
        const s = l.sources.sources.find((x) => x.id === c.source?.id);
        expect(s?.state, c.id).toBe("原典照合済");
      }
    }
    // 精密機能検査の間隔：3 年、推奨、閾値は出典（課長通知 第三の 11）
    const precision = l.checks.checks.find((c) => c.params.kind === "interval_max")!;
    expect(precision).toMatchObject({ level: "recommendation", thresholdOrigin: "source", params: { years: 3, extensionCapYears: null } });
    expect(precision.source?.clause).toContain("第三の 11");
    expect(l.sources.sources.find((s) => s.id === precision.source?.id)?.url).toBe("https://www.env.go.jp/hourei/11/000510.html");
  });

  test("sources.json に、照らした者と日付が書いてある（課長通知は原文の HTML の SHA-256 も）", () => {
    const notice = sources.sources.find((s: any) => s.id === "MHW-NOTICE-S46-KANSEI45");
    expect(notice.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(notice.checked.some((c: any) => /検査を作るサブエージェント/.test(c.by) && c.on === "2026-11-03" && c.what.includes("第三"))).toBe(true);
    const guide = sources.sources.find((s: any) => s.id === "MOE-GLPLE-PROV-R3");
    for (const t of ["表Ⅱ-7", "表Ⅱ-9", "表Ⅱ-12"]) expect(guide.checked.some((c: any) => c.what.includes(t)), t).toBe(true);
  });

  test("要件の出典が原典照合済でない・出典が一覧に無い・ID が重なる・形が違う・パックが違うものは読まない", () => {
    const base = structuredClone(pack);
    const mut = (f: (x: any) => void) => {
      const x = structuredClone(base);
      f(x);
      return x;
    };
    const s2 = { ...sources, sources: [...sources.sources, { id: "X-SUM", name: "要約", url: "https://www.env.go.jp/z", state: "要約のみ" }] };
    expect(loadPackChecks(mut((x) => Object.assign(x.checks[0], { level: "requirement", source: { id: "X-SUM", clause: "c", page: null } })), s2)).toMatchObject({ ok: false, reason: "sourceNotVerified" });
    // アプリの目安なら、要約のみの出典を添えてもよい
    expect(loadPackChecks(mut((x) => Object.assign(x.checks[0], { level: "app", thresholdOrigin: "app", source: { id: "X-SUM", clause: "c", page: null } })), s2).ok).toBe(true);
    expect(loadPackChecks(mut((x) => (x.checks[0].source.id = "NOPE")), sources)).toMatchObject({ ok: false, reason: "sourceMissing" });
    expect(loadPackChecks(mut((x) => (x.checks[1].id = x.checks[0].id)), sources)).toMatchObject({ ok: false, reason: "duplicateId" });
    expect(loadPackChecks(mut((x) => (x.checks[0].params.kind = "guess")), sources)).toMatchObject({ ok: false, reason: "checksInvalid" });
    expect(loadPackChecks(mut((x) => Object.assign(x.checks[0], { source: null })), sources)).toMatchObject({ ok: false, reason: "checksInvalid" });
    expect(loadPackChecks(mut((x) => (x.pack = "night-soil")), sources)).toMatchObject({ ok: false, reason: "packMismatch" });
    expect(loadPackChecks(pack, { schema: "moyai.sources/0" })).toMatchObject({ ok: false, reason: "sourcesInvalid" });
  });
});
