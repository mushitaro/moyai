// 頼みと受け取り（運営者の決定「マジックリンクで鎖をつなぐ」、監査 B1）：最初に開いた鍵だけが受け取る。頼み直すと前のリンクは効かない。
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeRequest, createRequest, readRequests, receiveRequest, type RequestVersion } from "../../src/plan/request";
import { planDir, type SignatureInfo } from "../../src/plan/store";
import { SIGNER, otherSigner } from "../helpers/signer";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const now = new Date("2026-11-05T01:00:00.000Z");
const later = new Date("2026-11-05T02:00:00.000Z");
const HASH = "ab".repeat(32);

/** その版を作った署名（山田の鍵の edit）だけを持つ版 */
function made(version: number, pub = SIGNER.pair.pub, contentHash = HASH): RequestVersion {
  const sig: SignatureInfo = { role: "edit", by: SIGNER.by, key: "k", pub, at: now.toISOString(), reason: "e2e", fileHash: "cd".repeat(32) };
  return { version, contentHash, signatures: [sig] };
}
const V1 = made(1);

function root(): string {
  dir = mkdtempSync(join(tmpdir(), "moyai-request-"));
  return join(dir, "保管先");
}

describe("頼みと受け取り", () => {
  it("リンクを最初に開いた鍵が受け取る。同じ鍵はもう一度開いても自分のもの。ほかの鍵は「ほかの鍵が受け取っています」", async () => {
    const rt = root();
    const boss = otherSigner("【架空】課長");
    const other = otherSigner("【架空】佐藤");
    const q = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "kacho@example.jp", by: SIGNER.by, pair: SIGNER.pair, now });
    expect(q.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 頼みのファイルに合言葉そのものは入らない（SHA-256 だけ）
    const files = readdirSync(join(planDir(rt, "plan-test"), "requests"));
    expect(readFileSync(join(planDir(rt, "plan-test"), "requests", files[0]!), "utf8")).not.toContain(q.token);
    expect((await activeRequest(rt, "plan-test", V1))?.receipt).toBeNull();
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: boss.by, pair: boss.pair, now })).toMatchObject({ state: "received" });
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: boss.by, pair: boss.pair, now })).toMatchObject({ state: "mine" });
    const taken = await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: other.by, pair: other.pair, now });
    expect(taken).toMatchObject({ state: "takenByOther", receipt: { by: boss.by, pub: boss.pair.pub } });
    expect((await activeRequest(rt, "plan-test", V1))?.receipt).toMatchObject({ by: boss.by, pub: boss.pair.pub });
    // 違う合言葉・違う版は受け取れない
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: "x".repeat(43), by: other.by, pair: other.pair, now })).toEqual({ state: "unknown" });
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: made(2), token: q.token, by: other.by, pair: other.pair, now })).toEqual({ state: "unknown" });
  });

  it("頼み直すと、前のリンクは「取り下げられました」になり、前の受け取りも効かない。新しいリンクで受け取れる", async () => {
    const rt = root();
    const boss = otherSigner("【架空】課長");
    const fwd = otherSigner("【架空】転送先");
    const q1 = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "kacho@example.jp", by: SIGNER.by, pair: SIGNER.pair, now });
    expect((await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q1.token, by: fwd.by, pair: fwd.pair, now })).state).toBe("received");
    const q2 = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "kacho@example.jp", by: SIGNER.by, pair: SIGNER.pair, now: later });
    expect((await activeRequest(rt, "plan-test", V1))?.receipt).toBeNull();
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q1.token, by: boss.by, pair: boss.pair, now: later })).toEqual({ state: "withdrawn" });
    expect((await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q2.token, by: boss.by, pair: boss.pair, now: later })).state).toBe("received");
    expect((await activeRequest(rt, "plan-test", V1))?.receipt?.pub).toBe(boss.pair.pub);
  });

  it("書き換えた頼みと受け取りは数えない（署名が合わない）", async () => {
    const rt = root();
    const boss = otherSigner("【架空】課長");
    const q = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "kacho@example.jp", by: SIGNER.by, pair: SIGNER.pair, now });
    await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: boss.by, pair: boss.pair, now });
    const rd = join(planDir(rt, "plan-test"), "receipts");
    const f = join(rd, readdirSync(rd)[0]!);
    writeFileSync(f, readFileSync(f, "utf8").replace("【架空】課長", "【架空】なりすまし"));
    expect((await activeRequest(rt, "plan-test", V1))?.receipt).toBeNull();
    const qd = join(planDir(rt, "plan-test"), "requests");
    const g = join(qd, readdirSync(qd)[0]!);
    writeFileSync(g, readFileSync(g, "utf8").replace("kacho@example.jp", "other@example.jp"));
    expect(await activeRequest(rt, "plan-test", V1)).toBeNull();
  });

  it("その版を作った鍵でない頼みは、時刻が未来でも数えない（効いている頼みも承認の道も変わらない。置かれていることは出す）", async () => {
    const rt = root();
    const boss = otherSigner("【架空】課長");
    const mallory = otherSigner("【架空】同僚");
    const q = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "kacho@example.jp", by: SIGNER.by, pair: SIGNER.pair, now });
    await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: boss.by, pair: boss.pair, now });
    // 保管先に書ける同僚が、自分の鍵で、時刻を未来にした頼みを置く
    const fake = await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: HASH, kind: "approve", to: "me@example.jp", by: mallory.by, pair: mallory.pair, now: new Date("2099-01-01T00:00:00.000Z") });
    // 山田の鍵でも、ほかの中身に宛てた頼みは数えない
    await createRequest({ root: rt, planId: "plan-test", version: 1, contentHash: "ef".repeat(32), kind: "approve", to: "x@example.jp", by: SIGNER.by, pair: SIGNER.pair, now: later });
    const act = await activeRequest(rt, "plan-test", V1);
    expect(act?.request.hash).toBe(q.request.hash);
    expect(act?.receipt?.pub).toBe(boss.pair.pub);
    // 同僚の合言葉では受け取れない。本物の頼みは取り下げにならない
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: fake.token, by: mallory.by, pair: mallory.pair, now })).toEqual({ state: "unknown" });
    expect(await receiveRequest({ root: rt, planId: "plan-test", version: V1, token: q.token, by: boss.by, pair: boss.pair, now })).toMatchObject({ state: "mine" });
    const { requests, foreign } = await readRequests(rt, "plan-test", V1);
    expect(requests).toHaveLength(1);
    expect(foreign.map((x) => x.body.by).sort()).toEqual([SIGNER.by, mallory.by].sort());
  });
});
