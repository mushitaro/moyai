// 施設の鍵の残り（docs/plan.md §2.19 の 5・6、Architect の台帳の 18）：署名鍵を作り直す・引退の印・連番のぶつかり。
// - 引退の印は、その鍵自身の署名で、中身は鍵 ID・最後に使った連番・月だけ（次の鍵は書かない）。ほかの鍵の署名の印は受けない
// - 引退した鍵は k にも集計にも数えない。印の最後の連番より大きい古い鍵の束は ✗（盗んだ人が引退のあとに古い鍵で出し続ける道）
// - 作り直したあとは新しい鍵で連番 1 から出す（新しい仲間。照合までは k に数えない）
// - 連番のぶつかり：場に同じ連番がもう見えれば送らない。同じ連番の束が 2 つ置かれたら「鎖が分かれています」で送るのを止める
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envelopeText, makeRetiredBody } from "../../../src/share/bundle";
import { createRing, loadRing, previewCheckpoint, ringPlace, rotateRingKey, sealPlace, sendCheckpoint, verifyRing, type Answers, type Sender } from "../../../src/share/checkpoint";
import { facilityKey, retireFacilityKeys, retiredKeys, type Facility } from "../../../src/share/facility";
import type { SharePack } from "../../../src/share/pack";
import { MEMBERS_DIR, RETIRED_SUFFIX, ringDir, writeBundle } from "../../../src/share/ring";
import { knownMaxSeq } from "../../../src/share/ring-seen";
import { generateKeyPair, keyIdOf, signBody, type KeyPair } from "../../../src/share/sign";
import { FACILITY_COMMON, SPEC, detail, plan, smallPlan, table, vocab } from "./fixtures";

const PACK: SharePack = { id: "waste-incineration", name: "架空のパック", spec: SPEC, vocab, table, classNames: { "T.FEED.LIFT": "架空の昇降機" }, axes: [] };
const NOW = new Date(2026, 10, 3, 12, 0, 0);
const MONTH = "2026-11";
const ANSWERS: Answers = { facility: FACILITY_COMMON, inNationalTable: true };

let dir = "";
const pending = new Map<string, KeyPair>();
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  pending.clear();
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), "moyai-rotate-"));
  const stateDir = join(dir, "state");
  const root = join(dir, "輪のフォルダ");
  const c = await createRing({ stateDir, root, pack: PACK, now: NOW });
  if (!c.ok) throw new Error(c.reason);
  const storage = join(dir, "保管先");
  const f: Facility = { root: storage, planId: smallPlan().planId };
  return { stateDir, root, ringId: c.ringId, f };
}
function senderOf(f: Facility, ringId: string): Sender {
  const k = facilityKey(f, ringId, pending);
  if (!k.ok) throw new Error(k.reason);
  return { facility: f, pair: k.pair, stored: k.stored };
}
async function load(stateDir: string, ringId: string, own: string[] = []) {
  const r = await loadRing(stateDir, ringId, PACK, own);
  if (!r.ok) throw new Error(r.reason);
  return r;
}
async function send(stateDir: string, ringId: string, sender: Sender, p = smallPlan(), own: string[] = []) {
  const ring = await load(stateDir, ringId, own);
  const v = previewCheckpoint(ring, sender, PACK, p, ANSWERS, MONTH);
  return sendCheckpoint(ring, sender, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW, pending);
}
/** フォルダを写す（Windows で fs.cpSync が落ちることがあるので自前で） */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const n of readdirSync(from)) {
    const a = join(from, n);
    if (statSync(a).isDirectory()) copyDir(a, join(to, n));
    else copyFileSync(a, join(to, n));
  }
}
const p2 = () => plan({ ...smallPlan(), details: [...smallPlan().details, detail("d9", "w2", 2021, { manDays: 3, days: 1 })] });

describe("署名鍵を作り直す", () => {
  it("引退の印は古い鍵自身の署名で、最後の連番だけを持つ。引退した鍵は集計に数えず、次は新しい鍵で連番 1 から", async () => {
    const { stateDir, root, ringId, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    const s1 = await send(stateDir, ringId, a);
    if (!s1.ok) throw new Error(s1.reason);
    expect((await load(stateDir, ringId, [keyA])).read.latest.map((x) => x.key)).toContain(keyA);
    expect(knownMaxSeq(stateDir, root, ringId).get(keyA)).toBe(1);

    const r = await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);
    expect(r).toEqual({ ok: true, retired: [keyA], unsigned: [] });
    expect(existsSync(join(ringDir(root, ringId), MEMBERS_DIR, `${keyA}${RETIRED_SUFFIX}`))).toBe(true);
    expect([...retiredKeys(f, ringId)]).toEqual([keyA]);
    // 鍵は消さずに keys/retired/ へ移す。その場の鍵は無くなる
    const keysDir = join(f.root, "plans", f.planId, "share", "keys");
    expect(readdirSync(keysDir)).toEqual(["retired"]);

    const after = await load(stateDir, ringId, [keyA]);
    expect(after.read.members.find((m) => m.key === keyA)).toMatchObject({ status: "ok", retiredAt: 1 });
    expect(after.read.latest.map((x) => x.key)).not.toContain(keyA);
    expect(after.read.latestBundles.map((x) => x.key)).not.toContain(keyA);
    const rep = await verifyRing(root, ringId, PACK, after.confirmed, after.known);
    expect(rep.lines.filter((l) => l.status !== "ok")).toEqual([]);
    expect(rep.ok).toBe(true);
    // 作り直したあと、古い鍵は自分の鍵として数えなくなる（keys/retired/ へ移る）。照合していなくても、引退した鍵は ✗ にしない
    const notOwn = new Set([...after.confirmed].filter((k) => k !== keyA));
    expect((await verifyRing(root, ringId, PACK, notOwn, after.known)).ok).toBe(true);
    // 引退した鍵の覚えは消さない（印の連番と比べる相手）
    expect(knownMaxSeq(stateDir, root, ringId).get(keyA)).toBe(1);

    // 次は新しい鍵（持ち出し簿に古い鍵の記録があっても、2 つの鍵とは数えない）
    const b = senderOf(f, ringId);
    expect(keyIdOf(b.pair.pub)).not.toBe(keyA);
    const s2 = await send(stateDir, ringId, b, p2(), [keyA]);
    if (!s2.ok) throw new Error(s2.reason);
    expect(s2.seq).toBe(1);
  });

  it("引退のあとに古い鍵で出した束（印の連番より大きい）は ✗。ほかの鍵が署名した印は受けない", async () => {
    const { stateDir, root, ringId, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    const s1 = await send(stateDir, ringId, a);
    if (!s1.ok) throw new Error(s1.reason);
    const oldPair = a.pair;
    await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);

    // 盗んだ人：古い鍵のまま、別の保管先から連番 2 を出す
    const thief: Sender = { facility: { root: join(dir, "盗んだ人"), planId: f.planId }, pair: oldPair, stored: true };
    const ring = await load(stateDir, ringId, [keyA]);
    const sealed = sealPlace(ringPlace(ring, thief), oldPair, PACK, p2(), ANSWERS, MONTH, previewCheckpoint(ring, thief, PACK, p2(), ANSWERS, MONTH).bodyHash!);
    if (!sealed.ok) throw new Error(sealed.reason);
    expect((await writeBundle(root, sealed.text, ring.ctx)).ok).toBe(true);
    const r = await load(stateDir, ringId, [keyA]);
    expect(r.read.bundles.find((x) => x.folder === keyA && x.seq === 2)).toMatchObject({ status: "ng", reasons: expect.arrayContaining(["chain.afterRetired"]) });
    expect(r.read.members.find((m) => m.key === keyA)).toMatchObject({ status: "ng" });

    // ほかの鍵で署名した、keyA の引退の印は受けない（他人の鍵を k から外せない）
    const { stateDir: sd2, root: root2, ringId: ring2Id, f: f2 } = await setup();
    const c = senderOf(f2, ring2Id);
    const keyC = keyIdOf(c.pair.pub);
    const sc = await send(sd2, ring2Id, c);
    if (!sc.ok) throw new Error(sc.reason);
    const forger = generateKeyPair();
    const body = makeRetiredBody(ring2Id, keyC, c.pair.pub, 1, MONTH);
    writeFileSync(join(ringDir(root2, ring2Id), MEMBERS_DIR, `${keyC}${RETIRED_SUFFIX}`), envelopeText(body, signBody(body, forger.privateKey)));
    const r2 = await load(sd2, ring2Id, [keyC]);
    expect(r2.read.members.find((m) => m.key === keyC)?.retiredAt).toBeUndefined();
    expect(r2.read.latest.map((x) => x.key)).toContain(keyC);
    expect(r2.read.notBundleFiles).toBeGreaterThan(0);
  });
});

describe("連番のぶつかり（2 つの保管先）", () => {
  it("片方が古い見え方のまま同じ連番を出そうとすると、場にもう見えるので送らない。置かれてしまえば「鎖が分かれています」で両方とも止める", async () => {
    const { stateDir, ringId, root, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    // 2 台目：保管先の写し（同期の遅れで、鍵だけが届き、持ち出し簿はまだ届いていない）
    const s0 = await send(stateDir, ringId, a);
    if (!s0.ok) throw new Error(s0.reason);
    const stale = await load(stateDir, ringId, [keyA]);
    const f2: Facility = { root: join(dir, "2 台目の保管先"), planId: f.planId };
    copyDir(join(f.root, "plans", f.planId, "share", "keys"), join(f2.root, "plans", f.planId, "share", "keys"));
    const b: Sender = { facility: f2, pair: a.pair, stored: true };

    // 1 台目が連番 2 を出す
    const s1 = await send(stateDir, ringId, a, p2(), [keyA]);
    if (!s1.ok) throw new Error(s1.reason);
    expect(s1.seq).toBe(2);
    // 2 台目は古い見え方（連番 1 までしか見えない）で連番 2 を出そうとする：場にもう 2 があるので送らない
    const v = previewCheckpoint(stale, b, PACK, smallPlan(), ANSWERS, MONTH);
    expect(v.seq).toBe(2);
    expect(await sendCheckpoint(stale, b, PACK, smallPlan(), ANSWERS, MONTH, v.bodyHash!, NOW, pending)).toEqual({ ok: false, reason: "seqTaken" });

    // それでも置かれてしまったとき（同期の遅れで場の束も見えなかった）：受け手は同じ連番の 2 つを ✗、送る側は鎖が分かれていると止める
    const sealed = sealPlace(ringPlace(stale, b), a.pair, PACK, smallPlan(), ANSWERS, MONTH, v.bodyHash!);
    if (!sealed.ok) throw new Error(sealed.reason);
    expect((await writeBundle(root, sealed.text, stale.ctx)).ok).toBe(true);
    const now = await load(stateDir, ringId, [keyA]);
    expect(now.read.bundles.filter((x) => x.folder === keyA && x.reasons.includes("chain.duplicateSeq"))).toHaveLength(2);
    const v2 = previewCheckpoint(now, a, PACK, p2(), ANSWERS, MONTH);
    expect(v2.blockers).toContain("chainForked");
    expect(await sendCheckpoint(now, a, PACK, p2(), ANSWERS, MONTH, v2.bodyHash ?? "0".repeat(64), NOW, pending)).toMatchObject({ ok: false });
    // 直すのは作り直し：新しい鍵で連番 1 から
    const r = await rotateRingKey(now, f, MONTH);
    expect(r.ok).toBe(true);
    const c = senderOf(f, ringId);
    expect(keyIdOf(c.pair.pub)).not.toBe(keyA);
    const s3 = await send(stateDir, ringId, c, p2(), [keyA]);
    if (!s3.ok) throw new Error(s3.reason);
    expect(s3.seq).toBe(1);
  });
});

describe("作り直しが途中で落ちたとき（Architect の 37・38）", () => {
  it("輪に印を置けなければ、鍵を移さない。押し直すと印が置かれ、受け手は古い鍵を数えない", async () => {
    const { stateDir, root, ringId, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    const s1 = await send(stateDir, ringId, a);
    if (!s1.ok) throw new Error(s1.reason);
    // 輪に書けない（印の名前の所をフォルダにして、置き換えが断られるようにした）
    const blocker = join(ringDir(root, ringId), MEMBERS_DIR, `${keyA}${RETIRED_SUFFIX}`);
    mkdirSync(blocker);
    const r1 = await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);
    expect(r1.ok).toBe(false);
    // 鍵は今の鍵のまま（引退させていない）
    expect(keyIdOf(senderOf(f, ringId).pair.pub)).toBe(keyA);
    expect([...retiredKeys(f, ringId)]).toEqual([]);
    rmSync(blocker, { recursive: true });
    const r2 = await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);
    expect(r2).toEqual({ ok: true, retired: [keyA], unsigned: [] });
    const after = await load(stateDir, ringId, [keyA]);
    expect(after.read.members.find((m) => m.key === keyA)?.retiredAt).toBe(1);
    expect(after.read.latest.map((x) => x.key)).not.toContain(keyA);
  });

  it("前に鍵だけ移して印が無い鍵は、作り直しで印を置き直す", async () => {
    const { stateDir, ringId, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    const s1 = await send(stateDir, ringId, a);
    if (!s1.ok) throw new Error(s1.reason);
    retireFacilityKeys(f, ringId);
    expect((await load(stateDir, ringId, [keyA])).read.members.find((m) => m.key === keyA)?.retiredAt).toBeUndefined();
    const r = await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);
    expect(r).toMatchObject({ ok: true, retired: [keyA] });
    expect((await load(stateDir, ringId, [keyA])).read.members.find((m) => m.key === keyA)?.retiredAt).toBe(1);
  });

  it("印の最後の連番は、持ち出し簿にある束だけで決める（持ち出し簿に無い束は、印のあとの束として ✗）", async () => {
    const { stateDir, root, ringId, f } = await setup();
    const a = senderOf(f, ringId);
    const keyA = keyIdOf(a.pair.pub);
    const s1 = await send(stateDir, ringId, a);
    if (!s1.ok) throw new Error(s1.reason);
    // 盗んだ人が、持ち出し簿に残らない所から連番 2 を先に出した
    const thief: Sender = { facility: { root: join(dir, "盗んだ人"), planId: f.planId }, pair: a.pair, stored: true };
    const ring = await load(stateDir, ringId, [keyA]);
    const sealed = sealPlace(ringPlace(ring, thief), a.pair, PACK, p2(), ANSWERS, MONTH, previewCheckpoint(ring, thief, PACK, p2(), ANSWERS, MONTH).bodyHash!);
    if (!sealed.ok) throw new Error(sealed.reason);
    expect((await writeBundle(root, sealed.text, ring.ctx)).ok).toBe(true);
    const r = await rotateRingKey(await load(stateDir, ringId, [keyA]), f, MONTH);
    expect(r.ok).toBe(true);
    const after = await load(stateDir, ringId, [keyA]);
    expect(after.read.members.find((m) => m.key === keyA)?.retiredAt).toBe(1);
    expect(after.read.bundles.find((x) => x.folder === keyA && x.seq === 2)?.reasons).toContain("chain.afterRetired");
  });
});
