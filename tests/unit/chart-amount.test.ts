// 星取表の金額の表示（mushitaro/moyai#48）：セルの金額は、実績の合計があれば実績、無ければ予算の合計。字は千円で 3 桁の区切り。
// 金額は当施設の画面の中だけ（共有ファイル・公開台帳・AI のツールの結果に出ないことは tests/unit/cross/cost-sentinel.test.ts が見る）。
import { describe, expect, it } from "vitest";
import { cellAmount, formatThousandYen } from "../../src/app/chart/grid";
import type { ChartCell } from "../../src/plan/chart";

const cell = (keys: string[]): ChartCell => ({ mark: "actual", summary: false, count: null, review: false, change: null, detailKeys: keys }) as unknown as ChartCell;

describe("金額の表示", () => {
  const amounts = new Map([
    ["a1", { yen: 1_000_000, kind: "actual" as const }],
    ["a2", { yen: 234_567, kind: "actual" as const }],
    ["p1", { yen: 900_000, kind: "plan" as const }],
  ]);
  it("実績があれば実績の合計、無ければ予算の合計、どちらも無ければ null（星のまま）", () => {
    expect(cellAmount(cell(["a1", "a2", "p1"]), amounts)).toEqual({ yen: 1_234_567, kind: "actual" });
    expect(cellAmount(cell(["p1"]), amounts)).toEqual({ yen: 900_000, kind: "plan" });
    expect(cellAmount(cell(["x"]), amounts)).toBeNull();
    expect(cellAmount(cell(["a1"]), null)).toBeNull();
    expect(cellAmount(undefined, amounts)).toBeNull();
    // 畳んだ行のまとめは、ほかの作業の金額を混ぜるので出さない
    expect(cellAmount({ ...cell(["a1"]), summary: true } as ChartCell, amounts)).toBeNull();
  });
  it("千円で 3 桁の区切り。1,000 円未満の金額は 0 と言わない", () => {
    expect(formatThousandYen(1_234_567)).toBe("1,235");
    expect(formatThousandYen(12_345_678)).toBe("12,346");
    expect(formatThousandYen(400)).toBe("<1");
    expect(formatThousandYen(0)).toBe("0");
    expect(formatThousandYen(-1_234_567)).toBe("-1,235");
    expect(formatThousandYen(-400)).toBe("-<1");
  });
});
