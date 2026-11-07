// 様式の写し方の案（template-layout-v1）の試験の材料：運営者が試験に渡した様式の「形の説明」どおりの架空の様式を exceljs で組む。
// 実物の様式は持たない（形だけ。どの施設の様式にもある一般の形）。計画もすべて架空。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { catalogFromPack, type ChartCatalog } from "../../src/plan/chart";
import { LAYOUT_SCHEMA, type TemplateLayout } from "../../src/shared/template-layout";
import { asset, detail, plan, work, ROOT } from "../unit/share/fixtures";
import type { Plan } from "../../src/shared/plan";

export const SHEET_INFO = "基本情報";
export const SHEET_FIRST = "履歴・前期計画";
export const SHEET_LATER = "後期計画";
export const YEAR_COLS = ["G", "H", "I", "J", "K", "L", "M", "N", "O"];
/** 明細の空行（9〜19 行目）と合計の行（20・21 行目）。架空の計画は 17 行なので、6 行を足す */
export const FIRST_DATA_ROW = 9;
export const TOTAL_ROW = 20;
/** 推移集計（全期間）の予定金額の行 */
export const SUMMARY_ROW = TOTAL_ROW + 4;

const thin = { style: "thin" } as const;
const box = { top: thin, left: thin, bottom: thin, right: thin };

function planSheet(ws: ExcelJS.Worksheet, title: string, first: boolean): void {
  ws.getCell("A1").value = `【架空】${title}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  if (first) {
    ws.getCell("A6").value = "開始年度（西暦）";
    ws.mergeCells("A6:B6");
    ws.getCell("C6").value = 2000;
  }
  const head: [string, string][] = [
    ["A7:A8", "設備"],
    ["B7:B8", "機器種別"],
    ["C7:C8", "号炉・系統"],
    ["D7:E8", "機器・部位"],
    ["F7:F8", "記入区分"],
    ["P7:P8", "重要度・整備方針"],
  ];
  for (const [r, t] of head) {
    ws.mergeCells(r);
    const c = ws.getCell(r.split(":")[0]!);
    c.value = t;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EEF0" } };
  }
  if (first) {
    ws.mergeCells("G7:K7");
    ws.getCell("G7").value = "既往の整備履歴";
    ws.mergeCells("L7:O7");
    ws.getCell("L7").value = "前期計画";
    // 8 行目の年度：開始年度の欄から式で決まる（H8〜O8 は共有の式）
    ws.getCell("G8").value = { formula: "C6", result: 2000 };
    ws.fillFormula("H8:O8", "G8+1", [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008]);
  } else {
    ws.mergeCells("G7:O7");
    ws.getCell("G7").value = "後期計画";
    // 後期は前期の年度から式で続く
    ws.getCell("G8").value = { formula: `'${SHEET_FIRST}'!O8+1`, result: 2009 };
    YEAR_COLS.slice(1).forEach((c, i) => (ws.getCell(`${c}8`).value = { formula: `${YEAR_COLS[i]}8+1`, result: 2010 + i }));
  }
  for (let r = FIRST_DATA_ROW; r < TOTAL_ROW; r++) {
    ws.mergeCells(`D${r}:E${r}`);
    for (const c of ["A", "B", "C", "D", "F", ...YEAR_COLS, "P"]) ws.getCell(`${c}${r}`).border = box;
  }
  ws.mergeCells(`A${TOTAL_ROW}:F${TOTAL_ROW}`);
  ws.getCell(`A${TOTAL_ROW}`).value = "予定金額 計［千円］";
  ws.mergeCells(`A${TOTAL_ROW + 1}:F${TOTAL_ROW + 1}`);
  ws.getCell(`A${TOTAL_ROW + 1}`).value = "実績金額 計［千円］";
  for (const c of YEAR_COLS) {
    ws.getCell(`${c}${TOTAL_ROW}`).value = { formula: `SUMIF($F$${FIRST_DATA_ROW}:$F$${TOTAL_ROW - 1},"予定金額",${c}${FIRST_DATA_ROW}:${c}${TOTAL_ROW - 1})`, result: 0 };
    ws.getCell(`${c}${TOTAL_ROW + 1}`).value = { formula: `SUMIF($F$${FIRST_DATA_ROW}:$F$${TOTAL_ROW - 1},"実績金額",${c}${FIRST_DATA_ROW}:${c}${TOTAL_ROW - 1})`, result: 0 };
  }
  if (first) {
    ws.getCell(`A${SUMMARY_ROW - 1}`).value = "予定・実績金額の推移集計（全期間）";
    ws.getCell(`A${SUMMARY_ROW}`).value = "予定金額";
    ws.getCell(`B${SUMMARY_ROW}`).value = { formula: `SUM(G${TOTAL_ROW}:O${TOTAL_ROW})+SUM('${SHEET_LATER}'!G${TOTAL_ROW}:O${TOTAL_ROW})`, result: 0 };
    ws.getCell(`A${SUMMARY_ROW + 1}`).value = "実績金額";
    ws.getCell(`B${SUMMARY_ROW + 1}`).value = { formula: `SUM(G${TOTAL_ROW + 1}:O${TOTAL_ROW + 1})+SUM('${SHEET_LATER}'!G${TOTAL_ROW + 1}:O${TOTAL_ROW + 1})`, result: 0 };
  }
  ws.getCell(`A${SUMMARY_ROW + 3}`).value = "金額はメーカー原価［千円・税抜］";
  ws.getColumn("A").width = 16;
  ws.getColumn("D").width = 14;
}

/** 架空の様式（空の書式）：基本情報・履歴・前期計画・後期計画 */
export async function templateBytes(o: { filled?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet(SHEET_INFO);
  info.getCell("A1").value = "基本情報";
  const items = ["業務名", "施設名", "所在地", "竣工年月", "処理能力", "炉数"];
  items.forEach((t, i) => {
    info.getCell(`A${3 + i}`).value = t;
    info.mergeCells(`B${3 + i}:D${3 + i}`);
  });
  planSheet(wb.addWorksheet(SHEET_FIRST), "長寿命化計画（履歴・前期計画）", true);
  planSheet(wb.addWorksheet(SHEET_LATER), "長寿命化計画（後期計画）", false);
  if (o.filled) {
    // 値の入ったデータの行のある様式（字を Claude に返さない）
    const ws = wb.getWorksheet(SHEET_FIRST)!;
    ws.getCell("A9").value = "架空の秘密の設備";
    ws.getCell("D10").value = "架空の秘密の部位";
    ws.getCell("F10").value = "予定内容";
    ws.getCell("G10").value = "架空の秘密の作業";
    ws.getCell("F11").value = "予定金額";
    ws.getCell("G11").value = 1234.5;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** 運営者の説明どおりの写し方の案 */
export function layoutFor(o: Partial<TemplateLayout> = {}): TemplateLayout {
  const sheet = (name: string, continues: string | null) => ({
    sheet: name,
    headerRows: [7, 8],
    years: { row: 8, from: "G", to: "O", startCell: continues === null ? "C6" : null },
    levels: {
      mode: "nested" as const,
      columns: [
        { level: 1, col: "A" },
        { level: 2, col: "B" },
        { level: 3, col: "C" },
        { level: 4, col: "D" },
      ],
    },
    group: {
      labelCol: "F",
      rows: [
        { label: "予定内容", content: "plan_content" as const, col: null },
        { label: "予定金額", content: "plan_amount" as const, col: null },
        { label: "実績内容", content: "actual_content" as const, col: null },
        { label: "実績金額", content: "actual_amount" as const, col: null },
      ],
    },
    insertBefore: TOTAL_ROW,
    continues,
  });
  return {
    schema: LAYOUT_SCHEMA,
    levelOrder: "asset-first",
    startYear: null,
    amount: { unit: "thousand_yen", tax: "excl" },
    sheets: [sheet(SHEET_FIRST, null), sheet(SHEET_LATER, SHEET_FIRST)],
    facility: { sheet: SHEET_INFO, cells: [{ field: "name", cell: "B4" }, { field: "scaleText", cell: "B7" }] },
    ...o,
  };
}

export const catalog = (): ChartCatalog =>
  catalogFromPack({ systems: [], seriesUnit: "号炉" }, JSON.parse(readFileSync(join(ROOT, "packs", "_kinds", "work.json"), "utf8")));

const yen = (cost: number, tax: "incl" | "excl" | "unknown" = "excl") => ({ cost, costSource: { file: "架空.xlsx", sheet: "費用", ref: "C3", text: String(cost), tax } });

/**
 * 架空の計画：設備 2 つ › 機器（号炉で分かれる）› 部位。明細は 2000〜2017 年度の内と、外（2030 年度）に 1 つ。
 * 階層（星取表の施設台帳）：1 設備・2 機器・3 号炉・4 部位
 */
export function layoutPlan(): Plan {
  return plan({
    assets: [
      asset("s1", null, { name: "架空の受入設備", level: 1 }),
      asset("m1", null, { name: "架空のクレーン", level: 2, parentKey: "s1", series: "1" }),
      asset("m2", null, { name: "架空のクレーン", level: 2, parentKey: "s1", series: "2" }),
      asset("p1", null, { name: "架空のバケット", level: 3, parentKey: "m1" }),
      asset("s2", null, { name: "架空の燃焼設備", level: 1 }),
      asset("m3", null, { name: "架空の火格子", level: 2, parentKey: "s2", series: "1" }),
    ],
    works: [
      work("w1", "INSPECT", ["p1"]),
      work("w2", "OVERHAUL", ["p1"]),
      work("w3", "INSPECT", ["m2"]),
      work("w4", "REPLACE", ["m3"], { trigger: { branches: [{ kind: "calendar", years: 10 }], combine: "earliest" } }),
    ],
    details: [
      detail("d1", "w1", 2001, yen(1_234_567)),
      detail("d2", "w2", 2001, yen(500_000)),
      detail("d3", "w1", 2003, { planOrActual: "actual", cost: null }),
      detail("d4", "w1", 2010, { planOrActual: "plan", ...yen(2_000_000) }),
      detail("d5", "w3", 2002, yen(300_000, "incl")),
      detail("d6", "w4", 2005, yen(9_999)),
      detail("d7", "w4", 2015, { planOrActual: "plan", ...yen(12_000_000, "unknown") }),
      detail("d8", "w3", 2030, { planOrActual: "plan", ...yen(1_000) }),
      detail("d0", "w3", 2000, yen(1_000)),
    ],
  });
}
