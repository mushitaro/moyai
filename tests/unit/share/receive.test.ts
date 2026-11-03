// 受け手の側の 3 つの立場（docs/plan.md §2.8・§5.1 share.chart）。
// 立場で変わるのは並べる場の組と見え方の出どころだけ、場をまたいで混ぜない、台帳は全国の表に載る施設だけ、
// 見せる下限（3）に届かない場は行を出さない、軸を足すと似た施設が減る。
import { describe, expect, it } from "vitest";
import type { PeerBundle } from "../../../src/share/aggregate";
import type { BundleBody } from "../../../src/share/bundle";
import type { Chunk } from "../../../src/share/copyout";
import type { Profile } from "../../../src/share/k";
import { compare, defaultAxes, receiverProfile, POSITION_PLACES, PROFILE_FROM, type Place } from "../../../src/share/receive";
import { keyIdOf, sha256Hex } from "../../../src/share/sign";
import { FACILITY_COMMON, SPEC, table } from "./fixtures";

const FULL: Profile = { group: "NATIONAL", stage: 0, axes: { ...FACILITY_COMMON } };
const ch = (o: Partial<Chunk> = {}): Chunk => ({ class: "T.FEED", work: "INSPECT", years: ["FY2018", "FY2019"], observed: "N2", interval: "I1", manDays: "W1_9", days: "D1_3", ...o });

function peer(tag: string, profile: Profile = FULL, chunks: Chunk[] = [ch()]): PeerBundle {
  const pub = sha256Hex(`架空の鍵 ${tag}`);
  const key = keyIdOf(pub);
  return { key, pub, body: { v: "moyai.bundle/0", key, pub, seq: 1, profile, chunks } as unknown as BundleBody };
}
const many = (tag: string, n: number, profile: Profile = FULL, chunks?: Chunk[]) => Array.from({ length: n }, (_, i) => peer(`${tag}${i}`, profile, chunks));

const answers = { facility: { ...FACILITY_COMMON }, inNationalTable: true };

describe("受け手の見え方", () => {
  it("人が選んだ軸だけで見え方を作る。段は残した軸の層から", () => {
    expect(receiverProfile(SPEC, table, answers, ["furnace", "capacity_t_per_day"])).toEqual({
      ok: true,
      profile: { group: "NATIONAL", stage: 2, axes: { furnace: "STOKER", capacity_t_per_day: "C100_200" } },
    });
    expect(receiverProfile(SPEC, table, answers, ["furnace", "turbine"])).toMatchObject({ ok: true, profile: { stage: 1 } });
    expect(receiverProfile(SPEC, table, answers, ["furnace", "contract"])).toMatchObject({ ok: true, profile: { stage: 0 } });
    expect(receiverProfile(SPEC, table, answers, [])).toEqual({ ok: true, profile: { group: "NATIONAL", stage: 3, axes: {} } });
    expect(receiverProfile(SPEC, table, { ...answers, inNationalTable: false }, ["furnace"])).toMatchObject({ ok: true, profile: { group: "OUTSIDE" } });
  });

  it("全国の表に載るかが決まらない・知らない軸・答えの無い軸は作らない（推測で埋めない）", () => {
    expect(receiverProfile(SPEC, table, { ...answers, inNationalTable: null }, ["furnace"])).toEqual({ ok: false, reason: "groupUnknown" });
    expect(receiverProfile(SPEC, table, answers, ["知らない軸"])).toEqual({ ok: false, reason: "axisUnknown" });
    expect(receiverProfile(SPEC, table, { ...answers, facility: { ...answers.facility, turbine: null } }, ["turbine"])).toEqual({ ok: false, reason: "axisUnanswered" });
  });

  it("最初に選ぶ軸は、主要の軸のうち答えのあるもの", () => {
    expect(defaultAxes(SPEC, table, answers)).toEqual(SPEC.axes.filter((a) => a.tier === "primary").map((a) => a.key));
    expect(defaultAxes(SPEC, table, { ...answers, facility: { ...answers.facility, furnace: null } })).not.toContain("furnace");
  });
});

describe("3 つの立場", () => {
  const ledger: Place = { kind: "ledger", id: "317f291617ec26bb", peers: many("台帳", 6), self: null };
  const ring: Place = { kind: "ring", id: "0123456789abcdef", peers: many("輪", 4, FULL, [ch({ interval: "I3" })]), self: null };

  it("立場で変わるのは並べる場の組と見え方の出どころだけ", () => {
    expect(POSITION_PLACES).toEqual({ municipal: ["ledger"], subsidiary: ["ring", "ledger"], om: ["ledger", "ring"] });
    expect(PROFILE_FROM).toEqual({ municipal: "self", subsidiary: "self", om: "target" });
    const m = compare({ table, position: "municipal", profile: FULL, places: [ledger, ring] });
    expect(m.places.map((p) => [p.kind, p.status])).toEqual([["ledger", "shown"]]);
    const s = compare({ table, position: "subsidiary", profile: FULL, places: [ledger, ring] });
    expect(s.places.map((p) => [p.kind, p.status])).toEqual([["ring", "shown"], ["ledger", "shown"]]);
    const o = compare({ table, position: "om", profile: FULL, places: [ring, ledger] });
    expect(o.places.map((p) => p.kind)).toEqual(["ledger", "ring"]);
  });

  it("場をまたいで混ぜない：統計の n は場ごと", () => {
    const s = compare({ table, position: "subsidiary", profile: FULL, places: [ledger, ring] });
    const [r, l] = s.places;
    if (r?.status !== "shown" || l?.status !== "shown") throw new Error("両方の場が出るはず");
    expect(r.agg.rows[0]!.stats.interval).toEqual({ shown: "range", n: 4, lo: "I3", hi: "I3" });
    expect(l.agg.rows[0]!.stats.interval).toEqual({ shown: "median", n: 6, q1: "I1", median: "I1", q3: "I1" });
  });

  it("自分の鍵は数えない（輪で自分の束がある場合）", () => {
    const mine = peer("自分");
    const r: Place = { ...ring, peers: [...ring.peers, mine], self: mine.key };
    const s = compare({ table, position: "subsidiary", profile: FULL, places: [r] });
    expect(s.places[0]).toMatchObject({ status: "shown" });
    if (s.places[0]?.status === "shown") expect(s.places[0].agg.similar.map((x) => x.key)).not.toContain(mine.key);
  });

  it("台帳は全国の表に載る施設だけ：載らない見え方とは比べない（輪とは比べる）", () => {
    const outside: Profile = { ...FULL, group: "OUTSIDE" };
    const ringOut: Place = { ...ring, peers: many("輪の外", 3, outside) };
    const o = compare({ table, position: "om", profile: outside, places: [ledger, ringOut] });
    expect(o.places.map((p) => p.status)).toEqual(["outsideGroup", "shown"]);
  });

  it("見せる下限（3）に届かない場は行を出さず、数だけ", () => {
    const small: Place = { ...ledger, peers: many("少ない", 2) };
    const m = compare({ table, position: "municipal", profile: FULL, places: [small] });
    expect(m.places).toEqual([{ kind: "ledger", id: ledger.id, status: "belowShow", similar: 2 }]);
  });

  it("軸を足すと似た施設が減り、外すと増える", () => {
    const other: Profile = { ...FULL, axes: { ...FULL.axes, contract: "OM" } };
    const mixed: Place = { ...ledger, peers: [...many("単年度", 3), ...many("O&M", 3, other)] };
    const wide = receiverProfile(SPEC, table, answers, ["furnace", "capacity_t_per_day"]);
    const narrow = receiverProfile(SPEC, table, answers, ["furnace", "capacity_t_per_day", "contract"]);
    if (!wide.ok || !narrow.ok) throw new Error("見え方が作れるはず");
    const w = compare({ table, position: "municipal", profile: wide.profile, places: [mixed] }).places[0];
    const n = compare({ table, position: "municipal", profile: narrow.profile, places: [mixed] }).places[0];
    expect(w).toMatchObject({ status: "shown" });
    if (w?.status === "shown") expect(w.agg.similar).toHaveLength(6);
    expect(n).toMatchObject({ status: "shown" });
    if (n?.status === "shown") {
      expect(n.agg.similar).toHaveLength(3);
      expect(n.agg.belowFive).toBe(true);
    }
  });

  it("場がまだ無いときは missing（輪に入っていない、台帳の場所を選んでいない）", () => {
    const s = compare({ table, position: "subsidiary", profile: FULL, places: [] });
    expect(s.places).toEqual([
      { kind: "ring", id: null, status: "missing" },
      { kind: "ledger", id: null, status: "missing" },
    ]);
  });
});
