// 層 2 構造：書き方によらず、表ごとに 1 つの木に落とす（plan §2.3）。
// 行の役割（題・凡例・見出し・親・データ・小計・合計・注記）を先に決め、名前の列の位置・頭の空白・字下げ・
// グループ・結合・太字が、行ごとに「何段目か」へ票を入れ、割れたら「疑い」にする。
// 層 2 は形式を知らない（格子だけを見る）。決まらないものは「問い」の種（Issue）として層 3 に渡す。
import { CellIndex, cellRef, colLetter, type GridCell, type SheetGrid, type SourceFile } from "./grid";
import { cue, norm, type ColumnCue } from "./cues";
import { fiscalYearInText, parseDateRange, parseDateText, parseDayCount, parseMonthDay, parseYearLabel, parseYearOnly, serialToYmd, type Ymd } from "./era";
import { isDateFormat } from "./numfmt";
import { isSymbolLike, numberDepth, parseEffort, parseUnit } from "./text";

export type RowRole = "title" | "legend" | "header" | "parent" | "data" | "subtotal" | "total" | "note";
export const ROW_ROLE_LABEL: Record<RowRole, string> = {
  title: "題",
  legend: "凡例",
  header: "見出し",
  parent: "親",
  data: "データ",
  subtotal: "小計",
  total: "合計",
  note: "注記",
};

export type ColRole =
  | "hier"
  | "name"
  | "number"
  | "unit"
  | "mark"
  | "date"
  | "effort"
  | "days"
  | "workName"
  | "workTitle"
  | "assetRef"
  | "spec"
  | "installed"
  | "remark"
  | "label"
  /** 機器番号（同一性の鍵）の列 */
  | "tag"
  /** 期間の終わりの日付（始まりと別の列に書く書き方：着手・完了） */
  | "end"
  /** 行ごとの予定・実績（星取表を予定の段と実績の段に分けて書く書き方） */
  | "planActual"
  | "unknown";

export type Shape = "tree" | "grid" | "events";

export type Signal = "indent" | "spaces" | "number" | "outline" | "position" | "merge";
export interface Vote {
  signal: Signal;
  level: number;
}

export interface RowInfo {
  r: number;
  role: RowRole;
  level: number | null;
  votes: Vote[];
  /** 票が割れた（疑い）。層 3 で問いにする */
  suspect: boolean;
  parentRow: number | null;
  bold: boolean;
}

export interface ColInfo {
  c: number;
  role: ColRole;
  header: string;
  headerParts: string[];
  cue: ColumnCue | null;
  hierLevel?: number;
  fiscalYear?: number;
  yearLabel?: string;
  planOrActual?: "plan" | "actual" | null;
  hidden: boolean;
}

export interface LegendEntry {
  symbol: string;
  meaning: string;
  planOrActual: "plan" | "actual" | null;
  refs: string[];
  r: number;
}

export interface Issue {
  kind: "levelSplit" | "levelJump" | "yearKind" | "blankSameAsAbove" | "hiddenData" | "columnRole" | "noLegend";
  tableId: string;
  /** 同じ形の行をまとめる鍵 */
  pattern: string;
  rows: number[];
  cells: string[];
  detail: string;
  /** 既定の答え（選択肢の id か値） */
  proposal: string | null;
  options: { id: string; label: string }[];
}

export interface Table {
  id: string;
  file: string;
  sheet: string | null;
  sheetIndex: number;
  shape: Shape;
  top: number;
  bottom: number;
  headerRows: number[];
  cols: ColInfo[];
  rows: RowInfo[];
  legend: LegendEntry[];
  legendRows: number[];
  yearKind: "fiscal" | "calendar" | null;
  issues: Issue[];
  /** 様式の形：列の見出しの文字と位置。同じ形の表（同じ様式の帳票を何冊も入れたとき）は、同じ書き方の問いをまとめて聞く */
  form: string;
}

export interface SheetLayout {
  file: string;
  sheet: string | null;
  sheetIndex: number;
  grid: SheetGrid;
  index: CellIndex;
  /** すべての中身のある行の役割（表の外の行も） */
  rowRoles: Map<number, RowRole>;
  tables: Table[];
  notes: { r: number; text: string; ref: string }[];
  titles: { r: number; text: string; ref: string }[];
  /** 表に属さない凡例 */
  looseLegends: LegendEntry[];
  /** 行の役割のほかに、外した理由を決めた行（頭書き・頁ごとにくり返す見出し・続きの印） */
  rowReasons: Map<number, string>;
  /** シートの中の文に書いた年度がただ 1 つなら、その年度（年の無い日付「4/6」の年を決めるため）。無い・2 つ以上なら null */
  contextFiscalYear: number | null;
}

// ─── 値の読み方 ────────────────────────────────────────────────

export function cellDate(c: GridCell, date1904: boolean): Ymd | null {
  if (typeof c.value === "number" && isDateFormat(c.numFmt)) {
    const d = serialToYmd(c.value, date1904);
    return { y: d.y, m: d.m, d: d.d };
  }
  if (typeof c.value === "string") return parseDateText(c.value) ?? parseDateRange(c.value)?.start ?? null;
  return null;
}

/** 期間のセル（「始まり〜終わり」）。1 日の日付なら始まりと終わりが同じ */
export function cellPeriod(c: GridCell, date1904: boolean): { start: Ymd; end: Ymd; range: boolean } | null {
  if (typeof c.value === "string") {
    const r = parseDateRange(c.value);
    if (r) return { ...r, range: true };
  }
  const d = cellDate(c, date1904);
  return d ? { start: d, end: d, range: false } : null;
}

function isNumberish(c: GridCell): boolean {
  if (typeof c.value === "number") return true;
  return typeof c.value === "string" && /^[\d,.\s]+$/.test(c.value.trim()) && c.value.trim() !== "";
}

/** 小計・合計の行の数の欄：数のほか、単位つきの数（工数「253人・日」・日数「61日」）も数の欄に数える */
function isAmountish(c: GridCell): boolean {
  if (isNumberish(c)) return true;
  if (typeof c.value !== "string") return false;
  const e = parseEffort(c.value);
  return (e !== null && e.unit !== "bare") || parseDayCount(c.value) !== null;
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

// ─── 行と塊 ────────────────────────────────────────────────────

function contentRows(idx: CellIndex, g: SheetGrid): number[] {
  const rows = new Set<number>();
  for (const c of g.cells) rows.add(c.r);
  return [...rows].sort((a, b) => a - b);
}

function blocksOf(rows: number[], g: SheetGrid): number[][] {
  const blocks: number[][] = [];
  let cur: number[] = [];
  // 結合が行をまたぐときは、つながっているものとして扱う
  const joined = new Set<number>();
  for (const m of g.merges) for (let r = m.top; r < m.bottom; r++) joined.add(r);
  for (const r of rows) {
    const last = cur[cur.length - 1];
    if (last !== undefined && (r === last + 1 || joined.has(last))) cur.push(r);
    else {
      if (cur.length) blocks.push(cur);
      cur = [r];
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function rowTexts(idx: CellIndex, r: number): GridCell[] {
  return idx.rowCells(r).filter((c) => c.text !== "" || c.note);
}

function isSubtotalRow(cells: GridCell[]): "subtotal" | "total" | null {
  const texts = cells.filter((c) => typeof c.value === "string");
  const labelCell = texts.find((c) => cue.isSubtotal(c.text) || cue.isTotal(c.text));
  if (!labelCell) return null;
  const others = cells.filter((c) => c !== labelCell);
  // 名前のほかは数か空（数の値の小計・合計）。数が 1 つも無ければ小計の行ではない
  if (!others.some(isAmountish)) return null;
  if (others.some((c) => !isAmountish(c) && !(cue.isSubtotal(c.text) || cue.isTotal(c.text)))) return null;
  return cue.isSubtotal(labelCell.text) ? "subtotal" : "total";
}

// ─── 凡例 ──────────────────────────────────────────────────────

/** 1 つのセルに並べた凡例：「○：予定　●：実績」「○予定 ●実績」「○=予定、●=実績」 */
function parseInlineLegend(text: string): { symbol: string; meaning: string }[] {
  const out: { symbol: string; meaning: string }[] = [];
  const isWordChar = (ch: string) => /[0-9A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(ch);
  for (const token of text.normalize("NFKC").split(/[\s、,，;；/]+/u)) {
    const t = token.replace(/^[:：=＝]+/, "");
    if (!t) continue;
    let i = 0;
    while (i < t.length && !isWordChar(t[i] ?? "") && !/[:：=＝]/.test(t[i] ?? "")) i++;
    const sym = t.slice(0, i);
    const meaning = t.slice(i).replace(/^[:：=＝]+/, "").trim();
    if (sym && meaning && isSymbolLike(sym)) out.push({ symbol: sym, meaning });
  }
  return out;
}

function readLegend(idx: CellIndex, rows: number[]): LegendEntry[] {
  const out: LegendEntry[] = [];
  for (const r of rows) {
    const cells = rowTexts(idx, r);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c) continue;
      if (cue.isLegendTitle(c.text)) {
        for (const e of parseInlineLegend(cue.stripLegendTitle(c.text))) out.push({ ...e, planOrActual: cue.planActual(e.meaning), refs: [c.ref], r });
        continue;
      }
      if (isSymbolLike(c.text)) {
        const next = cells[i + 1];
        if (next && !isSymbolLike(next.text)) {
          out.push({ symbol: c.text.trim(), meaning: next.text.trim(), planOrActual: cue.planActual(next.text), refs: [c.ref, next.ref], r });
          i++;
        }
        continue;
      }
      for (const e of parseInlineLegend(c.text)) out.push({ ...e, planOrActual: cue.planActual(e.meaning), refs: [c.ref], r });
    }
  }
  return out;
}

// ─── 表 ────────────────────────────────────────────────────────

interface BuildCtx {
  file: string;
  sheet: string | null;
  sheetIndex: number;
  grid: SheetGrid;
  idx: CellIndex;
  date1904: boolean;
  contextFiscalYear: number | null;
}

/** 日付として読めるセルか。年の無い日付（「4/6(月)」）は、シートに年度が 1 つだけ書いてあるときだけ日付にする */
function isDateCell(ctx: BuildCtx, x: GridCell): boolean {
  if (cellDate(x, ctx.date1904) !== null) return true;
  return ctx.contextFiscalYear !== null && typeof x.value === "string" && parseMonthDay(x.value) !== null;
}

/** 日付の列らしいか：〃（上と同じ）を除いた中身の 6 割以上が日付 */
function dateColumn(ctx: BuildCtx, cs: GridCell[]): boolean {
  const own = cs.filter((x) => !cue.isDitto(x.text));
  return own.length > 0 && ratio(own.filter((x) => isDateCell(ctx, x)).length, own.length) >= 0.6;
}

/** 号・系列の見出しの列の中身が、号の書き方か数だけか（「-」の号なしは数えない） */
function seriesValues(cs: GridCell[]): boolean {
  const own = cs.filter((x) => !/^[-－―—‐ー]+$/u.test(norm(x.text)));
  return own.length > 0 && ratio(own.filter((x) => /^\d{1,3}$/.test(norm(x.text)) || parseUnit(x.text) !== null).length, own.length) >= 0.8;
}

/** 予定・実績の語だけでできた列か（行ごとに予定の段と実績の段を書く書き方） */
function planActualColumn(cs: GridCell[]): boolean {
  return cs.length >= 2 && ratio(cs.filter((x) => cue.planActual(x.text) !== null).length, cs.length) >= 0.9;
}

function headerExtent(ctx: BuildCtx, block: number[], top: number): number[] {
  let bottom = top;
  for (const m of ctx.grid.merges) if (m.top === top && m.bottom > bottom && block.includes(m.bottom)) bottom = m.bottom;
  // 見出しのすぐ下の行が、実績・予定の語だけでできていれば、2 段の見出し
  const next = bottom + 1;
  if (block.includes(next)) {
    const cells = rowTexts(ctx.idx, next);
    if (cells.length >= 2 && cells.every((c) => cue.planActual(c.text) !== null)) bottom = next;
  }
  const out: number[] = [];
  for (let r = top; r <= bottom; r++) out.push(r);
  return out;
}

function columnHeader(ctx: BuildCtx, headerRows: number[], c: number): string[] {
  const parts: string[] = [];
  for (const r of headerRows) {
    const cell = ctx.idx.resolved(r, c);
    const t = cell?.text.trim() ?? "";
    if (t && parts[parts.length - 1] !== t) parts.push(t);
  }
  return parts;
}

function dataCellsOf(ctx: BuildCtx, rows: number[], c: number): GridCell[] {
  const out: GridCell[] = [];
  for (const r of rows) {
    const x = ctx.idx.at(r, c);
    if (x && x.text !== "") out.push(x);
  }
  return out;
}

function detectYearBand(ctx: BuildCtx, cols: ColInfo[], dataRows: number[], headerRow: number): { kind: Table["yearKind"]; issue: Omit<Issue, "tableId"> | null } {
  const years: { col: ColInfo; label: ReturnType<typeof parseYearLabel>; part: string }[] = [];
  for (const col of cols) {
    // 年の見出しは、見出しのどの段にあってもよい（上の段に「実施済」「計画期間」などの帯を置く書き方）。
    // 1 つのセルに年の書き方を改行で並べたもの（「H31⏎R1」）は、初めに読めたもの
    let found: { label: NonNullable<ReturnType<typeof parseYearLabel>>; part: string } | null = null;
    for (const part of col.headerParts) {
      for (const tok of part.split(/[\n\r]+/)) {
        const l = parseYearLabel(tok);
        if (l) {
          found = { label: l, part };
          break;
        }
      }
      if (found) break;
    }
    if (found) years.push({ col, label: found.label, part: found.part });
  }
  if (years.length < 1) return { kind: null, issue: null };
  // 年の列の中身が印（記号）であること。数や文の列（年度ごとの金額など）は星取表の印ではない
  const cells = years.flatMap((y) => dataCellsOf(ctx, dataRows, y.col.c));
  if (!cells.length || ratio(cells.filter((x) => isSymbolLike(x.text)).length, cells.length) < 0.8) return { kind: null, issue: null };
  // 隣り合う列で、年が減らずに並ぶこと（同じ年が 2 列＝実績・予定）
  const seq = years.map((y) => y.label?.year ?? 0);
  for (let i = 1; i < seq.length; i++) if ((seq[i] ?? 0) < (seq[i - 1] ?? 0)) return { kind: null, issue: null };
  for (const y of years) {
    y.col.role = "mark";
    y.col.fiscalYear = y.label?.year ?? 0;
    y.col.yearLabel = y.part;
    // 予定・実績は、年の見出しでない段の語から（年の下の「実績／予定」の段、年の上の「実施済」「計画期間」の帯）
    const others = y.col.headerParts.filter((p) => p !== y.part);
    const pas = [...new Set(others.map((p) => cue.planActual(p)).filter((x) => x !== null))];
    y.col.planOrActual = pas.length === 1 ? (pas[0] ?? null) : null;
  }
  const flags = years.map((y) => y.label?.fiscal ?? null);
  const anyTrue = flags.includes(true);
  const anyFalse = flags.includes(false);
  if (anyTrue && !anyFalse) return { kind: "fiscal", issue: null };
  if (anyFalse && !anyTrue) return { kind: "calendar", issue: null };
  return {
    kind: null,
    issue: {
      kind: "yearKind",
      pattern: anyTrue ? "mixed" : "bare",
      rows: [],
      cells: years.map((y) => cellRef(headerRow, y.col.c)),
      detail: anyTrue ? "年の見出しに「年度」と「年」が混じっている" : "年の見出しに「年度」も「年」も無い",
      proposal: "fiscal",
      options: [
        { id: "fiscal", label: "年度として読む" },
        { id: "calendar", label: "暦年として読む" },
      ],
    },
  };
}

function rankOf(values: number[]): Map<number, number> {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  return new Map(distinct.map((v, i) => [v, i + 1]));
}

function buildTable(ctx: BuildCtx, block: number[], top: number, roles: Map<number, RowRole>): Table {
  const id = `${ctx.file}#${ctx.sheetIndex}#${top}`;
  const issues: Issue[] = [];
  const headerRows = headerExtent(ctx, block, top);
  for (const r of headerRows) roles.set(r, "header");
  const body = block.filter((r) => r > (headerRows[headerRows.length - 1] ?? top));
  // 小計・合計・注記の行を先に決める
  const rows: RowInfo[] = [];
  const dataRows: number[] = [];
  for (const r of body) {
    const cells = rowTexts(ctx.idx, r);
    const st = isSubtotalRow(cells);
    const first = cells[0];
    let role: RowRole = "data";
    if (st) role = st;
    else if (first && cells.length === 1 && cue.isNote(first.text)) role = "note";
    rows.push({ r, role, level: null, votes: [], suspect: false, parentRow: null, bold: !!first?.bold });
    if (role === "data") dataRows.push(r);
  }
  let maxCol = 0;
  for (const r of block) for (const c of rowTexts(ctx.idx, r)) maxCol = Math.max(maxCol, c.c);
  for (const m of ctx.grid.merges) if (headerRows.includes(m.top)) maxCol = Math.max(maxCol, m.right);
  const cols: ColInfo[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const headerParts = columnHeader(ctx, headerRows, c);
    const header = headerParts.join(" / ");
    cols.push({ c, role: "unknown", header, headerParts, cue: cue.column(headerParts[0] ?? ""), hidden: !!ctx.grid.cols[c]?.hidden });
  }
  const yb = detectYearBand(ctx, cols, dataRows, top);
  const yearKind = yb.kind;
  if (yb.issue) issues.push({ ...yb.issue, tableId: id });
  const marks = cols.filter((c) => c.role === "mark");
  let shape: Shape;
  if (marks.length) shape = "grid";
  else {
    const dateCol = cols.find((col) => dateColumn(ctx, dataCellsOf(ctx, dataRows, col.c)));
    shape = dateCol ? "events" : "tree";
  }
  // 列の役目
  for (const col of cols) {
    if (col.role === "mark") continue;
    const cs = dataCellsOf(ctx, dataRows, col.c);
    if (!cs.length && !col.header) continue;
    // 工数の書き方（「24人工」「288時間」）は号・系列ではない（数と漢字の形が号の書き方と重なるため、先に外す）
    const isEffortText = (x: GridCell) => {
      const e = parseEffort(x.text);
      return e !== null && e.unit !== "bare";
    };
    const units = cs.filter((x) => parseUnit(x.text) !== null && !isEffortText(x));
    const hasRealUnit = units.some((x) => parseUnit(x.text)?.kind !== "ditto");
    if (cs.length && hasRealUnit && ratio(units.length, cs.length) >= 0.6) {
      col.role = "unit";
      continue;
    }
    if (shape === "events") {
      if (dateColumn(ctx, cs)) col.role = col.cue === "end" ? "end" : "date";
      else if (cs.length && ratio(cs.filter((x) => parseEffort(typeof x.value === "number" ? x.value : x.text) !== null).length, cs.length) >= 0.6 && col.cue === "effort") col.role = "effort";
      else if (cs.length && col.cue === "days" && ratio(cs.filter((x) => parseDayCount(typeof x.value === "number" ? x.value : x.text) !== null).length, cs.length) >= 0.6) col.role = "days";
      // 行の通し番号（No.）：その資料の中で行を指すだけ。記録の出どころには入るが、値としては読まない
      else if (cs.length && col.cue === "number" && ratio(cs.filter((x) => numberDepth(typeof x.value === "number" ? x.value : x.text) === 1).length, cs.length) >= 0.8) col.role = "number";
      // 管理番号（「R4-001」など）：行ごとに違う値なら、その資料の中で行を指すだけの番号
      else if (cs.length && col.cue === "number" && new Set(cs.map((x) => norm(x.text))).size === cs.length) col.role = "number";
      else if (col.cue === "assetRef" || col.cue === "name") col.role = "assetRef";
      else if (col.cue === "workName") col.role = "workName";
      else if (col.cue === "workTitle") col.role = "workTitle";
      else if (col.cue === "tag") col.role = "tag";
      // 号・系列の見出しの列で、中身が数だけ（「1」「2」）：号の列
      else if (col.cue === "series" && seriesValues(cs)) col.role = "unit";
      else if (col.cue === "remark" || col.cue === "spec" || col.cue === "category" || col.cue === "persons" || col.cue === "fiscal") col.role = "remark";
      else if (col.cue === "effort") col.role = "effort";
      else if (cs.length) {
        col.role = "unknown";
        issues.push({
          kind: "columnRole",
          tableId: id,
          pattern: `col:${col.c}`,
          rows: [],
          cells: cs.slice(0, 10).map((x) => x.ref),
          detail: `列 ${colLetter(col.c)}（見出し「${col.header || "なし"}」）の役目が決まらない`,
          proposal: "remark",
          options: [
            { id: "remark", label: "備考として根拠の文に添える" },
            { id: "workName", label: "作業の名前" },
            { id: "exclude", label: "外す" },
          ],
        });
      }
      continue;
    }
    // 木と星取表
    if (shape === "grid" && planActualColumn(cs)) {
      col.role = "planActual";
      continue;
    }
    if (col.cue === "tag") {
      col.role = "tag";
      continue;
    }
    if (col.cue === "number" || (cs.length && ratio(cs.filter((x) => typeof x.value === "string" && numberDepth(x.value) !== null).length, cs.length) >= 0.8 && cs.some((x) => /[-.]/.test(String(x.value))))) {
      col.role = "number";
      continue;
    }
    if (col.cue === "installed") {
      col.role = "installed";
      continue;
    }
    if (col.cue === "remark") {
      col.role = "remark";
      continue;
    }
    if (col.cue === "spec") {
      col.role = "spec";
      continue;
    }
    col.role = "label"; // 名前か階層の候補（下で決める）
  }
  if (shape === "events") {
    // 日付の列が 2 つ（着手・完了）で、終わりの手がかりが無ければ、右の列を終わりにする
    const ds = cols.filter((c) => c.role === "date");
    if (ds.length === 2 && !cols.some((c) => c.role === "end")) (ds[1] as ColInfo).role = "end";
    // 日付の欄の空欄で、ほかの欄に中身がある行（同じ日の 2 行目から日付を書かない書き方）：上の行と同じか（まとめて問う）
    for (const dc of cols.filter((c) => c.role === "date" || c.role === "end")) {
      const blanks: number[] = [];
      let seen = false;
      for (const r of dataRows) {
        const cell = ctx.idx.at(r, dc.c);
        if (cell && cell.text !== "") seen = true;
        else if (seen && rowTexts(ctx.idx, r).length > 0) blanks.push(r);
      }
      if (blanks.length)
        issues.push({
          kind: "blankSameAsAbove",
          tableId: id,
          pattern: `col:${dc.c}`,
          rows: blanks,
          cells: blanks.map((r) => cellRef(r, dc.c)),
          detail: `「${dc.header || "日付"}」の列の空欄（${blanks.length} 行）`,
          proposal: "same",
          options: [
            { id: "same", label: "上の行と同じ" },
            { id: "none", label: "日付は無い" },
          ],
        });
    }
  }
  if (shape === "grid") {
    const firstMark = Math.min(...marks.map((m) => m.c));
    let lvl = 0;
    for (const col of cols) {
      if (col.c >= firstMark) {
        if (col.role === "label") col.role = "spec";
        continue;
      }
      if (col.role === "label") {
        col.role = "hier";
        col.hierLevel = ++lvl;
      }
    }
  } else if (shape === "tree") {
    const labels = cols.filter((c) => c.role === "label");
    const group = nameGroup(ctx, labels, dataRows);
    if (group) {
      // 段ごとに名前を書く列を変える書き方：どの列も名前の列で、列の位置が段
      group.forEach((col, i) => {
        col.role = "name";
        col.hierLevel = i + 1;
      });
      for (const col of labels) if (!group.includes(col)) col.role = "spec";
    } else {
      const named = labels.find((c) => c.cue === "name") ?? labels[0];
      for (const col of labels) col.role = col === named ? "name" : "spec";
    }
  } else {
    for (const col of cols) if (col.role === "label") col.role = "remark";
  }
  for (const r of rows) roles.set(r.r, r.role);
  const table: Table = {
    id,
    file: ctx.file,
    sheet: ctx.sheet,
    sheetIndex: ctx.sheetIndex,
    shape,
    top,
    bottom: block[block.length - 1] ?? top,
    headerRows,
    cols,
    rows,
    legend: [],
    legendRows: [],
    yearKind,
    issues,
    form: `${shape}|${headerRows.map((r) => exactSig(rowTexts(ctx.idx, r))).join("\u0003")}`,
  };
  if (shape === "tree") voteLevels(ctx, table);
  if (shape === "grid") gridLevels(ctx, table);
  hiddenIssues(ctx, table);
  for (const r of table.rows) roles.set(r.r, r.role);
  return table;
}

/**
 * 名前の列の組：段ごとに名前を書く列を変える書き方（「名称」の下に「設備・機器・部位」など）。
 * 隣り合う 2 つ以上の名前の候補の列で、見出しの上の段が同じ（結合した見出し）か、どの行もそのうち 1 つの列にだけ名前がある。
 * どの列にも名前のある行があり、名前のある行がデータの行の 8 割以上。そうでなければ null
 */
function nameGroup(ctx: BuildCtx, labels: ColInfo[], dataRows: number[]): ColInfo[] | null {
  const sorted = [...labels].sort((a, b) => a.c - b.c);
  const filled = (r: number, c: ColInfo) => {
    const x = ctx.idx.at(r, c.c);
    return !!x && typeof x.value === "string" && x.text.trim() !== "";
  };
  for (let i = 0; i < sorted.length; i++) {
    const run: ColInfo[] = [sorted[i] as ColInfo];
    for (let j = i + 1; j < sorted.length && (sorted[j] as ColInfo).c === (run[run.length - 1] as ColInfo).c + 1; j++) run.push(sorted[j] as ColInfo);
    if (run.length < 2) continue;
    const top = run[0]?.headerParts[0];
    const sharedHeader = !!top && run.every((c) => c.headerParts.length >= 2 && c.headerParts[0] === top);
    let named = 0;
    let multi = 0;
    for (const r of dataRows) {
      const n = run.filter((c) => filled(r, c)).length;
      if (n >= 1) named++;
      if (n >= 2) multi++;
    }
    const everyUsed = run.every((c) => dataRows.some((r) => filled(r, c)));
    if (everyUsed && named >= 0.8 * dataRows.length && (sharedHeader || multi === 0)) return run;
  }
  return null;
}

/** 木の表：行ごとに票を入れる */
function voteLevels(ctx: BuildCtx, t: Table) {
  const nameCols = t.cols.filter((c) => c.role === "name");
  const nameCol = nameCols[0];
  const numCol = t.cols.find((c) => c.role === "number");
  const data = t.rows.filter((r) => r.role === "data");
  if (!nameCol) return;
  const nameCells = new Map<number, GridCell>();
  for (const r of data) {
    // 名前の列の組なら、その行で名前のある列
    const x = nameCols.map((c) => ctx.idx.resolved(r.r, c.c)).find((y) => !!y && y.text !== "") ?? ctx.idx.resolved(r.r, nameCol.c);
    if (x) nameCells.set(r.r, x);
  }
  // 番号の列が 1 段の番号だけ（通し番号）なら、段の票にしない（段を表さないため）
  const numDepths = numCol
    ? data
        .map((r) => ctx.idx.at(r.r, numCol.c))
        .filter((x): x is GridCell => !!x)
        .map((x) => numberDepth(typeof x.value === "number" ? x.value : x.text))
    : [];
  const flatNumbers = numDepths.length > 0 && numDepths.every((d) => d === 1 || d === null);
  // 名前の列が空で、左右の別の列に名前がある行（段ごとに列をずらす書き方）を位置の票にする
  const positions = new Map<number, number>();
  for (const r of data) {
    const first = rowTexts(ctx.idx, r.r).find((c) => typeof c.value === "string" && t.cols.find((k) => k.c === c.c)?.role !== "number");
    if (first) positions.set(r.r, first.c);
  }
  const indents = [...nameCells.values()].map((c) => c.indent);
  const spaces = [...nameCells.values()].map((c) => c.leadingSpaces);
  const outlines = data.map((r) => ctx.grid.rows[r.r]?.outline ?? 0);
  const posValues = [...positions.values()];
  const indentRank = indents.some((v) => v > 0) ? rankOf(indents) : null;
  const spaceRank = spaces.some((v) => v > 0) ? rankOf(spaces) : null;
  const outlineRank = outlines.some((v) => v > 0) ? rankOf(outlines) : null;
  const posRank = new Set(posValues).size > 1 ? rankOf(posValues) : null;
  for (const r of data) {
    const votes: Vote[] = [];
    const nc = nameCells.get(r.r);
    if (indentRank && nc) votes.push({ signal: "indent", level: indentRank.get(nc.indent) ?? 1 });
    if (spaceRank && nc) votes.push({ signal: "spaces", level: spaceRank.get(nc.leadingSpaces) ?? 1 });
    if (outlineRank) votes.push({ signal: "outline", level: outlineRank.get(ctx.grid.rows[r.r]?.outline ?? 0) ?? 1 });
    if (posRank) {
      const p = positions.get(r.r);
      if (p !== undefined) votes.push({ signal: "position", level: posRank.get(p) ?? 1 });
    }
    if (numCol && !flatNumbers) {
      const x = ctx.idx.at(r.r, numCol.c);
      const d = x ? numberDepth(typeof x.value === "number" ? x.value : x.text) : null;
      if (d !== null) votes.push({ signal: "number", level: d });
    }
    r.votes = votes;
    const levels = [...new Set(votes.map((v) => v.level))];
    if (levels.length === 0) r.level = 1;
    else if (levels.length === 1) r.level = levels[0] ?? 1;
    else {
      r.suspect = true;
      r.level = null;
    }
  }
  // 票が割れた行：割れ方ごとにまとめて問いにする（既定は番号の票、無ければ多い票）
  const groups = new Map<string, RowInfo[]>();
  for (const r of data.filter((x) => x.suspect)) {
    const sig = r.votes.map((v) => `${v.signal}=${v.level}`).join(",");
    groups.set(sig, [...(groups.get(sig) ?? []), r]);
  }
  for (const [sig, rs] of groups) {
    const votes = rs[0]?.votes ?? [];
    const byNumber = votes.find((v) => v.signal === "number");
    const counts = new Map<number, number>();
    for (const v of votes) counts.set(v.level, (counts.get(v.level) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
    const levels = [...new Set(votes.map((v) => v.level))].sort((a, b) => a - b);
    t.issues.push({
      kind: "levelSplit",
      tableId: t.id,
      pattern: sig,
      rows: rs.map((x) => x.r),
      cells: rs.map((x) => cellRef(x.r, nameCol.c)),
      detail: `段の手がかりが割れている（${votes.map((v) => `${SIGNAL_LABEL[v.signal]}は ${v.level} 段目`).join("、")}）`,
      proposal: `level:${byNumber?.level ?? majority}`,
      options: levels.map((l) => ({ id: `level:${l}`, label: `${l} 段目` })),
    });
  }
  assignParents(t, nameCol.c);
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  indent: "字下げ",
  spaces: "頭の空白",
  number: "番号",
  outline: "グループ",
  position: "名前の列の位置",
  merge: "結合",
};

/** 段から親を決める（段の決まらない行は飛ばし、決まってから層 3 でやり直す） */
export function assignParents(t: Table, nameC: number | null) {
  const data = t.rows.filter((r) => r.role === "data" || r.role === "parent");
  const stack: RowInfo[] = [];
  for (const r of data) {
    r.parentRow = null;
    if (r.level === null) continue;
    while (stack.length && (stack[stack.length - 1]?.level ?? 0) >= r.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      r.parentRow = parent.r;
      if ((parent.level ?? 0) < r.level - 1 && !t.issues.some((i) => i.kind === "levelJump" && i.rows.includes(r.r))) {
        t.issues.push({
          kind: "levelJump",
          tableId: t.id,
          pattern: `jump:${parent.level}->${r.level}`,
          rows: [r.r],
          cells: nameC ? [cellRef(r.r, nameC)] : [],
          detail: `${parent.level} 段目のすぐ下が ${r.level} 段目（間の段が無い）`,
          proposal: "keep",
          options: [
            { id: "keep", label: "そのまま（上の行を親にする）" },
            { id: "exclude", label: "外す" },
          ],
        });
      }
    } else if (r.level > 1 && !t.issues.some((i) => i.kind === "levelJump" && i.rows.includes(r.r))) {
      t.issues.push({
        kind: "levelJump",
        tableId: t.id,
        pattern: `orphan:${r.level}`,
        rows: [r.r],
        cells: nameC ? [cellRef(r.r, nameC)] : [],
        detail: `${r.level} 段目の行の上に親が無い`,
        proposal: "keep",
        options: [
          { id: "keep", label: "そのまま（親なし）" },
          { id: "exclude", label: "外す" },
        ],
      });
    }
    stack.push(r);
  }
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (!r) continue;
    const next = data[i + 1];
    r.role = next && r.level !== null && next.level !== null && next.level > r.level ? "parent" : "data";
  }
}

/** 星取表の形：段は名前の列の位置。結合と空欄（上と同じ）を確かめる */
function gridLevels(ctx: BuildCtx, t: Table) {
  const hier = t.cols.filter((c) => c.role === "hier").sort((a, b) => (a.hierLevel ?? 0) - (b.hierLevel ?? 0));
  const leaf = hier[hier.length - 1];
  const data = t.rows.filter((r) => r.role === "data");
  for (const r of data) {
    const votes: Vote[] = [];
    let deepest = 0;
    for (const col of hier) {
      const own = ctx.idx.at(r.r, col.c);
      const merged = ctx.idx.merge(r.r, col.c);
      if ((own && own.text !== "") || (merged && merged.top !== r.r)) deepest = col.hierLevel ?? deepest;
    }
    if (deepest) votes.push({ signal: "position", level: deepest });
    r.votes = votes;
    r.level = deepest || null;
  }
  // 葉でない段の列の空欄で、結合でもないもの：上と同じか（まとめて問う）
  for (const col of hier) {
    if (col === leaf) continue;
    const blanks: number[] = [];
    let seen = false;
    for (const r of data) {
      const cell = ctx.idx.resolved(r.r, col.c);
      if (cell && cell.text !== "") seen = true;
      else if (seen) blanks.push(r.r);
    }
    if (blanks.length)
      t.issues.push({
        kind: "blankSameAsAbove",
        tableId: t.id,
        pattern: `col:${col.c}`,
        rows: blanks,
        cells: blanks.map((r) => cellRef(r, col.c)),
        detail: `「${col.header}」の列の空欄（${blanks.length} 行）`,
        proposal: "same",
        options: [
          { id: "same", label: "上と同じ" },
          { id: "none", label: "その段は無い" },
        ],
      });
  }
}

function hiddenIssues(ctx: BuildCtx, t: Table) {
  const hiddenCols = t.cols.filter((c) => c.hidden && dataCellsOf(ctx, t.rows.map((r) => r.r), c.c).length > 0);
  const hiddenRows = t.rows.filter((r) => ctx.grid.rows[r.r]?.hidden && rowTexts(ctx.idx, r.r).length > 0);
  if (hiddenCols.length || hiddenRows.length)
    t.issues.push({
      kind: "hiddenData",
      tableId: t.id,
      pattern: "hidden",
      rows: hiddenRows.map((r) => r.r),
      cells: hiddenCols.map((c) => cellRef(t.headerRows[0] ?? t.top, c.c)),
      detail: `隠した列 ${hiddenCols.length}・隠した行 ${hiddenRows.length} に中身がある`,
      proposal: "include",
      options: [
        { id: "include", label: "取り込む" },
        { id: "exclude", label: "外す（隠してあるため）" },
      ],
    });
}

// ─── くり返す領域（頁ごとの見出し・続紙） ─────────────────────────

/** 列の見出しの行らしいか：中身が 3 つ以上で、列の手がかりの語が 2 つ以上 */
function headerLike(cells: GridCell[]): boolean {
  return cells.length >= 3 && cells.filter((c) => cue.column(c.text) !== null).length >= 2;
}

/**
 * 項目と値を並べた行（帳票の頭書き：「工期｜R5.8.31〜」「出力日｜2026/10/01｜受託者｜…」）。
 * 項目（短い文字。数・日付でない）と値の組が 1 つ以上で、最後に組にならない文が 1 つあってもよい。列の見出しの行や、
 * 中身の半分を超えて見出しの語の行（2 列の表の見出し）は、頭書きにしない
 */
function kvRow(cells: GridCell[]): boolean {
  if (cells.length < 2 || cells.length > 7 || headerLike(cells)) return false;
  if (cells.filter((c) => cue.column(c.text) !== null).length * 2 > cells.length) return false;
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const label = cells[i] as GridCell;
    const t = norm(label.text);
    if (typeof label.value !== "string" || t.length < 1 || t.length > 8 || /^[\d.,/\-:]+$/.test(t) || parseDateText(label.text) !== null) return false;
  }
  return true;
}

const exactSig = (cells: GridCell[]) => cells.map((c) => `${c.c}\u0001${norm(c.text)}`).join("\u0002");
/** 頁ごとに変わる所（続きの印・頁の番号などの数）を除いた形 */
const looseSig = (cells: GridCell[]) =>
  cells.map((c) => `${c.c}\u0001${norm(cue.stripContinued(c.text)).replace(/\d+/g, "#")}`).join("\u0002");

interface Repeat {
  kind: "header" | "preamble" | "continued";
  /** 同じ形の 1 つ目の行 */
  of: number;
}

/**
 * 頁ごとにくり返す見出しを見つける：列の見出しの行が同じ文字のまま後でまた出たら、それは前の表の続きの頁の見出し。
 * その上の行（題・頭書き）も、1 つ目の見出しの上の行と、上へ 1 行ずつ同じ形（続きの印と数を除く）のあいだは、くり返し。
 * 見出しのすぐ下の実績・予定だけの行（2 段の見出し）も、同じ文字ならくり返し。
 * 表の見出しより後の、続きの印だけの 1 セルの行（「（続き）」）も、前の表の続きの印。
 */
function findRepeats(idx: CellIndex, rows: number[]): Map<number, Repeat> {
  const out = new Map<number, Repeat>();
  const cellsOf = (r: number) => rowTexts(idx, r);
  const bySig = new Map<string, number[]>();
  for (const r of rows) {
    const cs = cellsOf(r);
    if (headerLike(cs)) bySig.set(exactSig(cs), [...(bySig.get(exactSig(cs)) ?? []), r]);
  }
  for (const hs of bySig.values()) {
    const first = hs[0];
    if (hs.length < 2 || first === undefined) continue;
    const iFirst = rows.indexOf(first);
    const sub = rows[iFirst + 1];
    const subCells = sub !== undefined ? cellsOf(sub) : [];
    const twoTier = subCells.length >= 2 && subCells.every((c) => cue.planActual(c.text) !== null);
    for (let k = 1; k < hs.length; k++) {
      const h = hs[k] ?? 0;
      const prevH = hs[k - 1] ?? 0;
      out.set(h, { kind: "header", of: first });
      const jh = rows.indexOf(h);
      const below = rows[jh + 1];
      if (twoTier && sub !== undefined && below !== undefined && exactSig(cellsOf(below)) === exactSig(subCells)) out.set(below, { kind: "header", of: sub });
      for (let i = iFirst - 1, j = jh - 1; i >= 0 && j >= 0; i--, j--) {
        const a = rows[i] ?? 0;
        const b = rows[j] ?? 0;
        if (b <= prevH || out.has(b) || looseSig(cellsOf(a)) !== looseSig(cellsOf(b))) break;
        out.set(b, { kind: "preamble", of: a });
      }
    }
  }
  // 続きの印だけの行：印を除くと空か、前に出た 1 セルの行（題）と同じ文字
  let seenHeader = false;
  const singles: { r: number; text: string }[] = [];
  for (const r of rows) {
    const cs = cellsOf(r);
    const text = cs[0]?.text ?? "";
    if (headerLike(cs)) seenHeader = true;
    else if (cs.length === 1 && !out.has(r)) {
      const rest = norm(cue.stripContinued(text));
      const earlier = singles.find((s) => s.text === rest);
      if (seenHeader && cue.isContinued(text) && (rest === "" || earlier)) out.set(r, { kind: "continued", of: earlier?.r ?? r });
      else singles.push({ r, text: norm(text) });
    }
  }
  return out;
}

/** くり返しの行のすぐ後から始まる塊は、前の塊（同じ表の前の頁）につなぐ */
function joinAcross(blocks: number[][], rows: number[], repeats: Map<number, Repeat>): number[][] {
  const out: number[][] = [];
  for (const b of blocks) {
    const prev = rows[rows.indexOf(b[0] ?? -1) - 1];
    const last = out[out.length - 1];
    if (last && prev !== undefined && repeats.has(prev)) last.push(...b);
    else out.push([...b]);
  }
  return out;
}

// ─── シートの入口 ────────────────────────────────────────────

export function layoutSheet(src: SourceFile, grid: SheetGrid): SheetLayout {
  const idx = new CellIndex(grid);
  const contextFiscalYear = fiscalYearInText(grid.cells.map((c) => c.text));
  const ctx: BuildCtx = { file: src.file, sheet: grid.name, sheetIndex: grid.index, grid, idx, date1904: src.date1904, contextFiscalYear };
  const roles = new Map<number, RowRole>();
  const rowReasons = new Map<number, string>();
  const tables: Table[] = [];
  const notes: SheetLayout["notes"] = [];
  const titles: SheetLayout["titles"] = [];
  const legends: { rows: number[]; entries: LegendEntry[] }[] = [];
  const all = contentRows(idx, grid);
  const repeats = findRepeats(idx, all);
  for (const [r, rp] of repeats) {
    roles.set(r, "header");
    rowReasons.set(r, rp.kind === "continued" ? "続きの印（前の表の続き）" : "くり返す見出し（表の始めの見出しと同じ。頁ごとにくり返したもの）");
  }
  const blocks = joinAcross(
    blocksOf(
      all.filter((r) => !repeats.has(r)),
      grid,
    ),
    all,
    repeats,
  );
  blocks.forEach((block, bi) => {
    const firstRow = block[0] ?? 0;
    const firstCells = rowTexts(idx, firstRow);
    // 凡例の塊
    if (firstCells.some((c) => cue.isLegendTitle(c.text))) {
      for (const r of block) roles.set(r, "legend");
      legends.push({ rows: block, entries: readLegend(idx, block) });
      return;
    }
    // 題と注記の塊（どの行も 2 つ以下のセル、4 行以下）。ただし、列の見出しの語がある塊や、
    // シートにほかの表が無い塊は、小さな表として読む
    const fewCells = block.length <= 4 && block.every((r) => rowTexts(idx, r).length <= 2);
    const hasColumnCue = block.some((r) => rowTexts(idx, r).length >= 2 && rowTexts(idx, r).some((c) => cue.column(c.text) !== null));
    const otherTable = blocks.some((b) => b !== block && !(b.length <= 4 && b.every((r) => rowTexts(idx, r).length <= 2)));
    const small = fewCells && !hasColumnCue && (otherTable || block.every((r) => rowTexts(idx, r).length <= 1));
    // 項目と値だけの塊（帳票の頭書き）：ほかに表があり、6 行まで、見出しの行が無く、どの行も 1 セルか項目と値の行。
    // 小計・合計の項目がある塊や、値がどれも数の塊は、2 列の小さな表として読む（頭書きの値は日付・名前・文がまじる）
    const kvRows = block.filter((r) => kvRow(rowTexts(idx, r)));
    const kvValues = kvRows.flatMap((r) => rowTexts(idx, r).filter((_, i) => i % 2 === 1));
    const kvBlock =
      otherTable &&
      block.length <= 6 &&
      kvRows.length > 0 &&
      !block.some((r) => headerLike(rowTexts(idx, r))) &&
      block.every((r) => rowTexts(idx, r).length === 1 || kvRow(rowTexts(idx, r))) &&
      !kvRows.some((r) => isSubtotalRow(rowTexts(idx, r)) !== null) &&
      !(kvValues.length >= 2 && kvValues.every((c) => isNumberish(c)));
    if (small || kvBlock) {
      block.forEach((r, i) => {
        const cells = rowTexts(idx, r);
        const text = cells.map((c) => c.text).join(" ");
        const ref = cells[0]?.ref ?? cellRef(r, 1);
        if (bi === 0 && i === 0 && cells.length === 1) {
          roles.set(r, "title");
          titles.push({ r, text, ref });
        } else {
          roles.set(r, "note");
          notes.push({ r, text, ref });
        }
      });
      return;
    }
    // 表の塊。頭の 1 セルだけの行は題
    let top = firstRow;
    const rest = [...block];
    while (rest.length > 2 && rowTexts(idx, rest[0] ?? 0).length === 1 && rest.slice(1).some((r) => rowTexts(idx, r).length >= 2)) {
      const r = rest.shift() ?? 0;
      const c = rowTexts(idx, r)[0];
      roles.set(r, tables.length === 0 && titles.length === 0 ? "title" : "note");
      (roles.get(r) === "title" ? titles : notes).push({ r, text: c?.text ?? "", ref: c?.ref ?? cellRef(r, 1) });
      top = rest[0] ?? top;
    }
    // 帳票の頭書き：列の見出しの行の上にある、項目と値だけの行（どれも 2 セルまで）。表の外の項目なので記録には使わない
    const hi = rest.findIndex((r) => headerLike(rowTexts(idx, r)));
    if (hi > 0 && rest.slice(0, hi).every((r) => rowTexts(idx, r).length <= 2 || kvRow(rowTexts(idx, r)))) {
      for (const r of rest.splice(0, hi)) {
        const cells = rowTexts(idx, r);
        roles.set(r, "note");
        rowReasons.set(r, "表の上の項目と値（頭書き）。記録には使わない");
        notes.push({ r, text: cells.map((c) => c.text).join(" "), ref: cells[0]?.ref ?? cellRef(r, 1) });
      }
      top = rest[0] ?? top;
    }
    tables.push(buildTable(ctx, rest, top, roles));
  });
  // 凡例は、上にある一番近い星取表の形の表へ
  const looseLegends: LegendEntry[] = [];
  for (const lg of legends) {
    const above = tables.filter((t) => t.shape === "grid" && t.bottom < (lg.rows[0] ?? 0)).sort((a, b) => b.bottom - a.bottom)[0];
    const target = above ?? tables.find((t) => t.shape === "grid");
    if (target) {
      target.legend.push(...lg.entries);
      target.legendRows.push(...lg.rows);
    } else looseLegends.push(...lg.entries);
  }
  return { file: src.file, sheet: grid.name, sheetIndex: grid.index, grid, index: idx, rowRoles: roles, tables, notes, titles, looseLegends, rowReasons, contextFiscalYear };
}

export function layoutFile(src: SourceFile): SheetLayout[] {
  return src.sheets.map((g) => layoutSheet(src, g));
}

export { norm };
