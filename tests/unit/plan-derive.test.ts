// 派生（docs/screens.md 3.1「この版から別の施設をつくる」、P2 の 3）：ほかの施設の確かめで合う版から、新しい施設の第 1 版を作る。
// 版の記録に元の計画・版・中身のハッシュ（derivedFrom）を書き、readHistory が返す。第 1 版だけで、元のハッシュが合うときだけ。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pendingDecisions } from "../../src/plan/diff";
import { commitPlan, readHistory, readPlanVersion } from "../../src/plan/store";
import type { Plan } from "../../src/shared/plan";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
function root(): string {
  dir = mkdtempSync(join(tmpdir(), "moyai-derive-"));
  return join(dir, "MOYAI");
}
function base(planId = "plan-a"): Plan {
  return { ...plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2016)] }), planId };
}
const accept = (p: Plan) => pendingDecisions(p, []).map((d) => ({ id: d.id, hash: d.hash, reason: "試験の台本が受けた" }));

describe("派生", () => {
  it("元の版のハッシュが合えば、新しい施設の第 1 版に derivedFrom を書く", async () => {
    const r = root();
    const a = base("plan-a");
    expect((await commitPlan({ root: r, plan: a, reason: "元の施設", acceptances: accept(a), basedOn: null, signer: SIGNER, client: "t" })).ok).toBe(true);
    const src = await readPlanVersion(r, "plan-a", 1);
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const b: Plan = { ...src.record.plan, planId: "plan-b", displayName: "【架空】派生した施設", version: 0 };
    const from = { planId: "plan-a", version: 1, contentHash: src.contentHash };
    const c = await commitPlan({ root: r, plan: b, reason: "A の第 1 版から作る", acceptances: accept(b), basedOn: null, signer: SIGNER, client: "t", derivedFrom: from });
    expect(c.ok).toBe(true);
    expect((await readHistory(r, "plan-b")).derivedFrom).toEqual(from);
    // 元の施設は派生ではない
    expect((await readHistory(r, "plan-a")).derivedFrom).toBeNull();
  });

  it("元の版のハッシュが違う・同じ計画から・第 2 版では、派生として書かない", async () => {
    const r = root();
    const a = base("plan-a");
    await commitPlan({ root: r, plan: a, reason: "元の施設", acceptances: accept(a), basedOn: null, signer: SIGNER, client: "t" });
    const src = await readPlanVersion(r, "plan-a", 1);
    if (!src.ok) throw new Error("読めない");
    const b: Plan = { ...src.record.plan, planId: "plan-b", version: 0 };
    const bad = await commitPlan({ root: r, plan: b, reason: "違うハッシュ", acceptances: accept(b), basedOn: null, signer: SIGNER, client: "t", derivedFrom: { planId: "plan-a", version: 1, contentHash: "0".repeat(64) } });
    expect(bad).toEqual({ ok: false, reason: "deriveSourceInvalid" });
    const self = await commitPlan({ root: r, plan: b, reason: "同じ計画から", acceptances: accept(b), basedOn: null, signer: SIGNER, client: "t", derivedFrom: { planId: "plan-b", version: 1, contentHash: src.contentHash } });
    expect(self).toEqual({ ok: false, reason: "deriveSourceInvalid" });
    const missing = await commitPlan({ root: r, plan: b, reason: "無い版から", acceptances: accept(b), basedOn: null, signer: SIGNER, client: "t", derivedFrom: { planId: "plan-a", version: 9, contentHash: src.contentHash } });
    expect(missing).toEqual({ ok: false, reason: "deriveSourceInvalid" });
    // 第 2 版を派生にはできない
    const a2: Plan = { ...src.record.plan };
    const second = await commitPlan({ root: r, plan: a2, reason: "第 2 版", acceptances: [], basedOn: 1, signer: SIGNER, client: "t", derivedFrom: { planId: "plan-b", version: 1, contentHash: src.contentHash } });
    expect(second).toEqual({ ok: false, reason: "deriveNotFirst" });
  });

  it("readPlanVersion は確かめで合う版だけを読む。無い版は versionUnknown", async () => {
    const r = root();
    const a = base("plan-a");
    await commitPlan({ root: r, plan: a, reason: "元の施設", acceptances: accept(a), basedOn: null, signer: SIGNER, client: "t" });
    expect(await readPlanVersion(r, "plan-a", 2)).toEqual({ ok: false, reason: "versionUnknown" });
    const v1 = await readPlanVersion(r, "plan-a", 1);
    expect(v1.ok && v1.record.version).toBe(1);
    expect(v1.ok && v1.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
