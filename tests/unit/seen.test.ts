// この PC が見た版と署名（監査 A5）：保管先から末尾の版が消された・同じ番号の版が差し替えられた・承認の署名が消されたことに気づく。
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSeen } from "../../src/bridge/seen";
import { commitPlan, planDir, readHistory, signLatest } from "../../src/plan/store";
import { signatureFileName } from "../../src/plan/signature";
import { keyIdOf } from "../../src/share/sign";
import { SIGNER, otherSigner } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), "moyai-seen-"));
  const root = join(dir, "保管先");
  const sd = join(dir, "状態");
  const p = { ...plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2016)] }), planId: "plan-seen" };
  const v1 = await commitPlan({ root, plan: p, reason: "第 1 版", acceptances: [], basedOn: null, signer: SIGNER, role: "edit", client: "t" });
  if (!v1.ok) throw new Error(v1.reason);
  const v2 = await commitPlan({ root, plan: v1.record.plan, reason: "第 2 版", acceptances: [], basedOn: 1, signer: SIGNER, role: "edit", client: "t" });
  if (!v2.ok) throw new Error(v2.reason);
  return { root, sd, d: planDir(root, "plan-seen") };
}

describe("この PC が見た版と署名", () => {
  it("初めて見たときは覚える。同じ履歴なら何も言わない。版が増えれば覚え直す", async () => {
    const { root, sd } = await setup();
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toBeNull();
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toBeNull();
    const seen = JSON.parse(readFileSync(join(sd, "seen.json"), "utf8"));
    expect(Object.values(seen.plans)).toMatchObject([{ version: 2 }]);
  });

  it("末尾の版をまるごと消されたら気づき、覚え直さない。戻れば何も言わない", async () => {
    const { root, sd, d } = await setup();
    checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"));
    const v2 = join(d, "versions", "000002.json");
    renameSync(v2, `${v2}.moved`);
    const sig = join(d, "signatures", signatureFileName(2, "edit", keyIdOf(SIGNER.pair.pub)));
    renameSync(sig, `${sig}.moved`);
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toEqual({ version: 2, signatures: 1 });
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toEqual({ version: 2, signatures: 1 });
    renameSync(`${v2}.moved`, v2);
    renameSync(`${sig}.moved`, sig);
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toBeNull();
  });

  it("同じ番号の版を差し替えられたら気づく", async () => {
    const { root, sd, d } = await setup();
    checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"));
    const v2 = join(d, "versions", "000002.json");
    writeFileSync(v2, readFileSync(v2, "utf8").replace("第 2 版", "差し替えた版"));
    expect(checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"))).toMatchObject({ version: 2 });
  });

  it("承認の署名を後から消されたら気づく（鎖は作った署名しか持たないので、鎖では分からない）", async () => {
    const { root, sd, d } = await setup();
    const boss = otherSigner("【架空】課長");
    const a = await signLatest({ root, planId: "plan-seen", version: 2, role: "approve", reason: "見て承認する", signer: boss });
    expect(a.ok).toBe(true);
    checkSeen(sd, root, "plan-seen", await readHistory(root, "plan-seen"));
    rmSync(join(d, "signatures", signatureFileName(2, "approve", keyIdOf(boss.pair.pub))));
    const h = await readHistory(root, "plan-seen");
    expect(h.versions.every((v) => v.problem === null)).toBe(true);
    expect(checkSeen(sd, root, "plan-seen", h)).toEqual({ version: null, signatures: 1 });
  });
});
