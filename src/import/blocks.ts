// 層 2：PDF の表の、何行にも折り返した 1 つの記録を 1 つの塊にまとめる（reader-pdf-blocks-v1）。PDF の格子のときだけ効かせる（Excel・CSV の表は今どおり）。
// - 列の幅：読み手（pdf.ts）は文字の左端の位置で列を組むので、列の途中で切れた字は別の列のセルになる。見出しの行の字の始まりの位置で列の幅を決め、
//   その幅の中に落ちるセルの字を、その列の字として行・列の順につなぐ。見出しの切れた字（隙間なく続く字の並び）も 1 つの見出しにする。
// - 記録の塊：名前の欄に字のある行から、次の空の行か、名前の欄の空いた行のあとの次に名前の欄に字のある行の前までを 1 つの記録にする
//   （名前の欄も折り返すので、続けて名前の欄に字のある行は同じ記録の名前の続き）。頁をまたぐ記録は、次の頁の名前の欄の空いた行を前の記録につなぐ。
// - 表の外：頁の頭書きと頁の足（頁ごとに同じ字がくり返す行、頁の番号「n / m」）・節の題（「1．」で始まる行）・文の段落（表の見出しの下に無い、文の続く行）は
//   理由つきで外す。項目と内容の 2 列の表は、資料の属性（号炉・工期）として読む。どれにも当たらない行は、今までどおりの読み方に回す。
// 語は持たない：見出しの語は packs/_cues の列の手がかりで見分け、ほかは字の位置と書き方（数・日付・「：」）だけで決める。
import { CellIndex, type GridCell, type SheetGrid, type SourceFile } from "./grid";
import { cue, norm } from "./cues";
import { nfkc, parseDateRange, parseDateText, type Ymd } from "./era";
import type { ColInfo, RowInfo, RowRole, Table } from "./structure";
import { leadingUnit, nameKey, parseEffort, parseUnit, type UnitValue } from "./text";

export const PAGE_REASON = "頁の頭書き（頁ごとにくり返す行・頁の番号）";
export const SECTION_REASON = "節の題";
export const PARAGRAPH_REASON = "文の段落（表の見出しの下に無い、文の続く行）";
export const ATTRS_REASON = "資料の属性（項目と内容の表。号炉と工期の手がかりに読んだ。記録の値には使わない）";
export const REPEAT_HEADER_REASON = "くり返す見出し（表の始めの見出しと同じ。頁ごとにくり返したもの）";

/** 記録の 1 つの列の、折り返しをつないだ字のまとまり（行の順） */
export interface BlockItem {
  text: string;
  refs: string[];
  rows: number[];
}

/** 名前の欄の 1 行（1 行の中の切れた字はつないである） */
export interface BlockLine {
  r: number;
  text: string;
  refs: string[];
}

/** 1 つの記録（何行にも折り返した塊） */
export interface RecordBlock {
  rows: number[];
  name: BlockLine[];
  /** 列（cols の c）→ 字のまとまり。名前の欄の列は含まない */
  items: Map<number, BlockItem[]>;
  /** 塊のどのセルも（行・列の順） */
  refs: string[];
}

/** 資料の属性（項目と内容の表から）：号炉（ただ 1 つのとき）と工期（年月日のそろった期間） */
export interface DocAttrs {
  unit: number | null;
  period: { start: Ymd; end: Ymd } | null;
}

export interface BlockTable {
  /** 名前・作業の内容・状態の列（cols の c） */
  nameCol: number;
  workCol: number;
  stateCol: number | null;
  records: RecordBlock[];
  /** 塊にできなかった行（名前の欄が空で、前に記録の無い行） */
  strays: { r: number; refs: string[] }[];
  attrs: DocAttrs | null;
}

export interface BlockLayout {
  tables: Table[];
  roles: Map<number, RowRole>;
  reasons: Map<number, string>;
  titles: { r: number; text: string; ref: string }[];
  /** この読みで行き先を決めた行（残りの行は今までどおりの読み方に回す） */
  consumed: Set<number>;
}

interface Frag {
  cell: GridCell;
  x0: number;
  x1: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

const isWs = (ch: string | undefined) => !!ch && /\s/u.test(ch);
const asciiAlnum = (ch: string | undefined) => !!ch && /[0-9A-Za-z]/.test(ch);

/** 同じ行の字の並びをつなぐ：隙間が字の幅の 2 割を越えるところは空白（pdf.ts のつなぎ方と同じ） */
function joinFrags(fs: readonly Frag[], em: number): string {
  let out = "";
  let right = -Infinity;
  for (const f of fs) {
    const t = f.cell.text;
    if (out && f.x0 - right > 0.2 * em && !isWs(out[out.length - 1]) && !isWs(t[0])) out += " ";
    out += t;
    right = Math.max(right, f.x1);
  }
  return out.trim();
}

/** 折り返しの行をつなぐ：英数字どうしが続くときだけ空白を入れる（日本語の折り返しは字の途中で切れる） */
export function joinWrap(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return asciiAlnum(a[a.length - 1]) && asciiAlnum(b[0]) ? `${a} ${b}` : `${a}${b}`;
}

/** 年月日のそろった期間か、年の無い月-日の期間（「05-14～05-18」「5/14〜5/18」「5月14日～5月18日」） */
export function monthDayRange(text: string): { start: { m: number; d: number }; end: { m: number; d: number } } | null {
  const m = /^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?\s*[~〜]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/u.exec(nfkc(text));
  if (!m) return null;
  const [m0, d0, m1, d1] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  const ok = (mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  return ok(m0, d0) && ok(m1, d1) ? { start: { m: m0, d: d0 }, end: { m: m1, d: d1 } } : null;
}

const periodLike = (t: string) => parseDateRange(t) !== null || monthDayRange(t) !== null || parseDateText(t) !== null;
/** 「項目：」で始まる字（「根拠：」「備考：」など）。新しいまとまりの始まり */
const labelStart = (t: string) => /^[^\s：:]{1,8}[：:]/u.test(nfkc(t));
/** 文の終わり（「。」）で終わる字は、次の行に続かない */
const sentenceEnd = (t: string) => /[。．]$/u.test(t.trim());

/** 見出しの語の手がかり：字全体と、「・」「／」で区切った語ごと */
function cuesOf(text: string): Set<string> {
  const out = new Set<string>();
  const whole = cue.column(text);
  if (whole) out.add(whole);
  for (const part of nfkc(text).split(/[・/、,\s]+/u)) {
    const k = part ? cue.column(part) : null;
    if (k) out.add(k);
  }
  return out;
}

/** 見出しの字らしいか：短く、文の句点が無く、日付・数だけでない */
function headerText(t: string): boolean {
  const s = norm(t);
  return s.length >= 1 && s.length <= 24 && !/[。]/u.test(s) && parseDateText(s) === null && !/^[\d.,:/\-]+$/u.test(s);
}

/** 頁の番号の行の終わり（「1 / 3」「WK-2020-03-1 / 1」） */
const pageNumber = (t: string) => /(?:^|[\s\-])\d{1,4}\s*\/\s*\d{1,4}$/u.test(nfkc(t));

export function readRecordBlocks(src: SourceFile, grid: SheetGrid, idx: CellIndex, rows: readonly number[]): BlockLayout | null {
  if (src.format !== "pdf") return null;
  const fragsAt = new Map<number, Frag[]>();
  for (const r of rows) {
    const fs = idx
      .rowCells(r)
      .filter((c) => c.text.trim() !== "" && !!c.box)
      .map((c) => ({ cell: c, x0: c.box?.[0] ?? 0, x1: (c.box?.[0] ?? 0) + (c.box?.[2] ?? 0) }))
      .sort((a, b) => a.x0 - b.x0);
    if (fs.length) fragsAt.set(r, fs);
  }
  const live = rows.filter((r) => fragsAt.has(r));
  if (!live.length) return null;
  const em = median(grid.cells.filter((c) => c.box).map((c) => c.box?.[3] ?? 0)) || 10;
  const frags = (r: number) => fragsAt.get(r) ?? [];
  const pageOf = (r: number) => frags(r)[0]?.cell.page ?? 1;
  /** 行の中の論理のセル：字の幅の 1.5 倍より広い隙間で分ける（切れた字・語の間の空白はつなぐ） */
  const logical = (r: number): { text: string; x0: number; frags: Frag[] }[] => {
    const out: { text: string; x0: number; frags: Frag[] }[] = [];
    let cur: Frag[] = [];
    let right = -Infinity;
    for (const f of frags(r)) {
      if (cur.length && f.x0 - right >= 1.5 * em) {
        out.push({ text: joinFrags(cur, em), x0: cur[0]?.x0 ?? 0, frags: cur });
        cur = [];
      }
      cur.push(f);
      right = Math.max(right, f.x1);
    }
    if (cur.length) out.push({ text: joinFrags(cur, em), x0: cur[0]?.x0 ?? 0, frags: cur });
    return out;
  };
  const lineText = (r: number) => joinFrags(frags(r), em);
  const loose = (r: number) => norm(lineText(r)).replace(/\d+/g, "#");
  /** 節の題（「1．工事の概要」「2. 所見」）：番号と句点で始まる、文の句点の無い短い行 */
  const section = (r: number) => {
    const t = nfkc(lineText(r));
    return /^\d{1,2}\s*[．.、)）]\s*\D/u.test(t) && norm(t).length <= 40 && !/[。]/u.test(t);
  };

  // ─── 見出しの行の候補：論理のセルが 2 つ以上、どれも見出しの字で、名前（機器）の語の列と作業の内容の語の列がある ───
  type Head = { r: number; cols: { text: string; x0: number; c: number; cues: Set<string> }[]; name: number; work: number };
  const headOf = (r: number): Head | null => {
    const ls = logical(r);
    if (ls.length < 2 || !ls.every((l) => headerText(l.text))) return null;
    const cols = ls.map((l) => ({ text: l.text, x0: l.x0, c: l.frags[0]?.cell.c ?? 1, cues: cuesOf(l.text) }));
    const name = cols.findIndex((c) => c.cues.has("name") || c.cues.has("assetRef"));
    const work = cols.findIndex((c, i) => i !== name && c.cues.has("workName"));
    return name >= 0 && work >= 0 ? { r, cols, name, work } : null;
  };
  const heads = new Map<number, Head>();
  for (const r of live) {
    const h = headOf(r);
    if (h) heads.set(r, h);
  }
  if (!heads.size) return null;

  // ─── 頁の頭書きと頁の足：頁の頭（足）から続く行で、ほかの頁の同じ位置に同じ字（数を除く）がある行。頁の番号の行も足 ───
  const pages = [...new Set(live.map(pageOf))].sort((a, b) => a - b);
  const byPage = new Map<number, number[]>();
  for (const r of live) byPage.set(pageOf(r), [...(byPage.get(pageOf(r)) ?? []), r]);
  const pageRows = new Set<number>();
  if (pages.length >= 2)
    for (const p of pages) {
      const mine = byPage.get(p) ?? [];
      let head = 0;
      let foot = 0;
      for (const q of pages) {
        if (q === p) continue;
        const other = byPage.get(q) ?? [];
        let i = 0;
        while (i < mine.length && i < other.length && !heads.has(mine[i] ?? 0) && !heads.has(other[i] ?? 0) && loose(mine[i] ?? 0) === loose(other[i] ?? 0)) i++;
        head = Math.max(head, i);
        let j = 0;
        while (j < mine.length && j < other.length && !heads.has(mine[mine.length - 1 - j] ?? 0) && loose(mine[mine.length - 1 - j] ?? 0) === loose(other[other.length - 1 - j] ?? 0)) j++;
        foot = Math.max(foot, j);
      }
      // 頁の全部が同じ字の頁（白紙の様式など）は、頭書きにしない
      if (head + foot >= mine.length) continue;
      for (let i = 0; i < head; i++) pageRows.add(mine[i] ?? 0);
      for (let j = 0; j < foot; j++) pageRows.add(mine[mine.length - 1 - j] ?? 0);
    }
  for (const p of pages) {
    const mine = byPage.get(p) ?? [];
    const last = mine[mine.length - 1];
    if (last !== undefined && !heads.has(last) && pageNumber(lineText(last))) pageRows.add(last);
  }

  // ─── 表：見出しの行から、左の余白に字のある行（節の題・文の段落）の前までを 1 つの表にする（頁の頭書きと足は飛ばす） ───
  const roles = new Map<number, RowRole>();
  const reasons = new Map<number, string>();
  const titles: BlockLayout["titles"] = [];
  const consumed = new Set<number>();
  const tables: Table[] = [];
  const inTable = new Set<number>();
  for (const [hr, head] of heads) {
    if (inTable.has(hr) || pageRows.has(hr)) continue;
    const tol = 0.5 * em;
    const starts = head.cols.map((c) => c.x0);
    const colAt = (x: number) => {
      let k = -1;
      for (let i = 0; i < starts.length; i++) if (x >= (starts[i] ?? 0) - tol) k = i;
      return k;
    };
    const hKey = loose(hr);
    const body: number[] = [];
    const repeated: number[] = [];
    let last = hr;
    for (const r of live) {
      if (r <= hr || pageRows.has(r)) continue;
      if (loose(r) === hKey) {
        repeated.push(r);
        last = r;
        continue;
      }
      // 表の終わり：左の余白に字のある行、表の左の端から始まる節の題、列の境をまたいで続く文の行（表の外の文の段落）
      const ls = logical(r);
      const k0 = colAt(ls[0]?.x0 ?? 0);
      const across = ls.length === 1 && /[。]/u.test(ls[0]?.text ?? "") && k0 < starts.length - 1 && Math.max(...(ls[0]?.frags ?? []).map((f) => f.x1)) > (starts[k0 + 1] ?? Infinity) + em;
      if (heads.has(r) || frags(r).some((f) => colAt(f.x0) < 0) || (k0 === 0 && section(r)) || across) break;
      body.push(r);
      last = r;
    }
    if (!body.length) continue;
    // 列ごとのセル（見出しの列の幅に落ちるもの）
    const cellsOf = (r: number, k: number) => frags(r).filter((f) => colAt(f.x0) === k);
    // 見出しの字の始まりが列の始まりか：名前と作業の内容の列の、行の最初のセルの 8 割以上が、見出しの字の始まりにそろう
    // （見出しの字を列の中ほどに置いた表は、見出しの位置で列の幅を決められないので、今までどおりの読み方）
    const aligned = (k: number) => {
      const firsts = body.map((r) => cellsOf(r, k)[0]).filter((f): f is Frag => !!f);
      return firsts.length > 0 && firsts.filter((f) => Math.abs(f.x0 - (starts[k] ?? 0)) <= em).length >= 0.8 * firsts.length;
    };
    if (!aligned(head.name) || !aligned(head.work)) continue;
    const named = (r: number) => frags(r).some((f) => colAt(f.x0) === head.name);
    // 折り返した記録の表か：名前の欄の空いた行があるか、見出しと中身・記録のあいだに空の行がある（無ければ今までどおりの読み方）
    const seq = [hr, ...body];
    const gapped = seq.some((r, i) => i > 0 && pageOf(r) === pageOf(seq[i - 1] ?? r) && r !== (seq[i - 1] ?? r) + 1);
    if (!body.some((r) => !named(r)) && !gapped) continue;

    // 記録の塊
    const records: number[][] = [];
    const strays: number[] = [];
    let cur: number[] | null = null;
    let curHasRest = false;
    let prev: number | null = null;
    for (const r of body) {
      const brokenByPage = prev !== null && pageOf(r) !== pageOf(prev);
      // 空の行：同じ頁で行の番号が続かない（くり返す見出しをはさんだときも）
      const blank = prev === null || (!brokenByPage && r !== prev + 1);
      if (named(r)) {
        // 名前の欄に字のある行：空の行・頁の替わり目・名前の欄の空いた行のあとなら、新しい記録。続けて名前の欄に字のある行は、名前の続き
        if (!cur || blank || brokenByPage || curHasRest) {
          cur = [r];
          records.push(cur);
          curHasRest = false;
        } else cur.push(r);
      } else if (cur && (!blank || brokenByPage)) {
        // 名前の欄の空いた行：前の行と続いていれば（頁をまたいでも）、その記録の続き
        cur.push(r);
        curHasRest = true;
      } else {
        // 名前の欄が空で、つなぐ記録の無い行（表の頭・空の行のあと）
        strays.push(r);
        cur = null;
      }
      prev = r;
    }
    if (!records.length) continue;
    // 列の右の境（最後の列は、その列の行の右端のいちばん右）
    const rights = head.cols.map((_, k) => (k < starts.length - 1 ? (starts[k + 1] ?? 0) - tol : Math.max(...body.flatMap((r) => cellsOf(r, k).map((f) => f.x1)), starts[k] ?? 0)));
    const blocks: RecordBlock[] = records.map((rs) => {
      const name: BlockLine[] = [];
      const items = new Map<number, BlockItem[]>();
      for (let k = 0; k < head.cols.length; k++) {
        const c = head.cols[k]?.c ?? 0;
        const list: BlockItem[] = [];
        let prevLine: { text: string; right: number } | null = null;
        for (const r of rs) {
          const fs = cellsOf(r, k);
          if (!fs.length) {
            prevLine = null;
            continue;
          }
          const text = joinFrags(fs, em);
          const refs = fs.map((f) => f.cell.ref);
          const right = Math.max(...fs.map((f) => f.x1));
          if (k === head.name) {
            name.push({ r, text, refs });
            continue;
          }
          const last = list[list.length - 1];
          const full = prevLine !== null && prevLine.right >= (rights[k] ?? 0) - 2 * em;
          if (last && prevLine && full && !sentenceEnd(prevLine.text) && !periodLike(prevLine.text) && !periodLike(text) && !labelStart(text)) {
            last.text = joinWrap(last.text, text);
            last.refs.push(...refs);
            last.rows.push(r);
          } else list.push({ text, refs, rows: [r] });
          prevLine = { text, right };
        }
        if (k !== head.name && list.length) items.set(c, list);
      }
      const refs = rs.flatMap((r) => frags(r).map((f) => f.cell.ref));
      return { rows: rs, name, items, refs };
    });
    // 状態の列：記録の 1 行目の字が予定・実績の語の記録のいちばん多い列（名前と作業の内容の列のほか）
    const firstText = (b: RecordBlock, c: number) => {
      const it = b.items.get(c)?.[0];
      return it && it.rows[0] === b.rows[0] ? it.text : "";
    };
    let stateCol: number | null = null;
    let best = 0;
    head.cols.forEach((col, k) => {
      if (k === head.name || k === head.work) return;
      const n = blocks.filter((b) => cue.planActual(firstText(b, col.c).replace(/[。．.]$/u, "")) !== null).length;
      if (n > best) {
        best = n;
        stateCol = col.c;
      }
    });
    const cols: ColInfo[] = head.cols.map((col, k) => ({
      c: col.c,
      role: k === head.name ? "assetRef" : k === head.work ? "workName" : "remark",
      header: col.text,
      headerParts: [col.text],
      cue: cue.column(col.text) ?? (k === head.name ? "assetRef" : k === head.work ? "workName" : null),
      hidden: false,
    }));
    const rowInfos: RowInfo[] = body.map((r) => ({ r, role: "data", level: null, votes: [], suspect: false, parentRow: null, bold: false }));
    const bottom = last;
    const table: Table = {
      id: `${src.file}#${grid.index}#${hr}`,
      file: src.file,
      sheet: grid.name,
      sheetIndex: grid.index,
      shape: "events",
      top: hr,
      bottom,
      headerRows: [hr],
      cols,
      rows: rowInfos,
      legend: [],
      legendRows: [],
      yearKind: null,
      issues: [],
      form: `events|blocks|${head.cols.map((c) => norm(c.text)).join("\u0002")}`,
      blocks: {
        nameCol: head.cols[head.name]?.c ?? 1,
        workCol: head.cols[head.work]?.c ?? 1,
        stateCol,
        records: blocks,
        strays: strays.map((r) => ({ r, refs: frags(r).map((f) => f.cell.ref) })),
        attrs: null,
      },
    };
    tables.push(table);
    roles.set(hr, "header");
    consumed.add(hr);
    for (const r of repeated) {
      roles.set(r, "header");
      reasons.set(r, REPEAT_HEADER_REASON);
      consumed.add(r);
    }
    for (const r of body) {
      roles.set(r, "data");
      consumed.add(r);
    }
    for (const r of live) if (r >= hr && r <= bottom) inTable.add(r);
  }
  if (!tables.length) return null;

  // ─── 表の外 ───
  for (const r of pageRows) {
    if (consumed.has(r)) continue;
    roles.set(r, "note");
    reasons.set(r, PAGE_REASON);
    consumed.add(r);
  }
  const outside = live.filter((r) => !consumed.has(r));
  // 続いた行の塊（空の行と頁で切る。頁の頭書きと足は除いてある）
  const runs: number[][] = [];
  for (const r of outside) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev !== undefined && pageOf(prev) === pageOf(r) && r === prev + 1) run.push(r);
    else runs.push([r]);
  }
  const found: { attrs: DocAttrs | null } = { attrs: null };
  for (const run of runs) {
    const rest = run.filter((r) => !section(r));
    for (const r of run.filter(section)) {
      roles.set(r, "note");
      reasons.set(r, SECTION_REASON);
      consumed.add(r);
    }
    if (!rest.length) continue;
    // 項目と内容の表：どの行も 2 つの論理のセル（短い項目と内容）で、項目と内容の始まりの位置がそろう。2 行以上
    const kv = rest.map((r) => logical(r));
    const kvTable =
      rest.length >= 2 &&
      kv.every((ls) => ls.length === 2 && norm(ls[0]?.text ?? "").length <= 10 && !/\d/u.test(ls[0]?.text ?? "") && headerText(ls[0]?.text ?? "")) &&
      kv.every((ls) => Math.abs((ls[0]?.x0 ?? 0) - (kv[0]?.[0]?.x0 ?? 0)) <= em && Math.abs((ls[1]?.x0 ?? 0) - (kv[0]?.[1]?.x0 ?? 0)) <= em);
    if (kvTable) {
      const units = new Set<number>();
      let period: DocAttrs["period"] = null;
      for (const ls of kv) {
        const value = ls[1]?.text ?? "";
        for (const tok of value.split(/[\s／]+/u)) {
          const u = tok ? parseUnit(tok) : null;
          if (u?.kind === "number") units.add(u.n);
        }
        period ??= parseDateRange(value);
      }
      const was = found.attrs;
      found.attrs = { unit: units.size === 1 ? ([...units][0] ?? null) : (was?.unit ?? null), period: period ?? was?.period ?? null };
      for (const r of rest) {
        roles.set(r, "note");
        reasons.set(r, ATTRS_REASON);
        consumed.add(r);
      }
      continue;
    }
    // 文の段落：句点のある行か、長い 1 つの文の行がある塊
    const prose = rest.some((r) => logical(r).length === 1 && (/[。]/u.test(lineText(r)) || norm(lineText(r)).length >= 20));
    if (prose) {
      for (const r of rest) {
        roles.set(r, "note");
        reasons.set(r, PARAGRAPH_REASON);
        consumed.add(r);
      }
      continue;
    }
    // 1 行だけの短い字（資料の題・表の題）
    if (rest.length === 1 && logical(rest[0] ?? 0).length === 1) {
      const r = rest[0] ?? 0;
      roles.set(r, "title");
      titles.push({ r, text: lineText(r), ref: frags(r)[0]?.cell.ref ?? "" });
      consumed.add(r);
    }
  }
  const attrs = found.attrs;
  if (attrs) for (const t of tables) if (t.blocks) t.blocks.attrs = attrs;
  return { tables, roles, reasons, titles, consumed };
}

// ─── 記録の中身を読む小さな決まり（層 3 の blockRecords が使う） ───────────────────────

export interface BlockName {
  /** 号炉（号炉の語のある区切りから。共通も） */
  unit: UnitValue | null;
  /** 機器の階層（上から）。設備の短い名前が下の名前と別の名前なら、いちばん上の段にする */
  path: string[];
  /** 号炉を書いた段（path の何番目か。無ければ null） */
  unitLevel: number | null;
}

const sameUnitValue = (a: UnitValue, b: UnitValue) => (a.kind === "number" && b.kind === "number" ? a.n === b.n : a.kind === b.kind);

/**
 * 名前の欄の行（「焼却炉本体」「1号炉 焼却炉本体／炉」「壁局部損耗域（24 m2）」）から、号炉と機器の階層を読む。
 * 1 行目に区切り「／」も号炉も無く、2 行目があれば、1 行目は設備の短い名前で、2 行目からが「号炉 設備／部位」の折り返し（行の順につなぐ）。
 * 区切り「／」の 1 つ目が設備、続くものが下の段（頭の号炉の語は除く。上の段と同じ名前の段は 1 つにする）。区切りの 1 つ目の中に号炉の語があれば、
 * その前の語は設備の短い名前。短い名前が設備の名前と別の名前（どちらにも含まれない）なら、設備の上の段にする。
 * 名前が残らない・号炉が 2 つあるときは null（呼ぶ側が聞く）
 */
export function parseBlockName(lines: readonly string[]): BlockName | null {
  const ls = lines.map((l) => nfkc(l).replace(/\s+/g, " ").trim()).filter(Boolean);
  const first = ls[0];
  if (first === undefined) return null;
  let head: string | null = ls.length >= 2 && !first.includes("/") && !leadingUnit(first) ? first : null;
  const body = (head ? ls.slice(1) : ls).reduce((a, b) => joinWrap(a, b), "");
  const segs = body
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let unit: UnitValue | null = null;
  const names: string[] = [];
  let unitAt: number | null = null;
  for (let i = 0; i < segs.length; i++) {
    let seg = segs[i] ?? "";
    let u: UnitValue | null = null;
    const lead = leadingUnit(seg);
    if (lead) {
      u = lead.unit;
      seg = lead.rest;
    } else if (i === 0) {
      // 「設備 号炉 設備」：区切りの中ほどの号炉の語
      const toks = seg.split(" ");
      const k = toks.findIndex((t, j) => j > 0 && !!leadingUnit(t) && leadingUnit(t)?.rest === "");
      if (k > 0) {
        u = leadingUnit(toks[k] ?? "")?.unit ?? null;
        const before = toks.slice(0, k).join(" ");
        const after = toks.slice(k + 1).join(" ");
        head ??= before;
        seg = after || before;
      }
    }
    if (u) {
      if (unit && !sameUnitValue(unit, u)) return null;
      unit ??= u;
    }
    seg = seg.trim();
    if (!seg) continue;
    if (names.length && nameKey(names[names.length - 1] ?? "") === nameKey(seg)) continue;
    if (u && unitAt === null) unitAt = names.length;
    names.push(seg);
  }
  if (!names.length) {
    if (!head) return null;
    names.push(head);
    head = null;
  }
  const top = names[0] ?? "";
  const alias = head !== null && (nameKey(top).includes(nameKey(head)) || nameKey(head).includes(nameKey(top)));
  const path = head && !alias ? [head, ...names] : names;
  const shift = head && !alias ? 1 : 0;
  return { unit, path, unitLevel: unit ? (unitAt ?? 0) + shift : null };
}

/**
 * 施工量と工数の行（「施工量 24.0 m2／耐火 22人工」「施工量 24.0 m2／ 耐火 22.0 人工」）：「／」で区切ったどれもが「語 数 単位」で、
 * 人・日に読める工数（今の工数の読み：人工・人日・延べ N 人）が 1 つ以上あるときだけ読む。工数の前の語は職種（書いてあるまま）、ほかは数量。
 * 時間・人数だけの書き方は人・日に直さない（null。記録の注記に残る）
 */
export function parseEffortLine(text: string): { quantity: string[]; manDays: number; trades: string[] } | null {
  const segs = nfkc(text)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let manDays = 0;
  let hit = false;
  const quantity: string[] = [];
  const trades: string[] = [];
  for (const seg of segs) {
    const m = /^(\D*?)\s*(\d+(?:\.\d+)?)\s*(\D\S*)$/u.exec(seg);
    if (!m) return null;
    const e = parseEffort(seg.replace(/\s+/g, "")) ?? parseEffort(`${m[2]}${m[3]}`);
    if (e?.unit === "manDays") {
      manDays += e.amount;
      hit = true;
      trades.push(seg);
    } else quantity.push(seg);
  }
  return hit ? { quantity, manDays: Math.round(manDays * 1000) / 1000, trades } : null;
}

/** 記録の期間の字（年月日のそろった期間・1 日の日付・年の無い月-日の期間）。どれでもなければ null */
export function blockPeriod(text: string): { start: Ymd; end: Ymd } | { md: NonNullable<ReturnType<typeof monthDayRange>> } | null {
  const r = parseDateRange(text);
  if (r) return r;
  const d = parseDateText(text);
  if (d) return { start: d, end: d };
  const md = monthDayRange(text);
  return md ? { md } : null;
}
