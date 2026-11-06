// 星取の案（chart_propose の stars。src/plan/star.ts・src/app/state/stars.ts）：利用者がチャットで言った作業 × 年度の星取（計画 ○・実績 ●）を、
// Claude が足す案・消す案として置く。人が確定のシートで受けるまで決まらない。確定と署名は人だけ。
// ツールの契約（送り手の引数の型と、受け手の答えの型）・範囲の外と無い作業の誤り・案 → 受ける → 作業明細に入る・受けない → 何も変わらない・確定した版の署名の確かめ。
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool, type TabToolResult } from "../../src/app/intake/tab-tools";
import { rejectCycleByHuman, rejectedCycles, resetPlanRulesForTest } from "../../src/app/state/cycles";
import { carryFromBase } from "../../src/app/state/crosswalk";
import { getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { setReferenceDate } from "../../src/app/state/review";
import { acceptRemovalByHuman, openRemovalCount, rejectRemovalByHuman, rejectedRemovals, resetStarsForTest, starRemovals, undoRemovalByHuman } from "../../src/app/state/stars";
import { CONVERSATION_SOURCE, PACK_SOURCE, RECORD_SOURCE } from "../../src/plan/cycle";
import { diffPlans, pendingDecisions } from "../../src/plan/diff";
import { proposalIdOf, starIdOf, workRowRef } from "../../src/plan/star";
import { commitPlan, readHistory } from "../../src/plan/store";
import { ERRORS } from "../../src/shared/errors";
import type { Plan } from "../../src/shared/plan";
import { toolDef } from "../../src/shared/tools";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

/**
 * a1（1 号炉 › 耐火物）に w1（補修。実績 2019・2022、計画 2025）と w2（点検。実績 2022）。a2 に w3（実績 2020）。
 * 計画の範囲は 2019〜2028（d9 の計画 2028 が最後）
 */
const base = (): Plan =>
  plan({
    assets: [asset("a1", "WI.FURNACE.REFRACTORY", { name: "耐火物" }), asset("a2", "WI.CRANE.ASH", { name: "灰クレーン" })],
    works: [work("w1", "OVERHAUL", ["a1"], { kind: "耐火物の補修" }), work("w2", "INSPECT", ["a1"], { kind: "耐火物の点検" }), work("w3", "OVERHAUL", ["a2"], { kind: "灰クレーンの整備" })],
    details: [
      detail("d1", "w1", 2019),
      detail("d2", "w1", 2022),
      detail("d3", "w1", 2025, { planOrActual: "plan" }),
      detail("d4", "w2", 2022, { sources: [{ file: "【架空】日報.xlsx", sheet: "2022", page: null, cell: "B12", box: null }], lines: [{ date: "2022-06-01", content: "点検", quantity: null, manDays: 1, days: 1, source: { file: "【架空】日報.xlsx", sheet: "2022", page: null, cell: "B12", box: null } }] }),
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

beforeEach(() => {
  resetPlanRulesForTest();
  resetStarsForTest();
  setReferenceDate("2026-11-06");
  setWorkingPlan(base(), "intake");
});

describe("ツールの契約（送り手の引数と、受け手の答え）", () => {
  const def = toolDef("chart_propose");
  const args = { basedOnVersion: 1, basis: "利用者の言葉", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] };

  it("送り手：stars だけでも置ける（rules は省ける）。行は作業の行の id で指し、行の値は持てない", () => {
    expect(def.input.safeParse(args).success).toBe(true);
    expect(def.input.safeParse({ ...args, rules: [] }).success).toBe(true);
    for (const bad of [
      { op: "add", rowRef: "n:a1", value: "plan", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "○", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027.5 },
      { op: "move", rowRef: "w:w1", value: "plan", fiscalYear: 2027 },
      { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027, name: "耐火物の補修" },
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
    // 機器の行でない id・無い機器は 0 行
    expect(ok(runTabTool(w, "chart_rows", { rowRef: "m:x|耐火物" }, ctx)).rows).toEqual([]);
    expect(ok(runTabTool(w, "chart_rows", { rowRef: "n:nope" }, ctx)).rows).toEqual([]);
  });

  it("受け手：足す案と消す案の答えは出力の型に合い、引数の順に案の ID と置いたかを返す", () => {
    const w = ws();
    const r = ok(
      propose(w, {
        author: "ai_relayed_human",
        stars: [
          { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 },
          { op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 },
        ],
      }),
    );
    expect(def.output.safeParse(r).success).toBe(true);
    expect(r.stars).toEqual([
      { id: "S1", index: 0, op: "add", placed: true, details: 1, bases: ["conversation"] },
      { id: "S2", index: 1, op: "remove", placed: true, details: 1 },
    ]);
    expect(r.matched).toBe(2);
    expect(r.examples).toEqual([
      { rowRef: "w:w1", before: null, after: "2027 年度 ○" },
      { rowRef: "w:w1", before: "2025 年度 ○", after: null },
    ]);
    expect(r.version).toBe(version());
  });

  it("誤りのコードは作業画面が送り、AI に文を返す", () => {
    for (const c of ["star_work_unknown", "star_out_of_range", "star_unknown", "star_basis_invalid"] as const) expect(ERRORS[c]).toMatchObject({ from: "tab", to: "ai" });
  });
});

describe("範囲の外・無い作業・無い星取は、どれも置かずに誤りで返す", () => {
  const unchanged = (before: Plan) => {
    expect(getWorkingPlan()!.plan).toEqual(before);
    expect(starRemovals()).toEqual([]);
  };

  it.each([
    ["範囲の前の年度", { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2018 }, "star_out_of_range"],
    ["範囲の後の年度", { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2029 }, "star_out_of_range"],
    ["基準日の年度（2026）より後の実績", { op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2027 }, "star_out_of_range"],
    ["無い作業", { op: "add", rowRef: "w:nope", value: "plan", fiscalYear: 2027 }, "star_work_unknown"],
    ["無い星取を消す", { op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }, "star_unknown"],
  ])("%s", (_name, star, code) => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    // 正しい案と一緒でも、1 つでも合わなければどれも置かない
    expect(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w3", value: "plan", fiscalYear: 2027 }, star] })).toEqual({ ok: false, code });
    unchanged(before);
  });

  it("周期の案と一緒でも、星取が合わなければ周期の案も置かない", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    const rule = { when: [{ field: "work.workKey", op: "equals", values: ["w1"] }], set: { field: "work.trigger", value: 2 }, reason: "利用者" };
    expect(propose(w, { rules: [rule], stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2030 }] })).toEqual({ ok: false, code: "star_out_of_range" });
    unchanged(before);
  });

  it("古い版をもとにした案は置かない", () => {
    const w = ws();
    expect(runTabTool(w, "chart_propose", { basedOnVersion: version() - 1, basis: "x", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }, ctx)).toEqual({ ok: false, code: "stale_version" });
  });
});

describe("実績の根拠（bases の決まりに合わせる）", () => {
  const actual = { op: "add", rowRef: "w:w1", value: "actual", fiscalYear: 2022 } as const;

  it("Claude の判断だけ（根拠なし）の実績の追加は置かない。パックの基準・計画ルールは実績の根拠にならない", () => {
    const w = ws();
    // w1 の 2022 は実績があるので、2021（同じ機器の実績が無い年度）で確かめる
    expect(propose(w, { stars: [{ ...actual, fiscalYear: 2021 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    expect(propose(w, { author: "ai_relayed_human", bases: { pack: { checkId: "WI-PRECISION-INTERVAL" } }, stars: [{ ...actual, fiscalYear: 2021 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
  });

  it("bases.record：同じ機器の同じ年度に、ほかの作業の実績が無ければ置かない。あれば、その出どころ（元のセル）と数を根拠に書く", () => {
    const w = ws();
    expect(propose(w, { bases: { record: true }, stars: [{ ...actual, fiscalYear: 2021 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    // w2 の 2019 年度の実績：同じ機器 a1 の w1 に 2019 年度の実績（d1）がある
    const r = ok(propose(w, { bases: { record: true }, stars: [{ op: "add", rowRef: "w:w2", value: "actual", fiscalYear: 2019 }] }));
    expect((r.stars as { placed: boolean }[])[0]!.placed).toBe(true);
    const d = starDetails(getWorkingPlan()!.plan)[0]!;
    expect(d).toMatchObject({ workKey: "w2", planOrActual: "actual", fiscalYear: 2019, author: "ai" });
    expect(d.sources).toEqual([{ file: RECORD_SOURCE, sheet: null, page: null, cell: null, box: null }, ...base().details[0]!.sources]);
    expect(d.basis).toContain("（案 S1：追加 実績 2019 年度）。自施設の実績：同じ機器の 2019 年度の実績 1（作業明細 0）");
  });

  it("利用者の言葉（ai_relayed_human）なら置ける。出どころは会話", () => {
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ ...actual, fiscalYear: 2021 }] }));
    const d = starDetails(getWorkingPlan()!.plan)[0]!;
    expect(d).toMatchObject({ planOrActual: "actual", fiscalYear: 2021, author: "ai_relayed_human" });
    expect(d.sources.map((s) => s.file)).toEqual([CONVERSATION_SOURCE]);
  });

  it("実績を消す案は、利用者の言葉だけ。計画を消す案は Claude の判断でも置ける", () => {
    const w = ws();
    expect(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] })).toEqual({ ok: false, code: "star_basis_invalid" });
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "remove", rowRef: "w:w1", value: "actual", fiscalYear: 2019 }] }));
    expect(starRemovals().map((r) => [r.value, r.fiscalYear, r.author])).toEqual([
      ["plan", 2025, "ai"],
      ["actual", 2019, "ai_relayed_human"],
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

describe("案 → 受ける → 作業明細に入る、受けない → 何も変わらない", () => {
  it("足す案：作者 AI の明細が 1 つ増え、人が受けるまで未確定（確定のシートの 1 行）。同じ星取がもうあれば置かない", () => {
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

  it("足す案を却下すると、計画は案を置く前と同じ。却下済みに星取が残る", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }));
    expect(rejectCycleByHuman("S1", " ")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(rejectCycleByHuman("S1", "予算が無い")).toEqual({ ok: true, marks: 1 });
    expect(getWorkingPlan()!.plan.details).toEqual(before.details);
    expect(rejectedCycles().map((x) => [x.id, x.star])).toEqual([["S1", { workKey: "w1", planOrActual: "plan", fiscalYear: 2027 }]]);
  });

  it("消す案：計画は変えずに置く（星取は残る）。受けると明細が外れ、取り消すと戻る。却下すると何も変わらない", () => {
    const w = ws();
    const before = getWorkingPlan()!.plan;
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    expect(getWorkingPlan()!.plan).toEqual(before);
    expect(openRemovalCount()).toBe(1);
    // 同じ消す案をもう一度：置かない
    const again = ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    expect((again.stars as { placed: boolean }[])[0]!.placed).toBe(false);
    expect(openRemovalCount()).toBe(1);
    const id = starRemovals()[0]!.id;
    expect(acceptRemovalByHuman(id, " ")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(acceptRemovalByHuman(id, "工事が前倒しで済んだ")).toEqual({ ok: true, details: 1 });
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d3")).toBe(false);
    expect(openRemovalCount()).toBe(0);
    expect(undoRemovalByHuman(id)).toBe(true);
    expect(getWorkingPlan()!.plan.details.find((d) => d.detailKey === "d3")).toEqual(before.details.find((d) => d.detailKey === "d3"));
    expect(rejectRemovalByHuman(id, "残す")).toEqual({ ok: true, details: 0 });
    expect(getWorkingPlan()!.plan.details.map((d) => d.detailKey).sort()).toEqual(before.details.map((d) => d.detailKey).sort());
    expect(openRemovalCount()).toBe(0);
    expect(rejectedRemovals().map((r) => r.id)).toEqual([id]);
  });

  it("未確定の案（足す案）は消す案で指せない（人が却下する）", () => {
    const w = ws();
    ok(propose(w, { author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] }));
    expect(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2027 }] })).toEqual({ ok: false, code: "star_unknown" });
  });

  it("置き直すと（次の回）、前の回の消す案は出さない", () => {
    const w = ws();
    ok(propose(w, { stars: [{ op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 }] }));
    setWorkingPlan(base(), "intake");
    expect(starRemovals()).toEqual([]);
  });

  it("受けた足す案は、次の版に重ねるとき周期の案と同じく写す（第 n 版と同じ）", () => {
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

  it("受けた足す案と消す案で確定：版の計画に足した星取が入り、消した星取が無い。受けた記録は今の acceptances の形のまま。署名は確かめで合い、星取を書き換えると合わない", async () => {
    const w = ws();
    ok(
      propose(w, {
        author: "ai_relayed_human",
        stars: [
          { op: "add", rowRef: "w:w1", value: "plan", fiscalYear: 2027 },
          { op: "add", rowRef: "w:w3", value: "actual", fiscalYear: 2024 },
          { op: "remove", rowRef: "w:w1", value: "plan", fiscalYear: 2025 },
        ],
      }),
    );
    // 消す案を人が受けないうちは、受けた足す案だけでは消えない（受けない → 何も変わらない）
    expect(getWorkingPlan()!.plan.details.some((d) => d.detailKey === "d3")).toBe(true);
    expect(acceptRemovalByHuman(starRemovals()[0]!.id, "前倒しで済んだ").ok).toBe(true);
    const p = getWorkingPlan()!.plan;
    const pending = pendingDecisions(p, []);
    expect(pending.map((d) => d.id).sort()).toEqual(["detail:st-S1-p-w1-2027", "detail:st-S2-a-w3-2024"]);
    // 足す案を受けないまま確定しようとすると止める
    const none = await commitPlan({ root: dir, plan: p, reason: "星取の案", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    expect(none).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 2 });
    const acceptances = pending.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v = await commitPlan({ root: dir, plan: p, reason: "星取の案を受けた", acceptances, basedOn: null, signer: SIGNER, client: "t" });
    if (!v.ok) throw new Error(v.reason);
    const details = v.record.plan.details;
    expect(details.find((d) => d.detailKey === "st-S1-p-w1-2027")).toMatchObject({ planOrActual: "plan", fiscalYear: 2027, author: "ai_relayed_human" });
    expect(details.find((d) => d.detailKey === "st-S2-a-w3-2024")).toMatchObject({ planOrActual: "actual", fiscalYear: 2024 });
    expect(details.some((d) => d.detailKey === "d3")).toBe(false);
    expect(v.record.acceptances.map((a) => Object.keys(a).sort())).toEqual([
      ["author", "hash", "id", "reason"],
      ["author", "hash", "id", "reason"],
    ]);
    // 周期の案ではないので、作業のきっかけは変えない
    expect(v.cycleChanges).toEqual([]);
    expect(v.record.plan.works.every((x) => x.trigger === null)).toBe(true);
    // 差分：足した 2・消した 1
    const diff = diffPlans(base(), v.record.plan);
    expect([diff.added, diff.removed]).toEqual([2, 1]);

    const h = await readHistory(dir, p.planId);
    expect(h.versions.map((x) => x.problem)).toEqual([null]);
    expect(h.accepted.map((a) => a.id).sort()).toEqual(["detail:st-S1-p-w1-2027", "detail:st-S2-a-w3-2024"]);
    expect(pendingDecisions(v.record.plan, h.accepted)).toEqual([]);

    // 版のファイルの星取を書き換えると、確かめで合わない
    const file = files(dir).find((f) => f.endsWith(".json") && readFileSync(f, "utf8").includes("st-S1-p-w1-2027"));
    expect(file, "版のファイル").toBeTruthy();
    writeFileSync(file!, readFileSync(file!, "utf8").replace('"fiscalYear":2027', '"fiscalYear":2026').replace('"fiscalYear": 2027', '"fiscalYear": 2026'));
    const tampered = await readHistory(dir, p.planId);
    expect(tampered.versions.map((x) => x.problem)).not.toEqual([null]);
  });
});
