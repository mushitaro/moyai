// 帯の境目の決定（docs/sharing.md §1・§2）を、試験の実行から作り直して照らす。
// 境目・段の順の数・工場の正解の世界の塊の帯は、記録（tests/fixtures/share/bands-decision.json）と同じでなければ落ちる。
// 境目を変えたら、BANDS_VERSION と記録と docs/sharing.md を同じ変更で直す。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANDS_VERSION, BAND_DEFS, ageBand, bandOf } from "../../../src/share/bands";
import { LEDGER_WITHHELD_FIELDS } from "../../../src/share/copyout";
import { SEND_MIN_K } from "../../../src/share/k";
import { decidedEdges, ladderCounts, measureWorld } from "./bands-measure";
import { ROOT } from "./fixtures";

const D = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "share", "bands-decision.json"), "utf8"));
const DOC = readFileSync(join(ROOT, "docs", "sharing.md"), "utf8");

describe("帯の境目の決定", () => {
  it("コードの境目と版は、決めた記録と同じ", () => {
    expect(BANDS_VERSION).toBe(D.bandsVersion);
    expect(decidedEdges()).toEqual(D.edges);
    expect([...LEDGER_WITHHELD_FIELDS]).toEqual(D.ledgerWithheld);
  });

  it("文書に、版と境目と測った数が書いてある", () => {
    expect(DOC).toContain(`\`${D.bandsVersion}\``);
    expect(DOC).toContain(D.edges.interval.join("・"));
    expect(DOC).toContain(D.edges.manDays.join("・"));
    expect(DOC).toContain(D.edges.days.join("・"));
    for (const w of Object.values(D.startYear.window) as { belowK: number }[]) expect(DOC).toContain(`| ${w.belowK} |`);
    for (const r of D.ladder.rungs as { facilities: number }[]) expect(DOC).toContain(`| ${r.facilities} |`);
  });

  it("境目ちょうどは上の帯、境目のすぐ下は下の帯", () => {
    const cases: [keyof typeof BAND_DEFS, number, string | null][] = [
      ["interval", 1, "I1"],
      ["interval", 5, "I5"],
      ["interval", 6, "I6_7"],
      ["interval", 7.5, "I6_7"],
      ["interval", 8, "I8_10"],
      ["interval", 30.5, "I16_30"],
      ["interval", 31, null],
      ["manDays", 0.5, "W1_9"],
      ["manDays", 9.99, "W1_9"],
      ["manDays", 10, "W10_29"],
      ["manDays", 29.5, "W10_29"],
      ["manDays", 30, "W30_99"],
      ["manDays", 1000, "W1000P"],
      ["days", 3.5, "D1_3"],
      ["days", 4, "D4_7"],
      ["days", 14, "D8_14"],
      ["days", 15, "D15_30"],
      ["days", 121, "D121P"],
    ];
    for (const [f, v, want] of cases) expect([f, v, bandOf(BAND_DEFS[f], v)]).toEqual([f, v, want]);
    expect(ageBand(19, "OVERHAUL")).toBe("A15_19");
    expect(ageBand(20, "OVERHAUL")).toBe("A20_24");
    expect(ageBand(29, "UPGRADE")).toBe("A20_29");
    expect(ageBand(45, "INSPECT")).toBe("A40P");
  });

  it("紛れる数の段の順：見え方だけで、どの段で k ≥ 5 に届くか（全国の表から）", () => {
    expect(ladderCounts()).toEqual(D.ladder);
    // 元の表を読んだ道具（Python）の段の数も、コードの段の順と同じ
    expect(D.ladder.rungs.map((r: { facilities: number }) => r.facilities)).toEqual(D.startYear.rungFacilities);
  });

  for (const id of ["fictional-1", "fictional-2"]) {
    it(`工場の正解の世界 ${id}：塊の帯と、帯にする前の値`, () => {
      expect(measureWorld(`samples/truth/waste-incineration/${id}/world.json`)).toEqual(D.truth[id]);
    });
  }

  it("決めた理由が数で保たれている：間隔の 1・2・3 年は別の帯、工数と日数は作業の重さで帯が分かれる", () => {
    for (const id of ["fictional-1", "fictional-2"]) {
      const t = D.truth[id];
      for (const y of [1, 2, 3]) expect(t.intervalRaw).toContain(y);
      expect(Object.keys(t.interval)).toEqual(expect.arrayContaining(["I1", "I2", "I3"]));
      expect(Object.keys(t.manDays).length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(t.days).length).toBe(3);
    }
  });

  it("経過年を台帳に出さない理由：年度と合わせると設置の年度が 5 年以内に絞れ、全国の表の使用開始の年で多くの施設が 5 未満に落ちる", () => {
    for (const id of ["fictional-1", "fictional-2"]) {
      const t = D.truth[id];
      const [lo, hi] = t.installWindowFromRing as [number, number];
      expect(hi - lo + 1).toBeLessThanOrEqual(5);
      // 読めた幅は正解の設置の年度を含む
      expect(lo).toBeLessThanOrEqual(t.installFiscalYears[0]);
      expect(hi).toBeGreaterThanOrEqual(t.installFiscalYears[0]);
      // 台帳の束には出ない
      expect(t.ageLedger).toBe(0);
      expect(t.ledgerWithheld).toBe(t.chunks.ledger);
    }
    const w = D.startYear.window;
    expect(D.startYear.kMin).toBe(SEND_MIN_K);
    // 5 年の幅で 4 割を超える施設が 5 未満、10 年に広げても 2 割を超える
    expect(w.pm2.belowK / D.startYear.facilities).toBeGreaterThan(0.4);
    expect(w.block10.belowK / D.startYear.facilities).toBeGreaterThan(0.2);
  });
});
