// 層 2 構造：書き方によらず、表ごとに 1 つの木に落とす（plan §2.3）。
// 行の役割（題・凡例・見出し・親・データ・小計・合計・注記）を先に決め、名前の列の位置・頭の空白・字下げ・
// グループ・結合・太字が、行ごとに「何段目か」へ票を入れ、割れたら「疑い」にする。
// 層 2 は形式を知らない（格子だけを見る）。決まらないものは「問い」の種（Issue）として層 3 に渡す。
import { CellIndex, cellRef, colLetter, type GridCell, type SheetGrid, type SourceFile } from "./grid";
import { cue, norm, type ColumnCue } from "./cues";
import { fiscalYearInText, nfkc as nfkcText, parseDateRange, parseDateText, parseDayCount, parseMonthDay, parseYearLabel, parseYearOnly, serialToYmd, validYmd, type Ymd } from "./era";
import { isDateFormat } from "./numfmt";
import { isSymbolLike, numberDepth, parseEffort, parseUnit, splitSeriesCell } from "./text";
import { parseWithFormat, ruleApplies, sameColumn, type ActiveRule, type DateFormat, type ReadingRule, type RuleHits } from "./reading";

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
  /** 費用（作業明細の費用の欄。共有にも AI の見本にも出さない） */
  | "cost"
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
  /** 作業の周期（「周期(年)」：その行の作業の暦のきっかけ） */
  | "cycle"
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
  /** 読み方の規則で決めた日付の書き方・工数の単位・外す列 */
  dateFormat?: DateFormat;
  effortUnit?: "manDays" | "hours";
  ruleExclude?: string;
  /** 1 つの列に、いくつかの欄をまとめて書いた見出し（「号炉・系統・機器・作業内容」）の、手がかりの語の並び */
  compound?: ColumnCue[];
  /** 読み方の規則がこの列に効かなかった・読み手の読み方を止めたこと（要約の注記に出す） */
  ruleNotes?: string[];
}

export interface LegendEntry {
  symbol: string;
  meaning: string;
  planOrActual: "plan" | "actual" | null;
  refs: string[];
  r: number;
  /** 読み方の規則の印の意味から足した凡例なら、その規則（印に当たった数を、規則を使った件数に数える。Architect の 60） */
  rule?: ReadingRule;
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
  /** 表の上の頭書きに書いた名前（「設備名｜受入供給設備」）の値のセル：表の行の親のまとまり（木の表だけ） */
  heading?: { text: string; ref: string } | null;
  /** 帳票の頭書きの項目と値（同じ頁の、表の上の「日付｜…」「設備名｜…」「機器番号｜…」「号炉｜…」）。表に無い欄を、下の表の行に付ける */
  head?: HeadField[];
  /**
   * 年の列に、記号でなく整備の内容の文を書き、その下の行に金額を書く星取表（2 段の書き方）：金額の行 → 内容の行。
   * 金額の行は機器の行ではなく、上の行の、同じ列の内容の費用
   */
  amountRows?: Map<number, number>;
}

export interface HeadField {
  cue: ColumnCue;
  label: string;
  cell: GridCell;
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
  /** 表の外（題・注記）に書いた期間がただ 1 つなら、その期間（日付の書いていない作業の行に、人が使うかを決める） */
  contextPeriod: { start: Ymd; end: Ymd; text: string } | null;
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

/** 日付の型のセル（Excel の日付の表示形式の数）か */
export function isTypedDate(c: GridCell): boolean {
  return typeof c.value === "number" && isDateFormat(c.numFmt);
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

function blocksOf(rows: number[], g: SheetGrid, spans: Map<number, number> = new Map()): number[][] {
  const blocks: number[][] = [];
  let cur: number[] = [];
  // 結合が行をまたぐときは、つながっているものとして扱う
  const joined = new Set<number>();
  for (const m of g.merges) for (let r = m.top; r < m.bottom; r++) joined.add(r);
  // CSV の囲みの中の改行：1 つの記録が何行にもわたる。記録の行と次の記録の行は、つながっている
  for (const [r, n] of spans) for (let k = r; k < r + n; k++) joined.add(k);
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

/** 数式のセル（計算済みの値が無くても）：小計・合計の行の数の欄に数える */
const isFormulaCell = (c: GridCell) => c.formula !== null;

function isSubtotalRow(cells: GridCell[]): "subtotal" | "total" | null {
  const texts = cells.filter((c) => typeof c.value === "string" && !isFormulaCell(c));
  const labelCell = texts.find((c) => cue.isSubtotal(c.text) || cue.isTotal(c.text) || cue.isCount(c.text));
  if (!labelCell) return null;
  const others = cells.filter((c) => c !== labelCell);
  // 名前のほかは数か空（数の値の小計・合計）。数が 1 つも無ければ小計の行ではない。数式のセルは、計算済みの値が無くても数の欄
  const amount = (c: GridCell) => isAmountish(c) || isFormulaCell(c);
  if (!others.some(amount)) return null;
  if (others.some((c) => !amount(c) && !(cue.isSubtotal(c.text) || cue.isTotal(c.text) || cue.isCount(c.text)))) return null;
  return cue.isSubtotal(labelCell.text) ? "subtotal" : "total";
}

// ─── 凡例 ──────────────────────────────────────────────────────

/** 1 つのセルに並べた凡例：「○：予定　●：実績」「○予定 ●実績」「○=予定、●=実績」 */
/** 星取表の印らしい短い書き方：記号（○●◎）か、数の無い 1〜2 字の短い字（「点」「整」）。括弧と並べる印（「（点）」「整・精」）も */
function isMarkLike(text: string): boolean {
  if (isSymbolLike(text)) return true;
  const t = norm(text).replace(/^[(（［[]|[)）］\]]$/gu, "");
  return t.split(/[・,、/]/u).every((x) => x.length >= 1 && x.length <= 2 && !/[0-9A-Za-z]/.test(x));
}

/** 凡例の「X＝意味」の書き方（記号でなく短い字の印：「点＝点検」）。等号でつないだものだけ */
function parseEqualsLegend(text: string): { symbol: string; meaning: string }[] {
  const out: { symbol: string; meaning: string }[] = [];
  for (const m of nfkcText(cue.stripLegendTitle(text)).matchAll(/(\S{1,2})\s*[=＝]\s*([^\s=＝]+)/gu)) {
    const sym = m[1] ?? "";
    if (sym && !/[0-9A-Za-z]/.test(sym)) out.push({ symbol: sym, meaning: (m[2] ?? "").trim() });
  }
  return out;
}

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
  /** このシートに効く読み方の規則 */
  rules: ActiveRule[];
  hits: RuleHits | null;
}

/** 日付として読めるセルか。年の無い日付（「4/6(月)」）は、シートに年度が 1 つだけ書いてあるときだけ日付にする */
function isDateCell(ctx: BuildCtx, x: GridCell, format?: DateFormat): boolean {
  // 書き方の規則（yyyymmdd・月/日）は文字や数の並びのセルに効く。日付の型のセルは、そのまま日付
  if (format) return (isTypedDate(x) && cellDate(x, ctx.date1904) !== null) || parseWithFormat(String(x.value ?? x.text), format) !== null;
  if (cellDate(x, ctx.date1904) !== null) return true;
  return ctx.contextFiscalYear !== null && typeof x.value === "string" && parseMonthDay(x.value) !== null;
}

/** 日付の列らしいか：〃（上と同じ）を除いた中身の 6 割以上が日付 */
function dateColumn(ctx: BuildCtx, cs: GridCell[], format?: DateFormat): boolean {
  const own = cs.filter((x) => !cue.isDitto(x.text));
  return own.length > 0 && ratio(own.filter((x) => isDateCell(ctx, x, format)).length, own.length) >= 0.6;
}

/**
 * 数の並びだけの日付（yyyymmdd：「20240406」）の列か。システムの書き出しに多い書き方。
 * 〃 を除いた中身の 8 割以上が 8 桁で、どれも年月日として正しい（年は 1900〜2100）。見出しが日付の語でなければ、すべてがそうであること
 * （8 桁の管理番号や金額を日付にしないため）
 */
function compactDateColumn(col: ColInfo, cs: GridCell[]): boolean {
  const own = cs.filter((x) => !cue.isDitto(x.text));
  if (!own.length) return false;
  const ok = own.filter((x) => {
    const f = parseWithFormat(String(x.value ?? x.text), "yyyymmdd");
    return !!f && f.y !== null && f.y >= 1900 && f.y <= 2100 && validYmd(f.y, f.m, f.d);
  }).length;
  const dateHeader = col.cue === "date" || col.cue === "end";
  return dateHeader ? ok >= 0.8 * own.length : ok === own.length && own.length >= 3;
}

/** 読み方の規則で決めた列の役目（列の見出しで指す）。規則が効いたセルを数える */
function ruleForColumn(ctx: BuildCtx, col: ColInfo, dataRows: number[]): void {
  for (const a of ctx.rules) {
    const r = a.rule;
    if ((r.kind !== "columnRole" && r.kind !== "dateFormat" && r.kind !== "effortUnit") || !sameColumn(col.header, r.column)) continue;
    if (r.kind === "dateFormat" && !col.dateFormat) col.dateFormat = r.format;
    if (r.kind === "effortUnit" && !col.effortUnit) col.effortUnit = r.unit;
    if (r.kind === "columnRole") {
      const c = col as ColInfo & { forced?: string; forcedBy?: string };
      if (!c.forced) {
        c.forced = r.role;
        c.forcedBy = r.id;
      } else if (c.forced !== r.role) {
        // 同じ列の 2 つ目の役目の規則は効かない（効いたセルにも数えない）。黙って捨てず、要約の注記に出す
        (col.ruleNotes ??= []).push(`「${col.header.replace(/\s*\n\s*/g, "")}」の列に役目のルールが 2 つある。効いたのは先のルール「${c.forcedBy}」（${c.forced}）で、ルール「${r.id}」（${r.role}）は効いていない（1 つの列に効く役目は 1 つ）`);
        continue;
      }
    }
    for (const row of dataRows) {
      const x = ctx.idx.at(row, col.c);
      if (x && x.text !== "") ctx.hits?.add(r, ctx.file, x.ref);
    }
  }
}
const forcedOf = (col: ColInfo) => (col as ColInfo & { forced?: string }).forced;

/** 号・系列の見出しの列の中身が、号の書き方か数だけか（「-」の号なしは数えない） */
function seriesValues(cs: GridCell[]): boolean {
  const own = cs.filter((x) => !/^[-－―—‐ー]+$/u.test(norm(x.text)));
  return own.length > 0 && ratio(own.filter((x) => /^\d{1,3}$/.test(norm(x.text)) || parseUnit(x.text) !== null).length, own.length) >= 0.8;
}

/** 金額らしい列か（見出しに額・価格・費、中身に円・¥）。役目の決まらない列の問いで、見本の字を伏せるのに使う */
const moneyLike = (header: string, cs: readonly GridCell[]): boolean => /額|価格|費/u.test(header) || cs.some((x) => /[円¥￥]/u.test(x.text));

/** 作業の表の、役目の決まらない列の問いの選択肢（どの役目にも答えられるように。既定は備考） */
export const COLUMN_ROLE_OPTIONS: { id: string; label: string }[] = [
  { id: "remark", label: "備考として根拠の文に添える" },
  { id: "workName", label: "作業の名前" },
  { id: "assetRef", label: "機器の名前" },
  { id: "tag", label: "機器番号" },
  { id: "date", label: "日付（始まり）" },
  { id: "end", label: "日付（終わり）" },
  { id: "days", label: "日数" },
  { id: "effort", label: "工数" },
  // 費用の列（Architect の 46）：見本では字を伏せ、作業の年度の値の費用に読む
  { id: "cost", label: "費用" },
  { id: "exclude", label: "外す" },
];

/** 英字まじりの符号（「STK-1」「SCL」「P101」）の列か：中身が 3 つ以上で、8 割以上が英字を含む符号の形、値はどれも違う */
function codeColumn(cs: GridCell[]): boolean {
  if (cs.length < 3) return false;
  const code = (t: string) => /^[A-Z0-9][A-Z0-9_./-]{0,15}$/.test(t) && /[A-Z]/.test(t);
  const keys = cs.map((x) => norm(x.text).toUpperCase());
  return ratio(keys.filter(code).length, keys.length) >= 0.8 && new Set(keys).size === keys.length;
}

/** 少ない値をくり返す列か：中身が 4 つ以上あり、違う値が 3 つ以下で、中身の数の半分以下（名前の列は値がほとんど違う） */
function repeatsFewValues(cs: GridCell[]): boolean {
  const distinct = new Set(cs.map((x) => norm(x.text))).size;
  return cs.length >= 4 && distinct <= 3 && distinct * 2 <= cs.length;
}

/** 予定・実績の語だけでできた列か（行ごとに予定の段と実績の段を書く書き方） */
function planActualColumn(cs: GridCell[]): boolean {
  return cs.length >= 2 && ratio(cs.filter((x) => cue.planActual(x.text) !== null).length, cs.length) >= 0.9;
}

/** 見出しの下の段らしい行：見出しの空いた列の単位の括弧（「(人)」）、日の数の並び（5・6・7…）、曜日（月・火…）だけの行 */
function subHeaderRow(ctx: BuildCtx, r: number, headerCols: Set<number>): boolean {
  const cs = rowTexts(ctx.idx, r);
  if (!cs.length) return false;
  const weekday = (t: string) => /^[月火水木金土日]$/u.test(norm(t));
  if (cs.length >= 3 && cs.every((c) => weekday(c.text))) return true;
  const nums = cs.filter((c) => /^\d{1,2}$/.test(norm(c.text)) && !headerCols.has(c.c)).map((c) => Number(norm(c.text)));
  const seq = nums.length >= 3 && nums.every((n, i) => i === 0 || n === (nums[i - 1] ?? 0) + 1 || n === 1);
  return cs.every((c) => (/^[(（][^()（）]{1,8}[)）]$/u.test(norm(c.text)) && !headerCols.has(c.c)) || (seq && /^\d{1,2}$/.test(norm(c.text)) && !headerCols.has(c.c)));
}

function headerExtent(ctx: BuildCtx, block: number[], top: number): number[] {
  let bottom = top;
  // 見出しの上の段から始まるとき：すぐ下の見出しの行も見出し
  if (block.includes(top + 1) && !headerLike(rowTexts(ctx.idx, top)) && headerLike(rowTexts(ctx.idx, top + 1))) bottom = top + 1;
  for (const m of ctx.grid.merges) if (m.top === top && m.bottom > bottom && block.includes(m.bottom)) bottom = m.bottom;
  // 見出しのすぐ下の行が、実績・予定の語だけでできていれば、2 段の見出し
  const next = bottom + 1;
  if (block.includes(next)) {
    const cells = rowTexts(ctx.idx, next);
    if (cells.length >= 2 && cells.every((c) => cue.planActual(c.text) !== null)) bottom = next;
  }
  // 見出しの下の段（単位・日の数・曜日）
  const headerCols = new Set(rowTexts(ctx.idx, bottom).map((c) => c.c));
  for (let k = 0; k < 3 && block.includes(bottom + 1) && subHeaderRow(ctx, bottom + 1, headerCols); k++) bottom++;
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

/** 数の値のセルか（数か、数の並びの文字） */
const isNumberCell = (c: GridCell) => typeof c.value === "number" || isNumberish(c);

/**
 * 年の列の 2 段の書き方：内容の行（年の列に整備の内容の文）のすぐ下に、金額の行（年の列に数だけを書き、年の列より左の欄に自分の文字の無い行）が続く。
 * 年の列の数の 8 割以上が金額の行にあり、金額の行の外の年の列の中身の 8 割以上が文で、内容の行と金額の行の組が 1 つ以上あるときだけ、金額の行 → 内容の行。そうでなければ null
 */
function amountRowsOf(ctx: BuildCtx, yearCols: ColInfo[], dataRows: number[]): Map<number, number> | null {
  const first = Math.min(...yearCols.map((c) => c.c));
  const inData = new Set(dataRows);
  const yearCells = (r: number) => yearCols.map((c) => ctx.idx.at(r, c.c)).filter((x): x is GridCell => !!x && x.text.trim() !== "");
  const ownLabel = (r: number) => ctx.idx.rowCells(r).some((x) => x.c < first && x.text.trim() !== "");
  const out = new Map<number, number>();
  for (const r of dataRows) {
    const ys = yearCells(r);
    if (!ys.length || !ys.every(isNumberCell) || ownLabel(r)) continue;
    const above = r - 1;
    if (!inData.has(above) || out.has(above)) continue;
    const ya = yearCells(above);
    if (ya.some(isNumberCell)) continue;
    if (!ya.length && !ownLabel(above)) continue;
    out.set(r, above);
  }
  if (!out.size) return null;
  const all = dataRows.flatMap(yearCells);
  const nums = all.filter(isNumberCell);
  const inAmount = nums.filter((x) => out.has(x.r));
  const rest = all.filter((x) => !out.has(x.r));
  if (inAmount.length < 0.8 * nums.length) return null;
  if (!rest.length || ratio(rest.filter((x) => !isNumberCell(x)).length, rest.length) < 0.8) return null;
  return out;
}

/** 年の帯の見出しの予定・実績（末尾の括弧の注記を除いても読む：「整備計画（2015年時点の表記）」） */
function bandPlanActual(part: string): "plan" | "actual" | null {
  return cue.planActual(part) ?? cue.planActual(nfkcText(part).replace(/\s+/g, "").replace(/[(（][^()（）]*[)）]$/u, ""));
}

function detectYearBand(ctx: BuildCtx, cols: ColInfo[], dataRows: number[], headerRow: number): { kind: Table["yearKind"]; issue: Omit<Issue, "tableId"> | null; amountRows?: Map<number, number> } {
  const years: { col: ColInfo; label: ReturnType<typeof parseYearLabel>; part: string }[] = [];
  for (const col of cols) {
    // 年の見出しは、見出しのどの段にあってもよい（上の段に「実施済」「計画期間」などの帯を置く書き方）。
    // 1 つのセルに年の書き方を改行で並べたもの（「H31⏎R1」）は、初めに読めたもの
    let found: { label: NonNullable<ReturnType<typeof parseYearLabel>>; part: string } | null = null;
    for (const part of col.headerParts) {
      const toks = part.split(/[\n\r]+/);
      for (const tok of toks) {
        const l = parseYearLabel(tok);
        if (l) {
          // 同じセルに並べたほかの書き方（「H23⏎2011年度」）が同じ年の年度・暦年を書いていれば、それも使う
          const other = l.fiscal === null ? toks.map((x) => parseYearLabel(x)).find((x) => x && x.year === l.year && x.fiscal !== null) : null;
          found = { label: other ? { ...l, fiscal: other.fiscal } : l, part };
          break;
        }
      }
      if (found) break;
    }
    // 元号と年の数を 2 段に分けた見出し（上の段「令和」、下の段「元」「2」…「12」）：合わせて読む。ほかの段に「年度」があれば年度
    if (!found) {
      const flat = (p: string) => nfkcText(p).replace(/\s+/g, "");
      const ei = col.headerParts.findIndex((p) => /^(令和|平成|昭和|大正|明治)$/u.test(flat(p)));
      const num = ei >= 0 ? col.headerParts.slice(ei + 1).find((p) => /^(\d{1,2}|元)(年度|年)?$/u.test(flat(p))) : undefined;
      const l = num !== undefined ? parseYearLabel(`${flat(col.headerParts[ei] ?? "")}${flat(num)}`) : null;
      if (l && num !== undefined) found = { label: l.fiscal === null && col.headerParts.some((p) => flat(p).endsWith("年度")) ? { ...l, fiscal: true } : l, part: num };
    }
    if (found) years.push({ col, label: found.label, part: found.part });
  }
  if (years.length < 1) return { kind: null, issue: null };
  // 年の列の中身が印（記号）であること。数や文の列（年度ごとの金額など）は星取表の印ではない。
  // ただし、整備の内容の文と、その下の行の金額を 2 段で書く書き方は、内容のセルを星取として読む（金額はその費用）
  const cells = years.flatMap((y) => dataCellsOf(ctx, dataRows, y.col.c));
  let amountRows: Map<number, number> | null = null;
  if (!cells.length || ratio(cells.filter((x) => isMarkLike(x.text)).length, cells.length) < 0.8) {
    amountRows = cells.length ? amountRowsOf(ctx, years.map((y) => y.col), dataRows) : null;
    if (!amountRows) return { kind: null, issue: null };
  }
  // 隣り合う列で、年が減らずに並ぶこと（同じ年が 2 列＝実績・予定）
  const seq = years.map((y) => y.label?.year ?? 0);
  for (let i = 1; i < seq.length; i++) if ((seq[i] ?? 0) < (seq[i - 1] ?? 0)) return { kind: null, issue: null };
  for (const y of years) {
    y.col.role = "mark";
    y.col.fiscalYear = y.label?.year ?? 0;
    y.col.yearLabel = y.part;
    // 予定・実績は、年の見出しでない段の語から（年の下の「実績／予定」の段、年の上の「実施済」「計画期間」の帯）
    const others = y.col.headerParts.filter((p) => p !== y.part);
    const pas = [...new Set(others.map((p) => bandPlanActual(p)).filter((x) => x !== null))];
    y.col.planOrActual = pas.length === 1 ? (pas[0] ?? null) : null;
  }
  const flags = years.map((y) => y.label?.fiscal ?? null);
  const anyTrue = flags.includes(true);
  const anyFalse = flags.includes(false);
  const extra = amountRows ? { amountRows } : {};
  if (anyTrue && !anyFalse) return { kind: "fiscal", issue: null, ...extra };
  if (anyFalse && !anyTrue) return { kind: "calendar", issue: null, ...extra };
  return {
    ...extra,
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
    const st = isSubtotalRow(ctx.idx.rowCells(r).filter((c) => c.text !== "" || !!c.note || isFormulaCell(c)));
    const first = cells[0];
    let role: RowRole = "data";
    if (st) role = st;
    else if (first && cells.length === 1 && cue.isNote(first.text)) role = "note";
    // 読み方の規則の行の役割（「『年度計』の行は合計として外す」）
    for (const a of ctx.rules) {
      if (a.rule.kind !== "rowRole") continue;
      const want = norm(a.rule.match);
      const prefix = a.rule.prefix === true;
      if (cells.some((c) => norm(c.text) === want || (prefix && norm(c.text).startsWith(want)))) {
        role = a.rule.role;
        for (const c of cells) ctx.hits?.add(a.rule, ctx.file, c.ref);
        break;
      }
    }
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
  for (const col of cols) ruleForColumn(ctx, col, dataRows);
  // 数の並びだけの日付の列は、規則が無くても、その書き方で読む（規則で決めた書き方が先）
  for (const col of cols) if (!col.dateFormat && compactDateColumn(col, dataCellsOf(ctx, dataRows, col.c))) col.dateFormat = "yyyymmdd";
  const yb = detectYearBand(ctx, cols, dataRows, top);
  const yearKind = yb.kind;
  // 金額の行（2 段の書き方の下の段）は、機器の行でも作業の行でもない（上の行の内容の費用）
  const amountRows = yb.amountRows;
  if (amountRows) for (const r of amountRows.keys()) dataRows.splice(dataRows.indexOf(r), 1);
  if (yb.issue) issues.push({ ...yb.issue, tableId: id });
  const marks = cols.filter((c) => c.role === "mark");
  let shape: Shape;
  if (marks.length) shape = "grid";
  else {
    const dateCol = cols.find((col) => forcedOf(col) === "date" || forcedOf(col) === "end" || dateColumn(ctx, dataCellsOf(ctx, dataRows, col.c), col.dateFormat));
    // 日付の列が無くても、作業の名前の列と、日数か工数の列があれば作業の表（工程表のように、日付を帯で描く書き方）
    const workish = cols.some((c) => c.cue === "workName") && cols.some((c) => c.cue === "days" || c.cue === "effort");
    shape = dateCol || workish ? "events" : "tree";
  }
  // 列の役目
  for (const col of cols) {
    if (col.role === "mark") continue;
    const cs = dataCellsOf(ctx, dataRows, col.c);
    // 読み方の規則で決めた役目（外すは理由つきで外す）
    const forced = forcedOf(col);
    // 読み手が自分で分けて読む列（号炉・機器・作業を 1 つのセルに書いた列）に、規則で役目を置いた：分けて読む読み方を止めたことを、要約の注記に出す
    if (forced && shape === "events" && compoundCues(col.headerParts[0] ?? ""))
      (col.ruleNotes ??= []).push(
        `「${col.header.replace(/\s*\n\s*/g, "")}」の列は、読み手が見出しの順に号炉・機器・作業に分けて読む列だが、ルール「${(col as ColInfo & { forcedBy?: string }).forcedBy ?? ""}」で役目を「${forced}」に決めたので、分けて読んでいない（このルールを外すと、読み手が分けて読む）`,
      );
    if (forced) {
      if (forced === "exclude") {
        col.role = "remark";
        col.ruleExclude = "ルールで外した列";
      } else col.role = forced as ColRole;
      continue;
    }
    if (col.dateFormat && shape === "events") {
      col.role = col.cue === "end" ? "end" : "date";
      continue;
    }
    if (col.effortUnit && shape === "events") {
      col.role = "effort";
      continue;
    }
    if (!cs.length && !col.header) continue;
    // 周期の列（「周期(年)」「点検周期」）：その行の作業の暦のきっかけ。段・号にしない（「1年」は号の書き方に見えるので、号より先に見る）
    if (col.cue === "cycle") {
      col.role = "cycle";
      continue;
    }
    // 費用の列（「概算費用(千円/回)」「契約金額」）：作業明細の費用の欄に読む（運営者の決定 A 案、2026-11-06）。印や作業にはしない。
    // 当施設の画面と Excel にだけ出し、共有ファイル・公開台帳・AI の見本には出さない
    if (col.cue === "cost") {
      col.role = "cost";
      continue;
    }
    // 工数の書き方（「24人工」「288時間」）は号・系列ではない（数と漢字の形が号の書き方と重なるため、先に外す）
    const isEffortText = (x: GridCell) => {
      const e = parseEffort(x.text);
      return e !== null && e.unit !== "bare";
    };
    // 号炉と号機を並べた書き方（「1号炉 No.1」）も号の列の中身に数える
    const units = cs.filter((x) => (parseUnit(x.text) !== null || splitSeriesCell(x.text) !== null) && !isEffortText(x));
    const hasRealUnit = units.some((x) => parseUnit(x.text)?.kind !== "ditto");
    if (cs.length && hasRealUnit && ratio(units.length, cs.length) >= 0.6) {
      col.role = "unit";
      continue;
    }
    if (shape === "events") {
      if (dateColumn(ctx, cs, col.dateFormat)) col.role = col.cue === "end" ? "end" : "date";
      else if (cs.length && ratio(cs.filter((x) => parseEffort(typeof x.value === "number" ? x.value : x.text) !== null).length, cs.length) >= 0.6 && col.cue === "effort") col.role = "effort";
      else if (cs.length && col.cue === "days" && ratio(cs.filter((x) => parseDayCount(typeof x.value === "number" ? x.value : x.text) !== null).length, cs.length) >= 0.6) col.role = "days";
      // 行の通し番号（No.）：その資料の中で行を指すだけ。記録の出どころには入るが、値としては読まない
      else if (cs.length && col.cue === "number" && ratio(cs.filter((x) => numberDepth(typeof x.value === "number" ? x.value : x.text) === 1).length, cs.length) >= 0.8) col.role = "number";
      // 管理番号（「R4-001」など）：行ごとに違う値なら、その資料の中で行を指すだけの番号
      else if (cs.length && col.cue === "number" && new Set(cs.map((x) => norm(x.text))).size === cs.length) col.role = "number";
      else if (col.cue === "assetRef" || col.cue === "name") col.role = "assetRef";
      else if (col.cue === "workName") {
        col.role = "workName";
        const k = compoundCues(col.headerParts[0] ?? "");
        if (k) col.compound = k;
      } else if (col.cue === "workTitle") col.role = "workTitle";
      else if (col.cue === "tag") col.role = "tag";
      else if (col.cue === "weekday") col.role = "remark";
      // 行ごとの予定・実績（「状態｜完了・計画中」）
      else if (planActualColumn(cs)) col.role = "planActual";
      // 号・系列の見出しの列で、中身が数だけ（「1」「2」）：号の列
      else if (col.cue === "series" && seriesValues(cs)) col.role = "unit";
      else if (col.cue === "remark" || col.cue === "spec" || col.cue === "category" || col.cue === "persons" || col.cue === "fiscal" || col.cue === "quantity") col.role = "remark";
      else if (col.cue === "effort") col.role = "effort";
      else if (cs.length) {
        col.role = "unknown";
        issues.push({
          kind: "columnRole",
          tableId: id,
          pattern: `col:${col.c}`,
          rows: [],
          cells: cs.slice(0, 10).map((x) => x.ref),
          // 見出しの無い列でも答えられるように、中身の見本と、表の行の範囲を添える。金額らしい列（見出しに額・価格・費、中身に円）は見本を伏せる（Architect の 46。費用の値を AI に渡さない）
          detail: `列 ${colLetter(col.c)}（見出し「${col.header || "なし"}」・中身の見本 ${moneyLike(col.header, cs) ? "（費用）" : [...new Set(cs.map((x) => x.text.replace(/\s+/g, " ").trim().slice(0, 20)))].slice(0, 3).map((t) => `「${t}」`).join("")}・表の ${dataRows[0] ?? top}〜${dataRows[dataRows.length - 1] ?? top} 行目）の役目が決まらない`,
          proposal: "remark",
          options: COLUMN_ROLE_OPTIONS,
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
    // 番号の見出しの列（「管理番号」）で、中身が英字まじりの符号で行ごとに違う：機器の表では機器番号（表に機器番号の見出しの列が無いとき）
    if (col.cue === "number" && !cols.some((k) => k.cue === "tag") && codeColumn(cs)) {
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
    // 数量の列（「1基」「2台」）は機器の仕様
    if (col.cue === "spec" || col.cue === "quantity") {
      col.role = "spec";
      continue;
    }
    col.role = "label"; // 名前か階層の候補（下で決める）
  }
  if (shape === "events") {
    // 区分の見出しの行（「〈燃焼設備〉」：中身が 1 セルだけで、日付も数も無い行）は、作業の行でなく注記
    for (const row of rows) {
      if (row.role !== "data") continue;
      const cs = rowTexts(ctx.idx, row.r);
      if (cs.length === 1 && typeof cs[0]?.value === "string" && !isDateCell(ctx, cs[0] as GridCell)) {
        row.role = "note";
        const i = dataRows.indexOf(row.r);
        if (i >= 0) dataRows.splice(i, 1);
      }
    }
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
    // 行が「機器 × 作業」の星取表：機器の名前の列より右の、作業の見出しの列は、その行の作業の名前。
    // 名前の列より右の、少ない値をくり返す列（施工の「委託・直営」など）は、機器の段ではなく属性
    const leaf = [...cols].reverse().find((c) => c.c < firstMark && c.role === "label" && (c.cue === "name" || c.cue === "assetRef"));
    if (leaf)
      for (const col of cols) {
        if (col.c <= leaf.c || col.c >= firstMark || col.role !== "label") continue;
        if (col.cue === "workName") col.role = "workName";
        else if (repeatsFewValues(dataCellsOf(ctx, dataRows, col.c))) col.role = "spec";
      }
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
    ...(amountRows ? { amountRows } : {}),
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
      detail: `階層の手がかりが割れている（${votes.map((v) => `${SIGNAL_LABEL[v.signal]}は第 ${v.level} 階層`).join("、")}）`,
      proposal: `level:${byNumber?.level ?? majority}`,
      options: levels.map((l) => ({ id: `level:${l}`, label: `第 ${l} 階層` })),
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
          detail: `第 ${parent.level} 階層のすぐ下が第 ${r.level} 階層（間の階層が無い）`,
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
        detail: `第 ${r.level} 階層の行の上に親が無い`,
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
  const data = t.rows.filter((r) => r.role === "data" && !t.amountRows?.has(r.r));
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
  // 葉でない段の列の空欄で、結合でもないもの：上と同じか（まとめて問う）。
  // 行ごとに作業の列があれば、葉（機器の名前）の空欄で作業の書いてある行も問う（上の行の機器の、別の作業）
  const workCol = t.cols.find((c) => c.role === "workName");
  for (const col of hier) {
    const isLeaf = col === leaf;
    if (isLeaf && !workCol) continue;
    const blanks: number[] = [];
    let seen = false;
    for (const r of data) {
      const cell = ctx.idx.resolved(r.r, col.c);
      if (cell && cell.text !== "") seen = true;
      else if (seen && (!isLeaf || (workCol && (ctx.idx.at(r.r, workCol.c)?.text ?? "") !== ""))) blanks.push(r.r);
    }
    if (blanks.length)
      t.issues.push({
        kind: "blankSameAsAbove",
        tableId: t.id,
        pattern: `col:${col.c}`,
        rows: blanks,
        cells: blanks.map((r) => cellRef(r, col.c)),
        detail: isLeaf ? `「${col.header}」の列の空欄で、作業だけを書いた行（${blanks.length} 行）` : `「${col.header}」の列の空欄（${blanks.length} 行）`,
        proposal: "same",
        options: isLeaf
          ? [
              { id: "same", label: "上の行と同じ機器（別の作業）" },
              { id: "none", label: "機器は無い" },
            ]
          : [
              { id: "same", label: "上と同じ" },
              { id: "none", label: "その階層は無い" },
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
function kvRow(cells: GridCell[], allowHeaderWords = false): boolean {
  if (cells.length < 2 || cells.length > 7 || (!allowHeaderWords && headerLike(cells))) return false;
  if (!allowHeaderWords && cells.filter((c) => cue.column(c.text) !== null).length * 2 > cells.length) return false;
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const label = cells[i] as GridCell;
    const t = norm(label.text);
    if (typeof label.value !== "string" || t.length < 1 || t.length > 8 || /^[\d.,/\-:]+$/.test(t) || parseDateText(label.text) !== null) return false;
  }
  return true;
}

/**
 * 塊の見出しの候補（頭の 1 セルだけの行（題）を除いた最初の行）より下の中身の半分以上が、その行に中身のある列（結合も見る）に並ぶか。
 * 候補の下に行が無ければ false
 */
function alignedUnderFirst(idx: CellIndex, block: number[]): boolean {
  const i = block.findIndex((r) => rowTexts(idx, r).length >= 2);
  const first = block[i];
  const body = block.slice(i + 1);
  if (i < 0 || first === undefined || !body.length) return false;
  const cells = body.flatMap((r) => rowTexts(idx, r));
  const under = cells.filter((c) => (idx.resolved(first, c.c)?.text ?? "") !== "").length;
  return cells.length > 0 && under * 2 >= cells.length;
}

const exactSig = (cells: GridCell[]) => cells.map((c) => `${c.c}\u0001${norm(c.text)}`).join("\u0002");
/** 頁ごとに変わる所（続きの印・頁の番号などの数）を除いた形 */
const looseSig = (cells: GridCell[]) =>
  cells.map((c) => `${c.c}\u0001${norm(cue.stripContinued(c.text)).replace(/\d+/g, "#")}`).join("\u0002");

/**
 * 頁の頭の行（題・副題・凡例・頁の番号の行）が、1 つ目の見出しの上の行と同じ形か：続きの印と数を除いて同じ文字か、
 * どちらも 2 セルまでで、同じ列に同じ幅の結合で書いた行（頁ごとに設備の名前だけ変わる題「中長期整備計画表　通風設備」）
 */
function samePreamble(idx: CellIndex, a: GridCell[], b: GridCell[]): boolean {
  if (looseSig(a) === looseSig(b)) return true;
  if (!a.length || a.length !== b.length || a.length > 2) return false;
  const span = (c: GridCell) => {
    const m = idx.merge(c.r, c.c);
    return m ? `${m.right - m.left}:${m.bottom - m.top}` : "1";
  };
  return a.every((x, i) => {
    const y = b[i] as GridCell;
    return x.c === y.c && span(x) === span(y) && span(x) !== "1" && typeof y.value === "string";
  });
}

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
        if (b <= prevH || out.has(b) || !samePreamble(idx, cellsOf(a), cellsOf(b))) break;
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

/** 1 つの列に、いくつかの欄を「・」でつないだ見出し（「号炉・系統・機器・作業内容」）：機器と作業の語があれば、手がかりの語の並び */
function compoundCues(header: string): ColumnCue[] | null {
  const parts = norm(header)
    .split(/[・]/u)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const ks = parts.map((p) => cue.column(p)).filter((k): k is ColumnCue => !!k);
  return ks.includes("workName") && (ks.includes("assetRef") || ks.includes("name")) ? ks : null;
}

// ─── 帳票（1 日 1 枚・1 件 1 枚） ─────────────────────────────────

/** 頭書きに書く項目の手がかり（表の行に付けられる欄） */
const HEAD_CUES = new Set<ColumnCue>(["date", "end", "name", "assetRef", "tag", "series", "workTitle"]);

/**
 * 帳票の頭書きの項目と値：行の中の、列の手がかりの語そのもの（「日付」「設備名」「機器番号」「号炉」。末尾の「：」は除く）の項目と、
 * そのすぐ右の中身のあるセル（値）。値が項目の語なら組にしない。列の見出しの行（手がかりの語が 3 つ以上）は頭書きにしない
 */
function headFields(idx: CellIndex, r: number): HeadField[] {
  const cs = rowTexts(idx, r);
  if (exactCueCount(cs) >= 3) return [];
  const out: HeadField[] = [];
  for (let i = 0; i + 1 < cs.length; i++) {
    const label = cs[i] as GridCell;
    const value = cs[i + 1] as GridCell;
    const t = stripLabel(label.text);
    const k = typeof label.value === "string" && t.length <= 8 ? cue.column(t) : null;
    if (!k || !HEAD_CUES.has(k) || !cueWordIs(t, k) || value.text.trim() === "" || cue.column(stripLabel(value.text)) !== null) continue;
    out.push({ cue: k, label: t, cell: value });
    i++;
  }
  return out;
}

const stripLabel = (t: string) => norm(t).replace(/[：:]$/u, "");
/** 手がかりの語そのものの見出しの数（列の見出しの行は「No.｜機器｜作業内容｜…」と語そのものが並ぶ。「1号炉」は語を含む値） */
const exactCueCount = (cs: GridCell[]) =>
  cs.filter((c) => {
    const t = stripLabel(c.text);
    const k = cue.column(t);
    return !!k && cueWordIs(t, k);
  }).length;
/** 手がかりの語そのものか（「日付」は日付の語。「作業日報」は語の頭だけが合うので項目にしない） */
const cueWordIs = (t: string, k: ColumnCue) => cue.words(k).includes(t);

/**
 * 同じ形の帳票を頁ごとに積んだシート（1 日 1 枚の日報を月のシートに、1 件 1 枚の報告書を 1 枚のシートに）の頁。
 * 頁の境は印刷の改ページ（行）。改ページが無ければ、同じ見出しの行の 2 つ目からの、すぐ上の頭書きの塊の始め。
 * 同じ見出しの行が 2 頁以上にあり、そのどの頁にも、見出しより上に頭書きの項目と値があるときだけ頁に分ける（帳票でなければ null）。
 * 1 つの長い表を印刷で頁に分けただけのもの（頭書きの無い頁）は分けない（頁ごとにくり返す見出しとしてつなぐ）
 */
function formPages(idx: CellIndex, rows: number[], g: SheetGrid): number[][] | null {
  const headers = new Map<string, number[]>();
  for (const r of rows) {
    const cs = rowTexts(idx, r);
    if (headerLike(cs)) headers.set(exactSig(cs), [...(headers.get(exactSig(cs)) ?? []), r]);
  }
  const hs = [...headers.values()].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!hs) return null;
  const split = (bounds: number[]) => {
    const pages: number[][] = [];
    let cur: number[] = [];
    let bi = 0;
    for (const r of rows) {
      while (bi < bounds.length && r >= (bounds[bi] ?? Infinity)) {
        if (cur.length) pages.push(cur);
        cur = [];
        bi++;
      }
      cur.push(r);
    }
    if (cur.length) pages.push(cur);
    return pages;
  };
  // 頁ごとに、見出しの行の上に頭書きの項目があるか
  const formLike = (pages: number[][]) => {
    const withHeader = pages.filter((p) => p.some((r) => hs.includes(r)));
    return withHeader.length >= 2 && withHeader.every((p) => {
      const h = p.find((r) => hs.includes(r)) ?? 0;
      return p.some((r) => r < h && headFields(idx, r).length > 0);
    });
  };
  const breaks = g.rowBreaks ?? [];
  if (breaks.length) {
    const pages = split(breaks.map((b) => b + 1));
    return formLike(pages) ? pages : null;
  }
  // 改ページが無い：2 つ目からの見出しの行ごとに、前の見出しより下で、いちばん近い頭書きの項目のある行の塊の始めで切る。
  // 頭書きは、表と空いた行で分かれた別の塊（見出しの行も、前の見出しも含まない塊）にあるときだけ（表の中の「作業内容｜…」を頭書きにしない）
  const blocks = blocksOf(rows, g);
  const bounds: number[] = [];
  for (let k = 1; k < hs.length; k++) {
    const h = hs[k] ?? 0;
    const prev = hs[k - 1] ?? 0;
    const headRow = [...rows].reverse().find((r) => r < h && r > prev && headFields(idx, r).length > 0);
    if (headRow === undefined) return null;
    const block = blocks.find((b) => b.includes(headRow));
    if (!block || block.includes(h) || block.includes(prev) || block.some((r) => exactCueCount(rowTexts(idx, r)) >= 3)) return null;
    bounds.push(Math.max(block[0] ?? headRow, prev + 1));
  }
  const pages = split(bounds);
  return formLike(pages) ? pages : null;
}

// ─── シートの入口 ────────────────────────────────────────────

/**
 * 概要のシート：列の見出しの行が 1 つも無く、どの行も 1 セルか項目と値の行（「時点・対象期間｜2015年3月策定…」「受入供給設備｜16 管理単位」）。
 * 同じ資料のほかのシートに表があるときだけ（表のシートの前置き）。機器や作業の表ではないので、行は注記（記録には使わない。理由を残す）
 */
function overviewSheet(idx: CellIndex, rows: number[]): boolean {
  return rows.length > 0 && !rows.some((r) => headerLike(rowTexts(idx, r))) && rows.every((r) => rowTexts(idx, r).length <= 1 || kvRow(rowTexts(idx, r), true));
}

export function layoutSheet(src: SourceFile, grid: SheetGrid, allRules: readonly ActiveRule[] = [], hits: RuleHits | null = null, otherSheetHasTable = false): SheetLayout {
  const idx = new CellIndex(grid);
  const sheetTexts = new Set(grid.cells.map((c) => norm(c.text)));
  const rules = allRules.filter((a) => ruleApplies(a.rule, src.file, sheetTexts));
  const contextFiscalYear = fiscalYearInText(grid.cells.map((c) => c.text));
  const ctx: BuildCtx = { file: src.file, sheet: grid.name, sheetIndex: grid.index, grid, idx, date1904: src.date1904, contextFiscalYear, rules, hits };
  const roles = new Map<number, RowRole>();
  const rowReasons = new Map<number, string>();
  const tables: Table[] = [];
  const notes: SheetLayout["notes"] = [];
  const titles: SheetLayout["titles"] = [];
  const legends: { rows: number[]; entries: LegendEntry[] }[] = [];
  const all = contentRows(idx, grid);
  if (otherSheetHasTable && overviewSheet(idx, all)) {
    all.forEach((r, i) => {
      const cells = rowTexts(idx, r);
      const text = cells.map((c) => c.text).join(" ");
      const ref = cells[0]?.ref ?? cellRef(r, 1);
      if (i === 0 && cells.length === 1) {
        roles.set(r, "title");
        titles.push({ r, text, ref });
      } else {
        roles.set(r, "note");
        notes.push({ r, text, ref });
        rowReasons.set(r, "概要のシートの項目と値（列の見出しの行の無いシート）。記録には使わない");
      }
    });
    return { file: src.file, sheet: grid.name, sheetIndex: grid.index, grid, index: idx, rowRoles: roles, tables, notes, titles, looseLegends: [], rowReasons, contextFiscalYear, contextPeriod: null };
  }
  // CSV の記録が物理の何行にわたるか（囲みの中の改行の数＋1）
  const spans = new Map<number, number>();
  if (src.format === "csv" || src.format === "tsv")
    for (const c of grid.cells) {
      const n = (c.text.match(/\r\n|\r|\n/g) ?? []).length + 1;
      if (n > 1 && n > (spans.get(c.r) ?? 1)) spans.set(c.r, n);
    }
  // 帳票を頁ごとに積んだシートは、頁ごとに表を切る（頁をまたいで表をつながない）
  const pages = formPages(idx, all, grid) ?? [all];
  const pageOf = new Map<number, number>();
  pages.forEach((p, i) => {
    for (const r of p) pageOf.set(r, i);
  });
  pages.forEach((page, pi) => {
    const repeats = findRepeats(idx, page);
    for (const [r, rp] of repeats) {
      roles.set(r, "header");
      rowReasons.set(r, rp.kind === "continued" ? "続きの表記（前の表の続き）" : "くり返す見出し（表の始めの見出しと同じ。頁ごとにくり返したもの）");
    }
    const blocks = joinAcross(
      blocksOf(
        page.filter((r) => !repeats.has(r)),
        grid,
        spans,
      ),
      page,
      repeats,
    );
    blocks.forEach((block, b0) => {
      // 題は 1 頁目の頭だけ
      const bi = pi === 0 ? b0 : b0 + 1;
      const firstRow = block[0] ?? 0;
      const firstCells = rowTexts(idx, firstRow);
      // 凡例の塊
      if (firstCells.some((c) => cue.isLegendTitle(c.text))) {
        for (const r of block) roles.set(r, "legend");
        // 記号の凡例が読めなければ、「X＝意味」の書き方（短い字の印）で読む
        let entries = readLegend(idx, block);
        if (!entries.length) {
          const r0 = block[0] ?? 0;
          const ref = rowTexts(idx, r0)[0]?.ref ?? cellRef(r0, 1);
          entries = block.flatMap((r) => rowTexts(idx, r).flatMap((c) => parseEqualsLegend(c.text))).map((e) => ({ ...e, planOrActual: cue.planActual(e.meaning), refs: [ref], r: r0 }));
        }
        legends.push({ rows: block, entries });
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
      // 見出しの候補の行の下の中身が、その行の列にほとんど並ばない小さな塊（PDF の題を文字の位置で切り分けたもの、表の下の署名の欄）。
      // 1 行だけの塊も、見出しの下に中身が無いので表にしない
      const loose = otherTable && block.length <= 4 && !alignedUnderFirst(idx, block);
      // どの行も 1 セルだけの塊で、1 行目が列の見出しの語でないもの（表紙の「記入の決まり」のような文の並び）：表にしない
      const lines = block.every((r) => rowTexts(idx, r).length === 1) && cue.column(firstCells[0]?.text ?? "") === null;
      // 帳票の頭書きの塊（「日付｜2021/4/1｜（木）｜天候｜晴｜…」）：ほかに表があり、6 行まで、列の見出しの行が無く、頭書きの項目と値がある
      const headBlock = otherTable && block.length <= 6 && block.some((r) => headFields(idx, r).length > 0) && !block.some((r) => exactCueCount(rowTexts(idx, r)) >= 3);
      if (small || kvBlock || loose || lines || headBlock) {
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
            if (headBlock) rowReasons.set(r, "表の上の項目と値（頭書き）");
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
      // 見出しの行：はじめの 4 行のうち、見出しの語のいちばん多い行（頭書きの値に見出しの語がまじる書き方があるため）
      const cueCount = (r: number) => rowTexts(idx, r).filter((c) => cue.column(c.text) !== null).length;
      let hi = -1;
      for (let i = 0; i < Math.min(rest.length, 4); i++) if (headerLike(rowTexts(idx, rest[i] ?? 0)) && (hi < 0 || cueCount(rest[i] ?? 0) > cueCount(rest[hi] ?? 0))) hi = i;
      if (hi < 0) hi = rest.findIndex((r) => headerLike(rowTexts(idx, r)));
      // 読み方の規則の見出しの行（「3 行目を見出しとして読む」）
      let ruleHeader = false;
      for (const a of rules) {
        if (a.rule.kind !== "headerRow") continue;
        const i = rest.indexOf(a.rule.row);
        if (i >= 0) {
          hi = i;
          ruleHeader = true;
          for (const c of rowTexts(idx, a.rule.row)) hits?.add(a.rule, src.file, c.ref);
          break;
        }
      }
      // 見出しの行のすぐ上の、見出しの空いた列の上にだけ短い名前を置いた行は、見出しの上の段（「人員」「延人員」）
      let upper = 0;
      if (hi > 0) {
        const head = new Set(rowTexts(idx, rest[hi] ?? 0).map((c) => c.c));
        for (let i = hi - 1; i >= 0; i--) {
          const cs = rowTexts(idx, rest[i] ?? 0);
          if (cs.length && cs.every((c) => !head.has(c.c) && typeof c.value === "string" && norm(c.text).length <= 8 && parseDateText(c.text) === null)) upper++;
          else break;
        }
      }
      if (hi - upper > 0 && (ruleHeader || rest.slice(0, hi - upper).every((r) => rowTexts(idx, r).length <= 2 || kvRow(rowTexts(idx, r)) || kvRow(rowTexts(idx, r), true)))) {
        for (const r of rest.splice(0, hi - upper)) {
          const cells = rowTexts(idx, r);
          roles.set(r, "note");
          rowReasons.set(r, "表の上の項目と値（頭書き）。記録には使わない");
          notes.push({ r, text: cells.map((c) => c.text).join(" "), ref: cells[0]?.ref ?? cellRef(r, 1) });
        }
        top = rest[0] ?? top;
      }
      tables.push(buildTable(ctx, rest, top, roles));
    });
  });
  // 帳票の頭書き：同じ頁の、表の上（前の表より下）の項目と値を、その表に持たせる（表に無い欄を行に付けるため）
  for (const t of tables) {
    const p = pageOf.get(t.top);
    const prevBottom = Math.max(0, ...tables.filter((u) => u !== t && u.bottom < t.top && pageOf.get(u.top) === p).map((u) => u.bottom));
    const fields = [...notes, ...titles]
      .filter((n) => n.r < t.top && n.r > prevBottom && pageOf.get(n.r) === p)
      .sort((a, b) => a.r - b.r)
      .flatMap((n) => headFields(idx, n.r));
    if (fields.length) t.head = fields;
    // 作業の表の、行の番号だけの行（帳票の記入欄の空き「3｜｜｜」）と、番号の欄に項目の名前を書いた 2 セルまでの行
    // （表の下の記入欄「安全・特記事項｜KY 活動実施。」）：記録にしない
    if (t.shape === "events")
      for (const row of t.rows) {
        const cs = rowTexts(idx, row.r);
        const roleOf = (c: GridCell) => t.cols.find((k) => k.c === c.c)?.role;
        const first = cs[0];
        const why =
          cs.length > 0 && cs.every((c) => roleOf(c) === "number")
            ? "行の番号だけの行（記入欄の空き）"
            : first && cs.length <= 2 && roleOf(first) === "number" && typeof first.value === "string" && numberDepth(first.value) === null && !/\d/u.test(first.text)
              ? "表の下の記入欄（項目と文）"
              : null;
        if (row.role === "data" && why) {
          row.role = "note";
          roles.set(row.r, "note");
          rowReasons.set(row.r, why);
        }
      }
  }
  // 頭書きの「名前の項目｜値」（「設備名｜受入供給設備」）：シートの木の表がただ 1 つで、その上にただ 1 つあれば、表の行の親のまとまり
  const trees = tables.filter((t) => t.shape === "tree");
  const tree = trees[0];
  if (trees.length === 1 && tree) {
    const heads = notes
      .filter((n) => n.r < tree.top)
      .flatMap((n) => {
        const cs = rowTexts(idx, n.r);
        if (!kvRow(cs)) return [];
        const out: GridCell[] = [];
        for (let i = 0; i + 1 < cs.length; i += 2) {
          const label = cs[i] as GridCell;
          const value = cs[i + 1] as GridCell;
          if (cue.column(label.text) === "name" && typeof value.value === "string" && value.text.trim() !== "") out.push(value);
        }
        return out;
      });
    const h = heads[0];
    if (heads.length === 1 && h) tree.heading = { text: h.text.replace(/\s*\n\s*/g, " ").trim(), ref: h.ref };
  }
  // 表の上や下の注記の行に書いた凡例（「凡例　点＝点検　整＝分解整備」「凡例　▲：実施済　△：計画」）も凡例にする（星取表の形の表があるときだけ）。
  // 記号の並び（「▲：実施済」）は、括弧だけの記号を除く（凡例の後ろの注記「（令和8年9月末現在）」を記号にしない）
  if (tables.some((t) => t.shape === "grid"))
    for (const n of notes.filter((x) => cue.isLegendTitle(x.text))) {
      const eq = parseEqualsLegend(n.text);
      const entries = eq.length ? eq : parseInlineLegend(cue.stripLegendTitle(n.text)).filter((e) => !/^[(（［\[「『【〔]+$/u.test(e.symbol));
      if (!entries.length) continue;
      roles.set(n.r, "legend");
      legends.push({ rows: [n.r], entries: entries.map((e) => ({ ...e, planOrActual: cue.planActual(e.meaning), refs: [n.ref], r: n.r })) });
    }
  // 読み方の規則の印の意味（「▲ は実績、△ は予定」）：どの星取表の形の表でも、資料の凡例より先に当てる（ルールは人が読み違いを直すために置く。Architect の 60）
  const markRules = rules.filter((a) => a.rule.kind === "markMeaning");
  const ruleEntries: LegendEntry[] = markRules.map((a) => {
    const r = a.rule as Extract<typeof a.rule, { kind: "markMeaning" }>;
    return { symbol: r.symbol, meaning: r.meaning ?? (r.planOrActual === "plan" ? "予定" : "実績"), planOrActual: r.planOrActual, refs: [], r: 0, rule: a.rule };
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
  if (ruleEntries.length) for (const t of tables.filter((x) => x.shape === "grid")) t.legend.unshift(...ruleEntries.map((e) => ({ ...e })));
  const periods = new Map<string, { start: Ymd; end: Ymd; text: string }>();
  for (const n of [...titles, ...notes]) {
    // 項目の名前（「予定工期：」）と曜日の括弧を除いて、期間として読む
    const body = nfkcText(n.text).replace(/^[^：:]{1,10}[：:]/u, "").replace(/[(（][月火水木金土日][)）]/gu, "");
    const pair = /(\S+)\s*[〜~]\s*(\S+)/u.exec(body);
    const p = parseDateRange(body) ?? (pair ? parseDateRange(`${pair[1]}~${pair[2]}`) : null);
    if (p) periods.set(`${p.start.y}-${p.start.m}-${p.start.d}|${p.end.y}-${p.end.m}-${p.end.d}`, { ...p, text: n.text });
  }
  const contextPeriod = periods.size === 1 ? ([...periods.values()][0] ?? null) : null;
  return { file: src.file, sheet: grid.name, sheetIndex: grid.index, grid, index: idx, rowRoles: roles, tables, notes, titles, looseLegends, rowReasons, contextFiscalYear, contextPeriod };
}

export function layoutFile(src: SourceFile, rules: readonly ActiveRule[] = [], hits: RuleHits | null = null): SheetLayout[] {
  // 列の見出しの行のあるシート（表のシート）。概要のシートは、ほかに表のシートがあるときだけ注記にする
  const hasTable = src.sheets.map((g) => {
    const idx = new CellIndex(g);
    return contentRows(idx, g).some((r) => headerLike(rowTexts(idx, r)));
  });
  return src.sheets.map((g, i) => layoutSheet(src, g, rules, hits, hasTable.some((h, j) => h && j !== i)));
}

export { norm };
