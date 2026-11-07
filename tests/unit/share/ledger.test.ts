// 公開の台帳の検証（docs/plan.md §2.8 場 2・§5.1 share.tamper と ledger）。輪の受け手と同じ関数（数え直し・鎖）で、
// 決まり（ledger.json）と束ごとに ✓ か理由つきの ✗ を出す。台帳のリポジトリは一時のフォルダに作る。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envelopeText, makeRetiredBody, makeRulesDocBody, CIRCLE_V } from "../../../src/share/bundle";
import { canonicalize } from "../../../src/share/jcs";
import { LEDGER_JSON_PATH, checkBundleAdded, checkRetiredAdded, jsonDepth, ledgerRetiredPath, readLedgerDir, verifyLedgerFiles, type LedgerFile } from "../../../src/share/ledger";
import { isClean, recount } from "../../../src/share/recount";
import { signBody } from "../../../src/share/sign";
import { formatLedger, ledgerRootOf, loadLedger, verifyLedgerCli } from "../../../src/cli/ledger";
import { reasonText } from "../../../src/app/text/reasons";
import type { Rules } from "../../../src/share/rules";
import { SPEC, TABLE_TEXT, VOCAB_TEXT, detail, plan, smallPlan, table, vocab, work, asset } from "./fixtures";
import { LEDGER_FIELDS, forge, makeLedger, makeSigner, sealLedger, sealRetired, writeRepo, type Sealed } from "./ledger-fixtures";

const pack = { table, vocab };
const L = makeLedger();
const A = makeSigner();
const B = makeSigner();
const a: Sealed[] = [];
let b1: Sealed;
let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-ledger-"));
  let prev: string | null = null;
  for (let seq = 1; seq <= 3; seq++) {
    const s = sealLedger(L, A, smallPlan(), { seq, prev });
    a.push(s);
    prev = s.hash;
  }
  b1 = sealLedger(L, B, smallPlan());
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
function repo(bundles: readonly Sealed[], ledger: { text: string } = L): string {
  const d = join(tmp, `repo-${++n}`);
  writeRepo(d, ledger, bundles);
  return d;
}
async function read(d: string) {
  const r = await readLedgerDir(d);
  if (!r.ok) throw new Error(r.reason);
  return verifyLedgerFiles(r.files, pack);
}
const lineOf = (r: Awaited<ReturnType<typeof read>>, s: Sealed) => r.bundles.find((x) => x.path === s.path)!;
const files = (bundles: readonly Sealed[], extra: LedgerFile[] = [], ledgerText = L.text): LedgerFile[] => [
  { path: LEDGER_JSON_PATH, kind: "file", bytes: Buffer.from(ledgerText) },
  ...bundles.map((b) => ({ path: b.path, kind: "file" as const, bytes: Buffer.from(b.text) })),
  ...extra,
];

describe("verify ledger：正しい台帳", () => {
  it("本物の写し取りと封で作った束は、台帳の決まりのもとで ✓", async () => {
    const r = await read(repo([...a, b1]));
    expect(r.ledger).toMatchObject({ status: "ok", id: L.id, version: 1 });
    expect(r.ledger.founder).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(r.bundles.map((b) => [b.path, b.status, b.reasons])).toEqual([...a, b1].map((s) => [s.path, "ok", []]).sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)));
    expect(r.others).toEqual([]);
    expect(r.ok).toBe(true);
    // 台帳向けの束に、経過年と UPGRADE は出ない
    const body = JSON.parse(a[0]!.text).body;
    expect(body.to).toEqual({ kind: "ledger", id: L.id });
    expect(body.profile.group).toBe("NATIONAL");
    for (const c of body.chunks) expect(c.ageAtWork).toBeUndefined();
  });

  it("利用条件（TERMS.md）は読まず、ledger/ の外のファイルも見ない", async () => {
    const d = repo([...a]);
    writeFileSync(join(d, "README.md"), "【架空】");
    mkdirSync(join(d, ".github", "workflows"), { recursive: true });
    writeFileSync(join(d, ".github", "workflows", "x.yml"), "x");
    const r = await read(d);
    expect(r.ok).toBe(true);
  });
});

describe("verify ledger：share.tamper（輪と同じ外れ）", () => {
  it("body の外のキー・重複キー", () => {
    const env = JSON.parse(a[0]!.text);
    const outside = canonicalize({ ...env, note: "x" });
    expect(recount(outside, L.ctx).reasons).toContain("shape.type");
    const sig = env.sig as string;
    const dup = a[0]!.text.slice(0, -1) + `,"sig":"${sig}"}`;
    const r = verifyLedgerFiles(files([{ ...a[0]!, text: dup }, a[1]!, a[2]!]), pack);
    expect(lineOf(r, a[0]!).reasons).toContain("shape.duplicateKey");
    expect(lineOf(r, a[1]!).reasons).toContain("chain.gap");
    expect(r.ok).toBe(false);
  });

  it("ledger.json に施設名（管理者が署名していても）→ 決まりが ✗ で、どの束も ✗", () => {
    const body = { ...makeRulesDocBody("moyai.ledger/0", L.admin.pub, L.nonce, 1, "2026-11", L.rules), title: "架空市みどり清掃センター" };
    const text = envelopeText(body, signBody(body, L.admin.privateKey));
    const r = verifyLedgerFiles(files([a[0]!], [], text), pack);
    expect(r.ledger.status).toBe("ng");
    expect(r.ledger.reasons).toEqual(expect.arrayContaining(["freeText", "shape.type"]));
    expect(lineOf(r, a[0]!).reasons).toEqual(["ledger"]);
  });

  it("1 バイトの書き換え → 署名 ✗ と名前の不一致、後ろの束は抜けあり", async () => {
    const t = a[1]!.text;
    const i = t.indexOf("FY2019");
    const text = t.slice(0, i + 5) + "8" + t.slice(i + 6);
    const d = repo([a[0]!, { ...a[1]!, text }, a[2]!]);
    const r = await read(d);
    expect(lineOf(r, a[1]!).reasons).toEqual(expect.arrayContaining(["chain.badSignature", "file.nameMismatch"]));
    expect(lineOf(r, a[2]!).reasons).toContain("chain.gap");
  });

  it("抜き・入れ替え・作り直した束（鎖が切れる）", async () => {
    const d = repo([a[0]!, a[1]!, a[2]!]);
    unlinkSync(join(d, ...a[1]!.path.split("/")));
    expect(lineOf(await read(d), a[2]!).reasons).toContain("chain.gap");
    const swapped = verifyLedgerFiles(files([{ ...a[0]!, text: a[1]!.text }, { ...a[1]!, text: a[0]!.text }]), pack);
    expect(lineOf(swapped, a[0]!).reasons).toContain("file.nameMismatch");
    const p = smallPlan();
    p.details.push({ ...p.details[0]!, detailKey: "d9", fiscalYear: 2021 });
    const fork = sealLedger(L, A, p, { seq: 2, prev: a[0]!.hash });
    const r = verifyLedgerFiles(files([a[0]!, fork, a[2]!]), pack);
    expect(lineOf(r, fork).status).toBe("ok");
    expect(lineOf(r, a[2]!).reasons).toContain("chain.broken");
  });

  it("他人のフォルダ（鍵 ID と署名の鍵が合わない）", () => {
    const moved = { ...b1, key: A.key, path: `ledger/ledger/bundles/${A.key}/${b1.fileName}` };
    const r = verifyLedgerFiles(files([a[0]!, moved]), pack);
    expect(lineOf(r, moved).reasons).toContain("file.otherFolder");
  });

  it("改行の変換・余分な空白・BOM・書きかけ", () => {
    const t = a[0]!.text;
    for (const text of [t + "\n", t.replace(/,/g, ",\r\n"), "\ufeff" + t]) {
      const r = verifyLedgerFiles(files([{ ...a[0]!, text }]), pack);
      expect(lineOf(r, a[0]!).reasons).toContain("shape.notCanonical");
    }
    // バイト列で受けても BOM を黙って捨てない
    expect(lineOf(verifyLedgerFiles(files([{ ...a[0]!, text: "\ufeff" + t }]), pack), a[0]!).reasons).toContain("shape.bom");
    const half = verifyLedgerFiles(files([{ ...a[0]!, text: t.slice(0, Math.floor(t.length / 2)) }]), pack);
    expect(lineOf(half, a[0]!).reasons).toContain("shape.truncated");
    expect(lineOf(half, a[0]!).status).toBe("ng");
  });

  it("ほかの行き先の束（ほかの台帳・輪）", () => {
    const other = makeLedger({}, { nonce: "f".repeat(32) });
    const s = sealLedger(other, A, smallPlan());
    const ringCtx = { ...L.ctx, to: { kind: "ring" as const, id: "00000000000000aa" } };
    const ringBundle = forge(a[0]!, A, (body) => {
      body.to = ringCtx.to;
    });
    for (const x of [s, ringBundle]) {
      const r = verifyLedgerFiles(files([x]), pack);
      expect(lineOf(r, x).reasons).toContain("chain.otherDestination");
    }
  });

  it("古い決まり：決まりを厳しくした版 2 に置き換えると、前の決まりの束は ✗", () => {
    const v2 = makeLedger({ minK: 6 }, { admin: L.admin, nonce: L.nonce, version: 2 });
    expect(v2.id).toBe(L.id);
    const r = verifyLedgerFiles(files([a[0]!], [], v2.text), pack);
    expect(r.ledger.status).toBe("ok");
    expect(lineOf(r, a[0]!).reasons).toContain("chain.oldRules");
  });
});

describe("verify ledger：台帳だけの決まり", () => {
  it("UPGRADE の塊は ✗（署名が正しくても）", () => {
    const x = forge(a[0]!, A, (body) => {
      (body.chunks as Record<string, unknown>[]).push({ class: "T.RESIDUE", work: "UPGRADE", years: ["FY2020"], observed: "N1" });
    });
    const r = verifyLedgerFiles(files([x]), pack);
    expect(lineOf(r, x).reasons).toEqual(expect.arrayContaining(["ledger.upgrade", "shape.type"]));
  });

  it("OUTSIDE の集団は ✗（台帳は NATIONAL だけ）", () => {
    const x = forge(a[0]!, A, (body) => {
      (body.profile as Record<string, unknown>).group = "OUTSIDE";
    });
    const r = verifyLedgerFiles(files([x]), pack);
    expect(lineOf(r, x).reasons).toEqual(expect.arrayContaining(["ledger.groupNotNational", "shape.type"]));
  });

  it("k < 5（数え直すと下限に届かない見え方）は ✗", () => {
    // 全国の表で数の少ない見え方に書き換え、送る側の k も合わせる（受ける側で数え直して ✗）
    const x = forge(a[0]!, A, (body) => {
      (body.profile as Record<string, unknown>).axes = { furnace: "OTHER", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" };
      (body.counts as Record<string, unknown>).k = 0;
    });
    const r = recount(x.text, L.ctx);
    expect(r.k).toBeLessThan(5);
    expect(r.reasons).toContain("k.belowMin");
    expect(lineOf(verifyLedgerFiles(files([x]), pack), x).reasons).toContain("k.belowMin");
  });

  it("費用の欄・施設名は ✗（形の外れ・自由記述・金額）", () => {
    const cost = forge(a[0]!, A, (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.cost = "1,200,000円";
    });
    const rc = verifyLedgerFiles(files([cost]), pack);
    expect(lineOf(rc, cost).reasons).toEqual(expect.arrayContaining(["shape.type", "freeText", "money"]));
    const name = forge(a[0]!, A, (body) => {
      body.facility = "【架空】みどり台クリーンセンター";
    });
    const rn = verifyLedgerFiles(files([name]), pack);
    expect(lineOf(rn, name).reasons).toEqual(expect.arrayContaining(["shape.type", "freeText"]));
  });

  it("粒度：1 回だけの行に間隔、回数の帯が年度の数と合わない", () => {
    const x = forge(a[0]!, A, (body) => {
      const cs = body.chunks as Record<string, unknown>[];
      cs[0] = { ...cs[0], years: ["FY2016"], observed: "N1", interval: "I3" };
      cs[1] = { ...cs[1], observed: "N3P" };
    });
    const r = recount(x.text, L.ctx);
    expect(r.reasons).toEqual(expect.arrayContaining(["grain.intervalOnN1", "grain.observedMismatch"]));
    expect(isClean(r)).toBe(false);
  });

  it("決まりを緩めた ledger.json（下限を下げる・欄を足す）は ✗", () => {
    for (const patch of [{ minK: 3 }, { fields: ["interval", "interval"] as never }]) {
      const loose = makeLedger(patch);
      const r = verifyLedgerFiles(files([], [], loose.text), pack);
      expect(r.ledger.status).toBe("ng");
      expect(r.ledger.reasons.some((x) => x.startsWith("rules.") || x.startsWith("shape."))).toBe(true);
    }
  });

  it("輪の決まり（circle.json）を ledger.json に置いても ✗", () => {
    const body = makeRulesDocBody(CIRCLE_V, L.admin.pub, L.nonce, 1, "2026-11", L.rules);
    const text = envelopeText(body, signBody(body, L.admin.privateKey));
    const r = verifyLedgerFiles(files([a[0]!], [], text), pack);
    expect(r.ledger.status).toBe("ng");
    expect(lineOf(r, a[0]!).reasons).toEqual(["ledger"]);
  });

  it("全国の表・公開語彙の版が決まりと違えば、決まりが ✗", () => {
    const other = makeLedger({ national: "0".repeat(64) });
    expect(verifyLedgerFiles(files([], [], other.text), pack).ledger.reasons).toContain("chain.nationalMismatch");
    const otherV = makeLedger({ vocab: "0".repeat(64) });
    expect(verifyLedgerFiles(files([], [], otherV.text), pack).ledger.reasons).toContain("chain.vocabMismatch");
  });

  it("許した形の外：symlink・submodule・知らないファイル・名前の形が違う束・深すぎる入れ子", () => {
    const deep = forge(a[0]!, A, (body) => {
      let v: unknown = "FY2016";
      for (let i = 0; i < 10; i++) v = [v];
      body.deep = v;
    });
    expect(jsonDepth(deep.text)).toBeGreaterThan(8);
    const r = verifyLedgerFiles(
      files([deep], [
        { path: `ledger/ledger/bundles/${B.key}/${b1.fileName}`, kind: "symlink", bytes: null },
        { path: `ledger/ledger/bundles/${A.key}/000009-0000000000000000.json`, kind: "submodule", bytes: null },
        { path: "ledger/ledger/notes.txt", kind: "file", bytes: Buffer.from("x") },
        { path: `ledger/ledger/bundles/${A.key}/memo.json`, kind: "file", bytes: Buffer.from("{}") },
        { path: "ledger/ledger/TERMS.md", kind: "symlink", bytes: null },
      ]),
      pack,
    );
    expect(lineOf(r, deep).reasons).toEqual(["file.tooDeep"]);
    expect(r.bundles.find((x) => x.path.endsWith(b1.fileName))!.reasons).toEqual(["file.symlink"]);
    expect(r.bundles.find((x) => x.path.endsWith("000009-0000000000000000.json"))!.reasons).toEqual(["file.submodule"]);
    expect(r.others).toEqual([
      { path: "ledger/ledger/TERMS.md", reasons: ["file.symlink"] },
      { path: `ledger/ledger/bundles/${A.key}/memo.json`, reasons: ["file.notBundleName"] },
      { path: "ledger/ledger/notes.txt", reasons: ["file.notAllowed"] },
    ]);
  });

  it("フォルダの symlink（Windows の junction も）はたどらない", async () => {
    const d = repo([a[0]!]);
    const target = join(tmp, `elsewhere-${n}`);
    writeRepo(target, L, [b1]);
    symlinkSync(join(target, "ledger", "ledger", "bundles", B.key), join(d, "ledger", "ledger", "bundles", B.key), process.platform === "win32" ? "junction" : "dir");
    const r = await read(d);
    expect(r.bundles.map((x) => x.path)).toEqual([a[0]!.path]);
    expect(r.others).toEqual([{ path: `ledger/ledger/bundles/${B.key}`, reasons: ["file.notBundleName"] }]);
    expect(r.ok).toBe(false);
    // ledger/ そのものが symlink なら読まない
    const d2 = join(tmp, `repo-link-${n}`);
    mkdirSync(d2);
    symlinkSync(join(d, "ledger"), join(d2, "ledger"), process.platform === "win32" ? "junction" : "dir");
    expect(await readLedgerDir(d2)).toEqual({ ok: false, reason: "ledgerDirSymlink" });
    // 台帳の根の下の ledger/ledger/ が symlink でも読まない
    const d3 = join(tmp, `repo-link-inner-${n}`);
    mkdirSync(join(d3, "ledger"), { recursive: true });
    symlinkSync(join(d, "ledger", "ledger"), join(d3, "ledger", "ledger"), process.platform === "win32" ? "junction" : "dir");
    expect(await readLedgerDir(d3)).toEqual({ ok: false, reason: "ledgerDirSymlink" });
  });
});

describe("verify ledger：取り下げの印（retired.json。Architect の 72）", () => {
  const retiredOf = (r: ReturnType<typeof verifyLedgerFiles>, key: string) => r.retired.find((x) => x.key === key)!;

  it("自分の署名の印：A の束は ✓ のまま残り、k にも集計にも数えない（body なし）。B は数える", async () => {
    const own = sealRetired(L, A, 3);
    expect(own.path).toBe(ledgerRetiredPath(A.key));
    // フォルダから読んでも同じ（道の鍵 ID・本文の key・pub から作った鍵 ID がそろう）
    const r = await read(repo([...a, b1, own]));
    expect(r.ok).toBe(true);
    expect(r.retired).toEqual([{ path: own.path, key: A.key, status: "ok", reasons: [], hash: own.hash, last: 3, placedMax: 3 }]);
    for (const s of a) expect(lineOf(r, s)).toMatchObject({ status: "ok", reasons: [], retired: true, body: null });
    expect(lineOf(r, b1)).toMatchObject({ status: "ok" });
    expect(lineOf(r, b1).retired).toBeUndefined();
    expect(lineOf(r, b1).body).not.toBeNull();
    expect(formatLedger(r).join("\n")).toContain(`✓ 失効記録 ${own.path}`);
    expect(formatLedger(r).join("\n")).toContain(reasonText("ledger.keyRetired"));
    // 一度も出していない鍵の印も受ける（数える束が無いだけ）
    const c = makeSigner();
    const lone = verifyLedgerFiles(files([...a], [{ path: ledgerRetiredPath(c.key), kind: "file", bytes: Buffer.from(sealRetired(L, c, 0).text) }]), pack);
    expect(lone.ok).toBe(true);
    expect(retiredOf(lone, c.key)).toMatchObject({ status: "ok", last: 0 });
  });

  it("他人の鍵の署名の印は ✗。A の束は今までどおり数える", () => {
    const cases: [string, Sealed, string][] = [
      ["B の鍵で署名（本文は A）", sealRetired(L, A, 3, { by: B }), "chain.badSignature"],
      ["B の公開鍵を名乗る（本文の key は A）", sealRetired(L, A, 3, { by: B, pub: B.pair.pub }), "chain.keyMismatch"],
      ["B の正しい印を A のフォルダに置く", { ...sealRetired(L, B, 1), path: ledgerRetiredPath(A.key) }, "file.otherFolder"],
      ["ほかの台帳の印", sealRetired(L, A, 3, { ledger: "00000000000000aa" }), "chain.otherDestination"],
    ];
    for (const [name, x, reason] of cases) {
      const r = verifyLedgerFiles(files([...a, b1, x]), pack);
      expect([name, r.ok]).toEqual([name, false]);
      expect(retiredOf(r, A.key)).toMatchObject({ status: "ng", last: null });
      expect([name, retiredOf(r, A.key).reasons]).toEqual([name, expect.arrayContaining([reason])]);
      for (const s of a) expect([lineOf(r, s).status, lineOf(r, s).retired]).toEqual(["ok", undefined]);
      expect(lineOf(r, a[2]!).body).not.toBeNull();
    }
    // 輪の形（ring を持つ）の印は、台帳では型の外れ
    const ringBody = makeRetiredBody(L.id, A.key, A.pair.pub, 3, "2026-11");
    const ringText = envelopeText(ringBody, signBody(ringBody, A.pair.privateKey));
    const r = verifyLedgerFiles(files([...a], [{ path: ledgerRetiredPath(A.key), kind: "file", bytes: Buffer.from(ringText) }]), pack);
    expect(retiredOf(r, A.key).reasons).toContain("shape.type");
    // 束を retired.json の名前で置いても印にならない
    const asBundle = verifyLedgerFiles(files([...a.slice(0, 1)], [{ path: ledgerRetiredPath(A.key), kind: "file", bytes: Buffer.from(a[1]!.text) }]), pack);
    expect(retiredOf(asBundle, A.key).reasons).toContain("file.notRetired");
  });

  it("印のあとの束（最後の連番より大きい連番）は ✗（chain.afterRetired）。足すときも断る", () => {
    const at1 = sealRetired(L, A, 1);
    const r = verifyLedgerFiles(files([...a, at1]), pack);
    expect(r.ok).toBe(false);
    expect(lineOf(r, a[0]!)).toMatchObject({ status: "ok", retired: true });
    expect(lineOf(r, a[1]!).reasons).toEqual(["chain.afterRetired"]);
    expect(lineOf(r, a[2]!).reasons).toEqual(["chain.afterRetired"]);
    // 印のある台帳に、次の束を足す
    expect(checkBundleAdded(files([a[0]!, at1]), pack, a[1]!.path, Buffer.from(a[1]!.text))).toEqual({ ok: false, reasons: ["chain.afterRetired"] });
    // 印の最後の連番までの束でも、取り下げた鍵には足さない
    const at3 = sealRetired(L, A, 3);
    expect(checkBundleAdded(files([a[0]!, at3]), pack, a[1]!.path, Buffer.from(a[1]!.text))).toEqual({ ok: false, reasons: ["ledger.keyRetired"] });
    // 印を足すとき：載った束より小さい最後の連番は断る。同じ鍵の印が 2 つ目なら断る
    expect(checkRetiredAdded(files([...a]), pack, at1.path, Buffer.from(at1.text))).toEqual({ ok: false, reasons: ["chain.retiredBelowKnown"] });
    expect(checkRetiredAdded(files([...a]), pack, at3.path, Buffer.from(at3.text))).toEqual({ ok: true, key: A.key, last: 3 });
    expect(checkRetiredAdded(files([...a, at3]), pack, at3.path, Buffer.from(at3.text))).toEqual({ ok: false, reasons: ["ledger.retiredExists"] });
    const forged = sealRetired(L, A, 3, { by: B });
    expect(checkRetiredAdded(files([...a]), pack, forged.path, Buffer.from(forged.text))).toMatchObject({ ok: false, reasons: expect.arrayContaining(["chain.badSignature"]) });
  });
});

describe("verify ledger：経過年はどこにも出さない（輪と同じ数え直し）", () => {
  it("塊に経過年の欄がある束は ✗（shape.fieldRemoved）。写し取りは作らない", () => {
    expect(a.every((s) => !s.text.includes("ageAtWork"))).toBe(true);
    const x = forge(a[0]!, A, (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.ageAtWork = "A15_19";
    });
    const r = verifyLedgerFiles(files([x]), pack);
    expect(r.ledger.status).toBe("ok");
    expect(lineOf(r, x).status).toBe("ng");
    expect(lineOf(r, x).reasons).toEqual(expect.arrayContaining(["shape.fieldRemoved", "shape.type"]));
    expect(lineOf(r, x).reasons.some((y) => y.startsWith("chain."))).toBe(false);
  });

  it("経過年の欄を許す台帳の決まり（ledger.json）は ✗。理由を出し、束は数えない", async () => {
    const loose = makeLedger({ fields: [...LEDGER_FIELDS, "ageAtWork"] as unknown as Rules["fields"] });
    const r = verifyLedgerFiles(files([a[0]!], [], loose.text), pack);
    expect(r.ledger.status).toBe("ng");
    expect(r.ledger.reasons).toEqual(expect.arrayContaining(["ledger.unreadable", "shape.rules.fieldRemoved"]));
    expect(lineOf(r, a[0]!).reasons).toEqual(["ledger"]);
    expect(r.ok).toBe(false);
    // CLI は決まりを読めないので（パックを選ぶ前に）2 で止まり、理由を添える
    const l = await loadLedger(repo([a[0]!], loose), { packsDir: join(tmp, "読まないパック") });
    expect(l.ok).toBe(false);
    if (l.ok) return;
    expect(l.code).toBe(2);
    expect(l.message).toContain(reasonText("shape.rules.fieldRemoved"));
  });

  it("前の帯の版（bands-1）で作った束は ✗（shape.bandsVersion）", () => {
    const x = forge(a[0]!, A, (body) => {
      body.bands = "bands-1";
    });
    const r = verifyLedgerFiles(files([x]), pack);
    expect(lineOf(r, x).reasons).toEqual(expect.arrayContaining(["shape.bandsVersion"]));
    expect(reasonText("shape.bandsVersion")).not.toBe("shape.bandsVersion");
  });
});

describe("CLI：verify ledger", () => {
  function packsDir(): string {
    const p = join(tmp, `packs-${++n}`);
    const pdir = join(p, "waste-incineration");
    mkdirSync(join(pdir, "national"), { recursive: true });
    writeFileSync(join(pdir, "national", "table.json"), TABLE_TEXT);
    writeFileSync(join(pdir, "vocab.json"), VOCAB_TEXT);
    writeFileSync(join(pdir, "pack.json"), JSON.stringify({ id: "waste-incineration", name: "架空", profile: SPEC }));
    return p;
  }

  it("すべて ✓ なら 0、✗ があれば 1、引数や台帳が無ければ 2", async () => {
    const pd = packsDir();
    const good = repo([...a, b1]);
    expect(ledgerRootOf(good)).toBe(good);
    expect(ledgerRootOf(join(good, "ledger"))).toBe(good);
    expect(ledgerRootOf(join(good, "ledger", "ledger"))).toBe(good);
    expect(await verifyLedgerCli(["ledger", good], { packsDir: pd })).toBe(0);
    expect(await verifyLedgerCli(["ledger", join(good, "ledger")], { packsDir: pd })).toBe(0);
    const t = a[1]!.text;
    const bad = repo([a[0]!, { ...a[1]!, text: t.replace("FY2019", "FY2018") }, a[2]!]);
    expect(await verifyLedgerCli(["ledger", bad], { packsDir: pd })).toBe(1);
    expect(await verifyLedgerCli(["ledger"], { packsDir: pd })).toBe(2);
    expect(await verifyLedgerCli(["ledger", join(tmp, "無い")], { packsDir: pd })).toBe(2);
    expect(await verifyLedgerCli(["ring", good], { packsDir: pd })).toBe(2);
    // 決まりのパックが無ければ 2
    expect(await verifyLedgerCli(["ledger", good], { packsDir: join(tmp, "空のパック") })).toBe(2);
  });

  it("端末に出す道の制御文字は ? にする（台帳に置いた人がファイル名で端末を操れないように）", () => {
    const r = verifyLedgerFiles(files([], [{ path: "ledger/ledger/\u001b[2Jx\u0007.txt", kind: "file", bytes: Buffer.from("x") }]), pack);
    const lines = formatLedger(r);
    for (const l of lines) expect(l).not.toMatch(/[\u0000-\u001f]/);
    expect(lines.join("\n")).toContain("ledger/ledger/?[2Jx?.txt");
  });

  it("束が 0 件でも、決まりが ✓ なら 0", async () => {
    expect(await verifyLedgerCli(["ledger", repo([])], { packsDir: packsDir() })).toBe(0);
  });

  it("小さな計画でも、台帳向けの束は人が受けた行だけ（案のままの行は写らない）", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.RESIDUE", { commonItemAccepted: false })],
      works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "INSPECT", ["a2"])],
      details: [detail("d1", "w1", 2016), detail("d2", "w1", 2018), detail("d3", "w2", 2017)],
    });
    const s = sealLedger(L, makeSigner(), p);
    expect(JSON.parse(s.text).body.chunks.map((c: { class: string }) => c.class)).toEqual(["T.FEED.LIFT"]);
  });
});
