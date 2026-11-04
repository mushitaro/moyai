// share.rules：circle.json で下限を下げる・欄を足す・帯を細かくする → 拒む。厳しくする変更は、人が受け入れるまで送らない。
import { describe, expect, it } from "vitest";
import { BAND_DEFS } from "../../../src/share/bands";
import { isClean, recount } from "../../../src/share/recount";
import { baseRules, checkRules, diffRules, rulesGate, type Rules } from "../../../src/share/rules";
import { previewBundle, sealBundle } from "../../../src/share/seal";
import { makeMember, makeRing, makeRingWith, sendInput, smallPlan, table, vocab } from "./fixtures";

describe("share.rules", () => {
  const base = baseRules(vocab.pack, vocab.hash, table.hash);

  it("コードの決まりそのものは通る（欄は間隔・工数・日数。経過年は無い）", () => {
    expect(checkRules(base)).toEqual([]);
    expect(base.fields).toEqual(["interval", "manDays", "days"]);
    const ring = makeRing();
    expect(isClean(recount(ring.circleText, ring.ctx))).toBe(true);
  });

  it("下限を下げる circle.json は拒む", () => {
    const low = makeRing({ minK: 3 });
    expect(checkRules(low.rules)).toEqual(["minKLowered"]);
    const r = recount(low.circleText, low.ctx);
    expect(r.reasons).toContain("shape.rules.minKLowered");
    expect(isClean(r)).toBe(false);
    expect(rulesGate(low.rules, low.ctx.rulesHash, low.ctx.rulesHash, low.rules)).toEqual({
      ok: false,
      reason: "loosened",
      violations: ["minKLowered"],
    });
  });

  it("許可リストに無い欄を足す circle.json は拒む", () => {
    const more = makeRing({ fields: [...base.fields, "cost" as never] });
    expect(checkRules(more.rules)).toContain("fieldUnknown");
    // 文脈の決まりそのものが形の外れなので、その文脈では何も数えない
    expect(recount(more.circleText, more.ctx).reasons).toEqual(["shape.contextRules.malformed"]);
    // コードの決まりの文脈で数え直すと、欄の外れと自由記述が出る
    const r = recount(more.circleText, { ...more.ctx, rules: base });
    expect(r.reasons).toContain("shape.type");
    expect(r.freeText).toBeGreaterThan(0); // 「cost」は公開語彙に無い
    expect(isClean(r)).toBe(false);
  });

  it("経過年の欄を許す circle.json は拒む（どこにも出さない欄。知らない欄とは分けて理由を出す）", () => {
    const old = makeRing({ fields: [...base.fields, "ageAtWork"] as unknown as Rules["fields"] });
    expect(checkRules(old.rules)).toEqual(["fieldRemoved"]);
    // 文脈の決まりそのものが形の外れ：数えずに、理由を分けて出す
    expect(recount(old.circleText, old.ctx).reasons).toEqual(["shape.contextRules.malformed", "shape.contextRules.fieldRemoved"]);
    // コードの決まりの文脈で数え直すと（受け手の readRing と同じ）、決まりの欄の外れが出る
    const r = recount(old.circleText, { ...old.ctx, rules: base });
    expect(r.reasons).toEqual(expect.arrayContaining(["shape.type", "shape.rules.fieldRemoved"]));
    expect(isClean(r)).toBe(false);
    // 送る側：人が受け入れたハッシュと同じでも、送らない
    expect(rulesGate(old.rules, old.ctx.rulesHash, old.ctx.rulesHash, old.rules)).toEqual({ ok: false, reason: "loosened", violations: ["fieldRemoved"] });
  });

  it("帯を細かくする（コードに無い境目を足す）circle.json は拒む。粗くするのは通る", () => {
    const finer = makeRing({ bands: { ...base.bands, interval: [1, 2, 3, 4, 5, 6, 7, 8, 11, 16, 31] } });
    expect(checkRules(finer.rules)).toEqual(["bandsFiner"]);
    expect(isClean(recount(finer.circleText, finer.ctx))).toBe(false);
    const coarser = makeRing({ bands: { ...base.bands, interval: [1, 2, 3, 4, 5, 11, 16, 31] } });
    expect(checkRules(coarser.rules)).toEqual([]);
    expect(isClean(recount(coarser.circleText, coarser.ctx))).toBe(true);
    // 最初と最後の境目は外せない
    const cut = { ...base, bands: { ...base.bands, days: BAND_DEFS.days.edges.slice(1) } };
    expect(checkRules(cut)).toEqual(["bandsFiner"]);
  });

  it("差を数える（緩くなった n、厳しくなった m）", () => {
    const strict: Rules = { ...base, minK: 7, fields: ["interval", "days"] };
    // 下限を上げた 1 と、外した欄（工数）1
    expect(diffRules(base, strict)).toEqual({ loosened: 0, tightened: 2, changed: 0 });
    expect(diffRules(strict, { ...strict, minK: 6 })).toEqual({ loosened: 1, tightened: 0, changed: 0 });
    expect(diffRules(base, { ...base, national: "f".repeat(64) })).toEqual({ loosened: 0, tightened: 0, changed: 1 });
  });

  it("厳しくする変更でも、人が受け入れるまで送らない。受け入れたあとは送れる", () => {
    const v1 = makeRing();
    const v2 = makeRingWith(v1.founder, v1.nonce, { minK: 6 }, 2);
    const m = makeMember(v2);
    const input = sendInput(v2, m, smallPlan());
    const pv = previewBundle(input);
    expect(pv.ok).toBe(true);
    if (!pv.ok) return;
    const args = {
      previewHash: pv.bodyHash,
      pair: m.pair,
      acceptedRulesHash: v1.ctx.rulesHash,
      acceptedRules: v1.rules,
      localWords: [],
      cells: [],
      folderPath: "/tmp/ring",
    };
    const refused = sealBundle(input, args);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("rules");
    expect(refused.rules).toEqual({ ok: false, reason: "notAccepted", diff: { loosened: 0, tightened: 1, changed: 0 } });
    // 人が画面で受け入れたら（覚えたハッシュが変わったら）送れる
    const accepted = sealBundle(input, { ...args, acceptedRulesHash: v2.ctx.rulesHash, acceptedRules: v2.rules });
    expect(accepted.ok).toBe(true);
  });

  it("場の決まりの下限を上げると、束の段が上がる", () => {
    const strict = makeRing({ minK: 30 });
    const m = makeMember(strict);
    const pv = previewBundle(sendInput(strict, m, smallPlan()));
    expect(pv.ok).toBe(true);
    if (!pv.ok) return;
    expect(pv.body.counts.k).toBeGreaterThanOrEqual(30);
    expect(pv.choice.tried[0]!.k).toBeLessThan(30);
    expect(pv.contentClean).toBe(true);
  });

  it("文脈の決まりが緩ければ、束も ✗（数え直しは引数で緩められない）", () => {
    const ring = makeRing();
    const m = makeMember(ring);
    const input = sendInput(ring, m, smallPlan());
    const pv = previewBundle(input);
    if (!pv.ok) throw new Error("プレビューができない");
    const s = sealBundle(input, {
      previewHash: pv.bodyHash,
      pair: m.pair,
      acceptedRulesHash: ring.ctx.rulesHash,
      acceptedRules: ring.rules,
      localWords: [],
      cells: [],
      folderPath: "/tmp/ring",
    });
    if (!s.ok) throw new Error("封ができない");
    const loose = recount(s.text, { ...ring.ctx, rules: { ...ring.rules, minK: 1 } });
    expect(loose.reasons).toContain("shape.contextRules.minKLowered");
    expect(isClean(loose)).toBe(false);
  });
});
