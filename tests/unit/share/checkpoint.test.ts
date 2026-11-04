// share.checkpoint：架空の計画を、検問所の裏の関数で端まで通す。
// 輪を作る（鍵を状態フォルダに置く。合言葉はやめた）→ プレビュー（写し取り → 束 → 数え直し）→ 送る（同じ関数で作り、ハッシュを照らし、署名して輪に置く）→ 受け手と同じ関数で確かめて ✓。
// 書き換えた束は理由つきの ✗。前の形の鍵・画面で見た束と違う・数が 0 でないときは署名しない。
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readKeyFile, readRings, readSent } from "../../../src/bridge/places";
import { openKeyFile, wrapPrivateKey, type KeyPair } from "../../../src/share/sign";
import { createRing, loadRing, previewCheckpoint, questionsOf, sendCheckpoint, verifyRing, withSentInfo, type Answers } from "../../../src/share/checkpoint";
import { parseJsonStrict } from "../../../src/share/jcs";
import type { SharePack } from "../../../src/share/pack";
import { BUNDLES_DIR } from "../../../src/share/ring";
import { formatReport, keysCli, ringsAt, sendCli, verifyRingCli } from "../../../src/cli/human";
import { FACILITY_COMMON, SPEC, detail, plan, smallPlan, table, vocab } from "./fixtures";

const PACK: SharePack = {
  id: "waste-incineration",
  name: "架空のパック",
  spec: SPEC,
  vocab,
  table,
  classNames: { "T.FEED.LIFT": "架空の昇降機" },
  axes: [],
};
const NOW = new Date(2026, 10, 3, 12, 0, 0);
const MONTH = "2026-11";
const ANSWERS: Answers = { facility: FACILITY_COMMON, inNationalTable: true };

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), "moyai-checkpoint-"));
  const stateDir = join(dir, "state");
  const root = join(dir, "輪のフォルダ");
  const c = await createRing({ stateDir, root, pack: PACK, now: NOW });
  if (!c.ok) throw new Error(c.reason);
  const ring = await loadRing(stateDir, c.ringId, PACK);
  if (!ring.ok) throw new Error(ring.reason);
  return { stateDir, root, ringId: c.ringId, created: c, ring };
}

describe("検問所の裏：架空の計画を端まで", () => {
  it("輪を作ると、鍵は包まずに状態フォルダに、輪のフォルダは rings.json に入り、指紋は 4 文字 × 4 組", async () => {
    const { stateDir, root, ringId, created } = await setup();
    expect(created.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const w = readKeyFile(stateDir, ringId)!;
    expect(w.v).toBe("moyai.key/1");
    expect(readRings(stateDir).folders).toEqual([root]);
    // 輪の決まりと自分の仲間のファイルは、受け手の関数で ✓（自分の鍵は確認済み）
    const rep = await verifyRing(root, ringId, PACK, new Set([created.key]));
    expect(rep.lines.map((l) => [l.kind, l.status])).toEqual([
      ["circle", "ok"],
      ["member", "ok"],
    ]);
  });

  it("プレビューと送るは同じバイト列：署名して置いた束を、受け手と同じ関数で確かめると ✓", async () => {
    const { stateDir, root, ringId, ring } = await setup();
    const p = smallPlan();
    const v = previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH);
    expect(v.blockers).toEqual([]);
    expect(v.counts).toEqual({ shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 });
    expect(v.k).toBeGreaterThanOrEqual(5);
    expect(v.steps!.all).toBe(table.active);
    expect(v.steps!.profile).toBeGreaterThanOrEqual(v.steps!.rows);
    expect(v.bodyText).not.toContain("架空");
    expect(v.original.length).toBeGreaterThan(0);
    // もう一度作っても同じバイト列（同じ関数・同じ入力）
    expect(previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH).bodyHash).toBe(v.bodyHash);

    const s = await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW);
    if (!s.ok) throw new Error(s.reason);
    expect(s.seq).toBe(1);
    const text = readFileSync(s.path, "utf8");
    const env = parseJsonStrict(text);
    expect(env.ok).toBe(true);
    // 置いた束の body は、検問所で見せたバイト列そのもの
    expect(text.startsWith(`{"body":${v.bodyText},"sig":"`)).toBe(true);
    expect(readSent(stateDir)).toMatchObject([{ ringId, seq: 1, hash: s.hash, fileName: s.fileName }]);

    const rep = await verifyRing(root, ringId, PACK, ring.confirmed);
    expect(rep.ok).toBe(true);
    expect(rep.lines.filter((l) => l.kind === "bundle")).toEqual([{ kind: "bundle", name: `bundles/${ring.entry.key}/${s.fileName}`, status: "ok", reasons: [], month: MONTH }]);

    // 2 回目は連番 2、前の束のハッシュを持つ
    const ring2 = await loadRing(stateDir, ringId, PACK);
    if (!ring2.ok) throw new Error(ring2.reason);
    const p2 = plan({ ...smallPlan(), details: [...smallPlan().details, detail("d9", "w2", 2021, { manDays: 3, days: 1 })] });
    const v2 = previewCheckpoint(stateDir, ring2, PACK, p2, ANSWERS, MONTH);
    expect(v2.seq).toBe(2);
    const s2 = await sendCheckpoint(stateDir, ring2, PACK, p2, ANSWERS, MONTH, v2.bodyHash!, NOW);
    if (!s2.ok) throw new Error(s2.reason);
    expect((await verifyRing(root, ringId, PACK, ring.confirmed)).ok).toBe(true);
  });

  it("前の形の鍵・画面で見た束と違う・施設名が入る・見え方が決まらないときは、署名も書き込みもしない", async () => {
    const { stateDir, root, ringId, ring } = await setup();
    const p = smallPlan();
    const v = previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH);
    // 前の形（合言葉で包んだ鍵）は使わない（人が keys unwrap で移すまで）
    const plain = readKeyFile(stateDir, ringId)!;
    writeFileSync(join(stateDir, "keys", `${ringId}.json`), JSON.stringify(wrapPrivateKey(openKeyFile(plain) as KeyPair, "架空の前の合言葉")));
    expect(await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW)).toEqual({ ok: false, reason: "oldKey" });
    writeFileSync(join(stateDir, "keys", `${ringId}.json`), JSON.stringify(plain));
    expect(await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, "f".repeat(64), NOW)).toEqual({ ok: false, reason: "previewChanged" });
    // 答えを変えると body も変わる（見た束と違うので送らない）
    const other = { ...ANSWERS, facility: { ...FACILITY_COMMON, contract: "OM" } };
    expect(await sendCheckpoint(stateDir, ring, PACK, p, other, MONTH, v.bodyHash!, NOW)).toEqual({ ok: false, reason: "previewChanged" });
    // 見え方の軸が決まらなければ送れない（推測で埋めない）
    const partial = previewCheckpoint(stateDir, ring, PACK, p, { facility: { furnace: "STOKER" }, inNationalTable: true }, MONTH);
    expect(partial.blockers).toContain("profileIncomplete");
    expect(partial.missing.length).toBeGreaterThan(0);
    expect(previewCheckpoint(stateDir, ring, PACK, p, { ...ANSWERS, inNationalTable: null }, MONTH).blockers).toContain("groupUnknown");
    // 輪のフォルダの道に施設の名前の語が入っていれば、固有名詞に数える
    const named = plan({ ...smallPlan(), name: "架空市清掃工場" });
    const ringNamed = { ...ring, entry: { ...ring.entry, root: join(root, "架空市清掃工場") } };
    const vn = previewCheckpoint(stateDir, ringNamed, PACK, named, ANSWERS, MONTH);
    expect(vn.counts!.properNoun).toBeGreaterThan(0);
    expect(vn.blockers).toContain("properNoun");
    expect(readdirSync(join(root, ringId))).not.toContain(BUNDLES_DIR);
  });

  it("受け取った束の行：束の送った月、自分の束なら束にした計画の版と置いた日（持ち出し簿から）", async () => {
    const { stateDir, root, ringId, ring } = await setup();
    const p = { ...smallPlan(), version: 7 };
    const v = previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH);
    const s = await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW);
    if (!s.ok) throw new Error(s.reason);
    const rep = await verifyRing(root, ringId, PACK, ring.confirmed);
    expect(rep.lines.find((l) => l.kind === "bundle")).toMatchObject({ status: "ok", month: MONTH });
    const withMine = withSentInfo(rep, readSent(stateDir));
    expect(withMine.lines.find((l) => l.kind === "bundle")).toMatchObject({ month: MONTH, version: 7, day: "2026-11-03" });
    // ほかの輪の持ち出し簿は当てない
    expect(withSentInfo(rep, readSent(stateDir).map((e) => ({ ...e, ringId: "f".repeat(16) }))).lines.find((l) => l.kind === "bundle")!.version).toBeUndefined();
  });

  it("書き換えた束・他人のフォルダの束は、受け手の関数で理由つきの ✗", async () => {
    const { stateDir, root, ringId, ring } = await setup();
    const p = smallPlan();
    const v = previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH);
    const s = await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW);
    if (!s.ok) throw new Error(s.reason);
    // 1 バイトの書き換え（年度を 1 つ変える）
    const text = readFileSync(s.path, "utf8");
    writeFileSync(s.path, text.replace("FY2016", "FY2017"));
    const rep = await verifyRing(root, ringId, PACK, ring.confirmed);
    const b = rep.lines.find((l) => l.kind === "bundle")!;
    expect(b.status).toBe("ng");
    expect(b.reasons.some((r) => r === "chain.badSignature" || r === "file.nameMismatch")).toBe(true);
    expect(rep.ok).toBe(false);
    // 未確認の仲間（指紋の読み合わせがまだ）も ✗
    const rep2 = await verifyRing(root, ringId, PACK, new Set());
    expect(rep2.lines.find((l) => l.kind === "member")!.reasons).toContain("member.unconfirmed");
    // CLI の文にも理由が日本語で出る
    expect(formatReport(rep).join("\n")).toMatch(/✗ 束 bundles\/.+：.*(署名 ✗|ファイルの名前が中身)/);
  });

  it("検問所で聞く軸は、パックの見え方のうち全国の表に列があるもの（規模の数から帯を読めれば候補にする）", () => {
    const qs = questionsOf({ ...PACK, axes: [{ key: "capacity_t_per_day", name: "処理能力", unit: "t/日", codes: [] }, { key: "furnace", name: "炉の型", unit: null, codes: [] }] }, smallPlan());
    expect(qs.map((q) => q.key)).toEqual(["furnace", "capacity_t_per_day"]);
    expect(qs.find((q) => q.key === "capacity_t_per_day")!.suggested).toBe("C100_200");
  });
});

describe("CLI：verify ring と、人だけの CLI", () => {
  it("verify ring は輪のフォルダかその上を受け、受け手と同じ関数で ✓／✗ を出す", async () => {
    const { stateDir, root, ringId, ring } = await setup();
    const packsDir = join(dir, "packs");
    // 架空の語彙のパックを一時のフォルダに置く（CLI はパックのファイルから読む）
    const pdir = join(packsDir, "waste-incineration");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(pdir, "national"), { recursive: true });
    const { TABLE_TEXT, VOCAB_TEXT } = await import("./fixtures");
    writeFileSync(join(pdir, "national", "table.json"), TABLE_TEXT);
    writeFileSync(join(pdir, "vocab.json"), VOCAB_TEXT);
    writeFileSync(join(pdir, "pack.json"), JSON.stringify({ id: "waste-incineration", name: "架空", profile: SPEC }));
    const p = smallPlan();
    const v = previewCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH);
    const s = await sendCheckpoint(stateDir, ring, PACK, p, ANSWERS, MONTH, v.bodyHash!, NOW);
    expect(s.ok).toBe(true);
    expect(ringsAt(root)).toEqual([{ root, ringId }]);
    expect(ringsAt(join(root, ringId))).toEqual([{ root, ringId }]);
    expect(await verifyRingCli(["ring", root], { packsDir, stateDir })).toBe(0);
    expect(await verifyRingCli(["ring", root], { packsDir, stateDir: join(dir, "空の状態") })).toBe(1); // 自分の鍵が未確認になる
    expect(await verifyRingCli(["ledger"], { packsDir, stateDir })).toBe(2);
  });

  it("鍵を作る CLI と送る CLI は、標準入力が端末でなければ断る", async () => {
    expect(await keysCli(["create", "--root", "/x", "--pack", "waste-incineration"], { stdin: { isTTY: false } })).toBe(3);
    expect(await keysCli(["create"], { stdin: {} })).toBe(3);
    expect(sendCli({ stdin: { isTTY: false } })).toBe(3);
  });
});

