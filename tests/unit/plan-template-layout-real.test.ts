// 様式の写し方の案（仕事 template-layout-v2）：運営者の実物の様式で測った式の形のまま、架空の様式を組んで書く。
// 実物の様式は持たない。式の字だけを測ったとおりに置く：年度の見出しは IF(ISNUMBER(履歴・前期計画!$D$6),履歴・前期計画!$D$6+n,"")、
// 後期の開始年度は前期の D6 を写す式、後期の階層の欄は前期の同じ行を写す IF(履歴・前期計画!A9="","",履歴・前期計画!A9)、
// 合計は SUMIF(シート!$F$9:$F$30,"予定金額",シート!G$9:G$30)。計画もすべて架空。
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { checkLayout, fillLayout, isMirrorFormula, previewGrid, templateShape, writtenCellsOf, yearRefOf } from "../../src/plan/template-layout";
import { LAYOUT_SCHEMA, type TemplateLayout } from "../../src/shared/template-layout";
import type { Plan } from "../../src/shared/plan";
import { catalog, layoutPlan } from "../helpers/template-layout";
import { asset, detail, work } from "./share/fixtures";

const INFO = "基本情報";
const FIRST = "履歴・前期計画";
const LATER = "後期計画";
const FIRST_YEARS = ["G", "H", "I", "J", "K", "L", "M", "N", "O"];
const LATER_YEARS = [...FIRST_YEARS, "P"];
/** 明細の空行（9〜30 行目）と合計の行（31・32 行目） */
const DATA = 9;
const TOTAL = 31;
const LEVEL_COLS = ["A", "B", "C", "D"];

const yearFormula = (n: number) => `IF(ISNUMBER(${FIRST}!$D$6),${FIRST}!$D$6+${n},"")`;
const mirror = (c: string, r: number) => `IF(${FIRST}!${c}${r}="","",${FIRST}!${c}${r})`;
const sumif = (sheet: string, label: string, c: string, last: number) => `SUMIF(${sheet}!$F$${DATA}:$F$${last},"${label}",${sheet}!${c}$${DATA}:${c}$${last})`;

const thin = { style: "thin" } as const;
const box = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * 運営者の実物の様式の形（式の字は実物で測ったまま）の架空の様式。
 * mirror：後期の階層の欄の写す式を、実物で測った 4 つのセル（A9・B10・C11・D12）にだけ置くか、明細の行のすべて（A9:D30）に置くか
 */
async function realTemplate(o: { mirror: "measured" | "all" }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet(INFO);
  info.getCell("A1").value = "基本情報";
  ["業務名", "施設名", "所在地"].forEach((t, i) => {
    info.getCell(`A${3 + i}`).value = t;
    info.mergeCells(`B${3 + i}:D${3 + i}`);
  });
  for (const [name, later] of [
    [FIRST, false],
    [LATER, true],
  ] as const) {
    const ws = wb.addWorksheet(name);
    const years = later ? LATER_YEARS : FIRST_YEARS;
    const last = years.at(-1)!;
    const side = String.fromCharCode(last.charCodeAt(0) + 1);
    ws.getCell("A1").value = `【架空】長寿命化計画（${later ? "後期計画" : "履歴・前期計画"}）`;
    ws.mergeCells("A6:C6");
    ws.getCell("A6").value = "開始年度（西暦）";
    if (later) ws.getCell("D6").value = { formula: `IF(ISNUMBER(${FIRST}!D6),${FIRST}!D6,"")` };
    for (const [r, t] of [
      ["A7:A8", "設備"],
      ["B7:B8", "機器種別"],
      ["C7:C8", "号炉・系統"],
      ["D7:E8", "機器・部位"],
      ["F7:F8", "記入区分"],
      [`${side}7:${side}8`, "重要度・整備方針"],
    ] as const) {
      ws.mergeCells(r);
      ws.getCell(r.split(":")[0]!).value = t;
      ws.getCell(r.split(":")[0]!).font = { bold: true };
    }
    if (later) {
      ws.mergeCells(`G7:${last}7`);
      ws.getCell("G7").value = "後期計画";
    } else {
      ws.mergeCells("G7:K7");
      ws.getCell("G7").value = "既往の整備履歴";
      ws.mergeCells("L7:O7");
      ws.getCell("L7").value = "前期計画";
    }
    years.forEach((c, i) => (ws.getCell(`${c}8`).value = { formula: yearFormula((later ? 9 : 0) + i) }));
    for (let r = DATA; r < TOTAL; r++) {
      ws.mergeCells(`D${r}:E${r}`);
      for (const c of ["A", "B", "C", "D", "F", ...years, side]) ws.getCell(`${c}${r}`).border = box;
    }
    if (later) {
      const cells = o.mirror === "all" ? Array.from({ length: TOTAL - DATA }, (_, i) => LEVEL_COLS.map((c) => [c, DATA + i] as const)).flat() : LEVEL_COLS.map((c, i) => [c, DATA + i] as const);
      for (const [c, r] of cells) ws.getCell(`${c}${r}`).value = { formula: mirror(c, r) };
    }
    ws.mergeCells(`A${TOTAL}:F${TOTAL}`);
    ws.getCell(`A${TOTAL}`).value = "予定金額 計［千円］";
    ws.mergeCells(`A${TOTAL + 1}:F${TOTAL + 1}`);
    ws.getCell(`A${TOTAL + 1}`).value = "実績金額 計［千円］";
    for (const c of years) {
      ws.getCell(`${c}${TOTAL}`).value = { formula: sumif(name, "予定金額", c, TOTAL - 1) };
      ws.getCell(`${c}${TOTAL + 1}`).value = { formula: sumif(name, "実績金額", c, TOTAL - 1) };
    }
    if (!later) {
      ws.getCell(`A${TOTAL + 3}`).value = "予定・実績金額の推移集計（全期間）";
      ws.getCell(`A${TOTAL + 4}`).value = "予定金額";
      ws.getCell(`B${TOTAL + 4}`).value = { formula: `SUM(G${TOTAL}:O${TOTAL})+SUM(${LATER}!G${TOTAL}:P${TOTAL})` };
    }
    ws.getCell(`A${TOTAL + 6}`).value = "金額はメーカー原価［千円・税抜］";
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Claude が置く形の案：前期は年度 G〜O と開始年度 D6、後期は年度 G〜P の続きのシート。階層は入れ子の縦で A・B・C・D、組は F 列の 4 行、合計の前 31 行目 */
function realLayout(later: Partial<TemplateLayout["sheets"][number]> = {}): TemplateLayout {
  const sheet = (name: string, to: string, startCell: string | null, continues: string | null) => ({
    sheet: name,
    headerRows: [7, 8],
    years: { row: 8, from: "G", to, startCell },
    levels: { mode: "nested" as const, columns: LEVEL_COLS.map((col, i) => ({ level: i + 1, col })) },
    group: {
      labelCol: "F",
      rows: [
        { label: "予定内容", content: "plan_content" as const, col: null },
        { label: "予定金額", content: "plan_amount" as const, col: null },
        { label: "実績内容", content: "actual_content" as const, col: null },
        { label: "実績金額", content: "actual_amount" as const, col: null },
      ],
    },
    insertBefore: TOTAL,
    continues,
  });
  return {
    schema: LAYOUT_SCHEMA,
    levelOrder: "asset-first",
    startYear: null,
    amount: { unit: "thousand_yen", tax: "excl" },
    sheets: [sheet(FIRST, "O", "D6", null), { ...sheet(LATER, "P", null, FIRST), ...later }],
    facility: { sheet: INFO, cells: [{ field: "name", cell: "B4" }] },
  };
}

const cost = (yen: number) => ({ cost: yen, costSource: { file: "架空.xlsx", sheet: "費用", ref: "C3", text: String(yen), tax: "excl" as const } });

/**
 * 架空の計画：v1 の試験の計画に設備を 1 つ（機器 2 つ）足し、年度を 16 年あとへ（最初の年度は 2016）。
 * 入れ子で 28 行になり、空行 22 行（9〜30）に入りきらないので 6 行を足す
 */
function realPlan(): Plan {
  const p = layoutPlan();
  p.assets.push(
    asset("s3", null, { name: "架空の排ガス設備", level: 1 }),
    asset("m4", null, { name: "架空の集じん器", level: 2, parentKey: "s3", series: "1" }),
    asset("m5", null, { name: "架空の送風機", level: 2, parentKey: "s3", series: "1" }),
  );
  p.works.push(work("w5", "INSPECT", ["m4"]), work("w6", "REPLACE", ["m5"]));
  p.details.push(detail("d9", "w5", 2004, cost(50_000)), detail("d10", "w6", 2017, { planOrActual: "plan", ...cost(8_000_000) }));
  p.details = p.details.map((d) => ({ ...d, fiscalYear: d.fiscalYear + 16 }));
  return p;
}

const ROWS = 28;
const INSERTED = ROWS - (TOTAL - DATA);
const NEW_TOTAL = TOTAL + INSERTED;

const load = async (bytes: Uint8Array | ArrayBuffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as ArrayBuffer);
  return wb;
};
const input = () => ({ plan: realPlan(), catalog: catalog(), asOf: "2026-11-07" });
const formulaAt = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as { formula?: string } | null)?.formula ?? null;
const resultAt = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as { result?: unknown } | null)?.result;

describe("年度の見出しの式（IF と ISNUMBER で包んだ形）", () => {
  it("実物の形の式から、参照のセルと足す数を 1 つに決める", () => {
    expect(yearRefOf(yearFormula(0))).toEqual({ sheet: FIRST, cell: "D6", add: 0 });
    expect(yearRefOf(yearFormula(8))).toEqual({ sheet: FIRST, cell: "D6", add: 8 });
    expect(yearRefOf(yearFormula(18))).toEqual({ sheet: FIRST, cell: "D6", add: 18 });
    // 後期の D6（前期の D6 を写す）
    expect(yearRefOf(`IF(ISNUMBER(${FIRST}!D6),${FIRST}!D6,"")`)).toEqual({ sheet: FIRST, cell: "D6", add: 0 });
    expect(yearRefOf(`=IF( ISNUMBER('${FIRST}'!$D$6) , '${FIRST}'!D6 - 1 , "" )`)).toEqual({ sheet: FIRST, cell: "D6", add: -1 });
    expect(yearRefOf('IFERROR(G8+1,"")')).toEqual({ sheet: null, cell: "G8", add: 1 });
  });

  it("足す数が 1 つに決まらない式・ほかのセルを指す式・ほかの計算の式は、今どおり null", () => {
    for (const f of [
      'IF(ISNUMBER(D6),D6+1,D6+2)',
      'IF(ISNUMBER(D6),E6+1,"")',
      `IF(ISNUMBER(D6),${FIRST}!D6+1,"")`,
      'IF(ISNUMBER(D6),D6*2,"")',
      'IF(ISNUMBER(D6),D6+1,"")*2',
      'IF(ISNUMBER(D6+1),D6+1,"")',
      'IF(AND(D6>0),D6+1,"")',
      "D6+D6",
      "ISNUMBER(D6)",
      'MAX(D6+1,"")',
      `IF(${FIRST}!A9="","",${FIRST}!A9)`,
      "SUM(G9:G30)",
    ])
      expect(yearRefOf(f), f).toBeNull();
  });

  it("様式の形は、包んだ年度の式も参照のセルと足す数を返す", async () => {
    const shape = templateShape(await load(await realTemplate({ mirror: "measured" })), "架空の実物の形");
    const f = (sheet: string) => new Map(shape.sheets.find((s) => s.name === sheet)!.formulas.map((x) => [x.cell, x.yearRef]));
    expect([f(FIRST).get("G8"), f(FIRST).get("O8")]).toEqual([
      { sheet: FIRST, cell: "D6", add: 0 },
      { sheet: FIRST, cell: "D6", add: 8 },
    ]);
    expect([f(LATER).get("G8"), f(LATER).get("P8"), f(LATER).get("D6")]).toEqual([
      { sheet: FIRST, cell: "D6", add: 9 },
      { sheet: FIRST, cell: "D6", add: 18 },
      { sheet: FIRST, cell: "D6", add: 0 },
    ]);
    // 階層の欄の写す式は年度の参照ではない
    expect(f(LATER).get("A9")).toBeNull();
  });
});

describe("前のシートの同じ行を写す式", () => {
  it("前のシートの同じ行・同じ列を指す形だけ", () => {
    expect(isMirrorFormula(mirror("A", 9), FIRST, 9, 1)).toBe(true);
    expect(isMirrorFormula(`if( '${FIRST}'!$B$10 = "" , "" , '${FIRST}'!B10 )`, FIRST, 10, 2)).toBe(true);
    expect(isMirrorFormula(`${FIRST}!D12`, FIRST, 12, 4)).toBe(true);
    expect(isMirrorFormula(mirror("A", 9), FIRST, 10, 1)).toBe(false);
    expect(isMirrorFormula(mirror("A", 9), FIRST, 9, 2)).toBe(false);
    expect(isMirrorFormula(mirror("A", 9), LATER, 9, 1)).toBe(false);
    expect(isMirrorFormula('IF(A9="","",A9)', FIRST, 9, 1)).toBe(false);
    expect(isMirrorFormula(`IF(${FIRST}!A9="","",${FIRST}!A9&"x")`, FIRST, 9, 1)).toBe(false);
    expect(isMirrorFormula(`IF(${FIRST}!A9="","",${FIRST}!A10)`, FIRST, 9, 1)).toBe(false);
  });
});

describe("実物の形の様式に、Claude が置く形の案で書く", () => {
  it("案を断らない。年度は前期 2016〜2024・後期 2025〜2034 と決まる", async () => {
    const wb = await load(await realTemplate({ mirror: "measured" }));
    expect(checkLayout(wb, realLayout(), 2016)).toEqual([]);
    const { summary } = fillLayout(wb, realLayout(), input());
    expect(summary.startYear).toBe(2016);
    expect(summary.sheets.map((s) => [s.sheet, s.firstYear, s.lastYear, s.rows, s.inserted, s.totalRow])).toEqual([
      [FIRST, 2016, 2024, ROWS, INSERTED, NEW_TOTAL],
      [LATER, 2025, 2034, ROWS, INSERTED, NEW_TOTAL],
    ]);
    expect(Object.values(summary.sheets[0]!.yearOf)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
    expect(summary.sheets[1]!.yearOf).toMatchObject({ G: 2025, H: 2026, O: 2033, P: 2034 });
    // 開始年度は前期の D6 だけに書く。後期の D6 は前期を写す式のまま
    const first = wb.getWorksheet(FIRST)!;
    const later = wb.getWorksheet(LATER)!;
    expect(first.getCell("D6").value).toBe(2016);
    expect(formulaAt(later, "D6")).toBe(`IF(ISNUMBER(${FIRST}!D6),${FIRST}!D6,"")`);
    // 年度の見出しの式は字のまま残り、たどった年度が計算済みの値に入る
    expect([formulaAt(first, "G8"), formulaAt(first, "O8"), formulaAt(later, "G8"), formulaAt(later, "P8")]).toEqual([yearFormula(0), yearFormula(8), yearFormula(9), yearFormula(18)]);
    expect([resultAt(first, "G8"), resultAt(first, "O8"), resultAt(later, "G8"), resultAt(later, "P8")]).toEqual([2016, 2024, 2025, 2034]);
    // 2033 年度（後期 O）の予定：更新 8,000 千円は、足した行に入る（集じん器・送風機は 26〜36 行目）
    expect([later.getCell("O33").value, later.getCell("O34").value]).toEqual(["更新", 8000]);
    // 2020 年度（前期 K）の実績：点検 50 千円
    expect([first.getCell("K30").value, first.getCell("K31").value]).toEqual(["点検", 50]);
  });

  for (const kind of ["measured", "all"] as const) {
    it(`後期の階層の欄は式のまま、前期と同じ行に名前が出る（写す式：${kind === "measured" ? "実物で測った A9・B10・C11・D12" : "明細の行のすべて"}）`, async () => {
      const wb = await load(await realTemplate({ mirror: kind }));
      fillLayout(wb, realLayout(), input());
      const first = wb.getWorksheet(FIRST)!;
      const later = wb.getWorksheet(LATER)!;
      // 測ったセル：式は字のまま、前期に書いた名前が計算済みの値に入る
      expect(LEVEL_COLS.map((c, i) => formulaAt(later, `${c}${DATA + i}`))).toEqual(LEVEL_COLS.map((c, i) => mirror(c, DATA + i)));
      expect(LEVEL_COLS.map((c, i) => resultAt(later, `${c}${DATA + i}`))).toEqual(["架空の受入設備", "架空のクレーン", "1 号炉", "架空のバケット"]);
      expect(LEVEL_COLS.map((c, i) => first.getCell(`${c}${DATA + i}`).value)).toEqual(["架空の受入設備", "架空のクレーン", "1 号炉", "架空のバケット"]);
      // 明細の行のすべて（足した行も）：前期に名前のあるセルは、後期では前期の同じセルを写す式で、値は前期の名前。名前は字で書かない
      let named = 0;
      for (let r = DATA; r < NEW_TOTAL; r++) {
        for (const c of LEVEL_COLS) {
          const name = first.getCell(`${c}${r}`).value;
          const f = formulaAt(later, `${c}${r}`);
          if (typeof name === "string") {
            named++;
            expect(f, `${c}${r}`).toBe(mirror(c, r));
            expect(resultAt(later, `${c}${r}`), `${c}${r}`).toBe(name);
          } else if (kind === "all") expect(f, `${c}${r}`).toBe(mirror(c, r));
          else expect(later.getCell(`${c}${r}`).value, `${c}${r}`).toBeNull();
        }
      }
      // 名前の行：設備 3・機器 4・号炉 5・部位 1
      expect(named).toBe(13);
      // 足した行（30〜35）とずれた行（36）にも、同じ行を指す式
      expect([formulaAt(later, "B32"), formulaAt(later, "C33"), formulaAt(later, "C28")]).toEqual([mirror("B", 32), mirror("C", 33), mirror("C", 28)]);
      expect([first.getCell("B32").value, resultAt(later, "B32")]).toEqual(["架空の送風機", "架空の送風機"]);
      // 組のラベルの列（F）は今どおり書く
      expect([12, 13, 14, 15, 33, 36].map((r) => later.getCell(`F${r}`).value)).toEqual(["予定内容", "予定金額", "実績内容", "実績金額", "予定内容", "実績金額"]);
      // 書き出して読み直しても、式と値が残る
      const again = (await load(await wb.xlsx.writeBuffer())).getWorksheet(LATER)!;
      expect([formulaAt(again, "A26"), resultAt(again, "A26")]).toEqual([mirror("A", 26), "架空の排ガス設備"]);
    });
  }

  it("行を足したあとの合計の式の範囲：前期・後期とも足した行まで広がり、推移集計は両方の合計の行を指す", async () => {
    const wb = await load(await realTemplate({ mirror: "all" }));
    fillLayout(wb, realLayout(), input());
    const first = wb.getWorksheet(FIRST)!;
    const later = wb.getWorksheet(LATER)!;
    const last = NEW_TOTAL - 1;
    expect([first.getCell(`A${NEW_TOTAL}`).value, later.getCell(`A${NEW_TOTAL + 1}`).value]).toEqual(["予定金額 計［千円］", "実績金額 計［千円］"]);
    expect(formulaAt(first, `G${NEW_TOTAL}`)).toBe(sumif(FIRST, "予定金額", "G", last));
    expect(formulaAt(first, `O${NEW_TOTAL + 1}`)).toBe(sumif(FIRST, "実績金額", "O", last));
    expect(formulaAt(later, `G${NEW_TOTAL}`)).toBe(sumif(LATER, "予定金額", "G", last));
    expect(formulaAt(later, `P${NEW_TOTAL + 1}`)).toBe(sumif(LATER, "実績金額", "P", last));
    expect(formulaAt(first, `B${NEW_TOTAL + 4}`)).toBe(`SUM(G${NEW_TOTAL}:O${NEW_TOTAL})+SUM(${LATER}!G${NEW_TOTAL}:P${NEW_TOTAL})`);
    // 足した行に 1 行の中の結合（D:E）を写す。合計の行の結合は下へ
    expect(later.model.merges).toEqual(expect.arrayContaining([`D30:E30`, `D${last}:E${last}`, `A${NEW_TOTAL}:F${NEW_TOTAL}`]));
    expect(later.model.merges).not.toContain(`A${TOTAL}:F${TOTAL}`);
    // 結合（D:E）の左上の式は 1 回だけずらす（もとの 30 行目は 36 行目へ、前期の 36 行目を指す）
    expect([formulaAt(later, `D${last}`), formulaAt(later, "D30")]).toEqual([mirror("D", last), mirror("D", 30)]);
  });

  it("見本：後期の階層の欄は前期の名前を出し、書いたセルの印が付く", async () => {
    const wb = await load(await realTemplate({ mirror: "measured" }));
    const layout = realLayout();
    const { summary, rows } = fillLayout(wb, layout, input());
    const g = previewGrid(wb, LATER, 20, [], writtenCellsOf(layout, summary, rows, realPlan()).get(LATER)!)!;
    expect(g.rows.find((r) => r.n === 9)!.cells[0]).toMatchObject({ text: "架空の受入設備", formula: true, written: true });
    expect(g.rows.find((r) => r.n === 20)!.cells[0]).toMatchObject({ text: "架空の燃焼設備", formula: true, written: true });
    expect(g.rows.find((r) => r.n === 8)!.cells[6]).toMatchObject({ text: "2025", formula: true });
  });

  it("断るもの：後期の行の並びが前期とそろわない案、同じ行を指さない式・前置きの無い式、最初のシートの写す式、ラベルの列の式", async () => {
    const wb = await load(await realTemplate({ mirror: "measured" }));
    const align = expect.stringContaining(`「${LATER}」の階層の欄は「${FIRST}」の同じ行を写す式なので`);
    expect(checkLayout(wb, realLayout({ insertBefore: 30 }), 2016)).toEqual([align]);
    const s = realLayout().sheets[1]!;
    expect(checkLayout(wb, realLayout({ group: { ...s.group, rows: s.group.rows.slice(0, 2) } }), 2016)).toEqual([align]);
    expect(checkLayout(wb, realLayout({ levels: { mode: "nested", columns: [...s.levels.columns.slice(0, 3), { level: 4, col: "Q" }] } }), 2016)).toEqual([align]);
    // 前期の続きでなければ、写す式は明細の欄の式
    expect(checkLayout(wb, realLayout({ continues: null, years: { ...s.years, startCell: null } }), 2016)).toContainEqual(`「${LATER}」の明細の欄 A9 に式がある`);
    const later = wb.getWorksheet(LATER)!;
    later.getCell("A9").value = { formula: mirror("A", 10) } as ExcelJS.CellValue;
    expect(checkLayout(wb, realLayout(), 2016)).toEqual([`「${LATER}」の明細の欄 A9 に式がある`]);
    later.getCell("A9").value = { formula: 'IF(A10="","",A10)' } as ExcelJS.CellValue;
    expect(checkLayout(wb, realLayout(), 2016)).toEqual([`「${LATER}」の明細の欄 A9 に式がある`]);
    later.getCell("A9").value = { formula: mirror("A", 9) } as ExcelJS.CellValue;
    later.getCell("F12").value = { formula: `${FIRST}!F12` } as ExcelJS.CellValue;
    expect(checkLayout(wb, realLayout(), 2016)).toEqual([`「${LATER}」の明細の欄 F12 に式がある`]);
    later.getCell("F12").value = null;
    wb.getWorksheet(FIRST)!.getCell("A9").value = { formula: `${LATER}!A9` } as ExcelJS.CellValue;
    expect(checkLayout(wb, realLayout(), 2016)).toEqual([`「${FIRST}」の明細の欄 A9 に式がある`]);
  });
});
