// 統計の行の言い方（src/share/stat-text.ts）：画面とサイトは「中央値」「四分位」「範囲」と、その値（階級の字）を出す（docs/words.md の置き換えの残り、Wire、11-06）。
import { describe, expect, it } from "vitest";
import { bandShort, spanShort, statText } from "../../../src/share/stat-text";

describe("統計の行の言い方", () => {
  it("階級の字：1 年・6〜7 年・1000 人・日以上", () => {
    expect(bandShort("I1")).toBe("1 年");
    expect(bandShort("I6_7")).toBe("6〜7 年");
    expect(bandShort("W1000P")).toBe("1000 人・日以上");
  });

  it("2 つの階級の間は、下の階級の下から上の階級の上まで", () => {
    expect(spanShort("I2", "I5")).toBe("2〜5 年");
    expect(spanShort("I2", "I6_7")).toBe("2〜7 年");
    expect(spanShort("I3", "I3")).toBe("3 年");
    expect(spanShort("W10_29", "W1000P")).toBe("10 人・日以上");
  });

  it("x・範囲と n・中央値と四分位と n。「帯」「幅」の字は出さない", () => {
    expect(statText({ shown: "x" })).toBe("x");
    expect(statText({ shown: "range", n: 3, lo: "I2", hi: "I5" })).toBe("範囲 2〜5 年・n 3");
    expect(statText({ shown: "median", n: 6, median: "I3", q1: "I2", q3: "I5" })).toBe("中央値 3 年（四分位 2〜5 年）・n 6");
    expect(statText({ shown: "median", n: 5, median: "I3", q1: "I3", q3: "I3" })).toBe("中央値 3 年（四分位も同じ）・n 5");
    for (const t of [statText({ shown: "range", n: 3, lo: "I2", hi: "I2" }), statText({ shown: "median", n: 6, median: "I3", q1: "I2", q3: "I5" })]) {
      expect(t).not.toMatch(/帯|幅/);
    }
  });
});
