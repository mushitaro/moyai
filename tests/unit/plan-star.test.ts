// 会話からの星取の案（chart_propose の stars。src/plan/star.ts・src/app/state/stars.ts・docs/screens.md 3.2）：利用者がチャットで言った作業 × 年度の
// 星取（計画 ○・実績 ●）を、Claude が追加・削除・移動の案として置く。人が確定のシートで確定するまで決まらない。確定と署名は人だけ。
// ツールの契約（送り手の引数の型と、受け手の答えの型）・範囲の外と無い作業の誤り・案 → 確定 → 作業の年度の値に入る・却下 → 何も変わらない・確定した版の署名の確かめ。
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool, type TabToolResult } from "../../src/app/intake/tab-tools";
import { resetPlanRulesForTest } from "../../src/app/state/cycles";
import { carryFromBase } from "../../src/app/state/crosswalk";
import { getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { setReferenceDate } from "../../src/app/state/review";
import {
  acceptRemovalsByHuman,
  openRemovalCount,
  rejectStarGroupByHuman,
  rejectedStarGroups,
  resetStarsForTest,
  starGroups,
  undoRemovalsByHuman,
} from "../../src/app/state/stars";
import { CONVERSATION_SOURCE, PACK_SOURCE } from "../../src/plan/cycle";
import { diffPlans, pendingDecisions } from "../../src/plan/diff";
import { proposalIdOf, starIdOf, workRowRef } from "../../src/plan/star";
import { commitPlan, readHistory } from "../../src/plan/store";
import { ERRORS } from "../../src/shared/errors";
import type { Plan } from "../../src/shared/plan";
import { toolDef } from "../../src/shared/tools";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

/**
 * a1（耐火物）に w1（補修。実績 2019・2022、計画 2025）と w2（点検。実績 2022）。a2（灰クレーン）に w3（実績 2020、計画 2028）。
 * 計画の範囲は 2019〜2028
 */
const base = (): Plan =>
  plan({
    assets: [asset("a1", "WI.FURNACE.REFRACTORY", { name: "耐火物" }), asset("a2", "WI.CRANE.ASH", { name: "灰クレーン" })],
    works: [work("w1", "OVERHAUL", ["a1"], { kind: "耐火物の補修" }), work("w2", "INSPECT", ["a1"], { kind: "耐火物の点検" }), work("w3", "OVERHAUL", ["a2"], { kind: "灰クレーンの整備" })],
    details: [
      detail("d1", "w1", 2019),
      detail("d2", "w1", 2022),
      detail("d3", "w1", 2025, { planOrActual: "plan" }),
      detail("d4", "w2", 2022, { lines: [{ date: "2022-06-01", content: "点検", quantity: null, manDays: 1, days: 1, source: { file: "【架空】日報.xlsx", sheet: "2022", page: null, cell: "B12", box: null } }] }),
      detail("d5", "w3", 2020),
      detail("d9", "w3", 2028, { planOrActual: "plan" }),
    ],
  });

const ctx = { conversation: "c", rowsRemaining: 2000 };
const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】星取の案の試験", fiscalYearStartMonth: 4, fictional: true });
const version = () => getWorkingPlan()!.revision;
const propose = (w: IntakeWorkspace, args: Record<string, unknown>): TabToolResult => runTabTool(w, "chart_propose", { basedOnVersion: version(), basis: "利用者が会話で言った", ...args }, ctx);
const ok = (r: TabToolResult) => {
  if (!r.ok) throw new Error(r.code);
  return r.data;
};
const starDetails = (p: Plan) => p.details.filter((d) => starIdOf(d.detailKey) !== null);
const keys = (p: Plan) => p.details.map((d) => d.detailKey).sort();

beforeEach(() => {
  resetPlanRulesForTest();
  resetStarsForTest();
  setReferenceDate("2026-11-06");
  setWorkingPlan(base(), "intake");
});

describe("ツールの契約（送り手の引数と、受け手の答え）", () => {
  const def = toolDef("chart_propose");
  const args = { basedOnVersion: 1, basis: "利用者の言葉", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] };

  it("送り手：stars だけでも置ける（rules は省ける）。移動は元と先の年度。行は作業の行の id で指し、行の値は持てない", () => {
    expect(def.input.safeParse(args).success).toBe(true);
    expect(def.input.safeParse({ ...args, rules: [] }).success).toBe(true);
    expect(def.input.safeParse({ ...args, stars: [{ op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2027 }] }).success).toBe(true);
    for (const bad of [
      { op: "add", rowRef: "n:a1", value: "plan", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "○", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027.5 },
      { op: "swap", rowRef: "w:w1", value: "plan", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027, name: "耐火物の補修" },
      { op: "move", rowRef: "w:w1", value: "actual", fromFiscalYear: 2025, fiscalYear: 2027 },
      { op: "move", rowRef: "w:w1", fiscalYear: 2027 },
    ])
      expect(def.input.safeParse({ ...args, stars: [bad] }).success, JSON.stringify(bad)).toBe(false);
  });

  it("chart_rows：機器の行の id を渡すと、その機器の作業の行（w:…）を返す。答えは出力の型に合う", () => {
    const w = ws();
    const r = ok(runTabTool(w, "chart_rows", { rowRef: "n:a1" }, ctx));
    expect(toolDef("chart_rows").output.safeParse(r).success).toBe(true);
    const rows = r.rows as { rowRef: string; cells: Record<string, string> }[];
    expect(rows.map((x) => x.rowRef)).toEqual([workRowRef("w1"), workRowRef("w2")]);
    expect(rows[0]!.cells).toMatchObject({ 作業: "耐火物の補修", "2019 年度": "●", "2022 年度": "●", "2025 年度": "○" });
    expect(r.total).toBe(2);
    expect(ok(runTabTool(w, "chart_rows", { rowRef: "m:x|耐火物" }, ctx)).rows).toEqual([]);
    expect(ok(runTabTool(w, "chart_rows", { rowRef: "n:nope" }, ctx)).rows).toEqual([]);
  });

  it("受け手：答えは出力の型に合い、引数の順に案の ID と置いたかを返す。1 回の頼みの同じ作業・同じ種類は同じ案（確定のシートの 1 行）", () => {
    const w = ws();
    const r = ok(
      propose(w, {
        author: "ai_relayed_human",
        stars: [
          { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 },
          { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2028 },
          { op: "add", rowRef: "w:w3", value: "plan", fiscalYear: 2027 },
          { op: "remove", rowRef: "w:w3", value: "plan", fiscalYear: 2028 },
        ],
      }),
    );
    expect(def.output.safeParse(r).success).toBe(true);
    expect(r.stars).toEqual([
      { id: "S1", index: 0, op: "add", placed: true, details: 1, bases: ["conversation"] },
      { id: "S1", index: 1, op: "add", placed: true, details: 1, bases: ["conversation"] },
      { id: "S2", index: 2, op: "add", placed: true, details: 1, bases: ["conversation"] },
      { id: "S3", index: 3, op: "remove", placed: true, details: 1 },
    ]);
    expect(r.matched).toBe(4);
    expect(r.examples).toEqual([
      { rowRef: "w:w1", before: null, after: "2027 年度 ○" },
      { rowRef: "w:w1", before: null, after: "2028 年度 ○" },
      { rowRef: "w:w3", before: null, after: "2027 年度 ○" },
      { rowRef: "w:w3", before: "2028 年度 ○", after: null },
    ]);
    expect(r.version).toBe(version());
    expect(starGroups().map((g) => [g.id, g.kind, g.workKey])).toEqual([
      ["S1", "planAdd", "w1"],
      ["S2", "planAdd", "w3"],
      ["S3", "planRemove", "w3"],
    ]);
  });

  it("誤りのコードは作業画面が送り、AI に文を返す", () => {
    for (const c of ["star_work_unknown", "star_out_of_range", "star_unknown", "star_basis_invalid"] as const) expect(ERRORS[c]).toMatchObject({ from: "tab", to: "ai" });
  });
});

describe("範囲の外・無い作業・無い星取は、どれも置かずに誤りで返す", () => {
  it.each([
    ["範囲の前の年度", { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2018 }, "star_out_of_range"],
    ["範囲の後の年度", { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2029 }, "star_out_of_range"],
    ["基準日の年度（2026）より後の実績", { op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2027 }, "star_out_of_range"],
    ["移動の先が範囲の外", { op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2030 }, "star_out_of_range"],
    ["移動の元と先が同じ", { op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2025 }, "star_out_of_range"],
    ["無い作業", { op: "add", rowRef: "w:nope", value: "plan", fiscalYear: 2027 }, "star_work_unknown"],
    ["無い星取の削除", { op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }, "star_unknown"],
    ["計画の星取の無い年度からの移動", { op: "move", rowRef: "w:w1", fromFiscalYear: 2024, fiscalYear: 2027 }, "star_unknown"],
  ])("%s", (_name, star, code) => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    // 正しい案と一緒でも、1 つでも合わなければどれも置かない
    expect(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w3", value: "plan", fiscalYear: 2027 }, star] })).toEqual({ ok: false, code });
    expect(getWorkingPlan()!.plan).toEqual(before);
    expect(starGroups()).toEqual([]);
  });

  it("周期の案と一緒でも、星取が合わなければ周期の案も置かない", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    const rule = { when: [{ field: "work.workKey", op: "equals", values: ["w1"] }], set: { field: "work.trigger", value: 2 }, reason: "利用者" };
    expect(propose(w, { rules: [rule], stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2030 }] })).toEqual({ ok: false, code: "star_out_of_range" });
    expect(getWorkingPlan()!.plan).toEqual(before);
  });

  it("古い版をもとにした案は置かない", () => {
    const w = ws();
    expect(runTabTool(w, "chart_propose", { basedOnVersion: version() - 1, basis: "x", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }, ctx)).toEqual({ ok: false, code: "stale_version" });
  });
});

describe("実績の根拠（bases の決まりに合わせる）", () => {
  it("Claude の判断だけ（根拠なし）の実績の追加は置かない。パックの基準・計画ルールは実績の根拠にならない", () => {
    const w = ws();
    expect(propose(w, { stars: [{ op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2021 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    expect(propose(w, { author: "ai_relayed_human", bases: { pack: { checkId: "WI-PRECISION-INTERVAL" } }, stars: [{ op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2021 }] })).toEqual({
      ok: false,
      code: "star_basis_invalid",
    });
  });

  it("author: ai と bases.record だけの実績の追加は star_basis_invalid（Architect の 71）。同じ年度のほかの作業の実績は、利用者の言葉のときに参考の行として添える", () => {
    const w = ws();
    // w2 の 2019 年度：同じ機器 a1 の w1 に 2019 年度の実績（d1）がある。それでも Claude の判断では置かない
    expect(propose(w, { bases: { record: true }, stars: [{ op: "add", rowRef: "w:w2", value: "actual", fiscalYear: 2019 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    expect(propose(w, { stars: [{ op: "add", rowRef: "w:w2", value: "actual", fiscalYear: 2019 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    expect(starDetails(getWorkingPlan()!.plan)).toEqual([]);
    const r = ok(propose(w, { author: "ai_relayed_human", bases: { record: true }, stars: [{ op: "add", rowRef: "w:w2", value: "actual", fiscalYear: 2019 }] }));
    expect((r.stars as { placed: boolean }[])[0]!.placed).toBe(true);
    const d = starDetails(getWorkingPlan()!.plan)[0]!;
    expect(d).toMatchObject({ workKey: "w2", planOrActual: "actual", fiscalYear: 2019, author: "ai_relayed_human" });
    // 出どころは会話だけ（ほかの作業の実績は根拠にしない）
    expect(d.sources.map((s) => s.file)).toEqual([CONVERSATION_SOURCE]);
    expect(d.basis).toContain("（案 S1：実績の追加 2019 年度）。参考　同じ機器の 2019 年度の実績 1（作業明細 0）");
  });

  it("利用者の言葉（ai_relayed_human）なら置ける。出どころは会話", () => {
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2021 }] }));
    const d = starDetails(getWorkingPlan()!.plan)[0]!;
    expect(d).toMatchObject({ planOrActual: "actual", fiscalYear: 2021, author: "ai_relayed_human" });
    expect(d.sources.map((s) => s.file)).toEqual([CONVERSATION_SOURCE]);
  });

  it("実績の削除は、利用者の言葉だけ。計画の削除は Claude の判断でも置ける", () => {
    const w = ws();
    expect(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] }));
    expect(starGroups().map((g) => [g.kind, g.removes.map((r) => r.fiscalYear), g.author])).toEqual([
      ["planRemove", [2025], "ai"],
      ["actualRemove", [2019], "ai_relayed_human"],
    ]);
  });

  it("計画の追加にはパックの基準を指せる（周期の案と同じく MOYAI が名前と出典を書く）。星取に ledger は使えない", () => {
    const w = ws();
    ok(propose(w, { bases: { pack: { checkId: "WI-PRECISION-INTERVAL" } }, stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }));
    expect(starDetails(getWorkingPlan()!.plan)[0]!.sources.map((s) => s.file)).toEqual([PACK_SOURCE]);
    const ledger = { ledgerVersion: "0123456789ab", commonItem: "WI.FURNACE.REFRACTORY", work: "OVERHAUL", checked: { n: 6, median: "I4_5", q1: "I3_4", q3: "I6_7" } };
    expect(propose(w, { ledger, stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2028 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
  });
});

describe("案 → 確定 → 作業の年度の値に入る、却下 → 何も変わらない", () => {
  it("追加：作者 AI の明細が増え、人が確定するまで未確定。同じ星取がもうあれば置かない", () => {
    const w = ws();
    const r = ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }, { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    expect((r.stars as { placed: boolean }[]).map((x) => x.placed)).toEqual([true, false]);
    const p = getWorkingPlan()!.plan;
    const [d] = starDetails(p);
    expect(d).toMatchObject({ workKey: "w1", planOrActual: "plan", fiscalYear: 2027, author: "ai_relayed_human", needsReview: false });
    expect(d!.detailKey).toBe("st-S1-p-w1-2027");
    expect(proposalIdOf(d!.detailKey)).toBe("S1");
    expect(pendingDecisions(p, []).map((x) => x.id)).toEqual([`detail:${d!.detailKey}`]);
  });

  it("追加を却下すると、計画は案を置く前と同じ。却下済みに案が残る", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }, { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2028 }] }));
    expect(rejectStarGroupByHuman("S1", " ")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(rejectStarGroupByHuman("S1", "予算が無い")).toEqual({ ok: true, details: 2 });
    expect(getWorkingPlan()!.plan.details).toEqual(before.details);
    expect(rejectedStarGroups().map((g) => [g.id, g.kind, g.rejectedAdds])).toEqual([["S1", "planAdd", [2027, 2028]]]);
    expect(starGroups()).toEqual([]);
  });

  it("削除：計画は変えずに置く（星取は残る）。確定すると明細が外れ、取り消すと戻る。却下すると何も変わらない", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    expect(getWorkingPlan()!.plan).toEqual(before);
    expect(openRemovalCount()).toBe(1);
    // 同じ削除をもう一度：置かない
    const again = ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    expect((again.stars as { placed: boolean }[])[0]!.placed).toBe(false);
    expect(openRemovalCount()).toBe(1);
    const id = starGroups()[0]!.id;
    expect(acceptRemovalsByHuman(id, " ")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(acceptRemovalsByHuman(id, "工事が前倒しで済んだ")).toEqual({ ok: true, details: 1 });
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d3")).toBe(false);
    expect(openRemovalCount()).toBe(0);
    expect(undoRemovalsByHuman(id)).toBe(true);
    expect(getWorkingPlan()!.plan.details.find((d) => d.detailKey === "d3")).toEqual(before.details.find((d) => d.detailKey === "d3"));
    expect(rejectStarGroupByHuman(id, "残す").ok).toBe(true);
    expect(keys(getWorkingPlan()!.plan)).toEqual(keys(before));
    expect(openRemovalCount()).toBe(0);
    expect(rejectedStarGroups().map((g) => g.id)).toEqual([id]);
  });

  it("移動：同じ作業の削除と追加の対で 1 つの案。確定すると元の年度が外れ先の年度に入る。却下すると何も変わらない", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    const r = ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2027 }] }));
    expect(r.stars).toEqual([{ id: "S1", index: 0, op: "move", placed: true, details: 2, bases: ["conversation"] }]);
    expect(r.examples).toEqual([{ rowRef: "w:w1", before: "2025 年度 ○", after: "2027 年度 ○" }]);
    const [g] = starGroups();
    expect(g).toMatchObject({ id: "S1", kind: "planMove", workKey: "w1", pairs: [{ from: 2025, to: 2027 }], removes: [{ fiscalYear: 2025, detailKeys: ["d3"] }] });
    expect(starDetails(getWorkingPlan()!.plan).map((d) => d.detailKey)).toEqual(["st-S1-p-w1-2027"]);
    // 却下：追加が外れ、削除も捨てる
    expect(rejectStarGroupByHuman("S1", "延期しない").ok).toBe(true);
    expect(getWorkingPlan()!.plan.details).toEqual(before.details);
    // もう一度置いて確定
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2027 }] }));
    const id = starGroups()[0]!.id;
    expect(acceptRemovalsByHuman(id, "延期").ok).toBe(true);
    const p = getWorkingPlan()!.plan;
    expect(p.details.filter((d) => d.workKey === "w1" && d.planOrActual === "plan").map((d) => d.fiscalYear)).toEqual([2027]);
  });

  it("未確定の案（追加）は削除で指せない（人が却下する）", () => {
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }));
    expect(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] })).toEqual({ ok: false, code: "star_unknown" });
  });

  it("置き直すと（次の回）、前の回の削除の案は出さない", () => {
    const w = ws();
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    setWorkingPlan(base(), "intake");
    expect(starGroups()).toEqual([]);
    expect(openRemovalCount()).toBe(0);
  });

  it("確定した追加は、次の版に重ねるとき周期の案と同じく写す（第 n 版と同じ）", () => {
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }));
    const signed = getWorkingPlan()!.plan;
    const carried = starDetails(carryFromBase(base(), signed, 1));
    expect(carried.map((d) => d.detailKey)).toEqual(["st-S1-p-w1-2027"]);
    expect(carried[0]!.basis).toMatch(/第 1 版で受けた当てはめと同じ$/);
  });
});

describe("版を確定したあとの署名の確かめ", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "moyai-plan-star-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));

  it("確定した追加・削除・移動で版を確定：版の計画に追加した星取が入り、削除した星取が無い。確定の記録は今の acceptances の形のまま。署名は確かめで合い、星取を書き換えると合わない", async () => {
    const w = ws();
    ok(
      propose(w, {
        author: "ai_relayed_human",
        stars: [
          { op: "add", rowRef: "w:w3", value: "actual", fiscalYear: 2024 },
          { op: "move", rowRef: "w:w1", fromFiscalYear: 2025, fiscalYear: 2027 },
          { op: "remove", rowRef: "w:w3", value: "plan", fiscalYear: 2028 },
        ],
      }),
    );
    // 削除を人が確定しないうちは、星取は消えない（確定しない → 何も変わらない）
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d3")).toBe(true);
    for (const g of starGroups()) if (g.removes.length > 0) expect(acceptRemovalsByHuman(g.id, "利用者の言葉どおり").ok).toBe(true);
    const p = getWorkingPlan()!.plan;
    const pending = pendingDecisions(p, []);
    expect(pending.map((d) => d.id).sort()).toEqual(["detail:st-S1-a-w3-2024", "detail:st-S2-p-w1-2027"]);
    // 追加を確定しないまま版を確定しようとすると止める
    const none = await commitPlan({ root: dir, plan: p, reason: "星取の案", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    expect(none).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 2 });
    const acceptances = pending.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て確定した" }));
    const v = await commitPlan({ root: dir, plan: p, reason: "星取の案を確定した", acceptances, basedOn: null, signer: SIGNER, client: "t" });
    if (!v.ok) throw new Error(v.reason);
    const details = v.record.plan.details;
    expect(details.find((d) => d.detailKey === "st-S2-p-w1-2027")).toMatchObject({ planOrActual: "plan", fiscalYear: 2027, author: "ai_relayed_human" });
    expect(details.find((d) => d.detailKey === "st-S1-a-w3-2024")).toMatchObject({ planOrActual: "actual", fiscalYear: 2024 });
    expect(details.some((d) => d.detailKey === "d3" || d.detailKey === "d9")).toBe(false);
    expect(v.record.acceptances.map((a) => Object.keys(a).sort())).toEqual([
      ["author", "hash", "id", "reason"],
      ["author", "hash", "id", "reason"],
    ]);
    // 周期の案ではないので、作業のきっかけは変えない
    expect(v.cycleChanges).toEqual([]);
    expect(v.record.plan.works.every((x) => x.trigger === null)).toBe(true);
    // 差分：追加 2・削除 2
    const diff = diffPlans(base(), v.record.plan);
    expect([diff.added, diff.removed]).toEqual([2, 2]);

    const h = await readHistory(dir, p.planId);
    expect(h.versions.map((x) => x.problem)).toEqual([null]);
    expect(h.accepted.map((a) => a.id).sort()).toEqual(["detail:st-S1-a-w3-2024", "detail:st-S2-p-w1-2027"]);
    expect(pendingDecisions(v.record.plan, h.accepted)).toEqual([]);

    // 版のファイルの星取を書き換えると、確かめで合わない
    const file = files(dir).find((f) => f.endsWith(".json") && readFileSync(f, "utf8").includes("st-S2-p-w1-2027"));
    expect(file, "版のファイル").toBeTruthy();
    const text = readFileSync(file!, "utf8");
    const changed = text.replace(/("detailKey":\s*"st-S2-p-w1-2027"[^}]*?"fiscalYear":\s*)2027/, "$12026");
    expect(changed).not.toBe(text);
    writeFileSync(file!, changed);
    const tampered = await readHistory(dir, p.planId);
    expect(tampered.versions.map((x) => x.problem)).not.toEqual([null]);
  });
});
