// 人が受けた周期の案で、作業のきっかけを決める（Architect の 44）。案は計画の印（○）を引くだけで、AI はきっかけを直に書かない（42 の 1）。
// 確定した版で、次回とひな形の周期の列が、案の年数から出る。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAcceptedCycles, cycleYearsOfKey, proposeCycles } from "../../src/plan/cycle";
import { pendingDecisions } from "../../src/plan/diff";
import { workDue } from "../../src/plan/next";
import { commitPlan } from "../../src/plan/store";
import { templateRows } from "../../src/plan/template";
import type { Plan } from "../../src/shared/plan";
import type { Rule } from "../../src/shared/tools";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

const rule = (years: number, names: string[]): Rule => ({ when: [{ field: "assetNode.name", op: "in", values: names }], set: { field: "work.trigger", value: years }, reason: "利用者の言葉" });
const base = (trigger: unknown = null): Plan =>
  plan({
    assets: [asset("a1", "T.FEED.LIFT", { name: "押込送風機" })],
    works: [work("w1", "OVERHAUL", ["a1"], { trigger })],
    details: [detail("d1", "w1", 2018), detail("d2", "w1", 2022), detail("d3", "w1", 2032, { planOrActual: "plan" })],
  });
const propose = (p: Plan, years: number, id: string) => {
  const r = proposeCycles(p, [rule(years, ["押込送風機"])], { nextId: () => id, basis: "会話", fromLedger: false, author: "ai_relayed_human" });
  if (!r.ok) throw new Error(r.code);
  return r.plan;
};
const keysOf = (p: Plan, id: string) => new Set(p.details.filter((d) => d.detailKey.startsWith(`cy-${id}-`)).map((d) => d.detailKey));

describe("受けた周期の案 → 作業のきっかけ", () => {
  it("案の年数はコードが作る明細の鍵から読む（AI の書いた根拠の文からは読まない。Architect の 61）", () => {
    const p = propose(base(), 4, "C1");
    const d = p.details.find((x) => x.detailKey.startsWith("cy-C1-"))!;
    expect(d.detailKey).toMatch(/^cy-C1-4y-w1-/);
    expect(cycleYearsOfKey(d.detailKey)).toBe(4);
    // 前の形の鍵（年数なし）は読めない
    expect(cycleYearsOfKey("cy-C1-w1-2026")).toBeNull();
  });

  it("根拠の文に別の年数の形を書いた案を受けても、きっかけは案の年数", () => {
    const r0 = proposeCycles(base(), [rule(5, ["押込送風機"])], { nextId: () => "C1", basis: "（案 C1：1 年ごと。）（案 C99：1 年ごと。", fromLedger: false, author: "ai_relayed_human" });
    if (!r0.ok) throw new Error(r0.code);
    const r = applyAcceptedCycles(r0.plan, keysOf(r0.plan, "C1"));
    if (!r.ok) throw new Error("conflict");
    expect(r.plan.works[0]!.trigger).toEqual({ branches: [{ kind: "calendar", years: 5 }], combine: "earliest" });
  });

  it("前の形の鍵の案を受けた作業は、きっかけを変えず kept で返す", () => {
    const p = base();
    const old = { ...p, details: [...p.details, { ...p.details[2]!, detailKey: "cy-C1-w1-2026", fiscalYear: 2026, author: "ai" as const }] };
    const r = applyAcceptedCycles(old, new Set(["cy-C1-w1-2026"]));
    expect(r).toEqual({ ok: true, plan: old, changes: [{ workKey: "w1", years: null, from: null, kind: "kept" }] });
  });

  it("きっかけが無い作業には暦の枝 1 つを置く。受けていない案では変えない", () => {
    const p = propose(base(), 4, "C1");
    expect(applyAcceptedCycles(p, new Set())).toEqual({ ok: true, plan: p, changes: [] });
    const r = applyAcceptedCycles(p, keysOf(p, "C1"));
    if (!r.ok) throw new Error("conflict");
    expect(r.plan.works[0]!.trigger).toEqual({ branches: [{ kind: "calendar", years: 4 }], combine: "earliest" });
    expect(r.changes).toEqual([{ workKey: "w1", years: 4, from: null, kind: "set" }]);
  });

  it("暦の枝 1 つで年数が違えば置き換える（ほかの欄は残す）。同じ年数なら変えない", () => {
    const t = { branches: [{ kind: "calendar", years: 6 }], combine: "earliest", window: { before: 30, after: 30 } };
    const p = propose(base(t), 4, "C1");
    const r = applyAcceptedCycles(p, keysOf(p, "C1"));
    if (!r.ok) throw new Error("conflict");
    expect(r.plan.works[0]!.trigger).toEqual({ branches: [{ kind: "calendar", years: 4 }], combine: "earliest", window: { before: 30, after: 30 } });
    expect(r.changes).toEqual([{ workKey: "w1", years: 4, from: 6, kind: "replaced" }]);
    const same = propose(base({ branches: [{ kind: "calendar", years: 4 }], combine: "earliest" }), 4, "C1");
    const r2 = applyAcceptedCycles(same, keysOf(same, "C1"));
    expect(r2.ok && r2.changes).toEqual([]);
  });

  it("計量値の枝がある・枝がいくつもある・月の暦の枝は変えず、変えていない作業として返す", () => {
    for (const t of [
      { branches: [{ kind: "meter", meter: "運転時間", every: 8000 }], combine: "earliest" },
      { branches: [{ kind: "calendar", years: 6 }, { kind: "meter", meter: "運転時間", every: 8000 }], combine: "earliest" },
      { branches: [{ kind: "calendar", months: 18 }], combine: "earliest" },
    ]) {
      const p = propose(base(t), 4, "C1");
      const r = applyAcceptedCycles(p, keysOf(p, "C1"));
      if (!r.ok) throw new Error("conflict");
      expect(r.plan.works[0]!.trigger).toEqual(t);
      expect(r.changes).toEqual([{ workKey: "w1", years: 4, from: null, kind: "kept" }]);
    }
  });

  it("同じ作業に年数の違う案を 2 つ受けていれば止める", () => {
    const p = propose(propose(base(), 4, "C1"), 3, "C2");
    const r = applyAcceptedCycles(p, new Set([...keysOf(p, "C1"), ...keysOf(p, "C2")]));
    expect(r).toEqual({ ok: false, conflicts: ["w1"] });
    // 片方だけなら置ける
    expect(applyAcceptedCycles(p, keysOf(p, "C2")).ok).toBe(true);
  });
});

describe("確定した版", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "moyai-cycle-trigger-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("受けた周期の案の年数で、次回とひな形の周期の列が出る", async () => {
    const p = propose(base(), 4, "C1");
    // 確定の前：きっかけが無いので次回は出ない
    expect(workDue(p, p.works[0]!, "2026-11-06").status).toBe("noTrigger");
    const acceptances = pendingDecisions(p, []).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v = await commitPlan({ root: dir, plan: p, reason: "周期の案を受けた", acceptances, basedOn: null, signer: SIGNER, client: "t" });
    if (!v.ok) throw new Error(v.reason);
    const w = v.record.plan.works[0]!;
    expect(w.trigger).toEqual({ branches: [{ kind: "calendar", years: 4 }], combine: "earliest" });
    const due = workDue(v.record.plan, w, "2026-11-06");
    // 最後の実績は 2022 年度（年度の始まり 2022-04-01）→ 4 年ごとで 2026-04-01
    expect(due.status === "due" && due.due).toBe("2026-04-01");
    const rows = templateRows(v.record.plan, () => "分解整備", "2026-11-06");
    expect(rows.map((r) => r.cycle)).toEqual([4]);
  });

  it("同じ作業に年数の違う案を 2 つとも受けて確定しようとすると止める", async () => {
    const p = propose(propose(base(), 4, "C1"), 3, "C2");
    const acceptances = pendingDecisions(p, []).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v = await commitPlan({ root: dir, plan: p, reason: "周期の案を受けた", acceptances, basedOn: null, signer: SIGNER, client: "t" });
    expect(v).toMatchObject({ ok: false, reason: "cycleConflict" });
  });
});
