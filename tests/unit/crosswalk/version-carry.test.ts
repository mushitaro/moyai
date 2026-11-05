// 次の版に重ねる（1C・重-2・重-3・台帳の中-8。Architect の形と縛り）：
// - 版を組んだ資料と決定だけで組み直すと、前の版と同じ機器・作業・明細になる（縛り 1）
// - 同一性の鍵は資料の位置から作らない：ファイル名と行の位置をずらした同じ資料でも、同じ機器は同じ鍵（中-8）
// - 前の版で人が受けた当てはめは「第 n 版と同じ」の案として並び、人が受けるまで決まらない（1C）
// - 同じタブで作り直して、受けた規則が新しい行に当たれば、規則は案に戻る（重-3）
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { acceptByHuman, setCrosswalkBase } from "../../../src/app/state/crosswalk";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../../src/app/state/plan-store";
import { pendingDecisions } from "../../../src/plan/diff";
import type { Plan } from "../../../src/shared/plan";
import { f1Rules } from "../../fixtures/crosswalk/rules";

const PACK = "waste-incineration";
const CTX = { conversation: "c-carry", rowsRemaining: 2000 };
const DIR = `samples/out/${PACK}/fictional-1/`;
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];

afterEach(() => {
  clearWorkingPlan();
  setCrosswalkBase(null);
});

function ok(r: ReturnType<typeof runTabTool>): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

const files = (list: { name: string; bytes: Uint8Array }[]) => list.map((f) => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes }));
const original = () => FILES.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(DIR + n)) }));

/** 既定の答えで質問に答え（AI が会話の答えとして置く）、計画を作る */
async function compose(ws: IntakeWorkspace): Promise<Plan> {
  for (let i = 0; i < 15; i++) {
    const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
    if (!s.questions.length) break;
    ok(runTabTool(ws, "intake_settle", { decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで既定の答えでよいと言った" })) }, CTX));
  }
  ok(runTabTool(ws, "intake_compose", {}, CTX));
  await ws.whenComposed();
  const p = getWorkingPlan()?.plan;
  if (!p) throw new Error(`計画ができない：${ws.composeBlockers().join("・")}`);
  return p;
}

const newWs = () => new IntakeWorkspace({ packId: PACK, facilityName: "【架空】版を重ねる試験", fiscalYearStartMonth: 4, fictional: true });
/** 当てはめの欄を除いた、機器・作業・明細の形（組み直しで同じかを比べる） */
const shape = (p: Plan) => ({
  assets: p.assets.map((a) => [a.nodeKey, a.name, a.parentKey, a.tag]).sort(),
  works: p.works.map((w) => [w.workKey, w.kind, w.targets.join(",")]).sort(),
  details: p.details.map((d) => [d.detailKey, d.workKey, d.planOrActual, d.fiscalYear, d.manDays, d.days]).sort(),
});

/** 機器台帳の上に空の行を 1 つ足し、行の位置をずらす */
async function shifted(bytes: Uint8Array): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  for (const ws of wb.worksheets) ws.spliceRows(1, 0, []);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("次の版に重ねる", () => {
  test("版を組んだ資料と決定だけで組み直すと、前の版と同じ機器・作業・明細になる（縛り 1）", async () => {
    const a = newWs();
    await a.addFiles(files(original()));
    const v1 = await compose(a);
    const rec = await a.sourcesForCommit();
    expect(rec).not.toBeNull();
    expect(rec!.files.map((f) => f.name).sort()).toEqual([...FILES].sort());
    expect(rec!.decisions.length).toBeGreaterThan(0);
    expect(rec!.decisions.every((d) => d.sources.length > 0 && d.sources.every((s) => rec!.files.some((f) => f.sha256 === s)))).toBe(true);
    clearWorkingPlan();
    const b = newWs();
    await b.restoreVersion(1, rec!.files, rec!.decisions);
    expect(b.restoredFrom?.version).toBe(1);
    // 戻した決定で、質問はもう残らない
    expect(ok(runTabTool(b, "intake_survey", { part: "questions" }, CTX)).questions).toEqual([]);
    ok(runTabTool(b, "intake_compose", {}, CTX));
    await b.whenComposed();
    expect(shape(getWorkingPlan()!.plan)).toEqual(shape(v1));
  }, 600_000);

  test("ファイル名と行の位置をずらした同じ資料でも、同じ機器は同じ鍵（台帳の中-8）", async () => {
    const a = newWs();
    await a.addFiles(files(original()));
    const v1 = await compose(a);
    clearWorkingPlan();
    const b = newWs();
    const moved = await Promise.all(original().map(async (f) => ({ name: `R8_${f.name}`, bytes: f.name === "equipment-ledger.xlsx" ? await shifted(f.bytes) : f.bytes })));
    await b.addFiles(files(moved));
    const v2 = await compose(b);
    const keys1 = new Map(v1.assets.map((a) => [a.nodeKey, a.name]));
    const keys2 = new Map(v2.assets.map((a) => [a.nodeKey, a.name]));
    expect(v2.assets.length).toBe(v1.assets.length);
    expect([...keys2.keys()].sort()).toEqual([...keys1.keys()].sort());
    expect([...keys2].every(([k, n]) => keys1.get(k) === n)).toBe(true);
  }, 600_000);

  test("前の版で人が受けた当てはめは「第 n 版と同じ」の案として並び、人が受けるまで決まらない（1C）", async () => {
    const a = newWs();
    await a.addFiles(files(original()));
    await compose(a);
    ok(runTabTool(a, "crosswalk_propose", { rules: [...f1Rules().nodes, ...f1Rules().works], basedOnVersion: getWorkingPlan()!.revision }, CTX));
    for (const p of getWorkingPlan()!.proposals.filter((x) => x.state === "proposed")) expect(acceptByHuman(p.ruleId, "試験の台本が押した").ok).toBe(true);
    // 第 1 版：人が受けた当てはめの入った計画と、受けた規則
    const w1 = getWorkingPlan()!;
    const v1: Plan = { ...w1.plan, version: 1 };
    const accepted = w1.proposals.filter((p) => p.state === "accepted");
    expect(accepted.length).toBeGreaterThan(0);
    const mapped1 = v1.assets.filter((a) => a.commonItemAccepted).length;
    const rec = await a.sourcesForCommit();
    // 第 2 版：開いて、資料と決定を戻し、もとにした版を置いて作り直す
    clearWorkingPlan();
    const b = newWs();
    setWorkingPlan(v1, "intake");
    setCrosswalkBase({ version: 1, plan: v1, crosswalk: accepted.map((p) => ({ rule: p.rule, basis: p.basis })) });
    await b.restoreVersion(1, rec!.files, rec!.decisions);
    ok(runTabTool(b, "intake_compose", {}, CTX));
    await b.whenComposed();
    const w2 = getWorkingPlan()!;
    // 黙って引き継がない：どの規則も案で、どの行も人が受けていない。案はどれも「第 1 版と同じ」
    expect(w2.proposals.length).toBeGreaterThan(0);
    expect(w2.proposals.every((p) => p.state === "proposed" && p.sameAs === 1)).toBe(true);
    expect(w2.plan.assets.some((a) => a.commonItemAccepted)).toBe(false);
    // 前の版で受けた行は、どれも案として同じ値で並ぶ
    const want = new Map(v1.assets.filter((x) => x.commonItemAccepted).map((x) => [x.nodeKey, x.commonItem]));
    expect(w2.plan.assets.filter((x) => want.get(x.nodeKey) === x.commonItem && x.commonItem !== null).length).toBe(mapped1);
    // 人が受けるまで確定できない
    expect(pendingDecisions(w2.plan, []).some((d) => d.kind === "commonItem")).toBe(true);
    // 人が 1 つ受けると、その規則の行だけが決まる
    const first = w2.proposals[0]!;
    expect(acceptByHuman(first.ruleId, "第 1 版で受けた当てはめと同じ").ok).toBe(true);
  }, 600_000);

  test("同じタブで作り直して、受けた規則が新しい行にも当たれば、規則は案に戻る（重-3）", async () => {
    const a = newWs();
    const two = original().filter((f) => f.name !== "daily-report.csv");
    await a.addFiles(files(two.filter((f) => f.name === "equipment-ledger.xlsx")));
    await compose(a);
    ok(runTabTool(a, "crosswalk_propose", { rules: [...f1Rules().nodes, ...f1Rules().works], basedOnVersion: getWorkingPlan()!.revision }, CTX));
    for (const p of getWorkingPlan()!.proposals.filter((x) => x.state === "proposed")) expect(acceptByHuman(p.ruleId, "試験の台本が押した").ok).toBe(true);
    const before = getWorkingPlan()!.proposals.filter((p) => p.state === "accepted").map((p) => p.ruleId);
    // 星取表を足して作り直す：作業の行が増えるので、作業の規則は新しい行に当たる
    await a.addFiles(files(two.filter((f) => f.name === "plan-hoshitori.xlsx")));
    await compose(a);
    const after = getWorkingPlan()!.proposals;
    const back = after.filter((p) => before.includes(p.ruleId) && p.state === "proposed");
    expect(back.length).toBeGreaterThan(0);
    // 戻った規則の行は、どれも人が受けていない
    expect(back.every((p) => p.target !== "work" || getWorkingPlan()!.plan.works.filter((w) => w.attribute === p.value && w.attributeAccepted && w.attributeBasis?.startsWith(p.basis)).length === 0)).toBe(true);
  }, 600_000);
});
