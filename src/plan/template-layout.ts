// 様式の写し方の案（TemplateLayout。src/shared/template-layout.ts）で、版を様式の Excel に書く（仕事 template-layout-v1）。
// 純粋な関数（ExcelJS の読んだブックを受けて書き換える。ファイルは書かない）。画面（見本・人が押す出力）と橋渡し（署名して書き出す）の両方で使う。
// - 行の並びは星取表の施設台帳と同じ関数（buildChart）。階層の並びは案の levelOrder（施設ごとの見せ方は使わない：見本・出力・署名した書き出しを同じにする）
// - 入れ子の縦の書き方：組の無い節は 1 行（その階層の列に名前だけ）、作業の記録のある節は組の行（最初の行にその階層の列の名前）。
//   1 行に横に並べる書き方：組の最初の行に、上の階層からの名前を横に並べる。
// - 年度の列：開始年度のセルに版の最初の年度（案の startYear があればそれ）を書き、年度の見出しの式（=G6・=G8+1・='前'!O8+1 の形）をたどって列ごとの年度を出す。
// - 明細は合計の行（insertBefore）の前の空行に書く。足りなければ最後の空行の前に行を足し、合計の行とその下を下へずらし、ブックのすべての式の参照を直す
//   （空行の範囲を指す合計の式 =SUM(G9:G30) は、足した行まで広がる）。
// - 金額は明細の費用（円）の和を単位に合わせる（千円は ÷ 1000。丸めない）。税は換算しない（様式と違う・分からない明細は数える）。
// - 基本情報のシートは、計画の施設にある項目だけを書く（無い項目は書かずに数える）。
// 書かないもの・書けないものは、黙って捨てずに数えて返す（LayoutSummary）。
import type ExcelJS from "exceljs";
import type { Plan, WorkDetailT, WorkT } from "../shared/plan";
import { COLUMN_CONTENTS, type FacilityField, type GroupContent, type LayoutPlanSheet, type TemplateLayout, type TemplateShape, SHAPE_MAX_FORMULAS, SHAPE_MAX_MERGES, SHAPE_MAX_SHEETS, SHAPE_MAX_TEXT_CELLS, SHAPE_TEXT_MAX } from "../shared/template-layout";
import { buildChart, type ChartCatalog, type ChartLabels, type ChartRow } from "./chart";
import { planDueViews, rowDue } from "./due-view";
import { cycleFor, fiscalYearOfHeader, fillTemplate, templateRows, type TemplateColumns, type TemplateMark } from "./template";

/** 行の並びを組む星取表の言葉（Excel の標準の書き出しと同じ字。号炉・系統の行の名前に出る） */
export const LAYOUT_LABELS: ChartLabels = {
  levelFallback: (n: number) => `第 ${n} 階層`,
  commonLevels: ["共通の設備", "共通の設備項目", "作業分類"],
  unmapped: "未紐付け",
  series: (s: string) => (s.startsWith("common.") ? s.slice("common.".length) || "共通" : `系列 ${s}`),
};
const MARK_TEXT: Record<TemplateMark, string> = { plan: "○", actual: "●", both: "◎" };
/** 内容の欄で作業の言い方をつなぐ字 */
const JOIN = "、";
/** 年度の列の数の上限（1 枚のシート） */
const MAX_YEAR_COLS = 200;

// ─── セルの位置 ───────────────────────────────────────────────

export const colNum = (s: string): number => [...s.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
export function parseCell(a: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a);
  if (!m) return null;
  const col = colNum(m[1]!);
  const row = Number(m[2]);
  return col >= 1 && col <= 16384 && row >= 1 && row <= 1_048_576 ? { row, col } : null;
}
function parseRange(r: string): { top: number; left: number; bottom: number; right: number } | null {
  const [a, b] = r.split(":");
  const p = a ? parseCell(a) : null;
  const q = b ? parseCell(b) : p;
  if (!p || !q) return null;
  return { top: Math.min(p.row, q.row), left: Math.min(p.col, q.col), bottom: Math.max(p.row, q.row), right: Math.max(p.col, q.col) };
}
const rangeText = (r: { top: number; left: number; bottom: number; right: number }) =>
  r.top === r.bottom && r.left === r.right ? `${colLetter(r.left)}${r.top}` : `${colLetter(r.left)}${r.top}:${colLetter(r.right)}${r.bottom}`;

// ─── 式の参照 ─────────────────────────────────────────────────

/** シートの名前の前置き（'名前'! か 名前!） */
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([^\s'!"(),;:+\-*/^&=<>{}%\[\]]+))!`;
const REF_RE = new RegExp(String.raw`(?:${SHEET})?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?`, "y");
/** この字のあとからは参照を読まない（名前・関数の名前の途中） */
const NOT_START = /[A-Za-z0-9_.$'!\u0080-\uffff]/;
/** 参照のあとに続くと、参照ではない（関数の名前 LOG10( など） */
const NOT_END = /[A-Za-z0-9_(!]/;
const sameSheet = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase();

/** 式の中の参照を 1 つずつ書き換える（字の中は触らない）。fn は参照のシート（前置きが無ければ null）と行・列を受け、書き換えた行を返す */
function mapRefs(formula: string, fn: (sheet: string | null, row: number) => number): string {
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (i === 0 || !NOT_START.test(formula[i - 1]!)) {
      REF_RE.lastIndex = i;
      const m = REF_RE.exec(formula);
      if (m && !NOT_END.test(formula[REF_RE.lastIndex] ?? "")) {
        const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
        const c1 = colNum(m[4]!);
        const c2 = m[8] ? colNum(m[8]) : c1;
        if (c1 <= 16384 && c2 <= 16384) {
          const prefix = m[1] !== undefined ? `'${m[1]}'!` : m[2] !== undefined ? `${m[2]}!` : "";
          let text = `${prefix}${m[3]}${m[4]}${m[5]}${fn(sheet, Number(m[6]))}`;
          if (m[7] !== undefined) text += `:${m[7]}${m[8]}${m[9]}${fn(sheet, Number(m[10]))}`;
          out += text;
          i = REF_RE.lastIndex;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 行を足したときの式の書き換え：target のシートの at 行から下を指す参照を count 行下げる（範囲の終わりだけが at から下なら、範囲が広がる）。
 * own は式の置かれたシート（前置きの無い参照はそのシート）。行だけの範囲（5:9）と名前の参照は書き換えない
 */
export function shiftFormulaRows(formula: string, own: string, target: string, at: number, count: number): string {
  return mapRefs(formula, (sheet, row) => (sameSheet(sheet ?? own, target) && row >= at ? row + count : row));
}

const YEAR_REF = new RegExp(String.raw`^\s*=?\s*(?:${SHEET})?\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*(?:([+-])\s*(\d{1,3}))?\s*$`);

/** 年度の参照の式（=G6・=$G$6・=G8+1・='前のシート'!O8+1）なら、参照のシート（前置きが無ければ null）・セル・足す数 */
export function yearRefOf(formula: string): { sheet: string | null; cell: string; add: number } | null {
  const m = YEAR_REF.exec(formula);
  if (!m) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
  const c = parseCell(`${m[3]}${m[4]}`);
  if (!c) return null;
  const n = m[6] ? Number(m[6]) * (m[5] === "-" ? -1 : 1) : 0;
  return { sheet, cell: `${colLetter(c.col)}${c.row}`, add: n };
}

// ─── セルの値 ─────────────────────────────────────────────────

type CellLike = { value: ExcelJS.CellValue; text?: string; formula?: string; isMerged?: boolean; master?: { address: string }; address: string };

function formulaOf(cell: CellLike): string | null {
  const v = cell.value as { formula?: string; sharedFormula?: string } | null;
  if (!v || typeof v !== "object" || v instanceof Date) return null;
  if (typeof v.formula === "string") return v.formula;
  if (typeof v.sharedFormula === "string") return cell.formula ?? null;
  return null;
}

function textOf(v: ExcelJS.CellValue): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return null;
}

const isYearNumber = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2200;

/** ブックの共有の式をふつうの式にする（行を動かす前に。共有の元の位置がずれると式が壊れるため） */
function unshareFormulas(wb: ExcelJS.Workbook): void {
  for (const ws of wb.worksheets) {
    const fix: { cell: ExcelJS.Cell; formula: string; result: unknown }[] = [];
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string; sharedFormula?: string; shareType?: string; result?: unknown } | null;
        if (!v || typeof v !== "object" || v instanceof Date) return;
        if (typeof v.sharedFormula === "string" || v.shareType === "shared") {
          const f = (cell as unknown as CellLike).formula ?? v.formula;
          if (typeof f === "string") fix.push({ cell, formula: f, result: v.result });
        }
      }),
    );
    for (const x of fix) x.cell.value = { formula: x.formula, ...(x.result !== undefined ? { result: x.result } : {}) } as ExcelJS.CellValue;
  }
}

/** ブックのすべての式を書き換える（書き換えた式の計算済みの値は捨てる。開いたときに計算し直す） */
function rewriteFormulas(wb: ExcelJS.Workbook, fn: (formula: string, own: string) => string): void {
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string; result?: unknown; shareType?: string; ref?: string } | null;
        if (!v || typeof v !== "object" || v instanceof Date || typeof v.formula !== "string") return;
        const next = fn(v.formula, ws.name);
        if (next !== v.formula) cell.value = { ...v, formula: next, result: undefined } as ExcelJS.CellValue;
      }),
    );
  }
}

const copyStyle = <T>(s: T): T => (s ? (JSON.parse(JSON.stringify(s)) as T) : s);

/**
 * シートの at 行の前に count 行を足す：at 行から下の行（値・書式・高さ）を下げ、結合と、ブックのすべての式の参照・条件付き書式・名前の範囲を直す。
 * 足した行は、もとの at 行の書式（1 行の中の結合も）を写した空の行
 */
export function insertRows(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, at: number, count: number): void {
  if (count <= 0) return;
  const merges = (ws.model.merges ?? []).map((m) => ({ text: m, r: parseRange(m) })).filter((m): m is { text: string; r: NonNullable<ReturnType<typeof parseRange>> } => m.r !== null);
  const moving = merges.filter((m) => m.r.bottom >= at);
  for (const m of moving) ws.unMergeCells(m.text);
  const last = ws.rowCount;
  const maxCol = Math.max(ws.columnCount, 1);
  for (let r = last; r >= at; r--) {
    const src = ws.getRow(r);
    const dst = ws.getRow(r + count);
    dst.height = src.height;
    dst.hidden = src.hidden;
    dst.outlineLevel = src.outlineLevel;
    for (let c = 1; c <= maxCol; c++) {
      const s = src.getCell(c);
      const d = dst.getCell(c);
      d.value = s.value;
      d.style = copyStyle(s.style);
      s.value = null;
    }
  }
  // 足した行：もとの at 行（今は at + count）の書式
  const model = ws.getRow(at + count);
  for (let i = 0; i < count; i++) {
    const row = ws.getRow(at + i);
    row.height = model.height;
    row.outlineLevel = model.outlineLevel;
    row.hidden = model.hidden;
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = copyStyle(model.getCell(c).style);
    }
  }
  const mergeWithoutStyle = (r: { top: number; left: number; bottom: number; right: number }) =>
    (ws as unknown as { mergeCellsWithoutStyle(t: number, l: number, b: number, rr: number): void }).mergeCellsWithoutStyle(r.top, r.left, r.bottom, r.right);
  for (const m of moving) mergeWithoutStyle({ ...m.r, top: m.r.top >= at ? m.r.top + count : m.r.top, bottom: m.r.bottom + count });
  // もとの at 行の中だけの結合（D:E など）は、足した行にも写す
  for (const m of moving.filter((x) => x.r.top === at && x.r.bottom === at)) for (let i = 0; i < count; i++) mergeWithoutStyle({ ...m.r, top: at + i, bottom: at + i });
  rewriteFormulas(wb, (f, own) => shiftFormulaRows(f, own, ws.name, at, count));
  // 条件付き書式の範囲
  const cfs = (ws as unknown as { conditionalFormattings?: { ref: string }[] }).conditionalFormattings ?? [];
  for (const cf of cfs) cf.ref = cf.ref.split(/\s+/).map((x) => shiftFormulaRows(x, ws.name, ws.name, at, count)).join(" ");
  // 印刷範囲と名前の範囲
  if (ws.pageSetup?.printArea) ws.pageSetup.printArea = ws.pageSetup.printArea.split(",").map((x) => shiftFormulaRows(x, ws.name, ws.name, at, count)).join(",");
  (wb as unknown as { definedNames?: { spliceRows(sheet: string, start: number, del: number, ins: number): void } }).definedNames?.spliceRows(ws.name, at, 0, count);
}

// ─── 様式の形（Claude に返す） ─────────────────────────────────────

/**
 * 様式の形：シートの名前・大きさ、字のあるセルの位置と字、結合、式のあるセルの位置（年度の参照の式だけ中身）。
 * 値の入ったデータの行（年度らしくない数・日付・真偽のある行。見出しの塊のあとからその最後の行まで）は、字を返さずに範囲とセルの数だけ。
 * 値のセルの中身はどこにあっても返さない
 */
export function templateShape(wb: ExcelJS.Workbook, name: string): TemplateShape {
  const sheets: TemplateShape["sheets"] = [];
  for (const ws of wb.worksheets.slice(0, SHAPE_MAX_SHEETS)) {
    type Item = { row: number; col: number; kind: "text" | "value" | "formula"; text: string; formula: string | null };
    const items: Item[] = [];
    ws.eachRow((row, r) =>
      row.eachCell((cell, c) => {
        const cl = cell as unknown as CellLike;
        if (cl.isMerged && cl.master && cl.master.address !== cell.address) return;
        const f = formulaOf(cl);
        if (f !== null) return void items.push({ row: r, col: c, kind: "formula", text: "", formula: f });
        const v = cell.value;
        const t = textOf(v);
        if (t !== null) {
          if (t.trim() !== "") items.push({ row: r, col: c, kind: "text", text: t.trim(), formula: null });
          return;
        }
        if (typeof v === "number") return void items.push({ row: r, col: c, kind: isYearNumber(v) ? "text" : "value", text: isYearNumber(v) ? String(v) : "", formula: null });
        if (v instanceof Date || typeof v === "boolean") items.push({ row: r, col: c, kind: "value", text: "", formula: null });
      }),
    );
    const merges = (ws.model.merges ?? []).filter((m) => parseRange(m) !== null);
    const valueRows = items.filter((x) => x.kind === "value").map((x) => x.row);
    let dataRows: TemplateShape["sheets"][number]["dataRows"] = null;
    if (valueRows.length) {
      const first = Math.min(...valueRows);
      const lastRow = Math.max(...valueRows);
      // 見出しの塊の終わり：データの行より上の、縦の結合の下端と年度の参照の式の行のいちばん下。どちらも無ければ、字の欄がいちばん多い行
      const ends: number[] = [];
      for (const m of merges) {
        const r = parseRange(m)!;
        if (r.bottom > r.top && r.top < first) ends.push(r.bottom);
      }
      for (const x of items) if (x.kind === "formula" && x.row < first && yearRefOf(x.formula ?? "") !== null) ends.push(x.row);
      let headEnd = ends.length ? Math.max(...ends) : 0;
      if (!ends.length) {
        const textCount = new Map<number, number>();
        for (const x of items) if (x.kind === "text" && x.row < first) textCount.set(x.row, (textCount.get(x.row) ?? 0) + 1);
        headEnd = [...textCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
      }
      const from = Math.max(Math.min(first, headEnd + 1), 1);
      if (from <= lastRow) dataRows = { from, to: lastRow, cells: items.filter((x) => x.kind !== "formula" && x.row >= from && x.row <= lastRow).length };
      else dataRows = { from: first, to: lastRow, cells: items.filter((x) => x.kind === "value").length };
    }
    const hidden = (r: number) => dataRows !== null && r >= dataRows.from && r <= dataRows.to;
    const texts = items.filter((x) => x.kind === "text" && !hidden(x.row));
    const formulas = items.filter((x) => x.kind === "formula");
    sheets.push({
      name: ws.name,
      rows: ws.rowCount,
      cols: ws.columnCount,
      texts: texts.slice(0, SHAPE_MAX_TEXT_CELLS).map((x) => ({ cell: `${colLetter(x.col)}${x.row}`, text: x.text.slice(0, SHAPE_TEXT_MAX) })),
      textsTotal: texts.length,
      merges: merges.slice(0, SHAPE_MAX_MERGES),
      formulas: formulas.slice(0, SHAPE_MAX_FORMULAS).map((x) => ({ cell: `${colLetter(x.col)}${x.row}`, yearRef: yearRefOf(x.formula ?? "") })),
      formulasTotal: formulas.length,
      dataRows,
    });
  }
  return { name, sheets, sheetsTotal: wb.worksheets.length };
}

// ─── 年度の列 ─────────────────────────────────────────────────

/** 年度の列の範囲（列の番号） */
const yearCols = (s: LayoutPlanSheet): number[] => {
  const a = colNum(s.years.from);
  const b = colNum(s.years.to);
  return a <= b && b - a < MAX_YEAR_COLS ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [];
};

/**
 * 案のシートごとの、年度の列 → 年度。開始年度のセルは startYear、式は年度の参照の形だけをたどる（ほかの式・空のセルは null）。
 * 見出しの字は R8・令和8年度・2026・2026年度・FY2026 など（plan/template.ts の fiscalYearOfHeader）
 */
export function layoutYears(wb: ExcelJS.Workbook, layout: TemplateLayout, startYear: number): Map<string, Map<number, number | null>> {
  const starts = new Map<string, number>();
  for (const s of layout.sheets) if (s.years.startCell) starts.set(`${s.sheet}!${s.years.startCell}`, startYear);
  const memo = new Map<string, number | null>();
  const resolve = (sheet: string, address: string, depth: number): number | null => {
    const key = `${sheet}!${address}`;
    if (starts.has(key)) return starts.get(key)!;
    if (memo.has(key)) return memo.get(key)!;
    if (depth > 60) return null;
    memo.set(key, null);
    const ws = wb.worksheets.find((w) => sameSheet(w.name, sheet));
    let out: number | null = null;
    if (ws) {
      const cell = ws.getCell(address) as unknown as CellLike;
      const f = formulaOf(cell);
      if (f !== null) {
        const ref = yearRefOf(f);
        if (ref) {
          const base = resolve(ref.sheet ?? ws.name, ref.cell, depth + 1);
          out = base === null ? null : base + ref.add;
        }
      } else if (typeof cell.value === "number") out = isYearNumber(cell.value) ? cell.value : null;
      else {
        const t = textOf(cell.value);
        out = t === null ? null : fiscalYearOfHeader(t);
      }
    }
    memo.set(key, out);
    return out;
  };
  const result = new Map<string, Map<number, number | null>>();
  for (const s of layout.sheets) {
    const m = new Map<number, number | null>();
    for (const c of yearCols(s)) m.set(c, resolve(s.sheet, `${colLetter(c)}${s.years.row}`, 0));
    result.set(s.sheet, m);
  }
  return result;
}

// ─── 案の確かめ ───────────────────────────────────────────────

/** 書く前の確かめ：案が様式に合うか。合わない所を短い文で返す（空なら書ける） */
export function checkLayout(wb: ExcelJS.Workbook, layout: TemplateLayout, startYear: number): string[] {
  const p: string[] = [];
  const sheetOf = (n: string) => wb.worksheets.find((w) => sameSheet(w.name, n));
  const seen = new Set<string>();
  layout.sheets.forEach((s, i) => {
    const ws = sheetOf(s.sheet);
    if (!ws) return void p.push(`シート「${s.sheet}」が様式に無い`);
    if (seen.has(s.sheet)) p.push(`シート「${s.sheet}」が 2 回ある`);
    seen.add(s.sheet);
    if (i === 0 && s.continues !== null) p.push(`最初のシート「${s.sheet}」は続きにできない（continues は null）`);
    if (s.continues !== null && !layout.sheets.slice(0, i).some((x) => x.sheet === s.continues)) p.push(`「${s.sheet}」の continues「${s.continues}」が前のシートに無い`);
    const headEnd = Math.max(...s.headerRows);
    const first = headEnd + 1;
    if (s.insertBefore <= first) p.push(`「${s.sheet}」の insertBefore（${s.insertBefore}）の前に、見出しの下の空行が 1 行も無い`);
    if (s.years.row > headEnd) p.push(`「${s.sheet}」の年度の行（${s.years.row}）が見出しの行より下`);
    const ys = yearCols(s);
    if (ys.length === 0) p.push(`「${s.sheet}」の年度の列 ${s.years.from}〜${s.years.to} が読めない（左から右へ ${MAX_YEAR_COLS} 列まで）`);
    if (s.years.startCell) {
      const c = parseCell(s.years.startCell)!;
      if (c.row >= first) p.push(`「${s.sheet}」の開始年度のセル ${s.years.startCell} が明細の行にある`);
    }
    const inYears = (c: number) => ys.includes(c);
    const used = new Map<number, string>();
    const use = (letter: string, what: string) => {
      const c = colNum(letter);
      if (inYears(c)) p.push(`「${s.sheet}」の${what}の列 ${letter} が年度の列に重なる`);
      const was = used.get(c);
      if (was && was !== what) p.push(`「${s.sheet}」の列 ${letter} に${was}と${what}が重なる`);
      used.set(c, what);
    };
    const levels = new Set<number>();
    for (const l of s.levels.columns) {
      if (levels.has(l.level)) p.push(`「${s.sheet}」の階層 ${l.level} が 2 回ある`);
      levels.add(l.level);
      use(l.col, `階層 ${l.level}`);
    }
    if (s.group.labelCol) use(s.group.labelCol, "組のラベル");
    for (const g of s.group.rows) {
      const one = COLUMN_CONTENTS.includes(g.content);
      if (one && !g.col) p.push(`「${s.sheet}」の組の行「${g.label}」（${g.content}）に col が要る`);
      if (!one && g.col) p.push(`「${s.sheet}」の組の行「${g.label}」（${g.content}）は年度の列に書くので col は null`);
      if (one && g.col) use(g.col, `組の行「${g.label}」`);
    }
    // 明細を書く欄に式があれば書かない（様式の式を消さない）
    rows: for (let r = first; r < s.insertBefore; r++) {
      for (const c of [...used.keys(), ...ys]) {
        if (formulaOf(ws.getCell(r, c) as unknown as CellLike) !== null) {
          p.push(`「${s.sheet}」の明細の欄 ${colLetter(c)}${r} に式がある`);
          break rows;
        }
      }
    }
  });
  if (p.length === 0) {
    const years = layoutYears(wb, layout, startYear);
    // 開始年度のセルを、年度の見出しがたどっているか（年度を 1 つ変えて、列の年度が動くか）
    const moved = layoutYears(wb, layout, startYear + 1);
    for (const s of layout.sheets) {
      if (!s.years.startCell) continue;
      const a = years.get(s.sheet)!;
      const b = moved.get(s.sheet)!;
      if ([...a.entries()].every(([c, y]) => y === null || b.get(c) === y)) p.push(`「${s.sheet}」の年度の見出しが開始年度のセル ${s.years.startCell} をたどっていない`);
    }
    const all = new Set<number>();
    for (const s of layout.sheets) {
      const m = years.get(s.sheet)!;
      const missing = [...m.entries()].filter(([, y]) => y === null).map(([c]) => colLetter(c));
      if (missing.length) p.push(`「${s.sheet}」の年度が決まらない列：${missing.slice(0, 8).join("・")}（見出しの字か、開始年度のセルからの式 =G6・=G8+1 の形だけを読む）`);
      for (const y of m.values()) {
        if (y === null) continue;
        if (all.has(y)) p.push(`${y} 年度の列が 2 つある（シートをまたいでも 1 つ）`);
        all.add(y);
      }
    }
  }
  if (layout.facility) {
    const ws = sheetOf(layout.facility.sheet);
    if (!ws) p.push(`基本情報のシート「${layout.facility.sheet}」が様式に無い`);
    const cells = new Set<string>();
    for (const c of layout.facility.cells) {
      if (cells.has(c.cell)) p.push(`基本情報の欄 ${c.cell} が 2 回ある`);
      cells.add(c.cell);
      if (ws && formulaOf(ws.getCell(c.cell) as unknown as CellLike) !== null) p.push(`基本情報の欄 ${c.cell} に式がある`);
    }
    if (layout.sheets.some((s) => sameSheet(s.sheet, layout.facility!.sheet))) p.push(`基本情報のシート「${layout.facility.sheet}」が計画の表のシートと同じ`);
  }
  return p;
}

// ─── 行を組む ─────────────────────────────────────────────────

export interface LayoutInput {
  plan: Plan;
  /** パックの名前の表（作業の言い方・号炉・系統の単位） */
  catalog: ChartCatalog;
  /** 次回の基準日（版を確定した日。作業中の版なら今日） */
  asOf: string;
}

/** 書いた行（見本と試験が読む） */
export interface OutRow {
  /** 階層の列 → 名前 */
  names: { col: string; text: string }[];
  /** 組の行なら、その節と組の何行目か */
  group: { row: ChartRow; index: number } | null;
}

export interface LayoutSummary {
  /** 計画の表のシートごと：書いた行の数・足した行の数・年度の範囲・年度の列 → 年度・合計の行の移った先 */
  sheets: { sheet: string; rows: number; inserted: number; firstYear: number | null; lastYear: number | null; yearOf: Record<string, number>; firstRow: number; totalRow: number }[];
  /** 開始年度のセルに書いた年度（決まらなければ null） */
  startYear: number | null;
  /** 書いた明細（組の行の節にあるもの） */
  details: number;
  /** 年度の列の外の明細（書かない） */
  outOfRange: number;
  /** 金額の行に入る明細のうち、費用の無いもの */
  amountMissing: number;
  /** 様式と税の違う金額・税の分からない金額（換算せずに書いた） */
  taxMismatch: number;
  taxUnknown: number;
  /** 列の無い階層の組の名前（いちばん深い列に書いた）と、列の無い階層の組の無い節（書かない） */
  namesWithoutColumn: number;
  levelsSkipped: number;
  /** 対象の機器が計画に無い明細（書けない） */
  orphans: number;
  /** 基本情報：書いた欄と、計画の施設に無い項目 */
  facility: { written: number; missing: FacilityField[] };
}

/** 版の最初の年度（明細が無ければ null） */
export function firstFiscalYear(plan: Plan): number | null {
  return plan.details.length ? plan.details.reduce((m, d) => Math.min(m, d.fiscalYear), Infinity) : null;
}

/** 案の levelOrder で、施設台帳の行（畳まない） */
function chartRows(input: LayoutInput, layout: TemplateLayout) {
  return buildChart(input.plan, input.catalog, LAYOUT_LABELS, { mode: "ledger", period: "year", layer: "original", foldLevel: null, levelOrder: layout.levelOrder });
}

/** 計画の表の 1 枚に書く行（入れ子か横並び） */
export function layoutRows(rows: readonly ChartRow[], s: LayoutPlanSheet, counts?: { namesWithoutColumn: number; levelsSkipped: number }): OutRow[] {
  const colOf = new Map(s.levels.columns.map((c) => [c.level, c.col]));
  const deepest = [...s.levels.columns].sort((a, b) => b.level - a.level)[0]!.col;
  const out: OutRow[] = [];
  for (const r of rows) {
    if (r.kind !== "node") continue;
    const hasGroup = r.detailKeys.length > 0 || (r.works?.length ?? 0) > 0;
    const name = r.path[r.level - 1] ?? "";
    const col = colOf.get(r.level);
    if (s.levels.mode === "nested") {
      if (!hasGroup) {
        if (col) out.push({ names: [{ col, text: name }], group: null });
        else if (counts) counts.levelsSkipped++;
        continue;
      }
      if (!col && counts) counts.namesWithoutColumn++;
      s.group.rows.forEach((_, i) => out.push({ names: i === 0 ? [{ col: col ?? deepest, text: name }] : [], group: { row: r, index: i } }));
      continue;
    }
    if (!hasGroup) continue;
    const names = new Map<string, string>();
    for (const c of s.levels.columns) {
      const t = r.path[c.level - 1];
      if (t) names.set(c.col, t);
    }
    if (!col) {
      names.set(deepest, name);
      if (counts) counts.namesWithoutColumn++;
    }
    s.group.rows.forEach((_, i) => out.push({ names: i === 0 ? [...names.entries()].map(([c, text]) => ({ col: c, text })) : [], group: { row: r, index: i } }));
  }
  return out;
}

const workLabel = (w: WorkT, catalog: ChartCatalog): string => (w.attribute ? (catalog.workLabels as Record<string, string>)[w.attribute] : undefined) ?? w.kind;

/** 案の見込み（書く前に数える。ブックは読むだけ）：書く行・年度・数えたもの。合わない所があれば problems */
export interface LayoutPlanResult {
  problems: string[];
  summary: LayoutSummary;
  rows: Map<string, OutRow[]>;
  years: Map<string, Map<number, number | null>>;
  /** 組の行の 1 つのセルの値（年度の列は year、1 つの列は null） */
  valueOf: (r: ChartRow, content: GroupContent, year: number | null) => string | number | null;
}

/** 案のとおりに書いたら、どうなるか（ブックは書き換えない。screen_set の答えと、画面の見本の数に使う） */
export function planLayout(wb: ExcelJS.Workbook, layout: TemplateLayout, input: LayoutInput): LayoutPlanResult {
  const { plan, catalog } = input;
  const startYear = layout.startYear ?? firstFiscalYear(plan);
  const problems = checkLayout(wb, layout, startYear ?? 2000);
  const years = problems.length ? new Map<string, Map<number, number | null>>() : layoutYears(wb, layout, startYear ?? 2000);
  const model = chartRows(input, layout);
  const details = new Map(plan.details.map((d) => [d.detailKey, d]));
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const due = planDueViews(plan, input.asOf);
  const counts = { namesWithoutColumn: 0, levelsSkipped: 0 };
  const allYears = new Set<number>();
  for (const m of years.values()) for (const y of m.values()) if (y !== null) allYears.add(y);
  const unit = layout.amount.unit === "thousand_yen" ? 1000 : 1;

  // 数える：組の行の節の明細（年度の外・費用の無いもの・税）
  const groupDetails = new Set<string>();
  for (const r of model.rows) if (r.kind === "node") for (const k of r.detailKeys) groupDetails.add(k);
  const contents = new Set(layout.sheets.flatMap((s) => s.group.rows.map((g) => g.content)));
  let outOfRange = 0;
  let amountMissing = 0;
  let taxMismatch = 0;
  let taxUnknown = 0;
  for (const k of groupDetails) {
    const d = details.get(k)!;
    if (!allYears.has(d.fiscalYear)) {
      outOfRange++;
      continue;
    }
    const amountRow = d.planOrActual === "plan" ? contents.has("plan_amount") : contents.has("actual_amount");
    if (!amountRow) continue;
    if (d.cost === null) amountMissing++;
    else if (!d.costSource || d.costSource.tax === "unknown") taxUnknown++;
    else if (layout.amount.tax !== "unknown" && d.costSource.tax !== layout.amount.tax) taxMismatch++;
  }

  const valueOf = (r: ChartRow, content: GroupContent, year: number | null): string | number | null => {
    const ds = r.detailKeys.map((k) => details.get(k)!).filter((d) => year === null || d.fiscalYear === year);
    const side = (want: "plan" | "actual") => ds.filter((d) => d.planOrActual === want);
    const text = (xs: WorkDetailT[]) => {
      const labels = [...new Set(xs.map((d) => works.get(d.workKey)).filter((w): w is WorkT => !!w).map((w) => workLabel(w, catalog)))];
      return labels.length ? labels.join(JOIN) : null;
    };
    const amount = (xs: WorkDetailT[]) => {
      const cs = xs.map((d) => d.cost).filter((c): c is number => c !== null);
      return cs.length ? cs.reduce((a, b) => a + b, 0) / unit : null;
    };
    switch (content) {
      case "plan_content":
        return text(side("plan"));
      case "actual_content":
        return text(side("actual"));
      case "plan_amount":
        return amount(side("plan"));
      case "actual_amount":
        return amount(side("actual"));
      case "marks": {
        const p = side("plan").length > 0;
        const a = side("actual").length > 0;
        return p && a ? MARK_TEXT.both : p ? MARK_TEXT.plan : a ? MARK_TEXT.actual : null;
      }
      case "cycle": {
        const ws = (r.works ?? []).map((k) => works.get(k)).filter((w): w is WorkT => !!w);
        return cycleFor(ws, [...new Set(ds.map((d) => d.fiscalYear))]);
      }
      case "next":
        return rowDue(r.works, due)?.text ?? null;
    }
  };

  const sheets: LayoutSummary["sheets"] = [];
  const rows = new Map<string, OutRow[]>();
  for (const s of layout.sheets) {
    const out = layoutRows(model.rows, s, s === layout.sheets[0] ? counts : undefined);
    rows.set(s.sheet, out);
    const first = Math.max(...s.headerRows) + 1;
    const extra = Math.max(0, out.length - (s.insertBefore - first));
    const ym = years.get(s.sheet) ?? new Map<number, number | null>();
    const ys = [...ym.values()].filter((y): y is number => y !== null);
    sheets.push({
      sheet: s.sheet,
      rows: out.length,
      inserted: extra,
      firstYear: ys.length ? Math.min(...ys) : null,
      lastYear: ys.length ? Math.max(...ys) : null,
      yearOf: Object.fromEntries([...ym.entries()].filter(([, y]) => y !== null).map(([c, y]) => [colLetter(c), y as number])),
      firstRow: first,
      totalRow: s.insertBefore + extra,
    });
  }
  const facility: LayoutSummary["facility"] = { written: 0, missing: [] };
  for (const c of layout.facility?.cells ?? []) {
    if (facilityValue(plan, c.field) === null) facility.missing.push(c.field);
    else facility.written++;
  }
  return {
    problems,
    summary: {
      sheets,
      startYear,
      details: groupDetails.size - outOfRange,
      outOfRange,
      amountMissing,
      taxMismatch,
      taxUnknown,
      namesWithoutColumn: counts.namesWithoutColumn,
      levelsSkipped: counts.levelsSkipped,
      orphans: model.orphanDetails.length,
      facility,
    },
    rows,
    years,
    valueOf,
  };
}

/**
 * TemplateLayout に従って、版を様式に書く（wb は様式を読んだブック。書き換える）。
 * 案が様式に合わなければ書かずに投げる（画面と screen_set は先に planLayout で確かめる）
 */
export function fillLayout(wb: ExcelJS.Workbook, layout: TemplateLayout, input: LayoutInput): { summary: LayoutSummary; rows: Map<string, OutRow[]> } {
  const planned = planLayout(wb, layout, input);
  if (planned.problems.length) throw new Error(planned.problems.join("\n"));
  const { summary, rows, years, valueOf } = planned;
  unshareFormulas(wb);
  for (const s of layout.sheets) {
    const ws = wb.worksheets.find((w) => sameSheet(w.name, s.sheet))!;
    const out = rows.get(s.sheet)!;
    const sum = summary.sheets.find((x) => x.sheet === s.sheet)!;
    // 最後の空行の前に足す（空行の範囲を指す合計の式が、足した行まで広がる）
    if (sum.inserted > 0) insertRows(wb, ws, s.insertBefore - 1, sum.inserted);
    const ym = years.get(s.sheet)!;
    out.forEach((o, i) => {
      const r = sum.firstRow + i;
      for (const n of o.names) ws.getCell(`${n.col}${r}`).value = n.text;
      if (!o.group) return;
      const g = s.group.rows[o.group.index]!;
      if (s.group.labelCol) ws.getCell(`${s.group.labelCol}${r}`).value = g.label;
      if (COLUMN_CONTENTS.includes(g.content)) {
        const v = valueOf(o.group.row, g.content, null);
        if (v !== null && v !== "") ws.getCell(`${g.col}${r}`).value = v;
        return;
      }
      for (const [c, y] of ym) {
        if (y === null) continue;
        const v = valueOf(o.group.row, g.content, y);
        if (v !== null) ws.getCell(r, c).value = v;
      }
    });
    if (s.years.startCell && summary.startYear !== null) ws.getCell(s.years.startCell).value = summary.startYear;
  }
  // 年度の見出しの式には、たどった年度を計算済みの値として入れる（保護ビューのように計算し直さない所でも年度が合う）。ほかの式の値は捨てて、開いたときに計算させる
  const yearCells = new Set<string>();
  for (const s of layout.sheets) {
    const ws = wb.worksheets.find((w) => sameSheet(w.name, s.sheet))!;
    for (const [c, y] of years.get(s.sheet)!) {
      const cell = ws.getCell(s.years.row, c);
      yearCells.add(`${ws.name}!${cell.address}`);
      const f = formulaOf(cell as unknown as CellLike);
      if (f !== null && y !== null) cell.value = { formula: f, result: y } as ExcelJS.CellValue;
    }
  }
  for (const ws of wb.worksheets)
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string; result?: unknown } | null;
        if (v && typeof v === "object" && !(v instanceof Date) && typeof v.formula === "string" && v.result !== undefined && !yearCells.has(`${ws.name}!${cell.address}`))
          cell.value = { formula: v.formula } as ExcelJS.CellValue;
      }),
    );
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  // 基本情報
  if (layout.facility) {
    const ws = wb.worksheets.find((w) => sameSheet(w.name, layout.facility!.sheet))!;
    for (const c of layout.facility.cells) {
      const v = facilityValue(input.plan, c.field);
      if (v !== null) ws.getCell(c.cell).value = v;
    }
  }
  return { summary, rows };
}

/** 施設の項目の値（計画の施設に無ければ null） */
export function facilityValue(plan: Plan, field: FacilityField): string | number | null {
  const f = plan.facility;
  switch (field) {
    case "name":
      return f.name.trim() ? f.name : null;
    case "scale":
      return f.scale;
    case "scaleUnit":
      return f.scaleUnit && f.scaleUnit.trim() ? f.scaleUnit : null;
    case "scaleText":
      return f.scale === null ? null : `${f.scale}${f.scaleUnit ? ` ${f.scaleUnit}` : ""}`;
    case "fiscalYearStartMonth":
      return f.fiscalYearStartMonth;
  }
}

/** 様式の Excel に書く：写し方に案（layout）があれば案のとおり、無ければ列の役目で平らに（前と同じ） */
export async function writeTemplate(
  wb: ExcelJS.Workbook,
  bytes: ArrayBuffer | Uint8Array,
  columns: Pick<TemplateColumns, "headerRow" | "roles" | "layout">,
  input: LayoutInput,
): Promise<{ bytes: Uint8Array; summary: LayoutSummary | null }> {
  if (!columns.layout) {
    const rows = templateRows(input.plan, (a) => (input.catalog.workLabels as Record<string, string>)[a], input.asOf);
    return { bytes: await fillTemplate(wb as never, bytes, columns, rows), summary: null };
  }
  await wb.xlsx.load(bytes as ArrayBuffer);
  const { summary } = fillLayout(wb, columns.layout, input);
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), summary };
}

// ─── 見本（画面が様式の見た目のまま描く格子） ──────────────────────────

export interface PreviewCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  bold: boolean;
  /** 背景の色（#RRGGBB。無ければ null） */
  fill: string | null;
  align: "left" | "center" | "right";
  /** 式のセル（計算済みの値が無ければ「＝」で式だと示す） */
  formula: boolean;
  /** 案が書いたセル */
  written: boolean;
}
export interface PreviewGrid {
  sheet: string;
  cols: { letter: string; width: number }[];
  rows: { n: number; cells: (PreviewCell | null)[]; gap?: boolean }[];
}

/**
 * 書いたブックの 1 枚を、見本の格子にする：上から upTo 行まで（と、moreRows の行）。結合は colSpan・rowSpan、結合の中のセルは null。
 * writtenCells は案が書いたセル（"G12" の形）
 */
export function previewGrid(wb: ExcelJS.Workbook, sheet: string, upTo: number, moreRows: readonly number[], writtenCells: ReadonlySet<string>): PreviewGrid | null {
  const ws = wb.worksheets.find((w) => sameSheet(w.name, sheet));
  if (!ws) return null;
  const nCols = Math.min(Math.max(ws.columnCount, 1), 60);
  const merges = (ws.model.merges ?? []).map((m) => parseRange(m)).filter((r): r is NonNullable<ReturnType<typeof parseRange>> => r !== null);
  /** 見本の位置 → 結合（字はもとの左上のセルから） */
  const masterOf = new Map<string, { rowSpan: number; colSpan: number; top: number; left: number }>();
  const covered = new Set<string>();
  const shown = [...Array.from({ length: Math.min(upTo, ws.rowCount) }, (_, i) => i + 1), ...moreRows.filter((r) => r > upTo && r <= ws.rowCount)];
  const shownSet = new Set(shown);
  for (const m of merges) {
    // 見本に出す行だけで数える（飛ばした行にかかる結合は、出す行の中で切る。左上の行を出さなければ、出す最初の行に字を置く）
    const rs: number[] = [];
    for (let r = m.top; r <= m.bottom; r++) if (shownSet.has(r)) rs.push(r);
    if (rs.length === 0) continue;
    masterOf.set(`${rs[0]},${m.left}`, { rowSpan: rs.length, colSpan: m.right - m.left + 1, top: m.top, left: m.left });
    for (const r of rs) for (let c = m.left; c <= m.right; c++) if (r !== rs[0] || c !== m.left) covered.add(`${r},${c}`);
  }
  const argb = (x: unknown): string | null => {
    const f = x as { type?: string; fgColor?: { argb?: string } } | undefined;
    const a = f?.type === "pattern" ? f.fgColor?.argb : undefined;
    return a && /^[0-9A-Fa-f]{8}$/.test(a) && a.slice(2).toUpperCase() !== "FFFFFF" ? `#${a.slice(2)}` : null;
  };
  const rows: PreviewGrid["rows"] = [];
  let prev = 0;
  for (const r of shown) {
    const cells: (PreviewCell | null)[] = [];
    for (let c = 1; c <= nCols; c++) {
      if (covered.has(`${r},${c}`)) {
        cells.push(null);
        continue;
      }
      const span = masterOf.get(`${r},${c}`) ?? { rowSpan: 1, colSpan: 1, top: r, left: c };
      const cell = ws.getCell(span.top, span.left);
      const v = cell.value as { formula?: string; result?: unknown } | null;
      const isFormula = !!v && typeof v === "object" && !(v instanceof Date) && (typeof v.formula === "string" || "sharedFormula" in v);
      let text: string;
      if (isFormula) text = v!.result !== undefined && v!.result !== null ? String(v!.result) : "＝";
      else if (typeof cell.value === "number") text = String(cell.value);
      else text = textOf(cell.value) ?? (cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : "");
      const h = (cell.alignment?.horizontal ?? "") as string;
      cells.push({
        text,
        colSpan: Math.min(span.colSpan, nCols - c + 1),
        rowSpan: span.rowSpan,
        bold: !!cell.font?.bold,
        fill: argb(cell.fill),
        align: h === "center" || h === "centerContinuous" ? "center" : h === "right" || typeof cell.value === "number" ? "right" : "left",
        formula: isFormula,
        written: writtenCells.has(`${colLetter(span.left)}${span.top}`),
      });
    }
    rows.push({ n: r, cells, ...(prev && r !== prev + 1 ? { gap: true } : {}) });
    prev = r;
  }
  const cols = Array.from({ length: nCols }, (_, i) => ({ letter: colLetter(i + 1), width: Math.round(((ws.getColumn(i + 1).width as number | undefined) ?? 9) * 7 + 10) }));
  return { sheet: ws.name, cols, rows };
}

/** 書いたセルの位置（見本で印を付ける）：計画の表は書いた行の階層・ラベル・年度・1 つの列、基本情報は書いた欄 */
export function writtenCellsOf(layout: TemplateLayout, summary: LayoutSummary, rows: ReadonlyMap<string, OutRow[]>, plan: Plan): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of layout.sheets) {
    const set = new Set<string>();
    const sum = summary.sheets.find((x) => x.sheet === s.sheet);
    const first = sum?.firstRow ?? Math.max(...s.headerRows) + 1;
    (rows.get(s.sheet) ?? []).forEach((o, i) => {
      const r = first + i;
      for (const n of o.names) set.add(`${n.col}${r}`);
      if (!o.group) return;
      const g = s.group.rows[o.group.index]!;
      if (s.group.labelCol) set.add(`${s.group.labelCol}${r}`);
      if (g.col) set.add(`${g.col}${r}`);
      else for (const c of yearCols(s)) set.add(`${colLetter(c)}${r}`);
    });
    if (s.years.startCell) set.add(s.years.startCell);
    out.set(s.sheet, set);
  }
  if (layout.facility) {
    const set = out.get(layout.facility.sheet) ?? new Set<string>();
    for (const c of layout.facility.cells) if (facilityValue(plan, c.field) !== null) set.add(c.cell);
    out.set(layout.facility.sheet, set);
  }
  return out;
}
