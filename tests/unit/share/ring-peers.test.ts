// 輪の受け手が、仲間で数える k（OUTSIDE の集団）を自分の確認済みの仲間で数え直す（Db の重-6、Architect の決まり a＋b＋c と 5 点）：
// 1 回目で ✓ を決め、その最新の束の見え方を仲間にして 2 回目で数える。届かない束は ✗ にせず鎖も切らず、集計に入れない。
// 束を出した施設の鍵だけを除き、受け手自身の施設は数える。送る側の k は形だけを見る（下限未満と書いた束は ✗）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleFileName, envelopeText, fileHash, type ShareContext } from "../../../src/share/bundle";
import type { PeerProfile } from "../../../src/share/k";
import { BUNDLES_DIR, readRing, ringDir, writeBundle, writeCircle, writeMember } from "../../../src/share/ring";
import { previewBundle, sealBundle, type SendInput } from "../../../src/share/seal";
import { signBody } from "../../../src/share/sign";
import { FACILITY_COMMON, makeMember, makeRing, sendInput, smallPlan, table, vocab, type Member } from "./fixtures";

const ring = makeRing();
const M = Array.from({ length: 7 }, () => makeMember(ring));
const PROFILE = { group: "OUTSIDE", stage: 0, axes: FACILITY_COMMON } as unknown as PeerProfile["profile"];
let base = "";

/** 送る側：ほかの 6 拠点を確認済みの仲間として数え、OUTSIDE の束に署名する */
function seal(m: Member, seq: number, prev: string | null) {
  const peers: PeerProfile[] = M.filter((x) => x !== m).map((x) => ({ key: x.key, profile: PROFILE }));
  const ctx: ShareContext = { ...ring.ctx, peers };
  const input: SendInput = sendInput({ ...ring, ctx }, m, smallPlan(), { group: "OUTSIDE", seq, prev });
  const pv = previewBundle(input);
  if (!pv.ok) throw new Error(`プレビュー ${pv.reason}`);
  const s = sealBundle(input, { previewHash: pv.bodyHash, pair: m.pair, acceptedRulesHash: ring.ctx.rulesHash, acceptedRules: ring.rules, localWords: [], cells: [], folderPath: "輪" });
  if (!s.ok) throw new Error(`署名 ${s.reason}`);
  return { ...s, body: pv.body };
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "moyai-ring-peers-"));
  expect((await writeCircle(base, ring.circleText, ring.ctx)).ok).toBe(true);
  for (const m of M) expect((await writeMember(base, m.memberText, ring.ctx)).ok).toBe(true);
  // 0 番は 2 つ（鎖の 2 つめも届かないとき ✗ にならないか）、ほかは 1 つずつ
  const first = seal(M[0]!, 1, null);
  expect(first.body.profile.group).toBe("OUTSIDE");
  expect(first.body.counts.k).toBe(6);
  for (const s of [first, seal(M[0]!, 2, first.hash), ...M.slice(1).map((m) => seal(m, 1, null))]) expect((await writeBundle(base, s.text, ring.ctx)).ok).toBe(true);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("輪の受け手が仲間で数える k", () => {
  it("7 拠点すべてを確認済みの受け手：どの束も ✓ で、届かない印は無く、全員が集計に入る", async () => {
    const r = await readRing(base, ring.ringId, { table, vocab, confirmed: new Set(M.map((m) => m.key)) });
    expect(r.bundles.every((b) => b.status === "ok" && !b.short)).toBe(true);
    expect(r.members.every((m) => m.status === "ok")).toBe(true);
    expect(r.latestBundles.map((b) => b.key).sort()).toEqual(M.map((m) => m.key).sort());
  });

  it("4 拠点だけを確認済みの受け手（自分を含む）：届かない束は ✗ にせず鎖も切らず、集計に入れない", async () => {
    // 受け手は 1 番。確認済みは 0〜3 番。0 番の束を数える仲間は 1〜3 番の 3 つ（受け手自身も数える）で、5 に届かない
    const confirmed = new Set(M.slice(0, 4).map((m) => m.key));
    const r = await readRing(base, ring.ringId, { table, vocab, confirmed });
    const zero = r.bundles.filter((b) => b.folder === M[0]!.key);
    expect(zero.map((b) => [b.seq, b.status, b.short, b.reasons])).toEqual([
      [1, "ok", true, []],
      [2, "ok", true, []],
    ]);
    expect(r.members.find((m) => m.key === M[0]!.key)).toMatchObject({ status: "ok", reasons: [] });
    expect(r.latestBundles).toEqual([]);
  });

  it("送る側の k が下限未満と書いた束は、作られたものとして ✗（同じ数かは見ない）", async () => {
    const s = seal(M[1]!, 1, null);
    const body = { ...s.body, counts: { ...s.body.counts, k: 3 } };
    const text = envelopeText(body, signBody(body, M[1]!.pair.privateKey));
    const other = await mkdtemp(join(tmpdir(), "moyai-ring-peers-k-"));
    try {
      expect((await writeCircle(other, ring.circleText, ring.ctx)).ok).toBe(true);
      expect((await writeMember(other, M[1]!.memberText, ring.ctx)).ok).toBe(true);
      // 橋渡しは正しい束の形しか書かないので、ほかの道具で置かれたものとして直に置く
      expect((await writeBundle(other, text, ring.ctx)).ok).toBe(false);
      const dir = join(ringDir(other, ring.ringId), BUNDLES_DIR, M[1]!.key);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, bundleFileName(1, fileHash(text))), text, "utf8");
      const r = await readRing(other, ring.ringId, { table, vocab, confirmed: new Set(M.map((m) => m.key)) });
      expect(r.bundles[0]).toMatchObject({ status: "ng" });
      expect(r.bundles[0]!.reasons).toContain("k.mismatch");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
