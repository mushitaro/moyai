// 計画ルール（3 段目の Skill の planCycle。運営者の決定「案 C」、2026-11-06・Architect の 42）：
// 共通の設備項目 × 作業の属性 → 周期。同じ Skill のファイル・範囲・版・承認に入り、当たる作業に周期の案（R）を出すだけで、人が受けるまで決まらない。
// chart_propose の根拠は、AI が指すだけで、中身は MOYAI が計画・パック・当てているルールから引く。
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { carryFromBase } from "../../src/app/state/crosswalk";
import { applyPlanRules, resetPlanRulesForTest } from "../../src/app/state/cycles";
import { getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { readingsSigned, setCurrentReadings } from "../../src/app/state/readings";
import { approvedReadingVersions, listReadings, loadedOf, planRulesBacked, readingVersion, registerReading } from "../../src/bridge/readings";
import { READING_SCHEMA, ReadingRule, ReadingSkill, activePlanRules, skillMarkdown, type LoadedReading } from "../../src/import/reading";
import { CONVERSATION_SOURCE, PACK_SOURCE, PLAN_RULE_SOURCE, RECORD_SOURCE, cycleIdOf } from "../../src/plan/cycle";
import { pendingDecisions } from "../../src/plan/diff";
import { commitPlan } from "../../src/plan/store";
import { keyIdOf } from "../../src/share/sign";
import type { Plan } from "../../src/shared/plan";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

const ITEM = "WI.CRANE.ASH";
const planRule = (o: Partial<Record<string, unknown>> = {}) =>
  ({ id: "p1", text: "灰クレーンの整備は 5 年ごと", kind: "planCycle", commonItem: ITEM, attribute: "OVERHAUL", years: 5, author: "ai", reason: "利用者が会話で直した", ...o }) as ReadingRule;
const skillOf = (rules: ReadingRule[], name = "【架空】計画ルール", scope: ReadingSkill["scope"] = "company"): ReadingSkill => ({ schema: READING_SCHEMA, name, scope, rules });
const draftOf = (s: ReadingSkill): LoadedReading => ({ skill: s, version: "", path: null, approved: false, draft: true });

/** w1：項目と属性を人が受けた作業（実施 2016・2021）。w2：属性が案のまま。w3：ほかの項目（終わりの年度 2035 を持つ） */
const base = (): Plan =>
  plan({
    assets: [asset("a1", ITEM, { name: "灰クレーン" }), asset("a2", ITEM, { name: "ごみクレーン" }), asset("a3", "WI.FAN.IDF", { name: "誘引送風機" })],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a2"], { attributeAccepted: false, attributeAuthor: "ai", attributeBasis: "名前" }), work("w3", "OVERHAUL", ["a3"])],
    details: [detail("d1", "w1", 2016), detail("d2", "w1", 2021), detail("d3", "w2", 2020), detail("d4", "w3", 2018), detail("d5", "w3", 2035, { planOrActual: "plan" })],
  });

const rDetails = (p: Plan) => p.details.filter((d) => cycleIdOf(d.detailKey)?.startsWith("R"));

beforeEach(() => {
  resetPlanRulesForTest();
  setCurrentReadings([], null);
});

describe("計画ルールの形と版", () => {
  it("項目のコード・4 つの属性・1〜30 年だけ。ほかの欄は置けない", () => {
    expect(ReadingRule.safeParse(planRule()).success).toBe(true);
    for (const bad of [{ commonItem: "灰クレーン" }, { attribute: "REPAIR" }, { years: 0 }, { years: 31 }, { years: 2.5 }, { script: "x" }]) expect(ReadingRule.safeParse(planRule(bad)).success, JSON.stringify(bad)).toBe(false);
  });

  it("中身が変われば版が変わる。計画ルールの無い読み方の SKILL.md の文は変えない", () => {
    const a = skillOf([planRule()]);
    const b = skillOf([planRule({ years: 6 })]);
    const v = (s: ReadingSkill) => readingVersion(skillMarkdown(s), JSON.stringify(s));
    expect(v(a)).not.toBe(v(b));
    expect(skillMarkdown(a)).toContain("- 灰クレーンの整備は 5 年ごと（計画ルール：WI.CRANE.ASH・OVERHAUL・5 年）");
    const reading = skillOf([{ id: "r1", text: "1 行目を見出しとして読む", kind: "headerRow", row: 1, author: "ai", reason: "会話" } as ReadingRule], "【架空】日報");
    expect(skillMarkdown(reading)).not.toContain("計画ルール");
  });

  it("同じ項目 × 属性は、効く順の先のもの（施設 → 担当 → 会社、下書きが先）だけ", () => {
    const company: LoadedReading = { skill: skillOf([planRule({ years: 7 })], "【架空】会社"), version: "c".repeat(64), path: "skills/会社/x", approved: true, draft: false };
    const facility = draftOf(skillOf([planRule({ years: 4 })], "【架空】施設", "facility"));
    expect(activePlanRules([company, facility]).map((a) => a.rule.years)).toEqual([4]);
  });
});

describe("計画ルール → 周期の案（R）", () => {
  it("項目と属性を人が受けた作業にだけ、R の案（作者 AI・出どころは計画ルール）を出す。work.trigger は書かず、人が受けるまで決まらない", () => {
    setWorkingPlan(base(), "intake");
    expect(applyPlanRules([draftOf(skillOf([planRule()]))])).toBe(true);
    const p = getWorkingPlan()!.plan;
    const rs = rDetails(p);
    expect(rs.map((d) => [d.workKey, d.fiscalYear])).toEqual([
      ["w1", 2026],
      ["w1", 2031],
    ]);
    for (const d of rs) {
      expect(d).toMatchObject({ planOrActual: "plan", author: "ai", sources: [{ file: PLAN_RULE_SOURCE, sheet: "【架空】計画ルール", cell: "p1" }] });
      expect(d.basis).toContain("計画ルール「【架空】計画ルール」版 ―：灰クレーンの整備は 5 年ごと");
    }
    expect(p.works.every((w) => w.trigger === null || w.trigger === undefined)).toBe(true);
    const pending = pendingDecisions(p, []).map((d) => d.id);
    for (const d of rs) expect(pending).toContain(`detail:${d.detailKey}`);
  });

  it("何度呼んでも同じ（書き換えない）。ルールを変えると出し直し、外すと消す。R は前の版から写さない", () => {
    setWorkingPlan(base(), "intake");
    const r = [draftOf(skillOf([planRule()]))];
    applyPlanRules(r);
    const rev = getWorkingPlan()!.revision;
    expect(applyPlanRules(r)).toBe(false);
    expect(getWorkingPlan()!.revision).toBe(rev);
    applyPlanRules([draftOf(skillOf([planRule({ years: 7 })]))]);
    expect(rDetails(getWorkingPlan()!.plan).map((d) => d.fiscalYear)).toEqual([2028, 2035]);
    const withR = getWorkingPlan()!.plan;
    applyPlanRules([]);
    expect(rDetails(getWorkingPlan()!.plan)).toEqual([]);
    // 次の版に重ねるとき、R の案は写さない（そのときのルールの版から出し直す）
    expect(rDetails(carryFromBase(base(), withR, 1))).toEqual([]);
  });

  it("保管先の版に入っている R の印には触らず、ID もぶつけない", () => {
    setWorkingPlan(base(), "intake");
    applyPlanRules([draftOf(skillOf([planRule()]))]);
    const signed = getWorkingPlan()!.plan;
    // 署名した版を開き直した形（新しい回）。同じ年度は飛ばすので、新しい印は出ない
    resetPlanRulesForTest();
    setWorkingPlan(signed, "intake");
    applyPlanRules([draftOf(skillOf([planRule({ years: 3 })]))]);
    const p = getWorkingPlan()!.plan;
    expect(p.details.filter((d) => d.detailKey.startsWith("cy-R1-"))).toEqual(rDetails(signed));
    expect(rDetails(p).filter((d) => !d.detailKey.startsWith("cy-R1-")).every((d) => d.detailKey.startsWith("cy-R2-"))).toBe(true);
  });
});

describe("chart_propose の根拠（AI は指すだけ）", () => {
  const ctx = { conversation: "c", rowsRemaining: 2000 };
  const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】根拠の試験", fiscalYearStartMonth: 4, fictional: true });
  const rule = { when: [{ field: "assetNode.commonItem", op: "equals", values: [ITEM] }], set: { field: "work.trigger", value: 5 }, reason: "会話で決めた" };
  const call = (w: IntakeWorkspace, bases: Record<string, unknown>) =>
    runTabTool(w, "chart_propose", { rules: [rule], basedOnVersion: getWorkingPlan()!.revision, basis: "利用者と決めた", bases }, ctx);
  /** いちばん新しい C の案の出どころ（案の印はどれも同じ出どころ） */
  const sourcesOf = () => {
    const d = getWorkingPlan()!.plan.details.filter((x) => cycleIdOf(x.detailKey)?.startsWith("C")).at(-1);
    return d?.sources.map((s) => s.file) ?? [];
  };

  it("② パックの基準：checks.json にある検査の ID なら、名前と出典を MOYAI が書く。無い ID は pack_basis_unknown で、案を置かない", () => {
    const w = ws();
    setWorkingPlan(base(), "intake");
    const before = getWorkingPlan()!.plan.details.length;
    expect(call(w, { pack: { checkId: "WI-NOT-THERE" } })).toEqual({ ok: false, code: "pack_basis_unknown" });
    expect(getWorkingPlan()!.plan.details.length).toBe(before);
    const ok = call(w, { pack: { checkId: "WI-PRECISION-INTERVAL" } });
    expect(ok.ok).toBe(true);
    expect(sourcesOf()).toEqual([PACK_SOURCE]);
    const d = getWorkingPlan()!.plan.details.find((x) => cycleIdOf(x.detailKey)?.startsWith("C"))!;
    expect(d.basis).toContain("パックの基準「精密機能検査の間隔」（WI-PRECISION-INTERVAL。出典 MHW-NOTICE-S46-KANSEI45");
  });

  it("④ 計画ルール：作業画面が当てているルールなら、版と 1 文を MOYAI が書く。無い名前・id は plan_rule_unknown", () => {
    const w = ws();
    setWorkingPlan(base(), "intake");
    expect(call(w, { rule: { name: "【架空】計画ルール", ruleId: "p1" } })).toEqual({ ok: false, code: "plan_rule_unknown" });
    const placed = runTabTool(w, "reading_rules_propose", { name: "【架空】計画ルール", scope: "company", rules: [planRule()] }, ctx);
    expect(placed.ok).toBe(true);
    // 件数は、出した R の案の印の数（w1 の 2026・2031）
    expect(placed.ok && placed.data.rules).toEqual([{ id: "p1", text: "灰クレーンの整備は 5 年ごと", hits: 2 }]);
    expect(call(w, { rule: { name: "【架空】計画ルール", ruleId: "nope" } })).toEqual({ ok: false, code: "plan_rule_unknown" });
    // 読み方の規則（計画ルールでない）を指しても通さない
    runTabTool(w, "reading_rules_propose", { name: "【架空】計画ルール", scope: "company", rules: [{ id: "r1", text: "1 行目を見出しとして読む", kind: "headerRow", row: 1, author: "ai", reason: "会話" }] }, ctx);
    expect(call(w, { rule: { name: "【架空】計画ルール", ruleId: "r1" } })).toEqual({ ok: false, code: "plan_rule_unknown" });
    expect(call(w, { rule: { name: "【架空】計画ルール", ruleId: "p1" } }).ok).toBe(true);
    expect(sourcesOf()).toContain(PLAN_RULE_SOURCE);
  });

  it("① 自施設の実績：間隔は当たった作業の実績から数える。数えられなければ出どころは会話", () => {
    const w = ws();
    setWorkingPlan(base(), "intake");
    expect(call(w, { record: true }).ok).toBe(true);
    expect(sourcesOf()).toEqual([RECORD_SOURCE]);
    const d = getWorkingPlan()!.plan.details.find((x) => cycleIdOf(x.detailKey)?.startsWith("C"))!;
    expect(d.basis).toContain("自施設の実績：実施が 2 回以上の作業 1 の間隔 5 年");
    // 実施が 1 回だけの作業しか当たらなければ、数えられないので会話
    setWorkingPlan(plan({ assets: [asset("a1", ITEM)], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2020), detail("d2", "w1", 2035, { planOrActual: "plan" })] }), "intake");
    expect(call(w, { record: true }).ok).toBe(true);
    expect(sourcesOf()).toEqual([CONVERSATION_SOURCE]);
  });
});

describe("版の署名で承認する計画ルール（Architect の 42 の 2）", () => {
  const root = mkdtempSync(join(tmpdir(), "moyai-plan-rules-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("載せるのは、この署名で人が受けた R の案のもとになったルールだけ。署名した版の記録は、その中身のハッシュで承認する", async () => {
    setWorkingPlan(base(), "intake");
    const both = skillOf([planRule(), planRule({ id: "p2", text: "誘引送風機の整備は 9 年ごと", commonItem: "WI.FAN.IDF", years: 9 })]);
    setCurrentReadings([draftOf(both)], null);
    applyPlanRules();
    const p = getWorkingPlan()!.plan;
    // p2 は w3（終わりの年度 2035、最後の実施 2018 → 2027）に 1 つ出る。p1 の案だけを受けた形
    const ids = new Set(rDetails(p).filter((d) => d.sources[0]!.cell === "p1").map((d) => `detail:${d.detailKey}`));
    const signed = readingsSigned(p, ids);
    expect(signed.map((r) => r.skill.rules.map((x) => x.id))).toEqual([["p1"]]);
    // どの案も受けていなければ、計画ルールだけの下書きは載せない
    expect(readingsSigned(p, new Set())).toEqual([]);
    // 橋渡しの照らし：受けた案の無いルールが入っていれば断る。承認済みの同じ中身なら通す
    expect(planRulesBacked(signed[0]!.skill, p, ids, [])).toBe(true);
    expect(planRulesBacked(both, p, ids, [])).toBe(false);
    expect(planRulesBacked(signed[0]!.skill, p, new Set(), [])).toBe(false);

    // 署名すると、その版が使った読み方の中身のハッシュ（版）が承認済みになる
    const w = await registerReading(root, signed[0]!.skill, null, null);
    if (!w.ok) throw new Error(w.reason);
    const acceptances = pendingDecisions(p, [])
      .filter((d) => ids.has(d.id) || !cycleIdOf(d.id.slice("detail:".length)))
      .map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const onlyP1: Plan = { ...p, details: p.details.filter((d) => !(cycleIdOf(d.detailKey)?.startsWith("R") && !ids.has(`detail:${d.detailKey}`))) };
    const v1 = await commitPlan({ root, plan: onlyP1, reason: "確定", acceptances, basedOn: null, signer: SIGNER, client: "t", readingSkills: [{ name: signed[0]!.skill.name, path: w.path, version: w.version }] });
    if (!v1.ok) throw new Error(v1.reason);
    const approved = await approvedReadingVersions(root, (x) => x.key === keyIdOf(SIGNER.pair.pub));
    expect(approved.get(w.version)?.in).toBe(1);
    const list = await listReadings(root, approved);
    expect(loadedOf(list, null).map((x) => [x.skill.name, x.approved, x.skill.rules.map((r) => r.id)])).toEqual([["【架空】計画ルール", true, ["p1"]]]);
    expect(planRulesBacked(signed[0]!.skill, p, new Set(), list)).toBe(true);
  });

  it("reading_skill_register と同じ確かめ：計画ルールの下書きも未承認の場所に書くだけで、承認済みの版は残り、範囲は置き場所で決まる", async () => {
    const w = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】書く試験", fiscalYearStartMonth: 4, fictional: true });
    const ctx = { conversation: "c", rowsRemaining: 2000 };
    const name = "【架空】計画ルール";
    // 上の試験で承認済みになった版（p1 だけ）の上に、p1 の周期を変えた下書きを書く
    expect(runTabTool(w, "reading_rules_propose", { name, scope: "company", rules: [planRule({ years: 6 })] }, ctx).ok).toBe(true);
    const mid = runTabTool(w, "reading_skill_register", { name }, ctx);
    if (!mid.ok) throw new Error(mid.code);
    // 作業画面は下書きの中身を渡すだけ（作者は AI に固めてある）。橋渡しが同じ関数で保管先に書く
    expect((mid.data.skill as ReadingSkill).rules[0]).toMatchObject({ kind: "planCycle", years: 6, author: "ai" });
    const before = await listReadings(root, await approvedReadingVersions(root, (x) => x.key === keyIdOf(SIGNER.pair.pub)));
    const old = before.find((x) => x.name === name && x.approved)!;
    const r = await registerReading(root, mid.data.skill, null, typeof mid.data.facilityKey === "string" ? mid.data.facilityKey : null);
    if (!r.ok) throw new Error(r.reason);
    const after = await listReadings(root, await approvedReadingVersions(root, (x) => x.key === keyIdOf(SIGNER.pair.pub)));
    const mine = after.filter((x) => x.name === name);
    // 新しい版は未承認。承認済みの前の版は versions/ に同じ中身で残り、作業画面に渡すのはまだ前の版
    expect(mine.map((x) => [x.version === r.version, x.current, x.approved])).toEqual([
      [true, true, false],
      [false, false, true],
    ]);
    expect(mine.find((x) => x.approved)!.version).toBe(old.version);
    expect(readdirSync(join(root, "skills", "会社", name, "versions"))).toContain(old.version);
    expect(loadedOf(after, null).map((x) => x.version)).toEqual([old.version]);
    // 範囲は置き場所：施設の範囲で同じ名前を書いても、会社の置き場所には触らない
    const f = await registerReading(root, { ...(mid.data.skill as ReadingSkill), scope: "facility" }, null, "fac-x");
    expect(f.ok && f.path).toBe(`fac-x/skills/${name}`);
    const again = await listReadings(root, await approvedReadingVersions(root, (x) => x.key === keyIdOf(SIGNER.pair.pub)));
    expect(again.filter((x) => x.name === name && x.scope === "company").map((x) => x.version)).toEqual(mine.map((x) => x.version));
  });
});
