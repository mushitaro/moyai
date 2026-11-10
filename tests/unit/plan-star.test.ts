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
import ExcelJS from "exceljs";
import { placeComposedPlan, setCrosswalkBase } from "../../src/app/state/crosswalk";
import { removalHash, removalId } from "../../src/plan/diff";
import {
  acceptRemovalsByHuman,
  removalAcceptances,
  removedCellOf,
  setRemovedInHistory,
  noteCommittedRemovals,
  openRemovalCount,
  rejectStarGroupByHuman,
  rejectedStarGroups,
  resetStarsForTest,
  starGroups,
  undoRemovalsByHuman,
} from "../../src/app/state/stars";
import { CONVERSATION_SOURCE, PACK_SOURCE } from "../../src/plan/cycle";
import * as trial from "../../src/app/state/stars";
import { TRIAL_SOURCE } from "../../src/plan/star";
import { diffPlans, pendingDecisions } from "../../src/plan/diff";
import { actualReferenceView, basisWithoutReference, proposalIdOf, starIdOf, workRowRef } from "../../src/plan/star";
import { commitPlan, planDir, readHistory } from "../../src/plan/store";
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

  it("詳しくの参考：1 行目は根拠の文と同じ形、その下に作業ごとの作業明細の数を 3 つまで（Wire）。理由には参考を二重に出さない", () => {
    const p = base();
    expect(actualReferenceView(p, "w2", 2019)).toEqual({ head: "参考　同じ機器の 2019 年度の実績 1（作業明細 0）", items: [{ name: "耐火物の補修", lines: 0 }], more: 0 });
    expect(actualReferenceView(p, "w1", 2022)).toEqual({ head: "参考　同じ機器の 2022 年度の実績 1（作業明細 1）", items: [{ name: "耐火物の点検", lines: 1 }], more: 0 });
    expect(actualReferenceView(p, "w1", 2021)).toBeNull();
    expect(basisWithoutReference("利用者の言葉（案 S1：実績の追加 2019 年度）。参考　同じ機器の 2019 年度の実績 1（作業明細 0）")).toBe("利用者の言葉（案 S1：実績の追加 2019 年度）");
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

describe("星取の削除を版に残す（Architect の 70）", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "moyai-plan-star-remove-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const readSheet = async (path: string): Promise<string[][]> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const out: string[][] = [];
    wb.worksheets[0]!.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
    return out;
  };
  /** 第 1 版（資料から読んだ計画）を確定して、作業中の計画をその版にする */
  const firstVersion = async () => {
    const v1 = await commitPlan({ root: dir, plan: base(), reason: "第 1 版", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    setWorkingPlan(v1.record.plan, "intake");
    return v1;
  };

  it("資料から読んだ実績を消して確定：確定の理由と作者が版の記録の署名の内側（acceptances の remove:<明細の鍵>）に入り、差分レポートの削除の行の理由に出る", async () => {
    await firstVersion();
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] }));
    expect(removalAcceptances()).toEqual([]);
    expect(acceptRemovalsByHuman(starGroups()[0]!.id, "二重に記録されていた（利用者）").ok).toBe(true);
    const removals = removalAcceptances();
    const d1 = base().details[0]!;
    expect(removals).toEqual([{ id: removalId("d1"), hash: removalHash({ ...d1 }), reason: "二重に記録されていた（利用者）" }]);
    const p = getWorkingPlan()!.plan;
    const v2 = await commitPlan({ root: dir, plan: p, reason: "実績の誤りを消した", acceptances: removals, basedOn: 1, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    expect(v2.record.acceptances).toEqual([{ id: "remove:d1", hash: removals[0]!.hash, reason: "二重に記録されていた（利用者）", author: "human" }]);
    expect(v2.record.plan.details.some((d) => d.detailKey === "d1")).toBe(false);
    const h = await readHistory(dir, p.planId);
    expect(h.versions.map((x) => x.problem)).toEqual([null, null]);
    expect(h.accepted).toContainEqual({ id: "remove:d1", hash: removals[0]!.hash, reason: "二重に記録されていた（利用者）", version: 2 });
    // 差分レポート：削除の行の作者は人、理由は人の判断の理由
    const rows = await readSheet(v2.files.report);
    const head = rows.findIndex((r) => r[0] === "機器");
    expect(rows[head]).toEqual(["機器", "作業", "年度", "前の星取", "後の星取", "作者", "理由"]);
    expect(rows.slice(head + 1)).toContainEqual(["耐火物", "耐火物の補修", "2019", "● 実績", "（星取なし）", "人", "二重に記録されていた（利用者）"]);
    // 理由を書き換えると、署名の確かめで合わない
    const file = join(planDir(dir, p.planId), "versions", "000002.json");
    writeFileSync(file, readFileSync(file, "utf8").replace("二重に記録されていた（利用者）", "書き換えた理由"));
    expect((await readHistory(dir, p.planId)).versions.map((x) => x.problem)[1]).not.toBeNull();
  });

  it("「＋ 次の版」で資料から作り直しても、確定して消した実績は戻らない。資料のセルには「削除（第 n 版）」と理由を引ける", async () => {
    await firstVersion();
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] }));
    acceptRemovalsByHuman(starGroups()[0]!.id, "二重に記録されていた");
    const v2 = await commitPlan({ root: dir, plan: getWorkingPlan()!.plan, reason: "消した", acceptances: removalAcceptances(), basedOn: 1, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    // 次の版：橋渡しの版の履歴（確定した決定）を受け取り、同じ資料から計画を作り直す（取り込みの組み直しと同じ道）
    resetStarsForTest();
    setWorkingPlan(v2.record.plan, "intake");
    setRemovedInHistory(v2.record.plan.planId, 2, (await readHistory(dir, v2.record.plan.planId)).accepted);
    const recomposed = { ...base(), planId: v2.record.plan.planId };
    expect(recomposed.details.some((d) => d.detailKey === "d1")).toBe(true);
    placeComposedPlan(recomposed);
    const next = getWorkingPlan()!.plan;
    expect(next.details.some((d) => d.detailKey === "d1")).toBe(false);
    expect(next.details.map((d) => d.detailKey).sort()).toEqual(["d2", "d3", "d4", "d5", "d9"]);
    const src = base().details[0]!.sources[0]!;
    expect(removedCellOf(src.file, src.sheet, src.cell!)).toEqual({ version: 2, reason: "二重に記録されていた" });
  });

  /** 第 2 版（d1 の実績を消した版）まで確定し、その版を開いた形（もとにした版は第 2 版）にする */
  const removedV2 = async () => {
    await firstVersion();
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] }));
    acceptRemovalsByHuman(starGroups()[0]!.id, "二重に記録されていた");
    const sent = removalAcceptances();
    const v2 = await commitPlan({ root: dir, plan: getWorkingPlan()!.plan, reason: "消した", acceptances: sent, basedOn: 1, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    return { v2, sent };
  };

  it("作り直しの順：版を開いてすぐ作り直しが走っても（履歴の削除を読む前でも）、消した実績は戻らない。履歴を読み終えるまで置かずに待ち、読んだら置く", async () => {
    const { v2 } = await removedV2();
    const planId = v2.record.plan.planId;
    resetStarsForTest();
    setWorkingPlan(v2.record.plan, "intake");
    setCrosswalkBase({ version: 2, plan: v2.record.plan, crosswalk: [] });
    const recomposed = { ...base(), planId };
    // 履歴を読む前に作り直しが走った：置かずに待つ（作業中の計画は第 2 版のまま）
    expect(placeComposedPlan(recomposed)).toBeNull();
    expect(getWorkingPlan()!.plan).toBe(v2.record.plan);
    // 前の版（第 1 版）までの履歴では足りない：まだ待つ
    setRemovedInHistory(planId, 1, []);
    expect(getWorkingPlan()!.plan).toBe(v2.record.plan);
    // 第 2 版までの履歴を読んだ：待たせた作り直しを置き、消した実績は外れたまま
    setRemovedInHistory(planId, 2, (await readHistory(dir, planId)).accepted);
    const next = getWorkingPlan()!.plan;
    expect(next).not.toBe(v2.record.plan);
    expect(next.details.map((d) => d.detailKey).sort()).toEqual(["d2", "d3", "d4", "d5", "d9"]);
    setCrosswalkBase(null);
  });

  it("作り直しの順：確定した直後（橋渡しの状態を読み直す前）に同じタブで作り直しても、送った削除で外れる", async () => {
    const planId = base().planId;
    setRemovedInHistory(planId, 1, []);
    const { v2, sent } = await removedV2();
    noteCommittedRemovals(planId, 2, sent);
    setWorkingPlan(v2.record.plan, "intake");
    setCrosswalkBase({ version: 2, plan: v2.record.plan, crosswalk: [] });
    expect(placeComposedPlan({ ...base(), planId })).not.toBeUndefined();
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d1")).toBe(false);
    setCrosswalkBase(null);
  });

  it("ほかの計画の履歴では外さない", async () => {
    setRemovedInHistory("plan-other", 3, [{ id: "remove:d1", hash: "0".repeat(16), reason: "別の計画", version: 3 }]);
    placeComposedPlan(base());
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d1")).toBe(true);
  });

  it("橋渡しの確かめ：今の計画にまだある明細の削除・前の版と中身の指紋が合わない削除・理由の無い削除は確定しない", async () => {
    const v1 = await firstVersion();
    const p = v1.record.plan;
    const without = { ...p, details: p.details.filter((d) => d.detailKey !== "d1") };
    const good = { id: "remove:d1", hash: removalHash(p.details.find((d) => d.detailKey === "d1")!), reason: "誤り" };
    expect(await commitPlan({ root: dir, plan: p, reason: "x", acceptances: [good], basedOn: 1, signer: SIGNER, client: "t" })).toMatchObject({ ok: false, reason: "acceptanceUnknown" });
    expect(await commitPlan({ root: dir, plan: without, reason: "x", acceptances: [{ ...good, hash: "0".repeat(16) }], basedOn: 1, signer: SIGNER, client: "t" })).toMatchObject({ ok: false, reason: "acceptanceUnknown" });
    expect(await commitPlan({ root: dir, plan: without, reason: "x", acceptances: [{ ...good, reason: " " }], basedOn: 1, signer: SIGNER, client: "t" })).toMatchObject({ ok: false, reason: "acceptanceReasonEmpty" });
    expect((await commitPlan({ root: dir, plan: without, reason: "x", acceptances: [good], basedOn: 1, signer: SIGNER, client: "t" })).ok).toBe(true);
  });
});


describe("人の試し（時間の地図 2、mushitaro/moyai#32）：星取表で人が未来の ○ を動かす。AI の道とは別", () => {
  const range = { min: 2019, max: 2028 };
  const at = (wk: string, fy: number) => getWorkingPlan()!.plan.details.filter((d) => d.workKey === wk && d.fiscalYear === fy && d.planOrActual === "plan");
  beforeEach(() => setWorkingPlan(base(), "intake"));

  it("動かすと、先の年度に作者「人」の明細（出どころは人の試し）、元の年度の明細は人の確定した削除（理由は「人の試し（理由 未記入）」）", () => {
    const r = trial.moveStarByHuman("w1", 2025, 2027, range);
    expect(r.ok).toBe(true);
    expect(at("w1", 2025)).toHaveLength(0);
    const [d] = at("w1", 2027);
    expect(d!.author).toBe("human");
    expect(d!.sources[0]!.file).toBe(TRIAL_SOURCE);
    // 人が受ける決定は要らない（作者が人）。元の年度の削除は署名の内側に入る（理由を書いていないことをそのまま書く。署名の理由は空にできないので）
    expect(pendingDecisions(getWorkingPlan()!.plan, []).some((x) => x.id.endsWith(d!.detailKey))).toBe(false);
    expect(removalAcceptances()).toEqual([expect.objectContaining({ id: removalId("d3"), reason: trial.TRIAL_REASON })]);
    expect(trial.trialOrigins()).toEqual([expect.objectContaining({ workKey: "w1", from: 2025, to: 2027 })]);
  });

  it("取り消しとやり直しは何度でも。取り消すと元に戻り、署名の内側にも入らない", () => {
    trial.moveStarByHuman("w1", 2025, 2026, range);
    trial.moveStarByHuman("w1", 2026, 2027, range);
    expect(at("w1", 2027)).toHaveLength(1);
    expect(trial.undoTrialByHuman()).toBe(true);
    expect(at("w1", 2026)).toHaveLength(1);
    expect(trial.undoTrialByHuman()).toBe(true);
    expect(at("w1", 2025).map((d) => d.detailKey)).toEqual(["d3"]);
    expect(removalAcceptances()).toEqual([]);
    expect(trial.undoTrialByHuman()).toBe(false);
    expect(trial.redoTrialByHuman(range)).toBe(true);
    expect(trial.redoTrialByHuman(range)).toBe(true);
    expect(at("w1", 2027)).toHaveLength(1);
    expect(trial.redoTrialByHuman(range)).toBe(false);
  });

  it("動かせないもの：実績のある年度・先にもう計画がある・範囲の外", () => {
    expect(trial.canMoveStarByHuman("w1", 2022, 2023, range)).toEqual({ ok: false, reason: "notPlanOnly" });
    expect(trial.canMoveStarByHuman("w1", 2025, 2025, range)).toEqual({ ok: false, reason: "outOfRange" });
    expect(trial.canMoveStarByHuman("w1", 2025, 2029, range)).toEqual({ ok: false, reason: "outOfRange" });
    trial.moveStarByHuman("w3", 2028, 2027, range);
    expect(trial.canMoveStarByHuman("w3", 2027, 2027, range)).toEqual({ ok: false, reason: "outOfRange" });
    expect(getWorkingPlan()!.plan.details.filter((d) => d.workKey === "w1").length).toBe(3);
  });

  it("置き直した（generation が変わった）あとは、前の試しを戻さない・やり直さない", () => {
    trial.moveStarByHuman("w1", 2025, 2027, range);
    expect(trial.undoTrialByHuman()).toBe(true);
    setWorkingPlan(base(), "intake");
    expect(trial.redoTrialByHuman(range)).toBe(false);
    trial.moveStarByHuman("w1", 2025, 2026, range);
    setWorkingPlan(base(), "intake");
    expect(trial.undoTrialByHuman()).toBe(false);
    expect(trial.trialOrigins()).toEqual([]);
  });

  it("AI のツールの受け手には、人の試しを動かす・戻す道が無い", () => {
    const src = readFileSync("src/app/intake/tab-tools.ts", "utf8");
    for (const f of ["moveStarByHuman", "undoTrialByHuman", "redoTrialByHuman", "acceptRemovalsByHuman", "undoRemovalsByHuman"]) expect(src).not.toContain(f);
  });
});
