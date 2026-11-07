// 層 2：工程表（ガント）の表を見分ける（reader-gantt-v1）。
// 見出しの行に、日付（通し番号の日付・年月日の字・年の無い月/日）が左から右へ等しい間（1 日・7 日）で並ぶ列を「時の列」にする。
// 時の列の上の段の月の見出し（「4月」「5月」）は見出しの上の段として分ける。行は、号炉の見出し・名前の段の行・作業の行・
// 停止の期間の帯（塗りだけ）・下（上）の行の和の行に分ける。施工の期間は、行の上に引いた線・四角の図形（格子の横の shapes）か、
// 時の列のセルの数（その日・週に施工した日数）から、層 3（records.ts の ganttRecords）が読む。
// 層 2 は形式を知らない（格子と、格子の横の図形・塗りだけを見る）。語はコードに置かない（列の見出しの語は packs/_cues の手がかり）。
import type { CellIndex, GridCell, SheetGrid, SourceFile } from "./grid";
import { CUES, cue, escapeRe, norm } from "./cues";
import { fiscalYearInText, nfkc, parseDateText, parseMonthDay, parseYearLabel, serialToYmd, validYmd, type Ymd } from "./era";
import { isDateFormat } from "./numfmt";
import { parseUnit } from "./text";
import type { ColInfo, RowInfo, RowRole, Table } from "./structure";

/** 時の列の 1 つ：その列の日（週の列は週の初めの日）。年の書いていない月/日は ymd が null（層 3 が年を補う） */
export interface GanttTime {
  c: number;
  ref: string;
  ymd: Ymd | null;
  md: { m: number; d: number };
}

/** 時の列のほかの列の役目（見出しの語と位置から） */
export type GanttColRole = "unit" | "hier" | "tag" | "work" | "effort" | "days" | "remark";

export interface GanttCol {
  c: number;
  role: GanttColRole;
  header: string;
  ref: string | null;
  /** 名前の段（hier の列だけ。左から 1） */
  level?: number;
}

/**
 * 行の種類：unit＝号炉の見出し（数があれば下の行の和）、node＝名前の段の行、work＝作業の行（名前の段の無い作業の欄の行）、
 * band＝停止の期間の帯（字は 1 つ、時の列は塗りだけ）、sum＝下（上）の行の和の行、stray＝名前も作業も無い行
 */
export type GanttRowKind = "unit" | "node" | "work" | "band" | "sum" | "stray";

/** 行の上に引いた線・四角（列は 1 から数え、両端を含む） */
export interface GanttBar {
  from: number;
  to: number;
  name: string;
}

export interface GanttRow {
  r: number;
  kind: GanttRowKind;
  /** 名前の段のセル（左の段から） */
  names: { level: number; cell: GridCell }[];
  /** 作業として読む行（作業の欄の行、名前の段の行で時の列の数・線・日数・工数のあるもの） */
  work: boolean;
  bars: GanttBar[];
  /** 時の列に数のある行 */
  counted: boolean;
}

export interface GanttTable {
  /** 時の列の間（日の列 1・週の列 7） */
  step: 1 | 7;
  timeRow: number;
  times: GanttTime[];
  /** 時の列の上の段の月の見出しの行と、そのセル */
  monthRow: number | null;
  monthRefs: string[];
  /** 時の列のほかの列の見出しの行 */
  labelRow: number;
  cols: GanttCol[];
  /** 名前の段の数 */
  levels: number;
  rows: GanttRow[];
  /** 年の無い月/日の年を補う年度（シートの名前か、題・注記の年度）。無ければ null */
  yearHint: { fiscalYear: number; from: "sheet" | "title"; text: string } | null;
  /** 題・注記の「1 人工＝8 時間」（1 人・日の時間）。無ければ null */
  hoursPerManDay: { hours: number; text: string } | null;
  /** 題・注記の予定・計画の語。無ければ null */
  planWord: string | null;
  /** 題・注記の行の字（問いの見本） */
  title: string;
}

/** 時の列とみなす、並んだ日付の数の下限 */
const MIN_RUN = 5;

// ─── 時の列 ─────────────────────────────────────────────────────

interface DateCell {
  c: number;
  ref: string;
  ymd: Ymd | null;
  md: { m: number; d: number };
}

function dateOfCell(x: GridCell, date1904: boolean): DateCell | null {
  if (typeof x.value === "number" && isDateFormat(x.numFmt)) {
    const d = serialToYmd(x.value, date1904);
    return { c: x.c, ref: x.ref, ymd: { y: d.y, m: d.m, d: d.d }, md: { m: d.m, d: d.d } };
  }
  if (typeof x.value !== "string") return null;
  const full = parseDateText(x.value);
  if (full) return { c: x.c, ref: x.ref, ymd: full, md: { m: full.m, d: full.d } };
  const md = parseMonthDay(x.value);
  return md ? { c: x.c, ref: x.ref, ymd: null, md } : null;
}

const dayNo = (d: Ymd) => Date.UTC(d.y, d.m - 1, d.d) / 86400000;

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 年の無い月/日の並びに、最初の年 y0 から年を付ける（月が戻れば次の年）。日付にならなければ null */
export function yearsFrom(mds: readonly { m: number; d: number }[], y0: number): Ymd[] | null {
  const out: Ymd[] = [];
  let y = y0;
  let prev = 0;
  for (const md of mds) {
    if (md.m < prev) y++;
    prev = md.m;
    if (!validYmd(y, md.m, md.d)) return null;
    out.push({ y, m: md.m, d: md.d });
  }
  return out;
}

/** 日付が等しい間（1 日・7 日）で並ぶか。並べば間を返す */
function evenStep(ds: readonly Ymd[]): 1 | 7 | null {
  if (ds.length < 2) return null;
  const s = dayNo(ds[1] as Ymd) - dayNo(ds[0] as Ymd);
  if (s !== 1 && s !== 7) return null;
  for (let i = 2; i < ds.length; i++) if (dayNo(ds[i] as Ymd) - dayNo(ds[i - 1] as Ymd) !== s) return null;
  return s;
}

/** 年の無い月/日の並びが等しい間で並ぶか（うるう年の 2 月をまたぐ並びも見るため、4 つの年で試す） */
function evenStepMd(mds: readonly { m: number; d: number }[]): 1 | 7 | null {
  for (const y0 of [2001, 2002, 2003, 2004]) {
    const ds = yearsFrom(mds, y0);
    const s = ds ? evenStep(ds) : null;
    if (s) return s;
  }
  return null;
}

/** 行の中の、左から右へ等しい列の間と等しい日の間で並ぶ日付のいちばん長い並び（MIN_RUN 以上）。無ければ null */
export function timeRun(cells: readonly GridCell[], date1904: boolean): { times: GanttTime[]; step: 1 | 7 } | null {
  const ds = cells.map((x) => dateOfCell(x, date1904));
  let best: { times: GanttTime[]; step: 1 | 7 } | null = null;
  for (let i = 0; i < ds.length; i++) {
    const a = ds[i];
    const b = ds[i + 1];
    if (!a || !b) continue;
    const gap = b.c - a.c;
    const full = a.ymd !== null;
    let j = i + 1;
    while (j + 1 < ds.length) {
      const x = ds[j + 1];
      const p = ds[j];
      if (!x || !p || x.c - p.c !== gap || (x.ymd !== null) !== full) break;
      j++;
    }
    const run = ds.slice(i, j + 1) as DateCell[];
    if (run.some((x) => (x.ymd !== null) !== full)) continue;
    if (run.length < MIN_RUN || (best && best.times.length >= run.length)) continue;
    const step = full ? evenStep(run.map((x) => x.ymd as Ymd)) : evenStepMd(run.map((x) => x.md));
    if (step) best = { times: run.map((x) => ({ c: x.c, ref: x.ref, ymd: x.ymd, md: x.md })), step };
  }
  return best;
}

/** 月の見出し（「4月」「2021年4月」）の月。読めなければ null */
function monthLabel(text: string): number | null {
  const m = /^(?:\d{4}年)?(\d{1,2})月$/u.exec(norm(text));
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 12 ? n : null;
}

/** 月の見出しが、その列の日（週の列はその週の 7 日）の月と合うか */
function monthFits(m: number, t: GanttTime, step: 1 | 7): boolean {
  if (t.md.m === m) return true;
  if (step === 1) return false;
  const end = addDays({ y: 2001, m: t.md.m, d: t.md.d }, 6);
  return end.m === m;
}

// ─── 題・注記の手がかり ────────────────────────────────────────

const words = (xs: readonly string[]) => [...new Set(xs.map((x) => escapeRe(nfkc(x))))].sort((a, b) => b.length - a.length).join("|");
const RE_HOURS_PER_DAY = new RegExp(
  `(?:1\\s*)?(?:${words([...CUES.effort.manDays, ...CUES.headerUnit.manDays])})\\s*[=:]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${words(CUES.effort.hours)})`,
  "iu",
);

/** 題・注記の「人工＝8時間」「1人日=7.5h」：1 人・日の時間。無ければ null */
export function hoursPerManDayInText(text: string): number | null {
  const m = RE_HOURS_PER_DAY.exec(nfkc(text));
  const h = m ? Number(m[1]) : NaN;
  return h > 0 && h <= 24 ? h : null;
}

const PLAN_WORDS = CUES.planActual.plan.map(norm);

// ─── 列と行 ─────────────────────────────────────────────────────

const HEAD_MARK = /^[\s　■□◆◇●○▲△▼▽★☆◎]+/u;

/** 号炉の見出し（「■ 1号炉」「1号炉」「共通」）：頭の印を除いた字が号・系列の書き方だけ */
export function unitHeading(text: string): ReturnType<typeof parseUnit> {
  const s = nfkc(text).replace(HEAD_MARK, "").trim();
  if (!s) return null;
  const u = parseUnit(s);
  return u && u.kind !== "ditto" ? u : null;
}

const isNum = (x: GridCell) => typeof x.value === "number" || (typeof x.value === "string" && /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(x.value));

function columnsOf(idx: CellIndex, labelRow: number, first: number, last: number): GanttCol[] | null {
  const cells = idx.rowCells(labelRow).filter((x) => x.text.trim() !== "" && (x.c < first || x.c > last));
  const cueOf = (x: GridCell) => cue.column(x.text);
  const nameCols = cells.filter((x) => {
    const k = cueOf(x);
    return k === "name" || k === "assetRef";
  });
  const lastName = nameCols.length ? Math.max(...nameCols.map((x) => x.c)) : null;
  const out: GanttCol[] = [];
  for (const x of cells) {
    const k = cueOf(x);
    let role: GanttColRole;
    if (k === "series") role = "unit";
    else if (k === "tag") role = "tag";
    else if (k === "name" || k === "assetRef") role = "hier";
    else if (k === "workName" || k === "workTitle") role = "work";
    else if (k === "effort") role = "effort";
    else if (k === "days") role = "days";
    // 見出しの語の無い列：名前の列より左（時の列より左）なら名前の上の段、ほかは備考
    else if (k === null && lastName !== null && x.c < lastName && x.c < first) role = "hier";
    else role = "remark";
    out.push({ c: x.c, role, header: x.text.trim(), ref: x.ref });
  }
  const hier = out.filter((c) => c.role === "hier").sort((a, b) => a.c - b.c);
  if (!hier.length && !out.some((c) => c.role === "work")) return null;
  hier.forEach((c, i) => (c.level = i + 1));
  return out;
}

/** 行の上の線・四角（1 行に収まるもの）を、その行の時の列の範囲に直す */
function barsOf(grid: SheetGrid, first: number, last: number): Map<number, GanttBar[]> {
  const out = new Map<number, GanttBar[]>();
  for (const s of grid.shapes ?? []) {
    const oneRow = s.from.row === s.to.row || (s.kind === "rect" && s.to.row === s.from.row + 1 && s.to.rowOff === 0);
    if (!oneRow) continue;
    const r = s.from.row + 1;
    const from = s.from.col + 1;
    // 終わりが列の左の端（colOff 0）なら、その前の列で終わる
    const to = s.to.colOff === 0 && s.to.col > s.from.col ? s.to.col : s.to.col + 1;
    const a = Math.max(from, first);
    const b = Math.min(to, last);
    if (a > b) continue;
    out.set(r, [...(out.get(r) ?? []), { from: a, to: b, name: s.name }]);
  }
  return out;
}

export interface GanttRead {
  tables: Table[];
  roles: Map<number, RowRole>;
  reasons: Map<number, string>;
  consumed: Set<number>;
}

/** 工程表の行の外す理由（行き先の字） */
export const GANTT_REASON = {
  month: "時の列の上の段の見出し（月）",
  band: "停止の期間の帯（工程の背景）",
  subtotal: "小計（行の和と合う）",
  subtotalMismatch: "小計（行の和と合わなかった。決定で外した）",
  unitUnused: "号・系列の見出し（下に機器の行が無い）",
  stray: "名前も作業も無い工程表の行（決定で外した）",
  noPeriod: "施工の期間の無い作業の行（決定で外した）",
} as const;

/**
 * シートの中の工程表を読む。時の列のある見出しの行を探し、その塊（と、すぐ下に続く工程の行の塊）を 1 つの表にする。
 * 見つからなければ null（今までどおり読む）
 */
export function readGantt(src: SourceFile, grid: SheetGrid, idx: CellIndex, rows: readonly number[]): GanttRead | null {
  const texts = (r: number) => idx.rowCells(r).filter((x) => x.text.trim() !== "");
  const blocks: number[][] = [];
  const joined = new Set<number>();
  for (const m of grid.merges) for (let r = m.top; r < m.bottom; r++) joined.add(r);
  for (const r of rows) {
    const cur = blocks[blocks.length - 1];
    const last = cur?.[cur.length - 1];
    if (cur && last !== undefined && (r === last + 1 || joined.has(last))) cur.push(r);
    else blocks.push([r]);
  }
  const out: GanttRead = { tables: [], roles: new Map(), reasons: new Map(), consumed: new Set() };
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi] ?? [];
    if (block.some((r) => out.consumed.has(r))) continue;
    // 時の列の見出しの行：塊のはじめの 3 行のうち、並んだ日付のいちばん長い行
    let tr: { r: number; times: GanttTime[]; step: 1 | 7 } | null = null;
    for (const r of block.slice(0, 3)) {
      const run = timeRun(texts(r), src.date1904);
      if (run && (!tr || run.times.length > tr.times.length)) tr = { r, ...run };
    }
    if (!tr) continue;
    const first = tr.times[0]?.c ?? 0;
    const last = tr.times[tr.times.length - 1]?.c ?? 0;
    const tset = new Set(tr.times.map((t) => t.c));
    // 見出しの行：時の列の行か、そのすぐ上の行（時の列の外に見出しの語のある行）
    const above = block.includes(tr.r - 1) ? tr.r - 1 : null;
    const outside = (r: number) => texts(r).filter((x) => x.c < first || x.c > last);
    const cueCount = (r: number) => outside(r).filter((x) => cue.column(x.text) !== null).length;
    const labelRow = cueCount(tr.r) > 0 ? tr.r : above !== null && cueCount(above) > 0 ? above : null;
    if (labelRow === null) continue;
    // 月の見出しの段：時の列の行のすぐ上の行の、時の列の中のセルがどれも月の見出しで、その列の日と合う
    let monthRow: number | null = null;
    const monthRefs: string[] = [];
    if (above !== null) {
      const inside = texts(above).filter((x) => x.c >= first && x.c <= last);
      const fits = inside.every((x) => {
        const m = monthLabel(x.text);
        const t = tr?.times.find((k) => k.c === x.c);
        return m !== null && !!t && monthFits(m, t, tr?.step ?? 1);
      });
      if (inside.length && fits) {
        monthRow = above;
        monthRefs.push(...inside.map((x) => x.ref));
      } else if (inside.length) continue;
    }
    const cols = columnsOf(idx, labelRow, first, last);
    if (!cols) continue;
    // 時の列の行のすぐ下の曜日の段（「木｜金｜土…」）も見出しの段
    const below = block.includes(tr.r + 1) ? tr.r + 1 : null;
    const weekdays = below !== null ? texts(below) : [];
    const weekdayRow =
      below !== null && weekdays.filter((x) => x.c >= first && x.c <= last).length >= 3 && weekdays.every((x) => (x.c >= first && x.c <= last ? /^[(（]?[月火水木金土日][)）]?$/u.test(norm(x.text)) : cue.column(x.text) === "weekday"))
        ? below
        : null;
    const headerRows = [...new Set([labelRow, tr.r, ...(monthRow !== null ? [monthRow] : []), ...(weekdayRow !== null ? [weekdayRow] : [])])].sort((a, b) => a - b);
    const top = headerRows[0] ?? tr.r;
    // 表の行：塊の見出しの下と、すぐ下に続く塊（空の行 2 つまでをはさみ、時の列の数か線のある塊）
    const bars = barsOf(grid, first, last);
    const body = block.filter((r) => r > (headerRows[headerRows.length - 1] ?? top));
    const ganttLike = (b: number[]) => b.some((r) => bars.has(r) || texts(r).some((x) => tset.has(x.c) && isNum(x)));
    for (let k = bi + 1; k < blocks.length; k++) {
      const nb = blocks[k] ?? [];
      const gap = (nb[0] ?? 0) - (body[body.length - 1] ?? block[block.length - 1] ?? 0) - 1;
      if (gap > 2 || !ganttLike(nb) || nb.some((r) => timeRun(texts(r), src.date1904) !== null)) break;
      body.push(...nb);
      for (const r of nb) out.consumed.add(r);
    }
    // 施工の期間の書き方（時の列の数か、行の上の線・四角の図形）の無い表は、工程表として読まない（今までどおり）
    if (!ganttLike(body)) continue;
    const g = classify(grid, idx, body, cols, tr.times, bars);
    // 題・注記：表より上の行の字（年度・1 人・日の時間・予定の語の手がかり）
    const titleRows = rows.filter((r) => r < top && !out.consumed.has(r));
    const titleTexts = titleRows.flatMap((r) => texts(r).map((x) => x.text));
    const title = titleTexts.join(" ").replace(/\s+/g, " ").trim();
    const sheetYear = grid.name ? parseYearLabel(grid.name) : null;
    const titleYear = fiscalYearInText(titleTexts) ?? (() => {
      const found = new Set<number>();
      for (const t of titleTexts) for (const m of nfkc(t).matchAll(/[(（]([^()（）]{1,12})[)）]/gu)) {
        const y = parseYearLabel(m[1] ?? "");
        if (y) found.add(y.year);
      }
      return found.size === 1 ? ([...found][0] ?? null) : null;
    })();
    const yearHint = sheetYear ? { fiscalYear: sheetYear.year, from: "sheet" as const, text: grid.name ?? "" } : titleYear !== null ? { fiscalYear: titleYear, from: "title" as const, text: title.slice(0, 40) } : null;
    const hoursText = titleTexts.find((t) => hoursPerManDayInText(t) !== null) ?? null;
    const planWord = PLAN_WORDS.find((w) => norm(title).includes(w)) ?? null;
    const gt: GanttTable = {
      step: tr.step,
      timeRow: tr.r,
      times: tr.times,
      monthRow,
      monthRefs,
      labelRow,
      cols,
      levels: cols.filter((c) => c.role === "hier").length,
      rows: g,
      yearHint,
      hoursPerManDay: hoursText ? { hours: hoursPerManDayInText(hoursText) ?? 0, text: hoursText } : null,
      planWord,
      title,
    };
    const roleOf: Record<GanttRowKind, RowRole> = { unit: "parent", node: "parent", work: "data", band: "note", sum: "subtotal", stray: "data" };
    const rowInfos: RowInfo[] = g.map((x) => ({
      r: x.r,
      role: x.kind === "node" && x.work ? "data" : roleOf[x.kind],
      level: x.names.length ? (x.names[x.names.length - 1]?.level ?? null) : null,
      votes: [],
      suspect: false,
      parentRow: null,
      bold: false,
    }));
    for (const r of headerRows) out.roles.set(r, "header");
    for (const x of rowInfos) out.roles.set(x.r, x.role);
    for (const x of g) if (x.kind === "band") out.reasons.set(x.r, GANTT_REASON.band);
    let maxCol = last;
    for (const c of cols) maxCol = Math.max(maxCol, c.c);
    const colInfos: ColInfo[] = [];
    const roleMap: Record<GanttColRole, ColInfo["role"]> = { unit: "unit", hier: "name", tag: "tag", work: "workName", effort: "effort", days: "days", remark: "remark" };
    for (let c = 1; c <= maxCol; c++) {
      const gc = cols.find((k) => k.c === c);
      const t = tr.times.find((k) => k.c === c);
      const header = gc ? gc.header : t ? (idx.at(tr.r, c)?.text ?? "") : "";
      colInfos.push({ c, role: gc ? roleMap[gc.role] : t ? "date" : "unknown", header, headerParts: [header], cue: gc ? cue.column(gc.header) : null, hidden: !!grid.cols[c]?.hidden, ...(gc?.level ? { hierLevel: gc.level } : {}) });
    }
    const bottom = Math.max(top, ...body);
    const form = `events|gantt|${tr.step}|${tr.r - labelRow}|${monthRow !== null ? "m" : "-"}|${first}|${cols
      .map((c) => `${c.c}\u0001${norm(c.header)}`)
      .join("\u0002")}`;
    const table: Table = {
      id: `${src.file}#${grid.index}#${top}`,
      file: src.file,
      sheet: grid.name,
      sheetIndex: grid.index,
      shape: "events",
      top,
      bottom,
      headerRows,
      cols: colInfos,
      rows: rowInfos,
      legend: [],
      legendRows: [],
      yearKind: null,
      issues: [],
      form,
      gantt: gt,
    };
    out.tables.push(table);
    for (const r of [...headerRows, ...body]) out.consumed.add(r);
    for (const r of block) out.consumed.add(r);
  }
  return out.tables.length ? out : null;
}

/** 表の行を種類に分ける */
function classify(grid: SheetGrid, idx: CellIndex, body: readonly number[], cols: readonly GanttCol[], times: readonly GanttTime[], bars: Map<number, GanttBar[]>): GanttRow[] {
  const first = times[0]?.c ?? 0;
  const last = times[times.length - 1]?.c ?? 0;
  const colOf = new Map(cols.map((c) => [c.c, c]));
  const hasWorkCol = cols.some((c) => c.role === "work");
  const firstLabel = Math.min(...cols.filter((c) => c.role !== "effort" && c.role !== "days").map((c) => c.c));
  const rows: (GanttRow & { minLevel: number; amounts: number })[] = [];
  for (const r of body) {
    const cells = idx.rowCells(r).filter((x) => x.text.trim() !== "");
    if (!cells.length && !bars.has(r)) continue;
    const inTime = (x: GridCell) => x.c >= first && x.c <= last;
    const label = cells.filter((x) => !inTime(x) && !["effort", "days"].includes(colOf.get(x.c)?.role ?? ""));
    const amounts = cells.filter((x) => (inTime(x) || ["effort", "days"].includes(colOf.get(x.c)?.role ?? "")) && isNum(x));
    const timeNums = cells.filter((x) => inTime(x) && isNum(x));
    const names = label
      .filter((x) => colOf.get(x.c)?.role === "hier")
      .map((x) => ({ level: colOf.get(x.c)?.level ?? 0, cell: x }))
      .sort((a, b) => a.level - b.level);
    const workCell = label.find((x) => colOf.get(x.c)?.role === "work");
    const rb = bars.get(r) ?? [];
    const fills = (grid.fills?.[r] ?? []).filter((c) => c >= first && c <= last);
    const one = label.length === 1 ? label[0] : undefined;
    const minLevel = names[0]?.level ?? (workCell ? 99 : 0);
    let kind: GanttRowKind;
    let work = false;
    if (one && unitHeading(one.text) && !workCell && (names.length === 0 || names.length === 1)) kind = "unit";
    else if (workCell) {
      kind = "work";
      work = true;
    } else if (one && amounts.length === 0 && !rb.length && fills.length && cells.length === 1) kind = "band";
    else if (one && amounts.length > 0 && !rb.length && one.c === firstLabel && colOf.get(one.c)?.role !== "tag" && !cells.some((x) => inTime(x) && !isNum(x))) kind = "sum";
    else if (names.length) {
      kind = "node";
      work = !hasWorkCol ? timeNums.length > 0 || rb.length > 0 || amounts.length > 0 : timeNums.length > 0 || rb.length > 0;
    } else kind = "stray";
    rows.push({ r, kind, names, work, bars: rb, counted: timeNums.length > 0, minLevel, amounts: amounts.length });
  }
  // 帯と和の行は、下に深い段の行が続かない（子の無い）行だけ。子があれば名前の段の行
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    if (!x || (x.kind !== "band" && x.kind !== "sum")) continue;
    const next = rows[i + 1];
    if (next && next.minLevel > x.minLevel && x.names.length) {
      x.kind = "node";
      x.work = !hasWorkCol && x.amounts > 0;
    }
  }
  return rows.map(({ minLevel: _m, amounts: _a, ...x }) => x);
}

/** 年の無い月/日の時の列に、年度から年を付ける。y0 は最初の列の年の候補（年度の前後）。年度の中の日がいちばん多い並びを取る。決まらなければ null */
export function datesOfTimes(times: readonly GanttTime[], fiscalYear: number, startMonth: number): Ymd[] | null {
  if (times.every((t) => t.ymd)) return times.map((t) => t.ymd as Ymd);
  let best: { ds: Ymd[]; n: number } | null = null;
  for (const y0 of [fiscalYear - 1, fiscalYear, fiscalYear + 1]) {
    const ds = yearsFrom(
      times.map((t) => t.md),
      y0,
    );
    if (!ds || !evenStep(ds)) continue;
    const n = ds.filter((d) => (d.m >= startMonth ? d.y : d.y - 1) === fiscalYear).length;
    if (!best || n > best.n) best = { ds, n };
  }
  return best && best.n * 2 > times.length ? best.ds : null;
}
