// 書き出し（docs/plan.md §2.9）：確定した計画を、人が見る様式の Excel にする。平らな表にはしない。
// - 星取表のシート：段の列（左に固定）と年度の列。親の名前は子の行まで縦に結合し、行はアウトラインで畳める（親が上）
// - 1 段目のまとまりごとに小計の行（年度ごとの印の数。式ではなく数の値。exceljs の式には計算済みの値が入らないため）
// - 共通の設備項目のシート（パックの名前の表があるときだけ）：人が受けた当てはめの行と、未当てはめの行の件数
// - 作業の行の右端に「次回｜期限｜根拠｜備考」の 4 列（docs/screens.md 3.5。字は画面と同じ due-view.ts。基準日は確定した日〔日本時間〕）
// - A3 横・幅を 1 頁に・見出しの行をくり返し印刷・ウィンドウ枠の固定・凡例・架空の計画は表題と作成者の欄に【架空】
// 行の組み方は画面の星取表と同じ関数（buildChart）。純粋な関数（ファイルは書かない。書くのは store.ts）。
import ExcelJS from "exceljs";
import type { Plan } from "../shared/plan";
import { fixWorkbook } from "./xlsx-fix";
import { buildChart, type ChartCatalog, type ChartLabels, type ChartModel, type ChartRow } from "./chart";
import { DUE_TEXT, dueBaseDate, planDueViews, rowDue, type DueView } from "./due-view";

/** 書き出しの言葉（Excel に書く言葉。画面の言葉は src/app/text/） */
export const EXPORT_TEXT = {
  sheetLedger: "星取表",
  sheetCommon: "共通の設備項目",
  title: "保全の計画（星取表）",
  fiction: "【架空】",
  plan: "計画",
  version: (n: number, at: string) => `第 ${n} 版（${at} に確定）`,
  legend: "凡例：○ 計画　● 実績　◎ 同じ年度に計画と実績　? 写真から読んで人がまだ確かめていない星取",
  fy: (y: number) => `${y} 年度`,
  subtotal: (name: string) => `小計（${name}）`,
  subtotalNote: "小計は、その年度に星取のある行の数",
  unmapped: (n: number) => `未紐付け（${n} 件）`,
  noCatalog: "このパックの名前の表が無いので、共通の設備項目のシートは作れません。",
  labels: {
    levelFallback: (n: number) => `第 ${n} 階層`,
    commonLevels: ["共通の設備", "共通の設備項目", "作業分類"] as [string, string, string],
    unmapped: "未紐付け",
    series: (s: string) => (s.startsWith("common.") ? s.slice("common.".length) || "共通" : `系列 ${s}`),
  } satisfies ChartLabels,
  mark: { plan: "○", actual: "●", both: "◎" } as Record<string, string>,
};

const HEADER_ROW = 6;
const OUTLINE_MAX = 7;
const FILL_HEAD = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EEF0" } } as const;
const FILL_SUB = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } } as const;
/** 印刷で行を追いやすくする細い罫（行の下、段の列と年度の列の境） */
const RULE = { style: "hair", color: { argb: "FFBBBBBB" } } as const;
const EDGE = { style: "thin", color: { argb: "FF888888" } } as const;

const N_DUE = DUE_TEXT.exportCols.length;

function ruleRow(row: ExcelJS.Row, nLevels: number, nYears: number): void {
  for (let c = 1; c <= nLevels + nYears + N_DUE; c++) {
    const cell = row.getCell(c);
    cell.border = { ...(cell.border ?? {}), bottom: RULE, ...(c === nLevels + 1 ? { left: EDGE } : {}) };
  }
}

export interface ExportInput {
  plan: Plan;
  version: number;
  /** 確定した時刻（ISO） */
  at: string;
  /** パックの名前の表（無ければ共通の設備項目のシートを作らない） */
  catalog: ChartCatalog | null;
  /** 名前の表が無いときも台帳の行は描けるように、作業の属性の名前だけの表 */
  emptyCatalog: ChartCatalog;
}

/** 1 つのシートを書く。返すのは書いたデータの行の数 */
function writeSheet(ws: ExcelJS.Worksheet, model: ChartModel, input: ExportInput, withSubtotals: boolean, due: ReadonlyMap<string, DueView>): number {
  const T = EXPORT_TEXT;
  const nLevels = model.levelNames.length;
  const years = model.periods;
  const fiction = input.plan.facility.fictional ? `　${T.fiction}` : "";
  ws.getCell(1, 1).value = `${T.title}${fiction}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getRow(2).values = [T.plan, input.plan.displayName];
  ws.getRow(3).values = ["", T.version(input.version, input.at.slice(0, 16).replace("T", " "))];
  ws.getCell(4, 1).value = T.legend;
  if (withSubtotals) ws.getCell(5, 1).value = T.subtotalNote;
  const head = ws.getRow(HEADER_ROW);
  head.values = [...model.levelNames, ...years.map((p) => T.fy(p.fiscalYear)), ...DUE_TEXT.exportCols];
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = FILL_HEAD;
    c.border = { bottom: { style: "thin" } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  // 年度の列は「2019 年度」が 1 行で収まる幅（Excel と LibreOffice の両方で確かめた幅）
  ws.columns = [...model.levelNames.map(() => ({ width: 22 })), ...years.map(() => ({ width: 11.5 })), { width: 13 }, { width: 13 }, { width: 16 }, { width: 26 }];

  let r = HEADER_ROW + 1;
  /** 段の列の縦の結合：段 j の名前を書いた行と、その下の子孫の行の最後 */
  const open: ({ from: number; to: number } | null)[] = Array.from({ length: nLevels }, () => null);
  const closeFrom = (j: number) => {
    for (let k = j; k < nLevels; k++) {
      const o = open[k];
      if (o && o.to > o.from) {
        ws.mergeCells(o.from, k + 1, o.to, k + 1);
        ws.getCell(o.from, k + 1).alignment = { vertical: "top", wrapText: true };
      }
      open[k] = null;
    }
  };
  /** 1 段目のまとまりの小計（年度ごとの印のある行の数） */
  let group: { name: string; counts: number[] } | null = null;
  const flushGroup = () => {
    if (!withSubtotals || !group) return;
    closeFrom(0);
    const row = ws.getRow(r);
    row.getCell(1).value = T.subtotal(group.name);
    group.counts.forEach((n, i) => {
      const c = row.getCell(nLevels + 1 + i);
      c.value = n;
      c.numFmt = "0";
      c.alignment = { horizontal: "center" };
    });
    row.font = { italic: true };
    row.eachCell({ includeEmpty: true }, (c) => (c.fill = FILL_SUB));
    row.outlineLevel = 0;
    ruleRow(row, nLevels, years.length);
    r++;
    group = null;
  };

  const rows: ChartRow[] = model.rows;
  for (const row of rows) {
    if (row.level === 1) {
      flushGroup();
      group = { name: row.path[0] ?? "", counts: years.map(() => 0) };
    }
    // この行の段より深い段の結合を閉じる。この行の段で新しい結合を始める
    closeFrom(row.level - 1);
    const xr = ws.getRow(r);
    row.levelCells.forEach((name, j) => {
      if (name !== "") xr.getCell(j + 1).value = row.kind === "unmapped" && row.count !== null ? T.unmapped(row.count) : name;
    });
    open[row.level - 1] = { from: r, to: r };
    for (let j = 0; j < row.level - 1; j++) {
      const o = open[j];
      if (o) o.to = r;
    }
    years.forEach((p, i) => {
      const cell = row.cells[p.key];
      if (!cell || cell.mark === null) return;
      const c = xr.getCell(nLevels + 1 + i);
      c.value = `${cell.review ? "?" : ""}${T.mark[cell.mark] ?? ""}`;
      c.alignment = { horizontal: "center" };
      if (group) group.counts[i]! += 1;
    });
    // 次回の 4 列：作業の行だけ
    const v = row.kind === "node" ? rowDue(row.works, due) : null;
    if (v) {
      [v.text, v.latest ?? "", v.basis ?? "", v.notes].forEach((x, k) => {
        if (x === "") return;
        const c = xr.getCell(nLevels + years.length + 1 + k);
        c.value = x;
        if (k < 2) c.alignment = { horizontal: "center" };
      });
    }
    xr.outlineLevel = Math.min(OUTLINE_MAX, Math.max(0, row.level - 1));
    ruleRow(xr, nLevels, years.length);
    r++;
  }
  flushGroup();
  closeFrom(0);
  return r - HEADER_ROW - 1;
}

function setupPrint(ws: ExcelJS.Worksheet, nLevels: number): void {
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 8 as unknown as ExcelJS.PaperSize, // A3（exceljs の型の一覧に無いが、Excel の用紙の番号）
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
  };
  ws.views = [{ state: "frozen", xSplit: nLevels, ySplit: HEADER_ROW }];
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
}

/** 確定した計画の、人が見る様式の Excel（xlsx のバイト列） */
export async function planWorkbook(input: ExportInput): Promise<Buffer> {
  const T = EXPORT_TEXT;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(input.at);
  if (input.plan.facility.fictional) wb.creator = T.fiction;
  const opts = { period: "year" as const, layer: "original" as const, foldLevel: null };

  const due = planDueViews(input.plan, dueBaseDate(input.at));
  const ledger = buildChart(input.plan, input.catalog ?? input.emptyCatalog, T.labels, { ...opts, mode: "ledger" });
  const ws1 = wb.addWorksheet(T.sheetLedger);
  writeSheet(ws1, ledger, input, true, due);
  setupPrint(ws1, ledger.levelNames.length);

  const ws2 = wb.addWorksheet(T.sheetCommon);
  if (input.catalog) {
    const common = buildChart(input.plan, input.catalog, T.labels, { ...opts, mode: "common" });
    writeSheet(ws2, common, input, false, due);
    setupPrint(ws2, common.levelNames.length);
  } else {
    ws2.getCell(1, 1).value = `${T.title}${input.plan.facility.fictional ? `　${T.fiction}` : ""}`;
    ws2.getCell(2, 1).value = T.noCatalog;
  }
  return fixWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
}
