// 中長期の計画表の一般の形（375t の取り込みの直し）：階層の列が何列もあり（設備｜機器｜系列｜部位）、年の列に整備の内容の文と、
// その下の行の金額を 2 段で書き、頁ごとに題・凡例・見出しを書き直し、区分ごとの小計が並ぶ表。
// 業種に依らないことを見るため、ここでは上水の架空の施設の語で書く（ごみ焼却の語は使わない）。
import { describe, expect, test } from "vitest";
import { acceptDefaults, rows, session, xlsxOf } from "./helpers";
import type ExcelJS from "exceljs";

/** 1 頁（題・副題・凡例・頁の題・見出し 2 段・データ・小計 2 つ・注記）。データは [設備, 機器, 系列, 部位, 実績の年 2 列, 計画の年 3 列] の行と、金額の行 */
function page(ws: ExcelJS.Worksheet, top: number, no: number, facility: string, data: (string | number | null)[][]) {
  rows(ws, top, [
    [`【架空】中長期整備計画表　${facility}`, null, null, null, null, null, null, null, "原案"],
    ["上段：整備内容／下段：原価予算［千円・税抜］"],
    ["重要度 A：安全・共通系　B：能力に影響　【改】：基幹改良　空欄：工事予算なし"],
    [`${facility}　（${no} / 2）　【架空】`],
    ["設備", "機器群", "系列", "機器／部位", "既往の整備履歴", null, "整備計画"],
    [null, null, null, null, "R4\n2022年度", "R5\n2023年度", "R6\n2024年度", "R7\n2025年度", "R8\n2026年度"],
  ]);
  ws.mergeCells(top, 1, top, 8);
  ws.mergeCells(top + 1, 1, top + 1, 9);
  ws.mergeCells(top + 2, 1, top + 2, 9);
  ws.mergeCells(top + 3, 1, top + 3, 9);
  for (const c of [1, 2, 3, 4]) ws.mergeCells(top + 4, c, top + 5, c);
  ws.mergeCells(top + 4, 5, top + 4, 6);
  ws.mergeCells(top + 4, 7, top + 4, 9);
  rows(ws, top + 6, data);
  const end = top + 6 + data.length;
  rows(ws, end, [["単年度整備 小計［千円］"], ["基幹改良 小計［千円］"], ["注）部分補修と一式更新を区別する。"]]);
  // 小計：単年度は【改】の無い金額の和、基幹改良は【改】の金額の和（計画の 3 列）
  for (const [i, c] of [7, 8, 9].entries()) {
    let plain = 0;
    let upgrade = 0;
    for (let k = 0; k + 1 < data.length; k += 2) {
      const text = String(data[k]?.[c - 1] ?? "");
      const amount = data[k + 1]?.[c - 1];
      if (typeof amount !== "number") continue;
      if (text.startsWith("【改】")) upgrade += amount;
      else plain += amount;
    }
    ws.getCell(end, c).value = plain;
    ws.getCell(end + 1, c).value = upgrade;
    void i;
  }
  return end + 3;
}

async function book(): Promise<Uint8Array> {
  return xlsxOf((ws, wb) => {
    // 概要のシート：列の見出しの行が無く、項目と値だけ
    const o = wb.addWorksheet("施設概要");
    rows(o, 1, [["【架空】浄水場　中長期整備計画"], [], ["計画の位置づけ", null, null, "原価予算の原案。後年の実績は追記しない。"], ["時点・対象期間", null, null, "2024年3月策定。既往は2022～2023年度。"], ["取水設備", "4 管理単位", "送水設備", "6 管理単位"]]);
    let r = 1;
    r = page(ws, r, 1, "送水設備", [
      ["送水設備", "送水ポンプ", "1系\nNo.1", "ポンプ本体\n軸受", "分解点検", "振動 2.1mm/s", "軸受交換", null, "【改】ポンプ更新"],
      [null, null, null, null, 120, null, 300, null, 9000],
      [null, null, null, "B：電動機", null, null, null, "絶縁診断", null],
      [null, null, null, null, null, null, null, 80, null],
      [null, null, "1系\nNo.2", "ポンプ本体\n軸受", null, null, "軸受交換", null, null],
      [null, null, null, null, null, null, 300, null, null],
    ]);
    page(ws, r, 2, "送水設備", [
      ["送水設備", "送水ポンプ", "2系", "2系 No.1 送水P", null, null, "分解点検", null, null],
      [null, null, null, null, null, null, 150, null, null],
      [null, "配水池", "共通", "配水池", null, "清掃", null, "清掃", null],
      [null, null, null, null, null, 40, null, 40, null],
    ]);
    // 結合：設備・機器群・系列・部位（部位は内容と金額の 2 行）
    const m = (a: string) => ws.mergeCells(a);
    m("A7:A12");
    m("B7:B12");
    m("C7:C10");
    m("C11:C12");
    m("D7:D8");
    m("D9:D10");
    m("D11:D12");
    m(`A${r + 6}:A${r + 9}`);
    m(`B${r + 6}:B${r + 7}`);
    m(`C${r + 6}:C${r + 7}`);
    m(`D${r + 6}:D${r + 7}`);
    m(`B${r + 8}:B${r + 9}`);
    m(`C${r + 8}:C${r + 9}`);
    m(`D${r + 8}:D${r + 9}`);
  }, "計画表");
}

describe("中長期の計画表：階層の列・年の欄の 2 段・頁ごとの題", () => {
  test("設備 › 機器（系列・号機）› 部位、作業・年度の値・費用として読み、題・凡例・注記・概要は機器にしない", async () => {
    const s = session();
    await s.add([{ name: "【架空】中長期計画.xlsx", bytes: await book() }]);
    acceptDefaults(s);
    const an = s.analyze();
    // 「共通」の意味は既定で答えた。のこる質問は無い
    expect(an.open.filter((q) => !q.decision).map((q) => q.text)).toEqual([]);
    // 同じ形の質問はまとめる（設備・機器を 1 行ずつ聞かない）
    expect(an.questions.length).toBeLessThanOrEqual(6);
    const p = s.compose().plan;
    expect(p, JSON.stringify(s.compose().blockers)).not.toBeNull();
    const byKey = new Map(p!.assets.map((a) => [a.nodeKey, a]));
    const pathOf = (a: NonNullable<typeof p>["assets"][number]) => {
      const out: string[] = [];
      for (let x: typeof a | undefined = a; x; x = x.parentKey ? byKey.get(x.parentKey) : undefined) out.unshift(`${x.name}${x.series ? `#${x.series}` : ""}${x.tag ? `@${x.tag}` : ""}`);
      return out.join(" › ");
    };
    const paths = p!.assets.map(pathOf).sort();
    expect(paths).toEqual(
      [
        "送水設備",
        "送水設備 › 送水ポンプ#1@No.1",
        "送水設備 › 送水ポンプ#1@No.1 › ポンプ本体 軸受",
        "送水設備 › 送水ポンプ#1@No.1 › 電動機",
        "送水設備 › 送水ポンプ#1@No.2",
        "送水設備 › 送水ポンプ#1@No.2 › ポンプ本体 軸受",
        "送水設備 › 送水ポンプ#2",
        "送水設備 › 送水ポンプ#2 › 送水P@No.1",
        "送水設備 › 配水池#common.facility",
        "送水設備 › 配水池#common.facility › 配水池",
      ].sort(),
    );
    // 題・凡例・頁の題・注記・概要の項目は機器にしない
    expect(p!.assets.some((a) => /架空|改|注|頁|概要|位置づけ|取水/u.test(a.name))).toBe(false);
    const works = new Map(p!.works.map((w) => [w.workKey, w]));
    const rowsOf = p!.details
      .map((d) => {
        const w = works.get(d.workKey)!;
        return `${pathOf(byKey.get(w.targets[0]!)!).split(" › ").slice(1).join("›")}|${w.kind}|${d.fiscalYear}|${d.planOrActual}|${d.cost}`;
      })
      .sort();
    expect(rowsOf).toEqual(
      [
        "送水ポンプ#1@No.1›ポンプ本体 軸受|分解点検|2022|actual|120000",
        "送水ポンプ#1@No.1›ポンプ本体 軸受|軸受交換|2024|plan|300000",
        "送水ポンプ#1@No.1›ポンプ本体 軸受|【改】ポンプ更新|2026|plan|9000000",
        "送水ポンプ#1@No.1›電動機|絶縁診断|2025|plan|80000",
        "送水ポンプ#1@No.2›ポンプ本体 軸受|軸受交換|2024|plan|300000",
        "送水ポンプ#2›送水P@No.1|分解点検|2024|plan|150000",
        "配水池#common.facility›配水池|清掃|2023|actual|40000",
        "配水池#common.facility›配水池|清掃|2025|plan|40000",
      ].sort(),
    );
    // 費用の元のセルと税は、金額の行のセルと題の「税抜」
    const up = p!.details.find((d) => works.get(d.workKey)?.kind === "【改】ポンプ更新")!;
    expect(up.costSource).toMatchObject({ sheet: "計画表", ref: "I8", tax: "excl" });
    // 測った値だけのセル（「振動 2.1mm/s」）は作業にせず、機器の仕様に残す
    expect(p!.works.some((w) => w.kind.includes("振動"))).toBe(false);
    const pump = p!.assets.find((a) => pathOf(a) === "送水設備 › 送水ポンプ#1@No.1 › ポンプ本体 軸受")!;
    expect(pump.specs.some((x) => x.value === "振動 2.1mm/s")).toBe(true);
    // 凡例で決めた頭の符号（「B：電動機」）は名前から分け、凡例の題を項目にして仕様に残す
    const motor = p!.assets.find((a) => pathOf(a) === "送水設備 › 送水ポンプ#1@No.1 › 電動機")!;
    expect(motor.specs).toContainEqual({ key: "重要度", value: "B：能力に影響" });
    // どのセルにも行き先がある（未解決が 0）
    expect([...s.compose().status.values()].filter((x) => x.s === "unresolved").length).toBe(0);
  });
});
