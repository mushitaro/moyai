// share.tamper：body の外のキー、重複キー、members や circle に施設名、1 バイトの書き換え、抜き・入れ替え、他人のフォルダ、
// 改行の変換、書きかけ、ほかの行き先の束。すべて理由つきの ✗。書きかけは「届きかけ」。輪のフォルダは一時のフォルダに作る。
import { cp, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CIRCLE_V, bundleFileName, envelopeText, fileHash, makeMemberBody, makeRulesDocBody, type ShareContext } from "../../../src/share/bundle";
import { canonicalize } from "../../../src/share/jcs";
import { isClean, recount } from "../../../src/share/recount";
import { BUNDLES_DIR, MEMBERS_DIR, TEMP_PREFIX, TEMP_SUFFIX, monthStart, readRing, writeBundle, writeCircle, writeMember } from "../../../src/share/ring";
import { previewBundle, sealBundle, type SendInput } from "../../../src/share/seal";
import { signBody } from "../../../src/share/sign";
import { makeMember, makeRing, makeRingWith, sendInput, smallPlan, table, vocab, type Member, type Ring } from "./fixtures";

function seal(input: SendInput, m: Member, ring: Ring): { text: string; hash: string; fileName: string } {
  const pv = previewBundle(input);
  if (!pv.ok) throw new Error(`プレビューができない: ${pv.reason}`);
  const s = sealBundle(input, {
    previewHash: pv.bodyHash,
    wrapped: m.wrapped,
    passphrase: m.passphrase,
    acceptedRulesHash: ring.ctx.rulesHash,
    acceptedRules: ring.rules,
    localWords: [],
    cells: [],
    folderPath: "/tmp/ring",
  });
  if (!s.ok) throw new Error(`封ができない: ${s.reason}`);
  return s;
}

let base: string;
const ring = makeRing();
const A = makeMember(ring);
const B = makeMember(ring);
const a: { text: string; hash: string; fileName: string }[] = [];
let b1: { text: string; hash: string; fileName: string };
const confirmed = new Set([A.key, B.key]);
const opts = () => ({ table, vocab, confirmed });

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "moyai-ring-"));
  const p = smallPlan();
  let prev: string | null = null;
  for (let seq = 1; seq <= 3; seq++) {
    const s = seal(sendInput(ring, A, p, { seq, prev }), A, ring);
    a.push(s);
    prev = s.hash;
  }
  b1 = seal(sendInput(ring, B, p), B, ring);
  expect((await writeCircle(base, ring.circleText, ring.ctx)).ok).toBe(true);
  expect((await writeMember(base, A.memberText, ring.ctx)).ok).toBe(true);
  expect((await writeMember(base, B.memberText, ring.ctx)).ok).toBe(true);
  for (const s of [...a, b1]) expect((await writeBundle(base, s.text, ring.ctx)).ok).toBe(true);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/** 正しい輪の写しを一時のフォルダに作る */
async function copyRing(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "moyai-ring-case-"));
  await cp(base, d, { recursive: true });
  return d;
}
const bundlePath = (root: string, key: string, name: string) => join(root, ring.ringId, BUNDLES_DIR, key, name);
const memberOf = (r: Awaited<ReturnType<typeof readRing>>, key: string) => r.members.find((x) => x.key === key)!;
const entryOf = (r: Awaited<ReturnType<typeof readRing>>, key: string, name: string) => r.bundles.find((x) => x.folder === key && x.name === name)!;

describe("ring：書く", () => {
  it("一時の名前 → 更新時刻を月の 1 日 0 時に → rename。一時のファイルは残らない", async () => {
    const files = await readdir(join(base, ring.ringId, BUNDLES_DIR, A.key));
    expect(files.sort()).toEqual(a.map((x) => x.fileName).sort());
    expect(files.some((f) => f.startsWith(TEMP_PREFIX))).toBe(false);
    const st = await stat(bundlePath(base, A.key, a[0]!.fileName));
    expect(st.mtime.getTime()).toBe(monthStart("2026-11").getTime());
    expect(await readFile(bundlePath(base, A.key, a[0]!.fileName), "utf8")).toBe(a[0]!.text);
    expect(a[0]!.fileName).toBe(bundleFileName(1, fileHash(a[0]!.text)));
  });

  it("足すだけ：同じ名前は置かない。正しい形でない束は置かない", async () => {
    const d = await copyRing();
    expect(await writeBundle(d, a[0]!.text, ring.ctx)).toEqual({ ok: false, reason: "exists" });
    const bad = await writeBundle(d, a[0]!.text + "\n", ring.ctx);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toBe("notClean");
    await rm(d, { recursive: true, force: true });
  });

  it("rename が断られ続けたら、数回だけ置き直して「結果不明」。一時のファイルは消す", async () => {
    const d = await copyRing();
    let calls = 0;
    const s = seal(sendInput(ring, A, smallPlan(), { seq: 4, prev: a[2]!.hash }), A, ring);
    const r = await writeBundle(d, s.text, ring.ctx, {
      retryDelayMs: 1,
      rename: async () => {
        calls++;
        throw Object.assign(new Error("断られた"), { code: "EPERM" });
      },
    });
    expect(r).toEqual({ ok: false, reason: "unknown" });
    expect(calls).toBe(4);
    const files = await readdir(join(d, ring.ringId, BUNDLES_DIR, A.key));
    expect(files.some((f) => f.startsWith(TEMP_PREFIX))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });
});

describe("share.tamper", () => {
  it("正しい輪は全員 ✓", async () => {
    const r = await readRing(base, ring.ringId, opts());
    expect(r.circle.status).toBe("ok");
    expect(r.members.map((m) => [m.key, m.status, m.reasons])).toEqual(
      [
        [A.key, "ok", []],
        [B.key, "ok", []],
      ].sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
    );
    expect(r.bundles.every((x) => x.status === "ok")).toBe(true);
    expect(r.latest.map((x) => x.key).sort()).toEqual([A.key, B.key].sort());
  });

  it("body の外のキー", async () => {
    const env = JSON.parse(a[0]!.text);
    const text = canonicalize({ ...env, note: "x" });
    const r = recount(text, ring.ctx);
    expect(r.reasons).toContain("shape.type");
    expect(isClean(r)).toBe(false);
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, a[0]!.fileName), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, a[0]!.fileName).status).toBe("ng");
    expect(memberOf(rr, A.key).status).toBe("ng");
    expect(memberOf(rr, A.key).reasons).toContain("shape.type");
    await rm(d, { recursive: true, force: true });
  });

  it("重複キー", () => {
    const sig = JSON.parse(a[0]!.text).sig as string;
    const text = a[0]!.text.slice(0, -1) + `,"sig":"${sig}"}`;
    const r = recount(text, ring.ctx);
    expect(r.reasons).toContain("shape.duplicateKey");
    expect(isClean(r)).toBe(false);
  });

  it("members に施設名（本人が署名していても）", async () => {
    const body = { ...makeMemberBody(ring.ringId, A.key, A.pair.pub, "2026-11"), name: "架空市みどり清掃センター" };
    const text = envelopeText(body, signBody(body, A.pair.privateKey));
    const r = recount(text, ring.ctx);
    expect(r.reasons).toContain("shape.type");
    expect(r.freeText).toBeGreaterThan(0);
    const d = await copyRing();
    await writeFile(join(d, ring.ringId, MEMBERS_DIR, `${A.key}.json`), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(memberOf(rr, A.key).status).toBe("ng");
    expect(memberOf(rr, A.key).reasons).toContain("freeText");
    expect(memberOf(rr, B.key).status).toBe("ok");
    await rm(d, { recursive: true, force: true });
  });

  it("circle に施設名（作った人が署名していても）→ 輪の全員が ✗", async () => {
    const body = { ...makeRulesDocBody(CIRCLE_V, ring.founder.pub, ring.nonce, 1, "2026-11", ring.rules), title: "架空市の勉強会" };
    const text = envelopeText(body, signBody(body, ring.founder.privateKey));
    const d = await copyRing();
    await writeFile(join(d, ring.ringId, "circle.json"), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(rr.circle.status).toBe("ng");
    expect(rr.circle.reasons).toContain("freeText");
    expect(rr.members.every((m) => m.status === "ng")).toBe(true);
    await rm(d, { recursive: true, force: true });
  });

  it("circle の決まりが決まりの形でない（署名していても）→ 落ちずに輪の全員が ✗", async () => {
    const body = { ...makeRulesDocBody(CIRCLE_V, ring.founder.pub, ring.nonce, 1, "2026-11", ring.rules), rules: { ...ring.rules, fields: "all" } };
    const text = envelopeText(body, signBody(body, ring.founder.privateKey));
    const d = await copyRing();
    await writeFile(join(d, ring.ringId, "circle.json"), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(rr.circle.status).toBe("ng");
    expect(rr.circle.reasons).toEqual(expect.arrayContaining(["shape.rules", "shape.type"]));
    expect(rr.bundles.every((x) => x.status === "ng" && x.reasons.includes("circle"))).toBe(true);
    // 数え直しに渡す決まりが壊れていても、落ちずに ✗
    const r = recount(a[0]!.text, { ...ring.ctx, rules: { ...ring.rules, fields: "all" } as never });
    expect(r.reasons).toEqual(["shape.contextRules.malformed"]);
    expect(isClean(r)).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it("1 バイトの書き換え", async () => {
    const t = a[1]!.text;
    const i = t.indexOf("FY2019");
    expect(i).toBeGreaterThan(0);
    const text = t.slice(0, i + 5) + "8" + t.slice(i + 6); // FY2019 → FY2018
    const r = recount(text, ring.ctx);
    expect(r.reasons).toContain("chain.badSignature");
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, a[1]!.fileName), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, a[1]!.fileName).reasons).toEqual(expect.arrayContaining(["chain.badSignature", "file.nameMismatch"]));
    // 後ろの束は鎖が切れる
    expect(entryOf(rr, A.key, a[2]!.fileName).reasons).toContain("chain.gap");
    await rm(d, { recursive: true, force: true });
  });

  it("抜き：途中の束を消すと、後ろの束が「抜けあり」。最後を消すと「前に見た束が消えています」", async () => {
    const d = await copyRing();
    await unlink(bundlePath(d, A.key, a[1]!.fileName));
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, a[2]!.fileName).reasons).toContain("chain.gap");
    expect(memberOf(rr, A.key).status).toBe("ng");
    await unlink(bundlePath(d, A.key, a[2]!.fileName));
    await cp(join(base, ring.ringId, BUNDLES_DIR, A.key, a[1]!.fileName), bundlePath(d, A.key, a[1]!.fileName));
    const r2 = await readRing(d, ring.ringId, { ...opts(), knownMaxSeq: new Map([[A.key, 3]]) });
    expect(memberOf(r2, A.key).reasons).toEqual(["chain.vanished"]);
    await rm(d, { recursive: true, force: true });
  });

  it("入れ替え：中身を入れ替える・同じ seq の別の束に差し替える", async () => {
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, a[0]!.fileName), a[1]!.text);
    await writeFile(bundlePath(d, A.key, a[1]!.fileName), a[0]!.text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, a[0]!.fileName).reasons).toContain("file.nameMismatch");
    expect(entryOf(rr, A.key, a[1]!.fileName).reasons).toContain("file.nameMismatch");
    await rm(d, { recursive: true, force: true });

    // 同じ鍵で seq 2 を作り直して差し替える → seq 3 の prev が合わない
    const d2 = await copyRing();
    const p = smallPlan();
    p.details.push({ ...p.details[0]!, detailKey: "d9", fiscalYear: 2021 });
    const fork = seal(sendInput(ring, A, p, { seq: 2, prev: a[0]!.hash }), A, ring);
    await unlink(bundlePath(d2, A.key, a[1]!.fileName));
    await writeFile(bundlePath(d2, A.key, fork.fileName), fork.text);
    const r2 = await readRing(d2, ring.ringId, opts());
    expect(entryOf(r2, A.key, fork.fileName).status).toBe("ok");
    expect(entryOf(r2, A.key, a[2]!.fileName).reasons).toContain("chain.broken");
    await rm(d2, { recursive: true, force: true });
  });

  it("他人のフォルダ", async () => {
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, b1.fileName), b1.text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, b1.fileName).reasons).toContain("file.otherFolder");
    expect(memberOf(rr, A.key).status).toBe("ng");
    expect(memberOf(rr, B.key).status).toBe("ok");
    await rm(d, { recursive: true, force: true });
  });

  it("改行の変換・余分な空白・BOM", async () => {
    const t = a[0]!.text;
    const pretty = JSON.stringify(JSON.parse(t), null, 2).replace(/\n/g, "\r\n");
    for (const text of [t + "\n", t + "\r\n", pretty, "\ufeff" + t]) {
      const r = recount(text, ring.ctx);
      expect(r.reasons).toContain("shape.notCanonical");
      expect(isClean(r)).toBe(false);
    }
    expect(recount("\ufeff" + t, ring.ctx).reasons).toContain("shape.bom");
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, a[0]!.fileName), t.replace(/,/g, ",\r\n"));
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, a[0]!.fileName).status).toBe("ng");
    await rm(d, { recursive: true, force: true });
  });

  it("書きかけは「届きかけ」（✗ と分ける）", async () => {
    const d = await copyRing();
    const s4 = seal(sendInput(ring, A, smallPlan(), { seq: 4, prev: a[2]!.hash }), A, ring);
    await writeFile(bundlePath(d, A.key, s4.fileName), s4.text.slice(0, Math.floor(s4.text.length / 2)));
    await writeFile(bundlePath(d, A.key, `${TEMP_PREFIX}abc${TEMP_SUFFIX}`), s4.text.slice(0, 10));
    await writeFile(bundlePath(d, B.key, "000002-0000000000000000.json"), "");
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, s4.fileName).status).toBe("arriving");
    expect(memberOf(rr, A.key)).toMatchObject({ status: "ok", arriving: 2 });
    expect(memberOf(rr, B.key)).toMatchObject({ status: "ok", arriving: 1 });
    await rm(d, { recursive: true, force: true });
  });

  it("ほかの行き先の束（ほかの輪・台帳）", async () => {
    const other = makeRing();
    const otherCtx: ShareContext = { ...ring.ctx, to: { kind: "ring", id: other.ringId } };
    const s = seal(sendInput(ring, A, smallPlan(), { ctx: otherCtx, seq: 4, prev: a[2]!.hash }), A, ring);
    const ledgerCtx: ShareContext = { ...ring.ctx, to: { kind: "ledger", id: "00000000000000aa" } };
    const l = seal(sendInput(ring, B, smallPlan(), { ctx: ledgerCtx, seq: 2, prev: b1.hash }), B, ring);
    const d = await copyRing();
    await writeFile(bundlePath(d, A.key, s.fileName), s.text);
    await writeFile(bundlePath(d, B.key, l.fileName), l.text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(entryOf(rr, A.key, s.fileName).reasons).toContain("chain.otherDestination");
    expect(entryOf(rr, B.key, l.fileName).reasons).toContain("chain.otherDestination");
    await rm(d, { recursive: true, force: true });
  });

  it("未確認の仲間・古い決まり・束の形をしていないファイル", async () => {
    const d = await copyRing();
    await writeFile(join(d, ring.ringId, BUNDLES_DIR, A.key, "memo.txt"), "x");
    const r1 = await readRing(d, ring.ringId, { table, vocab, confirmed: new Set([A.key]) });
    expect(memberOf(r1, B.key).reasons).toContain("member.unconfirmed");
    expect(r1.notBundleFiles).toBe(1);
    // 決まりを厳しくした版 2 に置き換えると、前の決まりの束は「古い決まり」
    const v2 = makeRingWith(ring.founder, ring.nonce, { minK: 6 }, 2);
    expect(v2.ringId).toBe(ring.ringId);
    await writeFile(join(d, ring.ringId, "circle.json"), v2.circleText);
    const r2 = await readRing(d, ring.ringId, opts());
    expect(r2.circle.status).toBe("ok");
    expect(entryOf(r2, B.key, b1.fileName).reasons).toContain("chain.oldRules");
    await rm(d, { recursive: true, force: true });
  });
});

describe("share.tamper：経過年はどこにも出さない（輪の受け手）", () => {
  /** 正しい束の body を書き換え、本人の鍵で署名し直す（前の版の写し取りが作っていた形の束） */
  function resigned(base: { text: string }, m: Member, edit: (body: Record<string, unknown>) => void) {
    const body = JSON.parse(base.text).body as Record<string, unknown>;
    edit(body);
    const text = envelopeText(body, signBody(body, m.pair.privateKey));
    return { text, fileName: bundleFileName(body.seq as number, fileHash(text)) };
  }

  it("塊に経過年の欄がある束は、署名が正しくても ✗（shape.fieldRemoved）", async () => {
    expect([...a, b1].every((s) => !s.text.includes("ageAtWork"))).toBe(true);
    const x = resigned(a[0]!, A, (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.ageAtWork = "A15_19";
    });
    const d = await copyRing();
    await unlink(bundlePath(d, A.key, a[0]!.fileName));
    await writeFile(bundlePath(d, A.key, x.fileName), x.text);
    const rr = await readRing(d, ring.ringId, opts());
    const e = entryOf(rr, A.key, x.fileName);
    expect(e.status).toBe("ng");
    expect(e.reasons).toEqual(expect.arrayContaining(["shape.fieldRemoved", "shape.type"]));
    expect(e.reasons.some((y) => y.startsWith("chain."))).toBe(false);
    expect(memberOf(rr, A.key).reasons).toContain("shape.fieldRemoved");
    // 送る側の置き場所も、この形の束は置かない
    expect((await writeBundle(d, x.text, ring.ctx)).ok).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it("前の帯の版（bands-1）で作った束は ✗（shape.bandsVersion）", async () => {
    const x = resigned(b1, B, (body) => {
      body.bands = "bands-1";
    });
    const r = recount(x.text, ring.ctx);
    expect(r.reasons).toEqual(expect.arrayContaining(["shape.bandsVersion"]));
    expect(r.chain).toBe(0);
    expect(isClean(r)).toBe(false);
  });

  it("経過年の欄を許す circle.json（作った人が署名していても）→ 理由つきで輪の全員が ✗", async () => {
    const rules = { ...ring.rules, fields: [...ring.rules.fields, "ageAtWork"] };
    const body = makeRulesDocBody(CIRCLE_V, ring.founder.pub, ring.nonce, 1, "2026-11", rules as never);
    const text = envelopeText(body, signBody(body, ring.founder.privateKey));
    const d = await copyRing();
    await writeFile(join(d, ring.ringId, "circle.json"), text);
    const rr = await readRing(d, ring.ringId, opts());
    expect(rr.circle.status).toBe("ng");
    expect(rr.circle.reasons).toEqual(expect.arrayContaining(["shape.rules", "shape.rules.fieldRemoved"]));
    expect(rr.bundles.every((x) => x.status === "ng" && x.reasons.includes("circle"))).toBe(true);
    expect(rr.members.every((m) => m.status === "ng")).toBe(true);
    await rm(d, { recursive: true, force: true });
  });
});
