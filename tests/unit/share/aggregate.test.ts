// 受け手とサイトの集計（docs/plan.md §2.8・§5.1 share.chart）。n の閾値（0〜2 は x、3〜4 は幅の帯と n、5 以上は中央・四分位の帯と n）、
// 自分を除く、集団を混ぜない、似た施設の見え方、匿名の札が鍵の指紋ごとに変わらないこと。
import { describe, expect, it } from "vitest";
import { aggregate, anonymousLabels, isSimilar, latestPerKey, sectionsOf, statCell, type PeerBundle } from "../../../src/share/aggregate";
import type { BundleBody } from "../../../src/share/bundle";
import type { Chunk } from "../../../src/share/copyout";
import type { Profile } from "../../../src/share/k";
import { keyIdOf, sha256Hex } from "../../../src/share/sign";
import { table } from "./fixtures";

const P: Profile = { group: "NATIONAL", stage: 0, axes: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" } };
const pubOf = (i: number) => sha256Hex(`架空の鍵 ${i}`);

function peer(i: number, chunks: Chunk[], profile: Profile = P, seq = 1): PeerBundle {
  const pub = pubOf(i);
  const key = keyIdOf(pub);
  const body = { v: "moyai.bundle/0", key, pub, seq, profile, chunks } as unknown as BundleBody;
  return { key, pub, body };
}
const ch = (o: Partial<Chunk> = {}): Chunk => ({ class: "T.FEED", work: "INSPECT", years: ["FY2016", "FY2017"], observed: "N2", interval: "I1", manDays: "W1_9", days: "D1_3", ...o });

describe("統計の行の n の閾値", () => {
  it("0〜2 は x、3〜4 は幅の帯と n、5 以上は中央・四分位の帯と n", () => {
    expect(statCell("interval", [])).toEqual({ shown: "x" });
    expect(statCell("interval", ["I1"])).toEqual({ shown: "x" });
    expect(statCell("interval", ["I1", "I3"])).toEqual({ shown: "x" });
    expect(statCell("interval", ["I3", "I1", "I2"])).toEqual({ shown: "range", n: 3, lo: "I1", hi: "I3" });
    expect(statCell("interval", ["I2", "I2", "I5", "I2"])).toEqual({ shown: "range", n: 4, lo: "I2", hi: "I5" });
    // 最近順位法：並べて ⌈p·n⌉ 番目。n=5 → 2・3・4 番目
    expect(statCell("manDays", ["W30_99", "W1_9", "W10_29", "W10_29", "W100_299"])).toEqual({ shown: "median", n: 5, q1: "W10_29", median: "W10_29", q3: "W30_99" });
    // n=8 → 2・4・6 番目（偶数でも実際にある帯）
    expect(statCell("days", ["D1_3", "D1_3", "D4_7", "D4_7", "D8_14", "D8_14", "D15_30", "D121P"])).toEqual({ shown: "median", n: 8, q1: "D1_3", median: "D4_7", q3: "D8_14" });
  });

  it("場の決まりで粗くした帯の順でも数える。知らないコードは数えない", () => {
    expect(statCell("interval", ["I1", "I2_3", "I2_3"], [1, 2, 4, 31])).toEqual({ shown: "range", n: 3, lo: "I1", hi: "I2_3" });
    expect(statCell("interval", ["I1", "I2", "知らない"])).toEqual({ shown: "x" });
  });
});

describe("似た施設と集計", () => {
  const peers = [
    peer(1, [ch(), ch({ class: "T.POWER", work: "OVERHAUL", years: ["FY2018"], observed: "N1", interval: undefined })]),
    peer(2, [ch({ interval: "I2" })]),
    peer(3, [ch({ interval: "I3", manDays: undefined })]),
    peer(4, [ch({ interval: "I2" })]),
    peer(5, [ch({ interval: "I2", years: ["FY2019", "FY2020"] })]),
    peer(6, [ch({ interval: "I1" })]),
  ];

  it("自分を除いて数え、塊ごと・欄ごとに n を数える", () => {
    const self = peers[0]!.key;
    const g = aggregate({ table, profile: P, self: [self], peers });
    expect(g.similar).toHaveLength(5);
    expect(g.similar.some((s) => s.key === self)).toBe(false);
    const feed = g.rows.find((r) => r.class === "T.FEED")!;
    expect(feed.peers).toHaveLength(5);
    expect(feed.stats.interval).toEqual({ shown: "median", n: 5, q1: "I2", median: "I2", q3: "I2" });
    expect(feed.stats.manDays).toEqual({ shown: "range", n: 4, lo: "W1_9", hi: "W1_9" });
    // 自分だけにある塊は行にならない
    expect(g.rows.find((r) => r.class === "T.POWER")).toBeUndefined();
    expect(g.years).toEqual(["FY2016", "FY2017", "FY2019", "FY2020"]);
    expect(g.belowFive).toBe(false);
  });

  it("サイト（自分なし）は全部を数え、1〜2 施設だけの塊は x", () => {
    const g = aggregate({ table, profile: P, self: [], peers });
    const power = g.rows.find((r) => r.class === "T.POWER")!;
    expect(power.peers).toHaveLength(1);
    expect(power.stats).toEqual({ interval: { shown: "x" }, manDays: { shown: "x" }, days: { shown: "x" } });
    expect(g.rows.find((r) => r.class === "T.FEED")!.stats.interval).toMatchObject({ shown: "median", n: 6 });
  });

  it("集団を混ぜない：OUTSIDE の束は、軸が同じでも数えない", () => {
    const outside = peer(9, [ch()], { ...P, group: "OUTSIDE" });
    const g = aggregate({ table, profile: P, self: [], peers: [...peers.slice(0, 2), outside] });
    expect(g.similar.map((s) => s.key)).not.toContain(outside.key);
    expect(isSimilar(table, P, outside.body.profile)).toBe(false);
    expect(g.belowFive).toBe(true);
    expect(g.belowShow).toBe(true);
  });

  it("似た施設の見え方：細かい相手は粗い受け手に入り、粗い相手は細かい受け手に入らない", () => {
    const coarse: Profile = { group: "NATIONAL", stage: 2, axes: { furnace: "STOKER", capacity_t_per_day: "C50_200" } };
    const fine: Profile = P;
    expect(isSimilar(table, coarse, fine)).toBe(true);
    expect(isSimilar(table, fine, coarse)).toBe(false);
    const other: Profile = { ...P, axes: { ...P.axes, capacity_t_per_day: "C400P" } };
    expect(isSimilar(table, coarse, other)).toBe(false);
    const stage3: Profile = { group: "NATIONAL", stage: 3, axes: {} };
    expect(isSimilar(table, stage3, fine)).toBe(true);
    expect(isSimilar(table, fine, stage3)).toBe(false);
  });

  it("鍵ごとに最新の束だけを使う", () => {
    const old = peer(1, [ch({ interval: "I5" })], P, 1);
    const cur = peer(1, [ch({ interval: "I1" })], P, 2);
    const l = latestPerKey([
      { key: old.key, body: cur.body },
      { key: old.key, body: old.body },
      { key: null, body: null },
    ]);
    expect(l).toHaveLength(1);
    expect(l[0]!.body.seq).toBe(2);
  });

  it("節：同じ見え方は 1 つにまとめる", () => {
    const other: Profile = { ...P, axes: { ...P.axes, contract: "OM" } };
    expect(sectionsOf([...peers, peer(7, [ch()], other), peer(8, [ch()], other)])).toHaveLength(2);
  });
});

describe("匿名の札", () => {
  it("鍵の指紋ごとに変わらない（ほかの施設が増えても、束が増えても）", () => {
    const a = anonymousLabels([pubOf(1), pubOf(2)]);
    const b = anonymousLabels([pubOf(3), pubOf(2), pubOf(1), pubOf(4)]);
    expect(a.get(pubOf(1))).toBe(b.get(pubOf(1)));
    expect(a.get(pubOf(2))).toBe(b.get(pubOf(2)));
    expect(a.get(pubOf(1))).toMatch(/^類似施設 [0-9A-Z]{4}$/);
  });

  it("指紋の頭がぶつかったときだけ延ばす", () => {
    const seen = new Map<string, string>();
    let pair: [string, string] | null = null;
    for (let i = 0; i < 200_000 && !pair; i++) {
      const p = sha256Hex(`ぶつかり ${i}`);
      const head = anonymousLabels([p]).get(p)!;
      const prev = seen.get(head);
      if (prev) pair = [prev, p];
      else seen.set(head, p);
    }
    expect(pair).not.toBeNull();
    const [x, y] = pair!;
    const l = anonymousLabels([x, y, pubOf(1)]);
    expect(l.get(x)).toMatch(/^類似施設 [0-9A-Z]{4}-[0-9A-Z]{4}/);
    expect(l.get(x)).not.toBe(l.get(y));
    expect(l.get(pubOf(1))).toMatch(/^類似施設 [0-9A-Z]{4}$/);
  });
});
