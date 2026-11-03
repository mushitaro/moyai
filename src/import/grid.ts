// 層 1 の出力の形：どの形式も「セルの格子＋出どころ」。層 2 から先は形式を知らない（plan §2.3）。

export type CellType = "number" | "string" | "boolean" | "error" | "formula-no-cache";

export interface GridCell {
  /** 1 から数える行と列 */
  r: number;
  c: number;
  /** 例 "C12"（CSV でも列の文字＋行の番号） */
  ref: string;
  /** 元の値。数（日付は通し番号のまま）・文字・真偽。誤りと、計算済みの値の無い数式は null */
  value: number | string | boolean | null;
  /** 表示の文字（表示形式を当てたもの。CSV は元の文字） */
  text: string;
  type: CellType;
  /** 表示形式（無ければ "General"） */
  numFmt: string;
  formula: string | null;
  /** 数式があって計算済みの値が無い（未解決に数える） */
  formulaNoCache: boolean;
  error: string | null;
  bold: boolean;
  /** 書式の字下げ（Excel の indent） */
  indent: number;
  /** 頭の空白の幅（半角 1、全角 2） */
  leadingSpaces: number;
  /** メモ（コメント）の文 */
  note: string | null;
  /** 頁（1 から）。頁のある資料（PDF）だけ。Excel・CSV は無い */
  page?: number;
  /** 頁の上の位置（頁の左上を原点に、右と下へ pt。x, y, 幅, 高さ）。頁のある資料だけ */
  box?: [number, number, number, number];
}

export interface MergeRange {
  ref: string; // "A5:A7"
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface LineProps {
  hidden: boolean;
  outline: number;
}

export interface SheetGrid {
  /** シートの名前。CSV は null */
  name: string | null;
  index: number;
  state: "visible" | "hidden" | "veryHidden";
  /** 値か文字のあるセルだけ（結合の従のセルは入れない）。行、列の順 */
  cells: GridCell[];
  merges: MergeRange[];
  rows: Record<number, LineProps>;
  cols: Record<number, LineProps>;
  maxRow: number;
  maxCol: number;
}

/** 台帳：読まなかった物・読み方を決めたこと・直したこと（数えて残す）。 */
export interface LedgerEntry {
  kind: "unread" | "decided" | "normalized" | "warning";
  what: string;
  count: number;
  detail: string;
  sheet: string | null;
}

export type SourceFormat = "xlsx" | "xlsm" | "csv" | "tsv" | "pdf" | PhotoFormat;

/** 頁のある資料の頁ごとの数（PDF）。文字の無い頁は写真の道に回す（推し量って読まない） */
export interface PageInfo {
  page: number;
  /** 頁の幅と高さ（pt） */
  width: number;
  height: number;
  /** 格子の何行目から何行目か（文字の無い頁は null） */
  rows: { from: number; to: number } | null;
  /** 文字の並び（空白だけのものを除く）の数と、セルに置いた数 */
  runs: number;
  placed: number;
  /** 文字が無い（スキャンの頁）。写真の道に回す */
  scanned: boolean;
}

/** 写真（JPEG・PNG と、文字の無い PDF の頁）。層 1 の読み手ではなく、AI が読んだ格子から作る（photo.ts） */
export type PhotoFormat = "photo";

/**
 * 写真から作った格子の付け足し（format が photo のときだけ）。層 2〜4 は形式を知らないので、
 * 層 4（compose.ts）が出どころに画像の位置を付け、人が確かめるまで要確認に数えるのに使う。
 */
export interface PhotoMeta {
  /** 人が画像と並べて確かめたか（確かめるまで、この写真から作った記録はどれも要確認） */
  confirmed: boolean;
  /** 人が確かめたときの一言の理由（確かめていなければ null） */
  confirmedReason: string | null;
  /** 元の画像の頁（文字の無い PDF の頁から来たもの。写真は null） */
  page: number | null;
  /** セル（"B3" など）→ 元の画像の上の位置 [x, y, w, h]（画素） */
  boxes: Record<string, [number, number, number, number]>;
  /** セル → 作者（AI が読んだまま、か人が直した） */
  authors: Record<string, "ai_reading" | "human">;
}

export interface SourceFile {
  /** ファイルの名前（取り込みの中で一意。出どころに書く） */
  file: string;
  format: SourceFormat;
  sheets: SheetGrid[];
  ledger: LedgerEntry[];
  date1904: boolean;
  /** 頁のある資料（PDF）の頁ごとの数 */
  pages?: PageInfo[];
  /** 写真から作った格子だけが持つ */
  photo?: PhotoMeta;
}

/** 受け付けない形式（保存し直しを求める）か、読めなかった */
export interface RejectedFile {
  file: string;
  reason: string;
}

export function colLetter(c: number): string {
  let s = "";
  let n = c;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function cellRef(r: number, c: number): string {
  return `${colLetter(c)}${r}`;
}

export function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  return { r: Number(m[2]), c: colNumber(m[1] ?? "") };
}

export function parseRange(ref: string): MergeRange | null {
  const [a, b] = ref.split(":");
  const p = a ? parseRef(a) : null;
  const q = b ? parseRef(b) : p;
  if (!p || !q) return null;
  return {
    ref,
    top: Math.min(p.r, q.r),
    left: Math.min(p.c, q.c),
    bottom: Math.max(p.r, q.r),
    right: Math.max(p.c, q.c),
  };
}

export function leadingSpaceWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " " || ch === "\t") w += 1;
    else if (ch === "　") w += 2;
    else break;
  }
  return w;
}

/** シートのセルを位置で引く表 */
export class CellIndex {
  private readonly map = new Map<number, GridCell>();
  private readonly mergeOf = new Map<number, MergeRange>();
  constructor(readonly sheet: SheetGrid) {
    for (const c of sheet.cells) this.map.set(key(c.r, c.c), c);
    for (const m of sheet.merges)
      for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) this.mergeOf.set(key(r, c), m);
  }
  /** そのセル（結合の従なら null） */
  at(r: number, c: number): GridCell | null {
    return this.map.get(key(r, c)) ?? null;
  }
  /** 結合の中なら主のセル */
  resolved(r: number, c: number): GridCell | null {
    const m = this.mergeOf.get(key(r, c));
    if (m) return this.map.get(key(m.top, m.left)) ?? null;
    return this.at(r, c);
  }
  merge(r: number, c: number): MergeRange | null {
    return this.mergeOf.get(key(r, c)) ?? null;
  }
  rowCells(r: number): GridCell[] {
    const out: GridCell[] = [];
    for (let c = 1; c <= this.sheet.maxCol; c++) {
      const x = this.at(r, c);
      if (x) out.push(x);
    }
    return out;
  }
}

function key(r: number, c: number): number {
  return r * 20000 + c;
}
