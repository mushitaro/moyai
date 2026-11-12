// 施設の名前を変える（mushitaro/moyai#56）：人は見出しでその場で直し（作業中の計画）、Claude は案を置くだけ（確定のシートで人が受ける）。
// 名前は次に署名した版から効き、前の版は前の名前のまま。架空の施設は【架空】の印を外せない。施設の鍵（planId）は変わらない。
import { SIGNER } from "../helpers/signer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions, pendingDecisions } from "../../src/plan/diff";
import { applyNameAcceptance, proposeName, renameByHuman } from "../../src/plan/facility-name";
import { commitPlan, readHistory, readPlanVersion } from "../../src/plan/store";
import type { Plan } from "../../src/shared/plan";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { asset, detail, plan, work } from "./share/fixtures";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  clearWorkingPlan();
});

const base = (fictional = false): Plan => {
  const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2016)] });
  const name = fictional ? "【架空】第一清掃工場" : "第一清掃工場";
  return { ...p, displayName: name, facility: { ...p.facility, name, fictional } };
};

describe("施設の名前（純な関数）", () => {
  it("人の直し：名前と共有の照らしの名前をそろえる。架空の施設は【架空】を付け直す。形が違えば変えない", () => {
    const p = renameByHuman(base(), "北部清掃工場")!;
    expect([p.displayName, p.facility.name, p.planId]).toEqual(["北部清掃工場", "北部清掃工場", base().planId]);
    expect(renameByHuman(base(true), "北部清掃工場")!.displayName).toBe("【架空】北部清掃工場");
    expect(renameByHuman(base(), "")).toBeNull();
    expect(renameByHuman(base(), "あ".repeat(41))).toBeNull();
  });

  it("Claude の案：案として置くだけで名前は変えない。同じ名前なら案を消す。【架空】を外す案は断る", () => {
    const r = proposeName(base(), "北部清掃工場", "ai_relayed_human", "利用者が会話で頼んだ");
    if (!r.ok) throw new Error(r.code);
    expect(r.state).toBe("proposed");
    expect(r.plan.displayName).toBe("第一清掃工場");
    expect(aiDecisions(r.plan).find((d) => d.kind === "facilityName")).toMatchObject({ id: "name:", value: "第一清掃工場 → 北部清掃工場", author: "ai_relayed_human" });
    const same = proposeName(r.plan, "第一清掃工場", "ai", "戻す");
    expect(same.ok && same.state === "same" && same.plan.nameProposal === undefined).toBe(true);
    expect(proposeName(base(true), "北部清掃工場", "ai", "x")).toEqual({ ok: false, code: "facility_name_fictional" });
    // 受けた案だけが効く
    expect(applyNameAcceptance(r.plan, false).displayName).toBe("第一清掃工場");
    const done = applyNameAcceptance(r.plan, true);
    expect([done.displayName, done.facility.name, done.nameProposal]).toEqual(["北部清掃工場", "北部清掃工場", undefined]);
  });
});

describe("施設の名前（署名した版）", () => {
  it("案は人が受けるまで署名できず、受けて署名した版から新しい名前。前の版は前の名前のまま", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-rename-"));
    const rt = join(dir, "MOYAI");
    const v1 = await commitPlan({ root: rt, plan: base(), reason: "第 1 版", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    const r = proposeName(v1.record.plan, "北部清掃工場", "ai_relayed_human", "利用者が会話で頼んだ");
    if (!r.ok) throw new Error(r.code);
    const blocked = await commitPlan({ root: rt, plan: r.plan, reason: "第 2 版", acceptances: [], basedOn: v1.record.version, signer: SIGNER, client: "t" });
    expect(blocked).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 1 });
    const d = aiDecisions(r.plan).find((x) => x.kind === "facilityName")!;
    const v2 = await commitPlan({ root: rt, plan: r.plan, reason: "第 2 版", acceptances: [{ id: d.id, hash: d.hash, reason: "名前を変える" }], basedOn: v1.record.version, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    expect([v2.record.plan.displayName, v2.record.plan.facility.name, v2.record.plan.nameProposal, v2.record.plan.planId]).toEqual(["北部清掃工場", "北部清掃工場", undefined, v1.record.plan.planId]);
    const old = await readPlanVersion(rt, v1.record.plan.planId, v1.record.version);
    if (!old.ok) throw new Error("前の版が読めない");
    expect(old.record.plan.displayName).toBe("第一清掃工場");
  });
});

describe("施設の名前（同じ案を置き直す。mushitaro/moyai#63）", () => {
  it("A → B を受けて署名し、人が A に戻して署名したあと、同じ根拠で A → B を置き直すと、確定のシートに出て受けるまで署名できない", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-rename-again-"));
    const rt = join(dir, "MOYAI");
    const sign = async (p: Plan, basedOn: number | null, acceptances: { id: string; hash: string; reason: string }[] = []) =>
      commitPlan({ root: rt, plan: p, reason: "版", acceptances, basedOn, signer: SIGNER, client: "t" });
    const v1 = await sign(base(), null);
    if (!v1.ok) throw new Error(v1.reason);
    const basis = "利用者が会話で頼んだ";
    const r1 = proposeName(v1.record.plan, "北部清掃工場", "ai_relayed_human", basis);
    if (!r1.ok) throw new Error(r1.code);
    const d1 = aiDecisions(r1.plan).find((x) => x.kind === "facilityName")!;
    const v2 = await sign(r1.plan, 1, [{ id: d1.id, hash: d1.hash, reason: "名前を変える" }]);
    if (!v2.ok) throw new Error(v2.reason);
    // 人が見出しで A に戻して署名する
    const back = renameByHuman(v2.record.plan, "第一清掃工場")!;
    const v3 = await sign(back, 2);
    if (!v3.ok) throw new Error(v3.reason);
    expect(v3.record.plan.displayName).toBe("第一清掃工場");
    // Claude が同じ根拠で A → B を置き直す：前に受けた決定と同じ指紋でも、受けていない決定に数える
    const r2 = proposeName(v3.record.plan, "北部清掃工場", "ai_relayed_human", basis);
    if (!r2.ok) throw new Error(r2.code);
    const d2 = aiDecisions(r2.plan).find((x) => x.kind === "facilityName")!;
    expect(d2.hash).toBe(d1.hash);
    const hist = await readHistory(rt, v1.record.plan.planId);
    expect(hist.accepted.some((a) => a.id === "name:" && a.hash === d1.hash)).toBe(true);
    expect(pendingDecisions(r2.plan, hist.accepted).map((d) => d.id)).toContain("name:");
    expect(await sign(r2.plan, 3)).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 1 });
    const v4 = await sign(r2.plan, 3, [{ id: d2.id, hash: d2.hash, reason: "もう一度変える" }]);
    if (!v4.ok) throw new Error(v4.reason);
    expect([v4.record.plan.displayName, v4.record.plan.nameProposal]).toEqual(["北部清掃工場", undefined]);
  });
});

describe("施設の名前（chart_propose の facilityName）", () => {
  it("案を置き、確定のシートの決定になる。架空の施設で【架空】を外す案は、どの案も置かずに断る", () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "第一清掃工場", fiscalYearStartMonth: 4, fictional: false });
    setWorkingPlan(base(), { kind: "intake" } as never);
    const v = getWorkingPlan()!.revision;
    const r = runTabTool(ws, "chart_propose", { basedOnVersion: v, basis: "利用者が会話で頼んだ", author: "ai_relayed_human", facilityName: "北部清掃工場" }, { conversation: "c", rowsRemaining: 2000 });
    if (!r.ok) throw new Error(r.code);
    expect(r.data.facilityName).toBe("proposed");
    expect(getWorkingPlan()!.plan.nameProposal).toMatchObject({ name: "北部清掃工場", author: "ai_relayed_human" });
    expect(getWorkingPlan()!.plan.displayName).toBe("第一清掃工場");
    setWorkingPlan(base(true), { kind: "intake" } as never);
    const no = runTabTool(ws, "chart_propose", { basedOnVersion: getWorkingPlan()!.revision, basis: "x", facilityName: "北部清掃工場" }, { conversation: "c", rowsRemaining: 2000 });
    expect(no).toEqual({ ok: false, code: "facility_name_fictional" });
    expect(getWorkingPlan()!.plan.nameProposal).toBeUndefined();
  });
});

describe("施設の名前（取り込みの作り直しをまたぐ。見直しの指摘）", () => {
  it("人が見出しで直した名前と、Claude の名前の案は、取り込みが計画を作り直しても残る（計画の ID が同じときだけ）", async () => {
    const { placeComposedPlan } = await import("../../src/app/state/crosswalk");
    const { rememberHumanName, proposeNameFromAi } = await import("../../src/app/state/facility-name");
    placeComposedPlan(base());
    expect(proposeNameFromAi("北部清掃工場", "ai_relayed_human", "利用者が会話で頼んだ")).toEqual({ ok: true, state: "proposed" });
    placeComposedPlan(base());
    expect(getWorkingPlan()!.plan.nameProposal?.name).toBe("北部清掃工場");
    rememberHumanName(base().planId, "南部清掃工場");
    placeComposedPlan(base());
    expect(getWorkingPlan()!.plan.displayName).toBe("南部清掃工場");
    // ほかの計画には効かない
    placeComposedPlan({ ...base(), planId: "plan-other" });
    expect(getWorkingPlan()!.plan.displayName).toBe("第一清掃工場");
  });
});
