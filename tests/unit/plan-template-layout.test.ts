// 様式の写し方の案（src/plan/template-layout.ts。仕事 template-layout-v1）：運営者が説明した形の架空の様式に、案のとおりに書く。
// 入れ子の縦の書き方・4 行の組・年度の列（開始年度のセルと式）・合計の前に足す行・合計の式の範囲・続きのシート・基本情報の欄。
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { checkLayout, fillLayout, previewGrid, shiftFormulaRows, templateShape, writeTemplate, writtenCellsOf, yearRefOf } from "../../src/plan/template-layout";
import { COLUMNS_SCHEMA, fillTemplate, isTemplateColumns, templateRows, type TemplateColumns } from "../../src/plan/template";
import { columnsHash } from "../../src/plan/exports";
import { templateLayoutInputSchema, templateLayoutSchema, templateShapeSchema } from "../../src/shared/template-layout";
import { FIRST_DATA_ROW, SHEET_FIRST, SHEET_INFO, SHEET_LATER, SUMMARY_ROW, TOTAL_ROW, catalog, layoutFor, layoutPlan, templateBytes } from "../helpers/template-layout";

const load = async (bytes: Uint8Array | ArrayBuffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as ArrayBuffer);
  return wb;
};
const input = () => ({ plan: layoutPlan(), catalog: catalog(), asOf: "2026-11-07" });
const formulaAt = (ws: ExcelJS.Worksheet, a: string) => (ws.getCell(a).value as { formula?: string } | null)?.formula ?? null;
const valueAt = (ws: ExcelJS.Worksheet, a: string) => {
  const v = ws.getCell(a).value as unknown;
  return v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v;
};

/** 架空の計画の 17 行（入れ子）：設備・機器・号炉・部位（組 4 行）… */
const ROWS = 17;
const INSERTED = ROWS - (TOTAL_ROW - FIRST_DATA_ROW);

describe("式の参照の書き換え", () => {
  it("足した行より下を指す参照は下げ、範囲の終わりだけが下なら広げる。字の中・関数の名前・ほかのシートは触らない", () => {
    expect(shiftFormulaRows('SUMIF($F$9:$F$19,"予定金額",G9:G19)', "前", "前", 19, 6)).toBe('SUMIF($F$9:$F$25,"予定金額",G9:G25)');
    expect(shiftFormulaRows("SUM(G20:O20)+SUM('後期計画'!G20:O20)", "前", "前", 19, 6)).toBe("SUM(G26:O26)+SUM('後期計画'!G20:O20)");
    expect(shiftFormulaRows("SUM(G20:O20)+SUM('後期計画'!G20:O20)", "前", "後期計画", 19, 6)).toBe("SUM(G20:O20)+SUM('後期計画'!G26:O26)");
    expect(shiftFormulaRows('IF(A20="G20",LOG10(B30),$C$5)', "前", "前", 19, 2)).toBe('IF(A22="G20",LOG10(B32),$C$5)');
    expect(shiftFormulaRows("後期計画!A30+'it''s'!A30", "x", "後期計画", 19, 1)).toBe("後期計画!A31+'it''s'!A30");
  });

  it("年度の参照の式：=G6・=$G$6・=G8+1・='前のシート'!O8+1。ほかの式は null", () => {
    expect(yearRefOf("C6")).toEqual({ sheet: null, cell: "C6", add: 0 });
    expect(yearRefOf("$C$6")).toEqual({ sheet: null, cell: "C6", add: 0 });
    expect(yearRefOf("G8 + 1")).toEqual({ sheet: null, cell: "G8", add: 1 });
    expect(yearRefOf("'履歴・前期計画'!O8+1")).toEqual({ sheet: "履歴・前期計画", cell: "O8", add: 1 });
    expect(yearRefOf("SUM(G9:G19)")).toBeNull();
  });
});

describe("様式の形（Claude に返すもの）", () => {
  it("シートの名前・見出しの字と位置・結合・式の位置（年度の参照だけ中身）・注記の字。型どおり", async () => {
    const shape = templateShape(await load(await templateBytes()), "架空の様式");
    expect(templateShapeSchema.safeParse(shape).success).toBe(true);
    expect(shape.sheets.map((s) => s.name)).toEqual([SHEET_INFO, SHEET_FIRST, SHEET_LATER]);
    const first = shape.sheets[1]!;
    expect(first.texts).toEqual(expect.arrayContaining([{ cell: "A7", text: "設備" }, { cell: "D7", text: "機器・部位" }, { cell: "G7", text: "既往の整備履歴" }, { cell: "A6", text: "開始年度（西暦）" }]));
    expect(first.texts).toContainEqual({ cell: `A${SUMMARY_ROW + 3}`, text: "金額はメーカー原価［千円・税抜］" });
    expect(first.merges).toEqual(expect.arrayContaining(["D7:E8", "G7:K7", `A${TOTAL_ROW}:F${TOTAL_ROW}`]));
    const f = new Map(first.formulas.map((x) => [x.cell, x.yearRef]));
    expect(f.get("G8")).toEqual({ sheet: null, cell: "C6", add: 0 });
    expect(f.get("I8")).toEqual({ sheet: null, cell: "H8", add: 1 });
    expect(f.get(`G${TOTAL_ROW}`)).toBeNull();
    expect(new Map(shape.sheets[2]!.formulas.map((x) => [x.cell, x.yearRef])).get("G8")).toEqual({ sheet: SHEET_FIRST, cell: "O8", add: 1 });
    expect(first.dataRows).toBeNull();
    // 開始年度の欄の既定の値（年度らしい数）は字として返す
    expect(first.texts).toContainEqual({ cell: "C6", text: "2000" });
  });

  it("値の入ったデータの行がある様式は、その行の字と値を返さず、範囲と数だけ", async () => {
    const shape = templateShape(await load(await templateBytes({ filled: true })), "架空の様式");
    const first = shape.sheets[1]!;
    expect(first.dataRows).toEqual({ from: 9, to: 11, cells: 6 });
    const text = JSON.stringify(shape);
    for (const v of ["架空の秘密の設備", "架空の秘密の部位", "架空の秘密の作業", "1234.5"]) expect(text).not.toContain(v);
    // 見出しは返る
    expect(first.texts).toContainEqual({ cell: "A7", text: "設備" });
  });
});

describe("案のとおりに書く", () => {
  it("入れ子の縦の書き方と 4 行の組、年度の列（開始年度のセルと式）、金額は千円で丸めない", async () => {
    const wb = await load(await templateBytes());
    const { summary } = fillLayout(wb, layoutFor(), input());
    const ws = wb.getWorksheet(SHEET_FIRST)!;
    // 開始年度のセルに版の最初の年度
    expect(ws.getCell("C6").value).toBe(2000);
    expect(summary.startYear).toBe(2000);
    expect(summary.sheets[0]).toMatchObject({ sheet: SHEET_FIRST, rows: ROWS, inserted: INSERTED, firstYear: 2000, lastYear: 2008, firstRow: FIRST_DATA_ROW, totalRow: TOTAL_ROW + INSERTED });
    // 入れ子：設備 → 機器 → 号炉 → 部位（どれも 1 行ずつ下げて、左の列に 1 つだけ）
    const at = (c: string, r: number) => ws.getCell(`${c}${r}`).value;
    expect([at("A", 9), at("B", 10), at("C", 11), at("D", 12)]).toEqual(["架空の受入設備", "架空のクレーン", "1 号炉", "架空のバケット"]);
    expect([at("B", 9), at("A", 10), at("D", 11), at("A", 12)]).toEqual([null, null, null, null]);
    // 4 行の組：F 列に予定内容・予定金額・実績内容・実績金額
    expect([12, 13, 14, 15].map((r) => at("F", r))).toEqual(["予定内容", "予定金額", "実績内容", "実績金額"]);
    expect([at("D", 13), at("D", 14), at("D", 15)]).toEqual([null, null, null]);
    // 2001 年度（H）の実績：内容は字、金額は千円（1,734,567 円 → 1734.567。丸めない）
    expect(at("H", 14)).toBe("点検、分解整備");
    expect(at("H", 15)).toBe(1734.567);
    // 2003 年度（J）：費用の無い実績は内容だけ
    expect(at("J", 14)).toBe("点検");
    expect(at("J", 15)).toBeNull();
    // 組のある号炉の行（2 号炉）：名前は組の最初の行の号炉の列
    expect([at("C", 16), at("F", 16), at("G", 18), at("G", 19)]).toEqual(["2 号炉", "予定内容", "点検", 1]);
    expect([at("A", 20), at("B", 21), at("C", 22), at("L", 24), at("L", 25)]).toEqual(["架空の燃焼設備", "架空の火格子", "1 号炉", "更新", 9.999]);
    // 年度の見出しの式は残し、たどった年度を計算済みの値に入れる（共有の式もふつうの式になる）
    expect(formulaAt(ws, "G8")).toBe("C6");
    expect(formulaAt(ws, "I8")).toBe("H8+1");
    expect(["G8", "H8", "O8"].map((a) => valueAt(ws, a))).toEqual([2000, 2001, 2008]);
    // 数えたもの
    expect(summary).toMatchObject({ details: 8, outOfRange: 1, amountMissing: 1, taxMismatch: 1, taxUnknown: 1, namesWithoutColumn: 0, levelsSkipped: 0, orphans: 0 });
  });

  it("合計の行の前に行を足し、合計の行を下へずらし、合計と推移集計の式の範囲を直す。足した行に 1 行の中の結合を写す", async () => {
    const wb = await load(await templateBytes());
    fillLayout(wb, layoutFor(), input());
    const ws = wb.getWorksheet(SHEET_FIRST)!;
    const total = TOTAL_ROW + INSERTED;
    const last = total - 1;
    expect(ws.getCell(`A${total}`).value).toBe("予定金額 計［千円］");
    expect(ws.getCell(`A${total + 1}`).value).toBe("実績金額 計［千円］");
    expect(formulaAt(ws, `G${total}`)).toBe(`SUMIF($F$${FIRST_DATA_ROW}:$F$${last},"予定金額",G${FIRST_DATA_ROW}:G${last})`);
    expect(formulaAt(ws, `O${total + 1}`)).toBe(`SUMIF($F$${FIRST_DATA_ROW}:$F$${last},"実績金額",O${FIRST_DATA_ROW}:O${last})`);
    // 下の推移集計：このシートの合計と、続きのシートの合計（続きのシートも同じ数の行を足した）
    expect(formulaAt(ws, `B${SUMMARY_ROW + INSERTED}`)).toBe(`SUM(G${total}:O${total})+SUM('${SHEET_LATER}'!G${total}:O${total})`);
    expect(ws.getCell(`A${SUMMARY_ROW + 3 + INSERTED}`).value).toBe("金額はメーカー原価［千円・税抜］");
    // 結合：合計の行は下へ、明細の行の D:E は足した行にも
    const merges = ws.model.merges;
    expect(merges).toEqual(expect.arrayContaining([`A${total}:F${total}`, `D${last}:E${last}`, `D${TOTAL_ROW - 1}:E${TOTAL_ROW - 1}`, "D9:E9", "D7:E8"]));
    expect(merges).not.toContain(`A${TOTAL_ROW}:F${TOTAL_ROW}`);
    // 書き出して読み直せる（結合と式が壊れていない）
    const again = await load(await wb.xlsx.writeBuffer());
    const ws2 = again.getWorksheet(SHEET_FIRST)!;
    expect(formulaAt(ws2, `G${total}`)).toBe(`SUMIF($F$${FIRST_DATA_ROW}:$F$${last},"予定金額",G${FIRST_DATA_ROW}:G${last})`);
    expect(ws2.getCell("D12").value).toBe("架空のバケット");
    // 開いたときに計算し直させる
    const book = await (await JSZip.loadAsync(await wb.xlsx.writeBuffer())).file("xl/workbook.xml")!.async("string");
    expect(book).toContain('fullCalcOnLoad="1"');
  });

  it("続きのシート：同じ行の並びで、そのシートの年度（前のシートの年度から式で続く）だけを書く", async () => {
    const wb = await load(await templateBytes());
    const { summary } = fillLayout(wb, layoutFor(), input());
    const ws = wb.getWorksheet(SHEET_LATER)!;
    expect(summary.sheets[1]).toMatchObject({ sheet: SHEET_LATER, rows: ROWS, inserted: INSERTED, firstYear: 2009, lastYear: 2017 });
    expect(formulaAt(ws, "G8")).toBe(`'${SHEET_FIRST}'!O8+1`);
    expect(["G8", "H8", "O8"].map((a) => valueAt(ws, a))).toEqual([2009, 2010, 2017]);
    expect([ws.getCell("A9").value, ws.getCell("D12").value, ws.getCell("F12").value]).toEqual(["架空の受入設備", "架空のバケット", "予定内容"]);
    // 2010 年度（H）の予定：点検 2,000 千円。2015 年度（M）の予定：更新 12,000 千円
    expect([ws.getCell("H12").value, ws.getCell("H13").value, ws.getCell("M22").value, ws.getCell("M23").value]).toEqual(["点検", 2000, "更新", 12000]);
    // 前のシートの年度の実績は書かない
    expect(ws.getCell("H14").value).toBeNull();
    const total = TOTAL_ROW + INSERTED;
    expect(formulaAt(ws, `G${total}`)).toBe(`SUMIF($F$${FIRST_DATA_ROW}:$F$${total - 1},"予定金額",G${FIRST_DATA_ROW}:G${total - 1})`);
  });

  it("基本情報のシート：施設の項目にあるものだけを書き、無い項目は書かずに数える", async () => {
    const wb = await load(await templateBytes());
    const layout = layoutFor({ facility: { sheet: SHEET_INFO, cells: [{ field: "name", cell: "B4" }, { field: "scaleText", cell: "B7" }, { field: "scale", cell: "B8" }] } });
    const p = layoutPlan();
    p.facility.scale = null;
    const { summary } = fillLayout(wb, layout, { ...input(), plan: p });
    const ws = wb.getWorksheet(SHEET_INFO)!;
    expect(ws.getCell("B4").value).toBe("【架空】試験の施設");
    expect([ws.getCell("B7").value, ws.getCell("B8").value, ws.getCell("B5").value]).toEqual([null, null, null]);
    expect(summary.facility).toEqual({ written: 1, missing: ["scaleText", "scale"] });
    const wb2 = await load(await templateBytes());
    fillLayout(wb2, layoutFor(), input());
    expect(wb2.getWorksheet(SHEET_INFO)!.getCell("B7").value).toBe("150 t/日");
  });

  it("1 行に横に並べる書き方：組の最初の行に上の階層からの名前。組の無い節は行にしない。周期と次回は 1 つの列に", async () => {
    const wb = await load(await templateBytes());
    const base = layoutFor();
    const s = base.sheets[0]!;
    const layout = layoutFor({
      sheets: [
        {
          ...s,
          levels: { ...s.levels, mode: "flat" },
          group: { labelCol: "F", rows: [{ label: "星取", content: "marks", col: null }, { label: "周期", content: "cycle", col: "P" }] },
        },
      ],
    });
    const { summary } = fillLayout(wb, layout, input());
    const ws = wb.getWorksheet(SHEET_FIRST)!;
    expect(summary.sheets[0]).toMatchObject({ rows: 6, inserted: 0 });
    expect(["A9", "B9", "C9", "D9", "F9", "H9", "J9"].map((a) => ws.getCell(a).value)).toEqual(["架空の受入設備", "架空のクレーン", "1 号炉", "架空のバケット", "星取", "●", "●"]);
    expect(["A10", "F10", "P10"].map((a) => ws.getCell(a).value)).toEqual([null, "周期", 2]);
    expect(["A11", "C11", "D11", "G11"].map((a) => ws.getCell(a).value)).toEqual(["架空の受入設備", "2 号炉", null, "●"]);
    // きっかけ（10 年）のある作業の周期はきっかけから
    expect(["C13", "P14"].map((a) => ws.getCell(a).value)).toEqual(["1 号炉", 10]);
  });

  it("案が様式に合わなければ書かない（シートが無い・列が年度に重なる・col の要る行・式のある欄・年度の決まらない列）", async () => {
    const wb = await load(await templateBytes());
    const s = layoutFor().sheets[0]!;
    const bad = (o: Partial<typeof s>) => checkLayout(wb, layoutFor({ sheets: [{ ...s, ...o }], facility: null }), 2000);
    expect(checkLayout(wb, layoutFor(), 2000)).toEqual([]);
    expect(bad({ sheet: "無いシート" })).toEqual(["シート「無いシート」が様式に無い"]);
    expect(bad({ levels: { mode: "nested", columns: [{ level: 1, col: "G" }] } })[0]).toContain("年度の列に重なる");
    expect(bad({ group: { labelCol: "F", rows: [{ label: "周期", content: "cycle", col: null }] } })[0]).toContain("col が要る");
    expect(bad({ insertBefore: 9 })[0]).toContain("空行が 1 行も無い");
    expect(bad({ years: { row: 8, from: "G", to: "P", startCell: "C6" } })).toEqual([expect.stringContaining("年度が決まらない列：P")]);
    expect(bad({ insertBefore: 23 })).toEqual([expect.stringContaining("式がある")]);
    expect(bad({ years: { row: 8, from: "G", to: "O", startCell: "D6" } })).toEqual([expect.stringContaining("開始年度のセル D6 をたどっていない")]);
    expect(() => fillLayout(wb, layoutFor({ sheets: [{ ...s, sheet: "無いシート" }] }), input())).toThrow("無いシート");
    // 型：知らない欄・col の形の外れは型で断る
    expect(templateLayoutSchema.safeParse({ ...layoutFor(), extra: 1 }).success).toBe(false);
    expect(templateLayoutInputSchema.safeParse({ ...layoutFor(), template: "架空の様式" }).success).toBe(true);
  });

  it("見本の格子：様式の見た目のまま（結合・太字・背景）、書いたセルに印、年度の式は年度を出す", async () => {
    const wb = await load(await templateBytes());
    const layout = layoutFor();
    const { summary, rows } = fillLayout(wb, layout, input());
    const written = writtenCellsOf(layout, summary, rows, layoutPlan());
    const g = previewGrid(wb, SHEET_FIRST, FIRST_DATA_ROW + 9, [summary.sheets[0]!.totalRow], written.get(SHEET_FIRST)!)!;
    expect(g.rows.map((r) => r.n).slice(0, 3)).toEqual([1, 2, 3]);
    const row7 = g.rows.find((r) => r.n === 7)!;
    expect(row7.cells[0]).toMatchObject({ text: "設備", rowSpan: 2, colSpan: 1, bold: true, fill: "#E6EEF0" });
    expect(row7.cells[3]).toMatchObject({ text: "機器・部位", colSpan: 2, rowSpan: 2 });
    expect(row7.cells[4]).toBeNull();
    const row8 = g.rows.find((r) => r.n === 8)!;
    expect(row8.cells[6]).toMatchObject({ text: "2000", formula: true });
    expect(g.rows.find((r) => r.n === 12)!.cells[3]).toMatchObject({ text: "架空のバケット", written: true });
    const total = g.rows.at(-1)!;
    expect(total).toMatchObject({ n: summary.sheets[0]!.totalRow, gap: true });
    expect(total.cells[6]).toMatchObject({ text: "＝", formula: true });
    expect(written.get(SHEET_INFO)).toEqual(new Set(["B4", "B7"]));
  });
});

describe("写し方の形と、今の平らな様式", () => {
  it("写し方に案を入れられる。案の無い写し方は前と同じ形とハッシュ", () => {
    const flat: TemplateColumns = { schema: COLUMNS_SCHEMA, headerRow: 1, headers: ["設備名"], roles: [{ kind: "item" }] };
    expect(isTemplateColumns(flat)).toBe(true);
    expect(isTemplateColumns({ ...flat, layout: layoutFor() })).toBe(true);
    expect(isTemplateColumns({ ...flat, layout: { ...layoutFor(), schema: "x" } })).toBe(false);
    expect(columnsHash({ ...flat, layout: layoutFor() })).not.toBe(columnsHash(flat));
    expect(columnsHash(flat)).toBe(columnsHash({ schema: COLUMNS_SCHEMA, headerRow: 1, headers: ["設備名"], roles: [{ kind: "item" }] }));
  });

  it("writeTemplate：案の無い写し方は前と同じ平らな書き方、案のある写し方は案のとおり", async () => {
    const wb0 = new ExcelJS.Workbook();
    wb0.addWorksheet("様式").addRow(["設備名", "作業", "2001"]);
    const flatBytes = new Uint8Array(await wb0.xlsx.writeBuffer());
    const columns = { headerRow: 1, roles: [{ kind: "item" as const }, { kind: "work" as const }, { kind: "year" as const, fiscalYear: 2001 }] };
    const a = await writeTemplate(new ExcelJS.Workbook(), flatBytes, columns, input());
    const rows = templateRows(layoutPlan(), (x) => (catalog().workLabels as Record<string, string>)[x], "2026-11-07");
    const b = await fillTemplate(new ExcelJS.Workbook() as never, flatBytes, columns, rows);
    const [wa, wbb] = [await load(a.bytes), await load(b)];
    expect(a.summary).toBeNull();
    expect(wa.worksheets[0]!.getSheetValues()).toEqual(wbb.worksheets[0]!.getSheetValues());
    const c = await writeTemplate(new ExcelJS.Workbook(), await templateBytes(), { headerRow: 8, roles: [{ kind: "none" }], layout: layoutFor() }, input());
    expect(c.summary?.sheets.map((s) => s.rows)).toEqual([ROWS, ROWS]);
    expect((await load(c.bytes)).getWorksheet(SHEET_FIRST)!.getCell("D12").value).toBe("架空のバケット");
  });
});
