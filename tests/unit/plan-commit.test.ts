// 確定（docs/plan.md §2.9）：版は足すだけ、戻すのは前の版を指す記録を足すこと、差分レポート（Excel）、
// 人が受けていない決定が残れば確定しない、理由が空なら確定しない。試験は一時のフォルダ（日本語の OneDrive の道の形）で行う。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions, diffPlans, pendingDecisions } from "../../src/plan/diff";
import { commitPlan, planDir, readHistory, revertPlan } from "../../src/plan/store";
import type { Plan } from "../../src/shared/plan";
import { asset, detail, plan, work } from "./share/fixtures";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** 一時のフォルダの下に、この PC と同じ形の道（利用者\OneDrive\ドキュメント\MOYAI）を作る */
function root(): string {
  dir = mkdtempSync(join(tmpdir(), "moyai-commit-"));
  return join(dir, "利用者", "OneDrive", "ドキュメント", "MOYAI");
}

function aiPlan(): Plan {
  return plan({
    assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.POWER.GEN", { commonItemAuthor: "ai", commonItemAccepted: false, commonItemBasis: "名前が似ている" })],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "INSPECT", ["a2"])],
    details: [
      detail("d1", "w1", 2016),
      detail("d2", "w1", 2019, { author: "ai_relayed_human", basis: "チャットで人が答えた" }),
      detail("d3", "w2", 2018, { planOrActual: "plan" }),
    ],
  });
}

async function readSheet(path: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0]!;
  const out: string[][] = [];
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
  return out;
}

describe("確定：版と差分レポート", () => {
  it("理由が空なら確定しない", async () => {
    const r = await commitPlan({ root: root(), plan: aiPlan(), reason: "  ", acceptances: [], basedOn: null, client: "t" });
    expect(r).toEqual({ ok: false, reason: "reasonEmpty" });
  });

  it("AI と AI（チャットでの人の答え）の決定が人に受けられるまで確定しない。受ける理由も空は通さない", async () => {
    const p = aiPlan();
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id).sort()).toEqual(["detail:d2", "item:a2"]);
    const r1 = await commitPlan({ root: root(), plan: p, reason: "確定の試験", acceptances: [], basedOn: null, client: "t" });
    expect(r1).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 2 });
    const r2 = await commitPlan({ root: join(dir, "x"), plan: p, reason: "確定の試験", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "" })), basedOn: null, client: "t" });
    expect(r2).toEqual({ ok: false, reason: "acceptanceReasonEmpty" });
    const r3 = await commitPlan({ root: join(dir, "x"), plan: p, reason: "確定の試験", acceptances: [{ id: "item:a2", hash: "0".repeat(16), reason: "見た" }], basedOn: null, client: "t" });
    expect(r3).toEqual({ ok: false, reason: "acceptanceUnknown" });
  });

  it("版は足すだけ：版のファイルを足し、差分レポートを書き、戻すのは前の版を指す新しい記録", async () => {
    const rt = root();
    const p = aiPlan();
    const acc = aiDecisions(p).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v1 = await commitPlan({ root: rt, plan: p, reason: "初めの確定", acceptances: acc, basedOn: null, client: "tab-1" });
    if (!v1.ok) throw new Error(v1.reason);
    expect(v1.version).toBe(1);
    expect(v1.record.plan.version).toBe(1);
    // 受けた当てはめは「人が受けた」になり、作者は AI のまま
    const a2 = v1.record.plan.assets.find((a) => a.nodeKey === "a2")!;
    expect(a2.commonItemAccepted).toBe(true);
    expect(a2.commonItemAuthor).toBe("ai");
    // 日本語の OneDrive の道の下に書けている
    expect(v1.files.version).toContain(join("利用者", "OneDrive", "ドキュメント", "MOYAI", "plans", "plan-test", "versions", "000001.json"));
    const first = readFileSync(v1.files.version, "utf8");

    // 同じ版を元にした 2 回目は、ほかの確定が先に入っていれば断る
    expect(await commitPlan({ root: rt, plan: p, reason: "古い画面から", acceptances: [], basedOn: null, client: "tab-2" })).toEqual({ ok: false, reason: "stale" });

    // 2 版目：印を 1 つ足し、1 つ消す。受けた決定は、同じ中身なら聞き直さない
    const p2: Plan = { ...v1.record.plan, details: [...v1.record.plan.details.filter((d) => d.detailKey !== "d1"), detail("d4", "w1", 2022, { manDays: 3 })] };
    expect(pendingDecisions(p2, (await readHistory(rt, "plan-test")).accepted)).toHaveLength(0);
    const v2 = await commitPlan({ root: rt, plan: p2, reason: "2022 の分解整備を足した", acceptances: [], basedOn: 1, client: "tab-1" });
    if (!v2.ok) throw new Error(v2.reason);
    expect(v2.version).toBe(2);
    expect(v2.record.summary).toMatchObject({ added: 1, removed: 1, changed: 0 });
    expect(v2.record.prev).toMatch(/^[0-9a-f]{64}$/);

    // 1 版目に戻す：3 版目の記録が 1 版目を指す。前の版のファイルは変わらない
    const v3 = await revertPlan({ root: rt, planId: "plan-test", to: 1, reason: "2022 の分は誤りだった", basedOn: 2, client: "tab-1" });
    if (!v3.ok) throw new Error(v3.reason);
    expect(v3.record.kind).toBe("revert");
    expect(v3.record.revertOf).toBe(1);
    expect(v3.record.summary).toMatchObject({ added: 1, removed: 1 });
    expect(readFileSync(v1.files.version, "utf8")).toBe(first);
    const d = planDir(rt, "plan-test");
    expect(readdirSync(join(d, "versions")).sort()).toEqual(["000001.json", "000002.json", "000003.json"]);
    expect(readdirSync(join(d, "reports")).sort()).toEqual(["000001-diff.xlsx", "000002-diff.xlsx", "000003-diff.xlsx"]);
    const h = await readHistory(rt, "plan-test");
    expect(h.versions.map((v) => v.kind)).toEqual(["confirm", "confirm", "revert"]);

    // 差分レポート：機器・作業・年度・前の印・後の印・誰が・なぜ
    const rows = await readSheet(v2.files.report);
    const head = rows.findIndex((r) => r[0] === "機器");
    expect(rows[head]).toEqual(["機器", "作業", "年度", "前の印", "後の印", "誰が", "なぜ"]);
    const body = rows.slice(head + 1);
    expect(body).toContainEqual(["架空の機器 a1", "架空の作業", "2022", "（印なし）", "● 実施", "人", "架空の記録"]);
    expect(body).toContainEqual(["架空の機器 a1", "架空の作業", "2016", "● 実施", "（印なし）", "人", "架空の記録"]);
    expect(rows.some((r) => r.includes("2022 の分解整備を足した"))).toBe(true);
  });

  it("AI が置いた作業の属性（人が受けていない案）も、受けるまで確定しない。受けると「人が受けた」になり、作者は AI のまま", async () => {
    const base = aiPlan();
    const p: Plan = {
      ...base,
      works: base.works.map((w) => (w.workKey === "w1" ? { ...w, attribute: "OVERHAUL", attributeAuthor: "ai", attributeBasis: "案 1：作業の名前が分解整備", attributeAccepted: false } : w)),
    };
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id).sort()).toEqual(["attr:w1", "detail:d2", "item:a2"]);
    expect(ds.find((d) => d.id === "attr:w1")).toMatchObject({ kind: "attribute", value: "OVERHAUL", author: "ai" });
    const rt = root();
    expect(await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: [], basedOn: null, client: "t" })).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 3 });
    const v1 = await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    expect(v1.record.plan.works.find((w) => w.workKey === "w1")).toMatchObject({ attributeAccepted: true, attributeAuthor: "ai" });
    // 当てはめの欄で人が受けたもの（attributeAccepted が true）は、もう受けていない決定に並ばない
    expect(aiDecisions(v1.record.plan).filter((d) => d.kind === "attribute")).toEqual([]);
  });

  it("差は機器・作業・年度ごとの印（計画と実施が重なれば ◎）", () => {
    const before = aiPlan();
    const after: Plan = { ...before, details: [...before.details, detail("d5", "w2", 2018)] };
    const d = diffPlans(before, after);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ nodeKey: "a2", fiscalYear: 2018, before: "plan", after: "both" });
    expect(diffPlans(null, before).added).toBe(3);
  });
});
