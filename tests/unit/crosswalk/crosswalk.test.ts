// crosswalk.*（docs/plan.md §2.1・§5.1）：深さと呼び名の違う 2 施設（fictional-1 は 3 段、fictional-2 は 4 段）の取り込んだ計画に、
// AI の規則（crosswalk_propose。行を写さず、欄 × 比べ方 × 値の組と置く値）で、資産の節を 1 段目の項目に、作業を作業の属性に当てる。
// 規則は、この試験が AI の代わりに書く（節の名前は chart_rows の段の道と intake_survey の crosswalk で読めるものだけを使う）。
// 正解の世界（samples/truth）は、当てた結果を照らすためだけに読む（src/ は読まない）。
// 案は人が受けるまで決まらない：受けるのは画面の道（state/crosswalk.ts の acceptByHuman）だけで、試験の台本が人の代わりに押す。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { acceptByHuman, rejectByHuman, setByHuman } from "../../../src/app/state/crosswalk";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { catalogFor } from "../../../src/app/chart/catalog";
import { buildChart } from "../../../src/plan/chart";
import { carryOverCrosswalk, crosswalkSummary, inCommonRows } from "../../../src/plan/crosswalk";
import { pendingDecisions } from "../../../src/plan/diff";
import { candidateClasses, copyOut, SKIP_REASONS } from "../../../src/share/copyout";
import { chooseProfile, loadNational, loadVocab, SEND_MIN_K, type ProfileSpec } from "../../../src/share/k";
import type { Plan, WorkT } from "../../../src/shared/plan";
import { EXAMPLES_MAX, SURVEY_TEXT_MAX, SURVEY_TOP_VALUES, TOOLS, type Rule } from "../../../src/shared/tools";
import { Entities, loadTruth, type Truth } from "../import/truth";
import { F1_MIXED_NAMES, F1_NODES, F2_NODES, attr, f1Rules, f2Rules, nameIs, node } from "../../fixtures/crosswalk/rules";

const PACK = "waste-incineration";
const CTX = { conversation: "c-crosswalk", rowsRemaining: 2000 };
const HUMAN_REASON = "試験の台本が押した（台帳の名前とパックの項目を見て合っている）";
const LABELS = { levelFallback: (n: number) => `L${n}`, commonLevels: ["S", "I", "A"] as [string, string, string], unmapped: "UNMAPPED", series: (s: string) => s };

afterEach(() => clearWorkingPlan());

function ok(r: ReturnType<typeof runTabTool>): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

/** 工場の資料を取り込み、既定の答えで質問に答え（AI がチャットの人の答えとして置く）、計画を作る */
async function composed(facility: string, files: string[]): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace({ packId: PACK, facilityName: `【架空】${facility}`, fiscalYearStartMonth: 4, fictional: true });
  const dir = `samples/out/${PACK}/${facility}/`;
  await ws.addFiles(
    files.map((n) => {
      const b = new Uint8Array(readFileSync(dir + n));
      return { name: n, size: b.length, bytes: async () => b };
    }),
  );
  for (let i = 0; i < 15; i++) {
    const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
    if (!s.questions.length) break;
    ok(
      runTabTool(
        ws,
        "intake_settle",
        { decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで既定の答えでよいと言った" })) },
        CTX,
      ),
    );
  }
  ok(runTabTool(ws, "intake_compose", {}, CTX));
  await ws.whenComposed();
  if (!getWorkingPlan()) throw new Error("計画ができない");
  return ws;
}

const plan = (): Plan => getWorkingPlan()!.plan;
const version = () => getWorkingPlan()!.revision;

// ─── 正解の世界で照らす ───────────────────────────────────────

/** 資産の節 → 正解の機器のコード（機器でない節は null） */
function truthCodeOf(t: Truth, a: Plan["assets"][number]): string | null {
  const ents = new Entities(t);
  const hit = a.sources.map((x) => (x.cell ? ents.of(x.file, x.cell) : null)).find((k) => k?.startsWith("e:"));
  return hit ? ((t.world.equipment_to_code as Record<string, string>)[hit.slice(2)] ?? null) : null;
}

/** 作業 → 正解の作業の属性の集まり（作業明細の出どころのセル・行から） */
function truthAttrsOf(t: Truth, p: Plan, w: WorkT): Set<string> {
  const attrOf = new Map<string, string>((t.world.works as { id: string; attr: string }[]).map((x) => [x.id, x.attr]));
  const out = new Set<string>();
  for (const d of p.details.filter((x) => x.workKey === w.workKey))
    for (const s of d.sources) {
      let ids: string[] = [];
      if (s.file === t.star?.file && s.cell) ids = t.star.cells[s.cell]?.work_ids ?? [];
      if (s.file === t.daily?.file && s.cell) ids = (t.daily.rows as { line: number; work_ids: string[] }[]).find((r) => r.line === Number(/\d+$/.exec(s.cell!)?.[0]))?.work_ids ?? [];
      for (const id of ids) if (attrOf.has(id)) out.add(attrOf.get(id)!);
    }
  return out;
}

function proposeAll(ws: IntakeWorkspace, rules: Rule[]): any {
  const r = ok(runTabTool(ws, "crosswalk_propose", { rules, basedOnVersion: version() }, CTX));
  expect(TOOLS.crosswalk_propose.output.safeParse(r).success).toBe(true);
  return r;
}

function acceptAll(reason = HUMAN_REASON): void {
  for (const p of getWorkingPlan()!.proposals.filter((x) => x.state === "proposed")) expect(acceptByHuman(p.ruleId, reason).ok).toBe(true);
}

const CASES = [
  // 星取表の印に点検と分解整備・取替が混ざる機器（送風機 2 つ × 2 炉と、補機 44）は、名前の無い作業の属性を置かない
  { facility: "fictional-1", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"], rules: f1Rules, mixedWorks: 48, leftOut: F1_MIXED_NAMES },
  { facility: "fictional-2", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"], rules: f2Rules, mixedWorks: 3, leftOut: ["押込ファン", "誘引送風機", "分散制御装置"] },
] as const;

describe("crosswalk.*：深さと呼び名の違う 2 施設の台帳を、規則で 1 段目に当てる", () => {
  for (const c of CASES) {
    test(`crosswalk.${c.facility}`, async () => {
      const ws = await composed(c.facility, [...c.files]);
      const t = loadTruth(PACK, c.facility);

      // 要約：パックの 1 段目の項目・作業の属性・欄ごとの要約（上限どおり）・版。行は写さない
      const s = ok(runTabTool(ws, "intake_survey", { part: "crosswalk" }, CTX));
      expect(TOOLS.intake_survey.output.safeParse(s).success).toBe(true);
      expect(s.samples).toEqual([]);
      const cw = s.crosswalk;
      expect(cw.version).toBe(version());
      expect(cw.items.map((i: any) => i.code)).toEqual(expect.arrayContaining(["WI.RECV.SCALE", "WI.DRAFT.IDF", "WI.INST.DCS"]));
      expect(cw.items).toHaveLength(catalogFor(PACK)!.items.size);
      expect(cw.attributes.map((a: any) => a.code)).toEqual(["INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"]);
      for (const f of cw.fields) {
        expect(f.top.length).toBeLessThanOrEqual(SURVEY_TOP_VALUES);
        for (const v of f.top) expect(v.value.length).toBeLessThanOrEqual(SURVEY_TEXT_MAX);
      }
      expect(cw.unmapped.records).toBe(plan().details.length);
      // 取り込んだばかりの計画は、どの当てはめも無い
      expect(plan().assets.every((a) => a.commonItem === null && !a.commonItemAccepted)).toBe(true);
      expect(plan().works.every((w) => w.attribute === null && !w.attributeAccepted)).toBe(true);

      // AI が規則を置く：数と行の参照だけが返る
      const { nodes, works } = c.rules();
      const r = proposeAll(ws, [...nodes, ...works]);
      expect(r.rules).toHaveLength(nodes.length + works.length);
      for (const x of r.rules) expect(x.matched, x.ruleId).toBeGreaterThan(0);
      expect(r.conflicts).toBe(0);
      expect(r.examples.length).toBeLessThanOrEqual(EXAMPLES_MAX);
      expect(r.version).toBe(version());
      // 返すのは行の参照とコードだけ（名前は返さない）
      for (const e of r.examples) expect(e.rowRef).toMatch(/^[nw]:[a-z0-9-]+$/);
      expect(r.unmappedWorks).toBe(c.mixedWorks);

      // 人が受けるまで、どれも決まっていない：作者は AI、根拠は規則の文、星取表の共通の行には入らない
      const proposed = plan();
      const mappedNodes = proposed.assets.filter((a) => a.commonItem !== null);
      const mappedWorks = proposed.works.filter((w) => w.attribute !== null);
      expect(mappedNodes.length).toBe((t.world.equipment as unknown[]).length);
      for (const a of mappedNodes) {
        expect(a.commonItemAccepted).toBe(false);
        expect(a.commonItemAuthor).toBe("ai");
        expect(a.commonItemBasis).toMatch(/^案 \d+：/);
      }
      for (const w of mappedWorks) {
        expect(w.attributeAccepted).toBe(false);
        expect(w.attributeAuthor).toBe("ai");
      }
      const common = buildChart(proposed, catalogFor(PACK)!, LABELS, { mode: "common", period: "year", layer: "original", foldLevel: null });
      expect(common.rows).toHaveLength(1);
      expect(common.rows[0]?.kind).toBe("unmapped");
      expect(common.rows[0]?.count).toBe(proposed.details.length);
      // 確定もできない：AI の案は人が受けていない決定に並ぶ
      expect(pendingDecisions(proposed, []).filter((d) => d.kind === "commonItem" || d.kind === "attribute").length).toBe(mappedNodes.length + mappedWorks.length);
      // 写し取りも何も写さない
      const before = copyOut({ plan: proposed, lift: new Map(F1_NODES.concat(F2_NODES).map(([, k]) => [k, k])), to: { kind: "ring", id: "0123456789abcdef" } });
      expect(before.chunks).toEqual([]);
      expect(before.skipped.attributeNotAccepted).toBeGreaterThan(0);

      // 人が画面で規則ごとに受ける
      acceptAll();
      const accepted = plan();
      // 正解の当てはめと一致：機器の節は正解のコード、機器でない節（設備の段・系統・部位）は当てない
      let equipment = 0;
      for (const a of accepted.assets) {
        const want = truthCodeOf(t, a);
        if (want) equipment++;
        expect(a.commonItem, a.name).toBe(want);
        if (want) {
          expect(a.commonItemAccepted).toBe(true);
          expect(a.commonItemAuthor).toBe("ai"); // 作者は AI のまま、根拠に人の理由
          expect(a.commonItemBasis).toContain(HUMAN_REASON);
        }
      }
      expect(equipment).toBe((t.world.equipment as unknown[]).length);
      // 作業の属性：正解の属性が 1 つの作業は、その属性と一致。当てなかったのは、名前の無い作業のうち、利用者の答えが
      // 「混ざっている」だった機器（送風機の 2 系列は名前が同じで、どちらかの系列の印に取替が混ざる）の作業だけ。
      // 名前のある作業でも、取り込みが 1 つの作業にまとめた記録の正解が混ざるものがある（凡例の ◎ は精密機能検査だが、
      // 正解では同じ年度の分解整備の記録が同じ印に重なる）。1 つの作業に属性は 1 つなので、そこは正解のどれかと同じであることを見る
      const nameOf = new Map(accepted.assets.map((a) => [a.nodeKey, a.name]));
      const leftOut = (w: WorkT) => w.kind === "" && w.targets.every((k) => (c.leftOut as readonly string[]).includes(nameOf.get(k) ?? ""));
      let mixedLeft = 0;
      for (const w of accepted.works) {
        const want = truthAttrsOf(t, accepted, w);
        expect(want.size, w.kind).toBeGreaterThan(0);
        if (w.attribute === null) {
          expect(leftOut(w), w.kind).toBe(true);
          if (want.size > 1) mixedLeft++;
          continue;
        }
        expect(w.attributeAccepted).toBe(true);
        expect([...want], w.kind).toContain(w.attribute);
        if (want.size === 1) expect([...want]).toEqual([w.attribute]);
      }
      expect(mixedLeft).toBeGreaterThan(0);
      // 星取表の共通の行に、受けた当てはめが並ぶ。未当てはめの行の件数は、数え方の関数と同じ
      const after = buildChart(accepted, catalogFor(PACK)!, LABELS, { mode: "common", period: "year", layer: "original", foldLevel: null });
      const assetsByKey = new Map(accepted.assets.map((a) => [a.nodeKey, a]));
      const withRecords = new Set(
        accepted.details.flatMap((d) => {
          const w = accepted.works.find((x) => x.workKey === d.workKey)!;
          return w.targets.map((k) => assetsByKey.get(k)!).filter((a) => inCommonRows(a, w)).map((a) => a.commonItem!);
        }),
      );
      expect(withRecords.size).toBeGreaterThan(10);
      expect(after.rows.filter((x) => x.level === 2).map((x) => x.id.slice(2)).sort()).toEqual([...withRecords].sort());
      const un = after.rows.find((x) => x.kind === "unmapped");
      const sum = crosswalkSummary(accepted);
      expect(un?.count ?? 0).toBe(sum.unmappedRecords);
      expect(sum.unmappedRecords).toBeGreaterThan(0); // 送風機の混ざった作業
      expect(sum.works.none).toBe(c.mixedWorks);
      expect(pendingDecisions(accepted, []).filter((d) => d.kind === "commonItem" || d.kind === "attribute")).toEqual([]);
    }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
  }
});

describe("ぶつかり・断り・人の道", () => {
  const F1 = CASES[0];

  test("同じ行に違う値の規則が当たればぶつかりに数え、行は変えない。人が受けた値と違う規則もぶつかり", async () => {
    const ws = await composed(F1.facility, [...F1.files]);
    // 2 つのクレーンの節を受入れのクレーンに、灰クレーンを灰出しのクレーンに：灰クレーンの節に 2 つが当たる
    const r = proposeAll(ws, [
      node([{ field: "assetNode.name", op: "in", values: ["ごみクレーン", "灰クレーン"] }], "WI.RECV.CRANE", "名前がクレーン"),
      node([nameIs("灰クレーン")], "WI.ASHOUT.ASH_CRANE", "灰クレーン"),
    ]);
    expect(r.matched).toBe(1);
    expect(r.conflicts).toBe(1);
    expect(r.rules.map((x: any) => [x.matched, x.conflicts])).toEqual([
      [1, 1],
      [0, 1],
    ]);
    const ash = plan().assets.find((a) => a.name === "灰クレーン")!;
    expect(ash.commonItem).toBeNull();
    expect(r.examples[0]).toMatchObject({ rowRef: `n:${ash.nodeKey}`, before: null, after: "WI.RECV.CRANE|WI.ASHOUT.ASH_CRANE" });
    // 人が受けたあとに、違う値の規則を置いてもぶつかりで、受けた値のまま
    acceptAll();
    const crane = plan().assets.find((a) => a.name === "ごみクレーン")!;
    expect(crane.commonItemAccepted).toBe(true);
    const r2 = proposeAll(ws, [node([nameIs("ごみクレーン")], "WI.RECV.SCALE", "わざと違う値")]);
    expect(r2.conflicts).toBe(1);
    expect(r2.matched).toBe(0);
    expect(plan().assets.find((a) => a.nodeKey === crane.nodeKey)?.commonItem).toBe("WI.RECV.CRANE");
    // 同じ値なら当てたに数え、変えない（人が受けたまま）
    const r3 = proposeAll(ws, [node([nameIs("ごみクレーン")], "WI.RECV.CRANE", "同じ値")]);
    expect([r3.matched, r3.conflicts]).toEqual([1, 0]);
    expect(plan().assets.find((a) => a.nodeKey === crane.nodeKey)).toMatchObject({ commonItemAccepted: true, commonItemBasis: crane.commonItemBasis });
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）

  test("パックに無いコードは型の誤りとして断り、どの案も置かない。4 つの外の属性・置けない欄・作業明細の条件は型で断る", async () => {
    const ws = await composed(F1.facility, [...F1.files]);
    const v = version();
    const good = node([nameIs("計量機")], "WI.RECV.SCALE", "r");
    const notInPack = node([nameIs("ごみクレーン")], "WI.RECV.NOPE", "パックに無い");
    expect(runTabTool(ws, "crosswalk_propose", { rules: [good, notInPack], basedOnVersion: v }, CTX)).toEqual({ ok: false, code: "code_not_in_pack" });
    expect(version()).toBe(v);
    expect(plan().assets.every((a) => a.commonItem === null)).toBe(true);
    expect(getWorkingPlan()!.proposals).toEqual([]);
    expect(ws.notices[0]?.text).toContain("断りました");

    const bad: Rule[] = [
      attr([{ field: "work.kind", op: "equals", values: ["x"] }], "REPAIR", "4 つの外"),
      { when: [{ field: "work.kind", op: "equals", values: ["x"] }], set: { field: "work.strategy", value: "time_based" }, reason: "置けない欄" },
      { when: [{ field: "work.kind", op: "equals", values: ["x"] }], set: { field: "assetNode.commonItemAuthor", value: "human" }, reason: "作者を変える" },
      node([{ field: "workDetail.fiscalYear", op: "range", values: [2019, 2020] }], "WI.RECV.SCALE", "作業明細の条件"),
      node([nameIs("計量機")], "not a code", "コードの形でない"),
    ];
    for (const b of bad) {
      expect(TOOLS.crosswalk_propose.input.safeParse({ rules: [b], basedOnVersion: v }).success, b.reason).toBe(false);
      expect(runTabTool(ws, "crosswalk_propose", { rules: [b], basedOnVersion: v }, CTX), b.reason).toEqual({ ok: false, code: "tool_failed" });
    }
    // 受けたことにする欄は、規則の欄の一覧にそもそも無い
    expect(TOOLS.crosswalk_propose.input.safeParse({ rules: [{ ...good, set: { field: "assetNode.commonItemAccepted", value: true } }], basedOnVersion: v }).success).toBe(false);
    expect(version()).toBe(v);
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）

  test("もとにした版が違えばどれも置かない。計画が無ければ「作業中の計画が無い」", async () => {
    expect(runTabTool(new IntakeWorkspace({ packId: PACK, facilityName: "x", fiscalYearStartMonth: 4, fictional: true }), "crosswalk_propose", { rules: [node([nameIs("計量機")], "WI.RECV.SCALE", "r")], basedOnVersion: 0 }, CTX)).toEqual({ ok: false, code: "no_working_plan" });
    const ws = await composed(F1.facility, [...F1.files]);
    const v = version();
    expect(runTabTool(ws, "crosswalk_propose", { rules: [node([nameIs("計量機")], "WI.RECV.SCALE", "r")], basedOnVersion: v - 1 }, CTX)).toEqual({ ok: false, code: "stale_version" });
    const r = proposeAll(ws, [node([nameIs("計量機")], "WI.RECV.SCALE", "r")]);
    expect(r.version).toBe(v + 1);
    // 前の版をもとにした 2 回目は断る（新しい版は結果と要約にある）
    expect(runTabTool(ws, "crosswalk_propose", { rules: [node([nameIs("DCS")], "WI.INST.DCS", "r")], basedOnVersion: v }, CTX)).toEqual({ ok: false, code: "stale_version" });
    expect(ok(runTabTool(ws, "intake_survey", { part: "crosswalk" }, CTX)).crosswalk.version).toBe(v + 1);
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）

  test("人が断ると案を外す（理由が空なら断れない）。人が直に当てると作者は「人」", async () => {
    const ws = await composed(F1.facility, [...F1.files]);
    // 1 つの機器に 1 つずつ当たる規則を 3 つ（台本は項目ごとに名前をまとめるので、ここでは明示して作る）
    const level2 = { field: "assetNode.level" as const, op: "equals" as const, values: [2] };
    proposeAll(ws, [
      node([nameIs("計量機"), level2], "WI.RECV.SCALE", "機器の段の名前「計量機」は、パックの項目の名前と同じもの"),
      node([nameIs("ごみクレーン"), level2], "WI.RECV.CRANE", "機器の段の名前「ごみクレーン」は、パックの項目の名前と同じもの"),
      node([nameIs("可燃性粗大ごみ切断機"), level2], "WI.RECV.SHREDDER", "機器の段の名前「可燃性粗大ごみ切断機」は、パックの項目の名前と同じもの"),
    ]);
    const [p1, p2] = getWorkingPlan()!.proposals;
    expect(rejectByHuman(p1!.ruleId, "  ")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(acceptByHuman(p1!.ruleId, "")).toEqual({ ok: false, reason: "reasonEmpty" });
    const r = rejectByHuman(p1!.ruleId, "計量機は別の項目にしたい");
    expect(r).toMatchObject({ ok: true, rows: 1 });
    expect(plan().assets.find((a) => a.name === "計量機")).toMatchObject({ commonItem: null, commonItemAuthor: null, commonItemBasis: null, commonItemAccepted: false });
    expect(getWorkingPlan()!.proposals[0]).toMatchObject({ state: "rejected", humanReason: "計量機は別の項目にしたい" });
    // 一度断った規則は、もう受けられない
    expect(acceptByHuman(p1!.ruleId, "やはり受ける")).toEqual({ ok: false, reason: "notProposed" });
    // 人が直に当てる：作者「人」・受けた。案のある行に当てると人の当てはめに置き換わる
    const scale = plan().assets.find((a) => a.name === "計量機")!;
    expect(setByHuman("assetNode", scale.nodeKey, "WI.RECV.SCALE", "")).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(setByHuman("assetNode", scale.nodeKey, "WI.NOPE.X", "r")).toEqual({ ok: false, reason: "valueInvalid" });
    expect(setByHuman("work", plan().works[0]!.workKey, "REPAIR", "r")).toEqual({ ok: false, reason: "valueInvalid" });
    expect(setByHuman("assetNode", scale.nodeKey, "WI.RECV.SCALE", "台帳を見て人が決めた").ok).toBe(true);
    expect(plan().assets.find((a) => a.nodeKey === scale.nodeKey)).toMatchObject({ commonItem: "WI.RECV.SCALE", commonItemAuthor: "human", commonItemAccepted: true });
    const crane = plan().assets.find((a) => a.name === "ごみクレーン")!;
    expect(crane.commonItemAccepted).toBe(false);
    expect(setByHuman("assetNode", crane.nodeKey, "WI.RECV.CRANE", "人が見た").ok).toBe(true);
    expect(getWorkingPlan()!.plan.assets.find((a) => a.nodeKey === crane.nodeKey)?.commonItemAuthor).toBe("human");
    // その規則の案のままの行は、もう無い
    expect(acceptByHuman(p2!.ruleId, "受ける")).toMatchObject({ ok: true, rows: 0 });
    // 外す
    expect(setByHuman("assetNode", crane.nodeKey, null, "やはり外す").ok).toBe(true);
    expect(plan().assets.find((a) => a.nodeKey === crane.nodeKey)?.commonItem).toBeNull();
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）

  test("AI のツールの受け手には、受ける・断る・直に当てる道が無い", () => {
    const src = readFileSync("src/app/intake/tab-tools.ts", "utf8");
    for (const f of ["acceptByHuman", "rejectByHuman", "setByHuman", "acceptProposal", "rejectProposal", "setMappingByHuman", "updateWorkingPlan", "setWorkingPlan"]) expect(src).not.toContain(f);
  });
});

describe("写し取り：人が受けた計画から塊が出る。作業の属性を受けていない作業は新しい理由に数える", () => {
  test("fictional-1：受けた計画で k ≥ 5 の段が決まり塊が出る。1 つの規則を受けずに残すと、その作業の行は attributeNotAccepted", async () => {
    const F1 = CASES[0];
    const ws = await composed(F1.facility, [...F1.files]);
    const { nodes, works } = f1Rules();
    proposeAll(ws, [...nodes, ...works]);
    // 名前の無い作業の OVERHAUL の規則（最後の 1 つ）だけを受けずに残す
    const ps = getWorkingPlan()!.proposals;
    const left = ps[ps.length - 1]!;
    for (const p of ps.slice(0, -1)) expect(acceptByHuman(p.ruleId, HUMAN_REASON).ok).toBe(true);
    const p = plan();
    const pending = new Set(p.works.filter((w) => w.attribute !== null && !w.attributeAccepted).map((w) => w.workKey));
    expect(pending.size).toBeGreaterThan(0);
    expect(p.works.filter((w) => pending.has(w.workKey)).every((w) => w.attributeBasis?.startsWith(`${left.ruleId}：`))).toBe(true);

    const dir = `packs/${PACK}/`;
    const vocab = loadVocab(readFileSync(dir + "vocab.json", "utf8"));
    const table = loadNational(readFileSync(dir + "national/table.json", "utf8"));
    const spec = (JSON.parse(readFileSync(dir + "pack.json", "utf8")) as { profile: ProfileSpec }).profile;
    const facility = { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" };
    const ch = chooseProfile({ table, vocab, spec, facility, group: "NATIONAL", classes: candidateClasses(p) });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    expect(ch.k).toBeGreaterThanOrEqual(SEND_MIN_K);
    const r = copyOut({ plan: p, lift: ch.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.chunks.length).toBeGreaterThan(0);
    // 受けていない作業の、実績の作業明細 × 対象の行の数だけが attributeNotAccepted
    const want = p.details
      .filter((d) => pending.has(d.workKey) && d.planOrActual === "actual" && !d.needsReview)
      .reduce((n, d) => n + (p.works.find((w) => w.workKey === d.workKey)?.targets.length ?? 0), 0);
    expect(want).toBeGreaterThan(0);
    expect(r.skipped.attributeNotAccepted).toBe(want);
    expect(Object.keys(r.skipped).sort()).toEqual([...SKIP_REASONS].sort());
    expect(r.rows).toBe(r.copied + Object.values(r.skipped).reduce((a, b) => a + b, 0));
    // 残した規則も受けると、その理由は 0 になり、写す行が増える
    expect(acceptByHuman(left.ruleId, HUMAN_REASON).ok).toBe(true);
    const r2 = copyOut({ plan: plan(), lift: ch.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r2.skipped.attributeNotAccepted).toBe(0);
    expect(r2.copied).toBeGreaterThan(r.copied);
    // 共通の行に入るのは、両方を人が受けた組だけ
    for (const w of plan().works) for (const t of w.targets) {
      const a = plan().assets.find((x) => x.nodeKey === t)!;
      expect(inCommonRows(a, w)).toBe(a.commonItemAccepted && w.attributeAccepted && a.commonItem !== null && w.attribute !== null);
    }
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});

describe("計画を作り直しても、当てはめを黙って捨てない", () => {
  const snap = (p: Plan) => ({
    nodes: Object.fromEntries(p.assets.map((a) => [a.nodeKey, [a.commonItem, a.commonItemAuthor, a.commonItemBasis, a.commonItemAccepted]])),
    works: Object.fromEntries(p.works.map((w) => [w.workKey, [w.attribute, w.attributeAuthor, w.attributeBasis, w.attributeAccepted]])),
  });

  test("人が受けた規則・断った規則・案のままの規則・人が直に当てた行が、作り直したあとも同じ", async () => {
    const F = CASES[0];
    const ws = await composed(F.facility, [...F.files]);
    const { nodes, works } = F.rules();
    proposeAll(ws, [...nodes, ...works]);
    const ps = getWorkingPlan()!.proposals;
    // 1 つ目は断る、2 つ目は案のまま、残りは受ける
    expect(rejectByHuman(ps[0]!.ruleId, "試験の台本が押した（断る）").ok).toBe(true);
    for (const p of ps.slice(2)) expect(acceptByHuman(p.ruleId, HUMAN_REASON).ok).toBe(true);
    // 人が直に当てる（規則の当てはめを人の当てはめに置き換える）
    const crane = plan().assets.find((a) => a.name === "ごみクレーン")!;
    expect(setByHuman("assetNode", crane.nodeKey, "WI.RECV.CRANE", "台帳を見て人が決めた").ok).toBe(true);
    const before = snap(plan());
    const states = getWorkingPlan()!.proposals.map((p) => [p.ruleId, p.state, p.humanReason]);
    const gen = getWorkingPlan()!.generation;

    // 取り込みで計画を作り直す（同じ資料と決定）
    ws.startCompose("human");
    await ws.whenComposed();
    expect(getWorkingPlan()!.generation).toBe(gen + 1);
    expect(snap(plan())).toEqual(before);
    // 断った規則は引き継がない。ほかは同じ ID・同じ状態・同じ理由
    expect(getWorkingPlan()!.proposals.map((p) => [p.ruleId, p.state, p.humanReason])).toEqual(states.filter((s) => s[1] !== "rejected"));
    // 画面に、引き継いだ数を知らせる
    expect(ws.notices[0]).toMatchObject({ kind: "info" });
    expect(ws.notices[0]!.text).toContain("前の当てはめを引き継ぎました");
    expect(ws.notices[0]!.text).not.toContain("引き継げませんでした");
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）

  test("新しい計画に無い行は、人が直に当てたものも数えて知らせる", async () => {
    const F = CASES[0];
    const ws = await composed(F.facility, [...F.files]);
    const crane = plan().assets.find((a) => a.name === "ごみクレーン")!;
    expect(setByHuman("assetNode", crane.nodeKey, "WI.RECV.CRANE", "台帳を見て人が決めた").ok).toBe(true);
    const prev = getWorkingPlan()!;
    const next: Plan = { ...prev.plan, assets: prev.plan.assets.filter((a) => a.nodeKey !== crane.nodeKey).map((a) => ({ ...a, commonItem: null, commonItemAuthor: null, commonItemBasis: null, commonItemAccepted: false })) };
    const r = carryOverCrosswalk(prev.plan, prev.proposals, next, new Set(catalogFor(PACK)!.items.keys()), (b, reason) => `${b}。人が受けた理由：${reason}`);
    expect(r.report).toMatchObject({ acceptedBefore: 1, acceptedAfter: 0, humanLost: 1 });
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});
