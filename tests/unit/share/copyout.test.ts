// share.grain と share.stable：写し取りの粒度と、送るたびに変わらないこと。
// 経過年（ageAtWork）は 2026-11-03 にどこにも出さないと決めた：輪にも台帳にも写らず、受け手はこの欄のある束を ✗ にする。
import { describe, expect, it } from "vitest";
import { envelopeText } from "../../../src/share/bundle";
import { canonicalize } from "../../../src/share/jcs";
import {
  CHUNK_FIELDS,
  OMIT_REASONS,
  REMOVED_CHUNK_FIELDS,
  SKIP_REASONS,
  candidateClasses,
  copyOut,
  fiscalYearOf,
  installFiscalRange,
  type CopyResult,
} from "../../../src/share/copyout";
import { chooseProfile } from "../../../src/share/k";
import { isClean, recount } from "../../../src/share/recount";
import { previewBundle } from "../../../src/share/seal";
import { signBody } from "../../../src/share/sign";
import { FACILITY_COMMON, SPEC, asset, detail, makeMember, makeRing, plan, sendInput, smallPlan, table, vocab, work } from "./fixtures";
import type { Plan } from "../../../src/shared/plan";

function liftFor(p: Plan) {
  const c = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: candidateClasses(p) });
  if (!c.ok) throw new Error("段が決まらない");
  return c;
}

function sumSkipped(r: CopyResult): number {
  return Object.values(r.skipped).reduce((s, n) => s + n, 0);
}

describe("share.grain", () => {
  const p = plan({
    assets: [
      asset("a1", "T.FEED.LIFT", { series: "1号炉", tag: "LIFT-1", name: "架空の昇降機 1 号" }),
      asset("a2", "T.FEED.LIFT", { series: "2号炉", tag: "LIFT-2" }),
      asset("a3", "T.POWER.GEN"),
      asset("a4", "T.FEED.LIFT", { commonItemAccepted: false, commonItemAuthor: "ai" }),
      asset("a5", null),
    ],
    works: [
      work("w1", "OVERHAUL", ["a1"], { contractor: "架空工業株式会社" }),
      work("w2", "OVERHAUL", ["a2"]),
      work("w3", "OVERHAUL", ["a1", "a2"]), // まとめ工事
      work("w4", "INSPECT", ["a3"]),
      work("w5", null, ["a3"]),
      work("w6", "OVERHAUL", ["a4"]),
      work("w7", "OVERHAUL", ["a5"]),
      work("w8", "REPLACE", ["a3"], { tagRange: "G-1A/B" }),
    ],
    details: [
      detail("d1", "w1", 2016, { cost: 12_340_000, manDays: 12, days: 5, startDate: "2016-07-12", endDate: "2016-07-16", performer: "架空 太郎" }),
      detail("d2", "w1", 2019, { cost: 9_800_000, manDays: 16, days: 7 }),
      detail("d3", "w2", 2017, { manDays: null, days: 6, resultValue: "架空の備考：軸受を交換" }),
      detail("d4", "w3", 2020, { manDays: 400, days: 30 }),
      detail("d5", "w4", 2018, { manDays: 2, days: 1 }),
      detail("d6", "w5", 2018),
      detail("d7", "w6", 2018),
      detail("d8", "w7", 2018),
      detail("d9", "w4", 2021, { planOrActual: "plan" }),
      detail("d10", "w4", 2019, { needsReview: true }),
      detail("d11", "w8", 2022, { manDays: 3, days: 2 }),
    ],
  });
  const c = liftFor(p);
  const r = copyOut({ plan: p, lift: c.lift, to: { kind: "ring", id: "0123456789abcdef" } });
  const text = canonicalize(r.chunks);

  it("費用・号炉の番号・人・日付・業者・備考・名前は束に出ず、欄ごと写さなかった数に数える", () => {
    for (const s of ["12340000", "9800000", "1号炉", "2号炉", "架空", "LIFT-1", "2016-07-12", "軸受"]) expect(text).not.toContain(s);
    expect(r.withheld.cost).toBe(2);
    expect(r.withheld.series).toBe(2);
    expect(r.withheld.performer).toBe(1);
    expect(r.withheld.dates).toBe(1);
    expect(r.withheld.contractor).toBe(1);
    expect(r.withheld.notes).toBe(1);
    expect(r.withheld.names).toBe(6); // 資産 5 つと施設
    expect(r.withheld.installed).toBe(5); // 設置の年も写さない（経過年はどこにも出さない）
  });

  it("塊は許可リストの欄だけ。経過年は許可リストに無く、輪にも台帳にも出ない", () => {
    for (const ch of r.chunks) for (const k of Object.keys(ch)) expect(CHUNK_FIELDS as readonly string[]).toContain(k);
    const ledger = copyOut({ plan: p, lift: c.lift, to: { kind: "ledger", id: "0123456789abcdef" } });
    for (const out of [r, ledger]) {
      expect(out.chunks.length).toBeGreaterThan(0);
      for (const ch of out.chunks) for (const f of REMOVED_CHUNK_FIELDS) expect(Object.hasOwn(ch, f)).toBe(false);
      expect(canonicalize(out.chunks)).not.toContain("ageAtWork");
    }
    for (const f of REMOVED_CHUNK_FIELDS) expect(CHUNK_FIELDS as readonly string[]).not.toContain(f);
    // 経過年を出さなかった理由の数も無い（作り手が無いので、数えるものも無い）
    expect(OMIT_REASONS.some((x) => x.startsWith("age"))).toBe(false);
  });

  it("まとめ工事と人・日に直せない工数は、工数と日数の中央に使わず、理由に数える", () => {
    const lift = r.chunks.find((x) => x.class === "T.FEED.LIFT" && x.work === "OVERHAUL")!;
    expect(lift.years).toEqual(["FY2016", "FY2017", "FY2019", "FY2020"]);
    // 使える工数は d1（12）と d2（16）だけ → 中央 14
    expect(lift.manDays).toBe("W10_29");
    // 日数は d1（5）・d2（7）・d3（6）→ 中央 6
    expect(lift.days).toBe("D4_7");
    // まとめ工事の回は d4（2 つの機器）と d11（範囲のタグ）
    expect(r.omitted.manDaysBundled).toBe(2);
    expect(r.omitted.manDaysUnconvertible).toBe(1);
    expect(r.omitted.daysBundled).toBe(2);
    // 範囲のタグの作業もまとめ工事
    const rep = r.chunks.find((x) => x.class === "T.POWER.GEN" && x.work === "REPLACE")!;
    expect(rep.manDays).toBeUndefined();
    expect(rep.days).toBeUndefined();
  });

  it("写さなかった行を理由ごとに数え、行の総数と合う", () => {
    expect(r.skipped.notAccepted).toBe(1);
    expect(r.skipped.commonItemUndecided).toBe(1);
    expect(r.skipped.attributeUndecided).toBe(1);
    expect(r.skipped.planned).toBe(1);
    expect(r.skipped.needsReview).toBe(1);
    expect(r.copied + sumSkipped(r)).toBe(r.rows);
    expect(Object.keys(r.skipped).sort()).toEqual([...SKIP_REASONS].sort());
  });

  it("UPGRADE は公開の台帳に出さず、輪では k が下限に届くときだけ", () => {
    const q = plan({
      assets: [asset("a1", "T.FEED.LIFT")],
      works: [work("w1", "UPGRADE", ["a1"]), work("w2", "OVERHAUL", ["a1"])],
      details: [detail("d1", "w1", 2015), detail("d2", "w2", 2016)],
    });
    const l = liftFor(q).lift;
    const ledger = copyOut({ plan: q, lift: l, to: { kind: "ledger", id: "0123456789abcdef" } });
    expect(ledger.chunks.map((x) => x.work)).toEqual(["OVERHAUL"]);
    expect(ledger.skipped.upgradeLedger).toBe(1);
    const ringLow = copyOut({ plan: q, lift: l, to: { kind: "ring", id: "0123456789abcdef" }, ringK: 4 });
    expect(ringLow.skipped.upgradeBelowK).toBe(1);
    const ringOk = copyOut({ plan: q, lift: l, to: { kind: "ring", id: "0123456789abcdef" }, ringK: 5 });
    expect(ringOk.chunks.map((x) => x.work)).toEqual(["OVERHAUL", "UPGRADE"]);
  });

  it("数えられない分類の行は出さず、数えられる上の分類へまとめる", () => {
    const q = plan({
      assets: [asset("a1", "T.LONE"), asset("a2", "T.FEED.ODD"), asset("a3", "T.FEED")],
      works: [work("w1", "INSPECT", ["a1"]), work("w2", "INSPECT", ["a2"]), work("w3", "INSPECT", ["a3"])],
      details: [detail("d1", "w1", 2016), detail("d2", "w2", 2017), detail("d3", "w3", 2018)],
    });
    const out = copyOut({ plan: q, lift: liftFor(q).lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(out.skipped.classNotCountable).toBe(1);
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0]!.class).toBe("T.FEED");
    expect(out.chunks[0]!.years).toEqual(["FY2017", "FY2018"]);
  });

  it("場の決まりが外した欄は写らない", () => {
    const out = copyOut({ plan: p, lift: c.lift, to: { kind: "ring", id: "0123456789abcdef" }, rules: { fields: ["interval"], bands: {} } });
    for (const ch of out.chunks) {
      expect(ch.manDays).toBeUndefined();
      expect(ch.days).toBeUndefined();
    }
    expect(out.omitted.fieldNotAllowed).toBe(out.chunks.length * 2);
  });
});

describe("share.stable", () => {
  function history(lastFy: number): Plan {
    const details = [];
    // 系統 1 と 2 が交互に 3 年ごと
    for (let y = 2010; y <= lastFy; y++) {
      if ((y - 2010) % 3 === 0) details.push(detail(`s1-${y}`, "w1", y, { manDays: 20, days: 10 }));
      if ((y - 2011) % 3 === 0) details.push(detail(`s2-${y}`, "w2", y, { manDays: 22, days: 12 }));
    }
    details.push(detail("one", "w3", 2012, { manDays: 4, days: 2 }));
    return plan({
      assets: [
        asset("a1", "T.FEED.LIFT", { series: "1号炉", installedOn: "1998-04-01" }),
        asset("a2", "T.FEED.LIFT", { series: "2号炉", installedOn: "1998-04-01" }),
        asset("a3", "T.POWER.GEN", { installedOn: "2000-03-31" }),
      ],
      works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a2"]), work("w3", "REPLACE", ["a3"])],
      details,
    });
  }

  it("同じ施設を 1 年ずらして 2 回送っても、見え方と塊の帯が変わらない（経過年は出ない）", () => {
    const p1 = history(2024);
    const p2 = history(2025);
    const c1 = liftFor(p1);
    const c2 = liftFor(p2);
    expect(c2.profile).toEqual(c1.profile);
    const r1 = copyOut({ plan: p1, lift: c1.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    const r2 = copyOut({ plan: p2, lift: c2.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    const bands = (r: CopyResult) => r.chunks.map(({ years: _years, ...rest }) => rest);
    expect(bands(r2)).toEqual(bands(r1));
    const { years: _y, ...ov } = r1.chunks.find((x) => x.work === "OVERHAUL")!;
    expect(ov).toEqual({ class: "T.FEED.LIFT", work: "OVERHAUL", observed: "N3P", interval: "I3", manDays: "W10_29", days: "D8_14" });
    // 年度の一覧は伸びる（星取表の列）
    expect(r2.chunks[0]!.years.length).toBeGreaterThan(r1.chunks[0]!.years.length);
  });

  it("号炉が交互でも間隔が半分にならない", () => {
    const r = copyOut({ plan: history(2024), lift: liftFor(history(2024)).lift, to: { kind: "ring", id: "0123456789abcdef" } });
    const ov = r.chunks.find((x) => x.work === "OVERHAUL")!;
    expect(ov.interval).toBe("I3");
    expect(ov.observed).toBe("N3P");
  });

  it("N1 の行には間隔が無い", () => {
    const r = copyOut({ plan: history(2024), lift: liftFor(history(2024)).lift, to: { kind: "ring", id: "0123456789abcdef" } });
    const one = r.chunks.find((x) => x.work === "REPLACE")!;
    expect(one.observed).toBe("N1");
    expect(one.interval).toBeUndefined();
    expect(r.omitted.intervalSingle).toBe(1);
  });

  it("年度の出し方（4 月始まり）。読めない書き方は推測しない", () => {
    expect(fiscalYearOf("2000-03-31", 4)).toBe(1999);
    expect(fiscalYearOf("2000-04-01", 4)).toBe(2000);
    expect(fiscalYearOf("2000-04", 4)).toBe(2000);
    expect(fiscalYearOf("FY2003", 4)).toBe(2003);
    expect(fiscalYearOf("2000", 4)).toBe(null);
    expect(fiscalYearOf("平成12年", 4)).toBe(null);
  });

  it("設置の年は、どの書き方でも写さず、欄ごと写さなかった数に数える（経過年はどこにも出さない）", () => {
    // 設置の文字の読み方（測りが使う。写し取りは使わない）：年だけは暦年か年度かが決まらないので幅にする
    expect(installFiscalRange("2002", 4)).toEqual([2001, 2002]);
    expect(installFiscalRange("2002", 1)).toEqual([2002, 2002]);
    expect(installFiscalRange("2002-05-01", 4)).toEqual([2002, 2002]);
    expect(installFiscalRange("平成14年", 4)).toBe(null);
    const mk = (installedOn: string | null, firstFy: number) =>
      plan({
        assets: [asset("a1", "T.FEED.LIFT", { installedOn })],
        works: [work("w1", "OVERHAUL", ["a1"])],
        details: [detail("d1", "w1", firstFy, { manDays: 20, days: 10 }), detail("d2", "w1", firstFy + 3, { manDays: 20, days: 10 })],
      });
    const cases: [string, number][] = [
      ["2002", 2014],
      ["2002", 2011],
      ["2015", 2014],
      ["2016", 2014],
      ["2002-05-01", 2014],
    ];
    for (const to of [{ kind: "ring", id: "0123456789abcdef" }, { kind: "ledger", id: "0123456789abcdef" }] as const) {
      for (const [installedOn, firstFy] of cases) {
        const q = mk(installedOn, firstFy);
        const r = copyOut({ plan: q, lift: liftFor(q).lift, to });
        expect(Object.keys(r.chunks[0]!).sort()).toEqual(["class", "days", "interval", "manDays", "observed", "work", "years"]);
        expect(canonicalize(r.chunks)).not.toContain(installedOn.slice(0, 4));
        expect(r.withheld.installed).toBe(1);
      }
      const none = mk(null, 2014);
      expect(copyOut({ plan: none, lift: liftFor(none).lift, to }).withheld.installed).toBe(0);
    }
  });
});

describe("share.grain（経過年の欄がある束は、受け手が ✗ にする）", () => {
  it("輪の束の塊に経過年を足して署名し直すと、数え直しが理由つきで ✗（shape.fieldRemoved）", () => {
    const ring = makeRing();
    const m = makeMember(ring);
    const pv = previewBundle(sendInput(ring, m, smallPlan()));
    if (!pv.ok) throw new Error(`プレビューができない: ${pv.reason}`);
    const sign = (body: unknown) => envelopeText(body, signBody(body, m.pair.privateKey));
    // 写し取りが作った束はそのまま ✓（経過年は無い）
    expect(canonicalize(pv.body)).not.toContain("ageAtWork");
    expect(isClean(recount(sign(pv.body), ring.ctx))).toBe(true);
    // 前の版の写し取りが作っていた形（経過年の帯つき）に書き換える
    const body = JSON.parse(canonicalize(pv.body)) as { chunks: Record<string, unknown>[] };
    body.chunks[0]!.ageAtWork = "A15_19";
    const r = recount(sign(body), ring.ctx);
    expect(isClean(r)).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(["shape.fieldRemoved", "shape.type"]));
    // 署名と鎖は正しい（外れは中身だけ）
    expect(r.chain).toBe(0);
  });
});

describe("share.grain（入れ子の作業）", () => {
  it("まとめ工事の子の作業は、人・日に直せないではなく、まとめ工事に数える", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.FEED.LIFT")],
      works: [
        work("parent", "OVERHAUL", ["a1", "a2"]),
        work("c1", "OVERHAUL", ["a1"], { parentWorkKey: "parent" }),
        work("c2", "OVERHAUL", ["a2"], { parentWorkKey: "parent" }),
      ],
      details: [
        detail("dp", "parent", 2015, { manDays: 40, days: 20 }),
        detail("d1", "c1", 2015, { manDays: null, days: null }),
        detail("d2", "c2", 2015, { manDays: null, days: null }),
      ],
    });
    const r = copyOut({ plan: p, lift: liftFor(p).lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.omitted.manDaysUnconvertible).toBe(0);
    expect(r.omitted.daysUnconvertible).toBe(0);
    expect(r.omitted.manDaysBundled).toBe(3);
    expect(r.omitted.daysBundled).toBe(3);
    expect(r.chunks[0]!.manDays).toBeUndefined();
    expect(r.chunks[0]!.days).toBeUndefined();
  });

  it("入れ子の子が自分の工数を持つなら、その値を使う（親から割らない）", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.FEED.LIFT")],
      works: [
        work("parent", "OVERHAUL", ["a1", "a2"]),
        work("c1", "OVERHAUL", ["a1"], { parentWorkKey: "parent" }),
        work("c2", "OVERHAUL", ["a2"], { parentWorkKey: "parent" }),
      ],
      details: [
        detail("dp", "parent", 2015, { manDays: 40, days: 20 }),
        detail("d1", "c1", 2015, { manDays: 20, days: null }),
        detail("d2", "c2", 2015, { manDays: 20, days: null }),
      ],
    });
    const r = copyOut({ plan: p, lift: liftFor(p).lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.omitted.manDaysBundled).toBe(1);
    expect(r.omitted.daysBundled).toBe(3);
    expect(r.chunks[0]!.manDays).toBeDefined();
  });
});
