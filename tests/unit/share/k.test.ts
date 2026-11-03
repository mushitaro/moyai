// share.k：境目の値、k < 5 で段が上がる、推せる属性で絞ると k が下がる、段 3 でも足りなければ送らない、分からない分類は出さない。
import { describe, expect, it } from "vitest";
import { BAND_DEFS, bandCodes, bandOf, intervalBand, observedBand, perVisitBand } from "../../../src/share/bands";
import {
  RECEIVE_MIN_K,
  SEND_MIN_K,
  chooseProfile,
  coarseOf,
  fineCodesOf,
  kNational,
  ladder,
  liftClass,
  loadNational,
  profileBandOf,
  statShown,
} from "../../../src/share/k";
import { FACILITY_COMMON, SPEC, table, vocab } from "./fixtures";

describe("share.k 境目の値", () => {
  it("帯のコードの一覧は §2.8 の初めの値の端と合う", () => {
    const i = bandCodes(BAND_DEFS.interval);
    const w = bandCodes(BAND_DEFS.manDays);
    const d = bandCodes(BAND_DEFS.days);
    expect([i[0], i.at(-1)]).toEqual(["I1", "I16_30"]);
    expect([w[0], w.at(-1)]).toEqual(["W1_9", "W1000P"]);
    expect([d[0], d.at(-1)]).toEqual(["D1_3", "D121P"]);
    for (const c of [...i, ...w, ...d]) expect(c).toMatch(/^[IWD]\d+(?:_\d+|P)?$/);
  });

  it("間隔・工数・日数は [下, 上)", () => {
    const I = BAND_DEFS.interval;
    expect(bandOf(I, 1)).toBe("I1");
    expect(bandOf(I, 5)).toBe("I5");
    expect(bandOf(I, 5.5)).toBe("I5");
    expect(bandOf(I, 6)).toBe("I6_7");
    expect(bandOf(I, 7.9)).toBe("I6_7");
    expect(bandOf(I, 8)).toBe("I8_10");
    expect(bandOf(I, 30)).toBe("I16_30");
    expect(bandOf(I, 31)).toBe(null);
    const W = BAND_DEFS.manDays;
    expect(bandOf(W, 0.5)).toBe("W1_9");
    expect(bandOf(W, 9.99)).toBe("W1_9");
    expect(bandOf(W, 10)).toBe("W10_29");
    expect(bandOf(W, 999)).toBe("W300_999");
    expect(bandOf(W, 1000)).toBe("W1000P");
    expect(bandOf(W, 0)).toBe(null);
    expect(bandOf(W, -3)).toBe(null);
    const D = BAND_DEFS.days;
    expect(bandOf(D, 3.9)).toBe("D1_3");
    expect(bandOf(D, 4)).toBe("D4_7");
    expect(bandOf(D, 120)).toBe("D61_120");
    expect(bandOf(D, 121)).toBe("D121P");
  });

  it("回数（経過年の帯は無い。どこにも出さない）", () => {
    expect(observedBand(1)).toBe("N1");
    expect(observedBand(2)).toBe("N2");
    expect(observedBand(3)).toBe("N3P");
    expect(observedBand(40)).toBe("N3P");
  });

  it("処理能力の帯：境目ちょうどは上の帯", () => {
    const key = "capacity_t_per_day";
    expect(profileBandOf(table, key, 49.9)).toBe("CLT50");
    expect(profileBandOf(table, key, 50)).toBe("C50_100");
    expect(profileBandOf(table, key, 99.99)).toBe("C50_100");
    expect(profileBandOf(table, key, 100)).toBe("C100_200");
    expect(profileBandOf(table, key, 400)).toBe("C400P");
    // 粗くすると、後ろから 1 つおきに境目を外す（50・200 が残る）
    expect(coarseOf(table, key, "C100_200")).toBe("C50_200");
    expect(coarseOf(table, key, "C400P")).toBe("C200P");
    expect(coarseOf(table, key, "CLT50")).toBe("CLT50");
    expect(fineCodesOf(table, key, "C200P")).toEqual(["C200_400", "C400P"]);
  });

  it("間隔は系統ごとに数えてから中央。N1 は間隔なし", () => {
    expect(intervalBand([[2016]])).toEqual({ band: null, reason: "single" });
    expect(intervalBand([[2016], [2016]])).toEqual({ band: null, reason: "single" });
    // 交互：系統 1 は 2016・2019・2022、系統 2 は 2017・2020・2023 → 系統の中の差は 3
    expect(intervalBand([[2016, 2019, 2022], [2017, 2020, 2023]]).band).toBe("I3");
    // 系統を混ぜて数えると 1 になる（してはいけない形の確かめ）
    expect(intervalBand([[2016, 2017, 2019, 2020, 2022, 2023]]).band).toBe("I1");
    expect(intervalBand([[2016], [2018]])).toEqual({ band: null, reason: "noRepeat" });
    expect(intervalBand([[1960, 2000]])).toEqual({ band: null, reason: "outOfRange" });
  });

  it("工数・日数は 1 回ごとの中央。まとめ工事と直せない値は使わない", () => {
    const r = perVisitBand("manDays", [
      { value: 12, bundled: false },
      { value: 20, bundled: false },
      { value: 500, bundled: true },
      { value: null, bundled: false },
      { value: 0, bundled: false },
    ]);
    expect(r).toEqual({ band: "W10_29", used: 2, bundled: 1, unconvertible: 2 });
    expect(perVisitBand("days", [{ value: 30, bundled: true }]).band).toBe(null);
  });
});

describe("share.k 段の順と k", () => {
  it("下限はコードの定数（送る側 5、受ける側 3）と統計の行の見せ方", () => {
    expect(SEND_MIN_K).toBe(5);
    expect(RECEIVE_MIN_K).toBe(3);
    expect([0, 2, 3, 4, 5, 9].map(statShown)).toEqual(["x", "x", "range", "range", "median", "median"]);
  });

  it("段の順は 1 本：後ろの軸から外す → 帯を粗く → 業種だけ。全国の表に無い軸は使わない", () => {
    const r = ladder(SPEC, table);
    expect(r.map((x) => [x.stage, x.kept.join("+"), x.coarse])).toEqual([
      [0, "furnace+capacity_t_per_day+turbine+ash+contract", false],
      [1, "furnace+capacity_t_per_day+turbine+ash", false],
      [1, "furnace+capacity_t_per_day+turbine", false],
      [2, "furnace+capacity_t_per_day", false],
      [2, "furnace+capacity_t_per_day", true],
      [3, "", false],
    ]);
  });

  it("k < 5 なら段が上がり、最初に届いた段で止まる", () => {
    const c = chooseProfile({
      table,
      vocab,
      spec: SPEC,
      facility: { furnace: "ROTARY", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" },
      group: "NATIONAL",
      classes: ["T.FEED.LIFT"],
    });
    expect(c.tried.map((t) => t.k)).toEqual([1, 2, 2, 2, 5]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.k).toBe(5);
    expect(c.profile).toEqual({ group: "NATIONAL", stage: 2, axes: { furnace: "ROTARY", capacity_t_per_day: "C200P" } });
  });

  it("届けば段 0 のまま", () => {
    const c = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: ["T.FEED.LIFT"] });
    expect(c.ok && c.profile.stage).toBe(0);
    expect(c.ok && c.k).toBe(22);
  });

  it("場の決まりの下限（上げるだけ）で段が上がる。下げる値は効かない", () => {
    const up = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: [], minK: 30 });
    expect(up.ok && up.k).toBeGreaterThanOrEqual(30);
    expect(up.tried[0]!.k).toBe(22);
    const tiny = { furnace: "ROTARY", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" };
    const down = chooseProfile({ table, vocab, spec: SPEC, facility: tiny, group: "NATIONAL", classes: [], minK: 1 });
    expect(down.ok && down.k).toBe(5);
  });

  it("推せる属性で絞ると k が下がる", () => {
    const axes = { furnace: "STOKER", capacity_t_per_day: "C100_200" };
    expect(kNational(table, vocab, axes, [], 2)).toBe(158);
    expect(kNational(table, vocab, axes, ["T.POWER.GEN"], 2)).toBe(64);
    expect(kNational(table, vocab, axes, ["T.FEED.LIFT"], 2)).toBe(158);
  });

  it("外した軸を推せる分類は、同じ段で上の分類へまとめる", () => {
    // 施設は灰を搬出（OUT）だが、溶融を推す分類がある → 灰の軸を外す段で、分類も上へまとめる
    const c = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: ["T.RESIDUE.MELT"] });
    expect(c.tried.map((t) => t.k)).toEqual([0, 0, 64]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.profile.stage).toBe(1);
    expect(c.lift.get("T.RESIDUE.MELT")).toBe("T.RESIDUE");
  });

  it("段 3 でも足りなければ送らない", () => {
    const tinyTable = loadNational(
      JSON.stringify({
        pack: "test-pack",
        source: { id: "TEST" },
        axes: [{ key: "furnace", codes: [{ code: "A" }, { code: "B" }] }],
        rows: [
          { furnace: "A", n: 2 },
          { furnace: "B", n: 2 },
        ],
        population: { active: 4 },
      }),
    );
    const c = chooseProfile({
      table: tinyTable,
      vocab,
      spec: { axes: [{ key: "furnace", tier: "primary" }] },
      facility: { furnace: "A" },
      group: "NATIONAL",
      classes: [],
    });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toBe("kShort");
    expect(c.tried.map((t) => [t.stage, t.k])).toEqual([
      [2, 2],
      [3, 4],
    ]);
  });

  it("分からない分類は出さない（出典の無い universal・推せない・全国の表に無い軸・語彙に無い）", () => {
    const none = new Set<string>();
    expect(liftClass(vocab, table, "T.LONE", none)).toBe(null);
    expect(liftClass(vocab, table, "T.UNIV.NOSRC", none)).toBe(null);
    expect(liftClass(vocab, table, "T.GAS.FILTER", none)).toBe(null);
    expect(liftClass(vocab, table, "X.NOT.IN.VOCAB", none)).toBe(null);
    // 数えられない分類は、数えられる上の分類まで上げる
    expect(liftClass(vocab, table, "T.FEED.ODD", none)).toBe("T.FEED");
    expect(liftClass(vocab, table, "T.POWER.GEN", none)).toBe("T.POWER.GEN");
    expect(liftClass(vocab, table, "T.POWER.GEN", new Set(["turbine"]))).toBe(null);
  });

  it("集団と見え方が決まらなければ送らない（件数を添えて人に返す）", () => {
    const g = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: null, classes: [] });
    expect(!g.ok && g.reason).toBe("groupUnknown");
    const p = chooseProfile({ table, vocab, spec: SPEC, facility: { ...FACILITY_COMMON, ash: null }, group: "NATIONAL", classes: [] });
    expect(!p.ok && p.reason).toBe("profileIncomplete");
    expect(!p.ok && p.missing).toEqual(["ash"]);
  });

  it("人は粗くすることだけができる（段の順の途中から始める）", () => {
    const c = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: [], fromRung: 3 });
    expect(c.ok && c.profile.axes).toEqual({ furnace: "STOKER", capacity_t_per_day: "C100_200" });
    expect(c.ok && c.rung).toBe(3);
  });
});
