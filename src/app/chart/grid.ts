// 星取表の表（AG Grid Community だけ。木の表示・行のまとめなどの Enterprise の機能は使わない）。plan §2.2。
// - 表は React の外で createGrid で作る。セルごとに React の部品を持たない（数千のセルでも軽く動かすため）。
// - 印は書式の関数（valueFormatter）と CSS のクラス（cellClassRules）で描く。セルの aria-label に階層の道を入れるため、
//   セルの描き手は DOM の文字を 1 つ置くだけの小さな関数の組にしてある。
// - 段の列は左に固定。段の見出しを押すとその段で畳む（開閉の状態は呼ぶ側が持つ）。
import {
  AllCommunityModule,
  ModuleRegistry,
  createGrid,
  themeQuartz,
  type CellClassParams,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type ICellRendererComp,
  type ICellRendererParams,
  type IHeaderComp,
  type IHeaderParams,
  type SuppressKeyboardEventParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import { markWithout, type ChartCell, type ChartModel, type ChartRow, type Mark, type Period } from "../../plan/chart";
import { changedFrom, oldMark } from "../../plan/chart-compare";
import { DUE_TEXT, rowDue, type DueView } from "../../plan/due-view";
import type { StatField } from "../../share/bands";
import { bandShort, statText } from "../../share/stat-text";
import { TEXT } from "../text";

ModuleRegistry.registerModules([AllCommunityModule]);

const T = TEXT.chart;

// デザイン定義 §13.3。縦の罫は年度の境と固定の列だけ（chart.css のクラス）
const theme = themeQuartz.withParams({
  backgroundColor: "var(--bg)",
  foregroundColor: "var(--text)",
  cellTextColor: "var(--text)",
  accentColor: "var(--text)",
  borderColor: "var(--line)",
  headerBackgroundColor: "var(--layer-1)",
  headerTextColor: "var(--text-3)",
  rowHoverColor: "var(--layer-1)",
  selectedRowBackgroundColor: "var(--layer-2)",
  oddRowBackgroundColor: "var(--bg)",
  fontFamily: "var(--font-body)",
  browserColorScheme: "inherit",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 500,
  rowHeight: 36,
  headerHeight: 44,
  spacing: 4,
  cellHorizontalPadding: 16,
  headerColumnResizeHandleColor: "transparent",
  borderRadius: 0,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  columnBorder: false,
  headerColumnBorder: false,
  pinnedColumnBorder: { width: 1, color: "var(--line-strong)" },
  rowBorder: { width: 1, color: "var(--line)" },
  iconSize: 16,
  focusShadow: "none",
});

export interface GridHandlers {
  onFold(level: number): void;
  onSelect(rowId: string, periodKey: string | null): void;
  onOpenFolded(rowId: string): void;
  /** 共通の設備項目で見るとき、設備の見出しの行を押して、その設備の行を畳む・開く（Wire、2026-11-05） */
  onToggle?(rowId: string): void;
  onEditStopped(): void;
  /** 行を渡し終えたとき（描くのは AG Grid が次の描画の枠でする） */
  onRendered(): void;
}

/** 印の文字（○ ● ◎）。消した印は空 */
export function markText(mark: Mark | null): string {
  return mark === null ? "" : T.mark[mark];
}

/** 期の見出しの名前：年度の表は「2023」の数だけ（年度か月かは切り替えで分かる。Wire、11-06） */
export function periodLabel(p: Period): string {
  return p.month === null ? T.yearHead(p.fiscalYear) : T.month(p.month);
}

/** セルに出す文字：要確認なら「?」を前に、畳んだ行なら台数を後ろに */
export function formatCell(cell: ChartCell | undefined): string {
  if (!cell) return "";
  const m = markText(cell.mark);
  const head = cell.review && m !== "" ? `${T.reviewPrefix}${m}` : m;
  return cell.summary && cell.count !== null ? `${head}${cell.count}` : head;
}

/** セルの aria-label：階層の道・期・印の意味。似た施設の行と統計の行は、その行の名前も道に入れる */
export function cellAria(row: ChartRow, p: Period, cell: ChartCell | undefined): string {
  const own = row.kind === "peer" || row.kind === "stat" ? [row.levelCells[row.levelCells.length - 1] ?? ""] : [];
  const path = [...row.path.filter((x): x is string => x !== null), ...own].join(T.pathSep);
  const period = p.month === null ? T.fiscalYear(p.fiscalYear) : `${T.fiscalYear(p.fiscalYear)} ${T.month(p.month)}`;
  let mark: string = T.markNone;
  if (cell) {
    mark = cell.mark === null ? T.markRemoved : T.markName[cell.mark];
    if (cell.summary && cell.count !== null) mark = `${T.summaryName} ${mark} ${T.units(cell.count)}`;
    if (cell.review) mark = `${T.reviewName} ${mark}`;
    if (cell.change) mark = `${mark} ${T.source.changed}`;
  }
  return T.cellAria(path, period, mark);
}

/** 似た施設の帯の列の文字：似た施設の行はその施設の帯、統計の行はその場の統計。自分の行は空 */
export function bandCellText(row: ChartRow | undefined, f: StatField): string {
  if (row?.kind === "peer") {
    const c = row.peerBands?.[f];
    return c ? bandShort(c) : "";
  }
  if (row?.kind === "stat" && row.stats) return statText(row.stats[f]);
  return "";
}

/** 段の列のセルの文字：畳んだ行は台数、未当てはめの行は件数、似た施設にだけある行はそのことを添える */
function levelText(row: ChartRow, i: number): string {
  const name = row.levelCells[i] ?? "";
  if (i !== row.level - 1 || row.count === null) return name;
  return row.kind === "unmapped" ? `${name}（${T.records(row.count)}）` : `${name}（${T.units(row.count)}）`;
}

/** 表に渡す、行の外の状態：Claude が台帳から置き、人がまだ受けていない案の明細の鍵と、比べる版の印（docs/screens.md 3.2） */
interface GridContext {
  proposals: ReadonlySet<string>;
  compare: { version: number; before: ReadonlyMap<string, Mark> } | null;
  /** コメントの付いた行（行の鍵 → 番号の字「①②」） */
  comments?: ReadonlyMap<string, string>;
  /** 作業ごとの次回の字（重-8b） */
  due?: ReadonlyMap<string, DueView>;
  /** 共通台帳で見ているか（まとめたセルの案は、印に朱の破線の円を重ねる。Wire、11-06） */
  common?: boolean;
  /** 明細の鍵 → 計画か実績か（案を除いた印を描くため） */
  kinds?: ReadonlyMap<string, "plan" | "actual">;
  /** 星取の削除の案が指す明細の鍵（施設台帳では今の星取に朱の斜線、共通台帳とまとめたセルでは朱の破線の円を重ねる。docs/screens.md 3.2） */
  removals?: ReadonlySet<string>;
  /** 選んだ星（行と期）。その星だけを細い墨の枠で強め、ほかの星を薄くする（時間の地図 1、mushitaro/moyai#31） */
  picked?: { rowId: string; periodKey: string } | null;
  /** 周期の線を引く行と、その行の期の鍵（年度の表示のときだけ。列の順） */
  cycle?: { rowId: string; keys: readonly string[] } | null;
  /** 人の試し（時間の地図 2）：動かす前の位置（行の鍵 + "\u0000" + 期の鍵。薄い ○）と、動かした先の明細の鍵（朱の細い枠） */
  ghosts?: ReadonlySet<string>;
  trials?: ReadonlySet<string>;
  /** 時間の地図 4：答えの結果で新しく現れた星（行の鍵 + "\u0000" + 期の鍵）。出るときだけ静かに現れる */
  fresh?: ReadonlySet<string>;
}
const NO_PROPOSALS: ReadonlySet<string> = new Set();
export type GridCompare = GridContext["compare"];

/** この印が、比べる版から変わったか */
function isChanged(row: ChartRow | undefined, p: Period, cell: ChartCell | undefined, context: unknown): boolean {
  const c = (context as GridContext | undefined)?.compare;
  return !!c && !!row && row.kind !== "peer" && row.kind !== "stat" && changedFrom(c.before, row.id, p.key, cell?.mark ?? null);
}
/** 比べる版にあって、今は無い印 */
function wasMark(row: ChartRow | undefined, p: Period, cell: ChartCell | undefined, context: unknown): Mark | null {
  const c = (context as GridContext | undefined)?.compare;
  return c && row && row.kind !== "peer" && row.kind !== "stat" ? oldMark(c.before, row.id, p.key, cell?.mark ?? null) : null;
}

/** この印が、まだ受けていない Claude の案を含むか */
function isProposal(cell: ChartCell | undefined, context: unknown): boolean {
  const s = (context as GridContext | undefined)?.proposals;
  return !!cell && !!s && s.size > 0 && cell.detailKeys.some((k) => s.has(k));
}

/** この星取が、まだ確定していない削除の案に指されているか */
function isRemoval(cell: ChartCell | undefined, context: unknown): boolean {
  const s = (context as GridContext | undefined)?.removals;
  return !!cell && !!s && s.size > 0 && !!cell.mark && cell.detailKeys.some((k) => s.has(k));
}
/** 削除の案の出し方：施設台帳の 1 つの星取は朱の斜線（strike）、共通台帳とまとめたセルは朱の破線の円（ring）。削除の案が無ければ null */
function removalShape(cell: ChartCell | undefined, context: unknown): "strike" | "ring" | null {
  if (!isRemoval(cell, context)) return null;
  return (context as GridContext | undefined)?.common || cell?.summary ? "ring" : "strike";
}

/**
 * 共通台帳のまとめたセルに未確定の案があるとき：案を除いた印の上に朱の破線の円を重ねる（ring）。
 * 案だけのセルは、施設台帳と同じく破線の円だけ（ring は付けず、印は案の ○）。施設台帳では今のまま（null）
 */
function proposalRing(cell: ChartCell | undefined, context: unknown): Mark | null {
  const c = context as GridContext | undefined;
  if (!cell || !c?.common || !c.kinds || cell.change || !isProposal(cell, context)) return null;
  return markWithout(cell.detailKeys, c.proposals, c.kinds);
}

/**
 * 周期の線（時間の地図 1）：選んだ行の星どうしを、セルの左半分・右半分の細い線で結ぶ。
 * 未来の ○（計画だけ）へ向かう線は破線。間隔（年）は始まりの星の右に小さく出す。良否は判定しない（色も印も変えない）
 */
export function cycleOf(row: ChartRow, keys: readonly string[], key: string): { left: "solid" | "dash" | null; right: "solid" | "dash" | null; gap: number | null } {
  const none = { left: null, right: null, gap: null };
  const i = keys.indexOf(key);
  if (i < 0) return none;
  const marks = keys.map((k, j) => (row.cells[k]?.mark ? j : -1)).filter((j) => j >= 0);
  const prev = [...marks].reverse().find((j) => j < i);
  const next = marks.find((j) => j > i);
  const here = marks.includes(i);
  const style = (to: number) => (row.cells[keys[to]!]?.mark === "plan" ? "dash" : "solid");
  if (here) return { left: prev !== undefined ? style(i) : null, right: next !== undefined ? style(next) : null, gap: next !== undefined ? next - i : null };
  if (prev === undefined || next === undefined) return none;
  const st = style(next);
  return { left: st, right: st, gap: null };
}

/** 印のセルの描き手：文字を 1 つ置き、セルに aria-label を付けるだけ */
class MarkCell implements ICellRendererComp<ChartRow> {
  private el = document.createElement("span");
  init(p: ICellRendererParams<ChartRow>) {
    this.refresh(p);
  }
  getGui() {
    return this.el;
  }
  refresh(p: ICellRendererParams<ChartRow>): boolean {
    this.el.textContent = p.valueFormatted ?? "";
    const period = (p.colDef?.cellRendererParams as { period: Period } | undefined)?.period;
    const cell = p.data && period ? p.data.cells[period.key] : undefined;
    // 形は CSS が data-mark で描く（字は読み上げと写しのために残す）。台数は data-count で右下に
    // 共通台帳で案の混じったセルは、案を除いた印に朱の破線の円（data-ring）を重ねる
    // 削除の案：施設台帳では今の星取を墨のまま残して朱の斜線、共通台帳とまとめたセルでは朱の破線の円を重ねる（docs/screens.md 3.2）
    const removal = removalShape(cell, p.context);
    const ring = proposalRing(cell, p.context) ?? (removal === "ring" ? (cell?.mark ?? null) : null);
    if (removal === "strike") this.el.dataset.strike = "true";
    else delete this.el.dataset.strike;
    const shown = ring ?? cell?.mark ?? null;
    if (shown) this.el.dataset.mark = shown;
    else delete this.el.dataset.mark;
    // 人の試し：動かした先は朱の細い枠、動かす前の位置は薄い ○（字は aria-label に）。計画だけの ○ はドラッグで動かせる
    const tctx = p.context as GridContext | undefined;
    const ghost = !shown && !!p.data && !!period && !!tctx?.ghosts?.has(`${p.data.id}\u0000${period.key}`);
    if (ghost) this.el.dataset.ghost = "plan";
    else delete this.el.dataset.ghost;
    const trial = !!cell && !!tctx?.trials && cell.detailKeys.some((k) => tctx.trials!.has(k));
    if (trial) this.el.dataset.trial = "true";
    else delete this.el.dataset.trial;
    const fresh = !!shown && !!p.data && !!period && !!tctx?.fresh?.has(`${p.data.id}\u0000${period.key}`);
    if (fresh) this.el.dataset.fresh = "true";
    else delete this.el.dataset.fresh;
    this.el.draggable = shown === "plan" && !cell?.summary;
    if (ring) this.el.dataset.ring = "true";
    else delete this.el.dataset.ring;
    // 選んだ星と周期の線（時間の地図 1）。選びを外すと消える
    const ctx = p.context as GridContext | undefined;
    const picked = !!ctx?.picked && !!p.data && !!period && !!shown && ctx.picked.rowId === p.data.id && ctx.picked.periodKey === period.key;
    if (picked) this.el.dataset.sel = "true";
    else delete this.el.dataset.sel;
    const cyc = ctx?.cycle && p.data && period && ctx.cycle.rowId === p.data.id ? cycleOf(p.data, ctx.cycle.keys, period.key) : null;
    const g = p.eGridCell;
    if (cyc?.left) g.dataset.cycL = cyc.left;
    else delete g.dataset.cycL;
    if (cyc?.right) g.dataset.cycR = cyc.right;
    else delete g.dataset.cycR;
    if (cyc?.gap) g.dataset.gap = T.cycleGap(cyc.gap);
    else delete g.dataset.gap;
    if (cell?.summary && cell.count !== null) this.el.dataset.count = String(cell.count);
    else delete this.el.dataset.count;
    // 比べる版にあって今は無い印は、淡い破線の円で残す（字は読み上げのために aria-label に）
    const was = period ? wasMark(p.data, period, cell, p.context) : null;
    if (was) this.el.dataset.old = was;
    else delete this.el.dataset.old;
    const version = (p.context as GridContext | undefined)?.compare?.version ?? 0;
    if (p.data && period)
      p.eGridCell.setAttribute(
        "aria-label",
        cellAria(p.data, period, cell) +
          (isProposal(cell, p.context) ? T.legend.proposalAria : "") +
          (isRemoval(cell, p.context) ? T.legend.removalAria : "") +
          (isChanged(p.data, period, cell, p.context) ? T.legend.changedFromAria(version) : "") +
          (was ? T.legend.oldPlanAria(version, T.markName[was]) : "") +
          (ghost ? T.legend.trialFromAria : "") +
          (trial ? T.legend.trialAria : ""),
      );
    return true;
  }
}

/** 段の列の見出し：押すとその段で畳む／開く */
class FoldHeader implements IHeaderComp {
  private el = document.createElement("button");
  private params!: IHeaderParams & { level: number; folded: boolean; onFold: (level: number) => void };
  init(p: IHeaderParams & { level: number; folded: boolean; onFold: (level: number) => void }) {
    this.el.type = "button";
    this.el.className = "moyai-fold-header";
    this.el.addEventListener("click", () => this.params.onFold(this.params.level));
    this.refresh(p);
  }
  getGui() {
    return this.el;
  }
  refresh(p: IHeaderParams & { level: number; folded: boolean; onFold: (level: number) => void }): boolean {
    this.params = p;
    this.el.textContent = `${p.folded ? "▸" : "▾"} ${p.displayName}`;
    this.el.title = T.foldHint;
    this.el.setAttribute("aria-pressed", String(p.folded));
    this.el.dataset.testid = `fold-${p.level}`;
    this.el.dataset.folded = String(p.folded);
    return true;
  }
}

/** 文字の入力は Enter か F2 で編集欄を開いてから（IME の最初の 1 文字を落とさないため）。打った字や Delete で編集を始めない */
function suppressTypingStart(p: SuppressKeyboardEventParams<ChartRow>): boolean {
  if (p.editing || p.event.type !== "keydown") return false;
  const e = p.event;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Process";
}

/** 階層の名前の見込みの幅（13px の字：全角 13px・半角 7.5px と字間） */
function textWidth(t: string): number {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 0xff ? 14 : 8;
  return w;
}
/**
 * 階層の列の幅（Wire、11-06。運営者「年度の欄が狭い」）：いちばん長い名前に合わせて広げず、役目で上限を分ける。
 * いちばん上の階層（設備）144px・号炉・系統 96px・いちばん下の階層（部位）200px・ほか（機器）176px。どの列も、その列のいちばん長い名前に合わせて縮む。
 * 入らない名前は後ろを「…」で切り、全文はセルの title と詳しくに出す
 */
export const LEVEL_UPPER_MAX = 144;
export const LEVEL_LOWEST_MAX = 240;
export const LEVEL_TOP_MAX = 144;
export const LEVEL_SERIES_MAX = 96;
export const LEVEL_BOTTOM_MAX = 200;
export const LEVEL_MIDDLE_MAX = 176;
const LEVEL_MIN = 72;
/** セルの左右の余白（cellHorizontalPadding の 2 つ分） */
const CELL_PAD = 32;
export const NEXT_WIDTH = 88;
export const YEAR_WIDTH = 44;
/** 列の見出しの ▾ と間（12px の字） */
const FOLD_MARK = 16;
/** その列の名前と見出しが入る幅（上限まで） */
function levelWidth(header: string, texts: readonly string[], max: number): number {
  return Math.min(max, Math.max(LEVEL_MIN, textWidth(header) + FOLD_MARK + CELL_PAD, ...texts.map((t) => textWidth(t) + CELL_PAD)));
}

/**
 * 共通の設備項目 × 作業の属性で見るときの行の見出しは 1 列（Wire、2026-11-05。絵は Fold.dc.html）：
 * 設備は見出しの行、その下は「計量機 › 点検」（項目 › 作業）の 1 行。列の見出しは「共通の設備項目 › 作業」
 */
export function commonRowText(row: ChartRow): string {
  if (row.kind === "peer" || row.kind === "stat") return row.levelCells[row.levelCells.length - 1] ?? "";
  // 設備の見出しの行：名前の左に ▾（開いている）か ▸（畳んだ）。押すと、その設備の行を畳む・開く
  if (row.level === 1 && row.kind === "node" && row.hasChildren) return `${row.folded ? T.foldClosed : T.foldOpen} ${levelText(row, 0)}`;
  if (row.level === 1 || row.kind === "unmapped") return levelText(row, row.level - 1);
  if (row.level === 2) return levelText(row, 1);
  const [, item, attr] = row.path;
  const text = `${item ?? ""}${T.commonSep}${attr ?? ""}`;
  return row.count === null ? text : `${text}（${T.units(row.count)}）`;
}

/** 1 列のときに表へ渡す行：項目の行は、その下に作業の行があれば出さない（作業の行が「項目 › 作業」を言う） */
export function commonRowsShown(rows: readonly ChartRow[]): ChartRow[] {
  return rows.filter((r) => !(r.kind === "node" && r.level === 2 && r.hasChildren && !r.folded));
}

function levelColumns(model: ChartModel, foldLevel: number | null, h: GridHandlers): ColDef<ChartRow>[] {
  if (model.mode === "common")
    return [
      {
        colId: "lv1",
        headerName: T.commonOneCol,
        pinned: "left",
        lockPinned: true,
        width: levelWidth(T.commonOneCol, model.rows.map(commonRowText), LEVEL_LOWEST_MAX),
        tooltipValueGetter: (p) => (p.data ? commonRowText(p.data) || null : null),
        valueGetter: (p) => {
          if (!p.data) return "";
          const marks = (p.context as GridContext | undefined)?.comments?.get(p.data.id);
          return marks ? `${commonRowText(p.data)}　${marks}` : commonRowText(p.data);
        },
        cellClass: "moyai-lv",
        cellClassRules: {
          "moyai-common-head": (p: CellClassParams<ChartRow>) => !!p.data && p.data.level === 1 && p.data.kind === "node",
          "moyai-lv-folded": (p: CellClassParams<ChartRow>) => !!p.data?.folded,
          "moyai-lv-own": (p: CellClassParams<ChartRow>) => !!p.data,
        },
      },
    ];
  return model.levelNames.map((name, i) => ({
    colId: `lv${i + 1}`,
    headerName: name,
    pinned: "left",
    lockPinned: true,
    // 名前の入る幅（上の階層は 144px、いちばん下の階層は 240px まで。越える名前は「…」で切り、title に全文）
    width: levelWidth(
      name,
      model.rows.map((r) => levelText(r, i)),
      i === 0 ? LEVEL_TOP_MAX : i === model.seriesColumn ? LEVEL_SERIES_MAX : i === model.levelNames.length - 1 ? LEVEL_BOTTOM_MAX : LEVEL_MIDDLE_MAX,
    ),
    tooltipValueGetter: (p) => (p.data ? levelText(p.data, i) || null : null),
    valueGetter: (p) => {
      if (!p.data) return "";
      const text = levelText(p.data, i);
      const marks = i === p.data.level - 1 ? (p.context as GridContext | undefined)?.comments?.get(p.data.id) : undefined;
      return marks ? `${text}　${marks}` : text;
    },
    headerComponent: FoldHeader,
    headerComponentParams: { level: i + 1, folded: foldLevel === i + 1, onFold: h.onFold },
    suppressHeaderKeyboardEvent: (p) => {
      if (p.event.type === "keydown" && (p.event.key === "Enter" || p.event.key === " ")) {
        h.onFold(i + 1);
        return true;
      }
      return false;
    },
    cellClass: "moyai-lv",
    cellClassRules: {
      "moyai-lv-folded": (p: CellClassParams<ChartRow>) => !!p.data?.folded && i === p.data.level - 1,
      "moyai-lv-own": (p: CellClassParams<ChartRow>) => !!p.data && i === p.data.level - 1,
    },
    editable: false,
  }));
}

/** fyStart：年度の境（左に強い罫を引く列） */
function markColumn(p: Period, width: number, fyStart: boolean): ColDef<ChartRow> {
  const get = (c: { data?: ChartRow | undefined }) => c.data?.cells[p.key];
  return {
    colId: p.key,
    headerName: periodLabel(p),
    width,
    cellClass: fyStart ? "moyai-mark moyai-num moyai-fy-start" : "moyai-mark moyai-num",
    headerClass: fyStart ? "moyai-num moyai-mark-head moyai-fy-start" : "moyai-num moyai-mark-head",
    cellClassRules: {
      "moyai-mark-summary": (c: CellClassParams<ChartRow>) => !!get(c)?.summary,
      "moyai-mark-changed": (c: CellClassParams<ChartRow>) => !!get(c)?.change,
      "moyai-mark-review": (c: CellClassParams<ChartRow>) => !!get(c)?.review,
      // 共通台帳で案の混じったセルは、破線の円を重ねる（data-ring）ので、印そのものは破線にしない
      "moyai-mark-proposal": (c: CellClassParams<ChartRow>) => isProposal(get(c), c.context) && proposalRing(get(c), c.context) === null && removalShape(get(c), c.context) !== "ring",
      "moyai-mark-ring": (c: CellClassParams<ChartRow>) => proposalRing(get(c), c.context) !== null || removalShape(get(c), c.context) === "ring",
      "moyai-mark-strike": (c: CellClassParams<ChartRow>) => removalShape(get(c), c.context) === "strike",
      "moyai-mark-vchg": (c: CellClassParams<ChartRow>) => isChanged(c.data, p, get(c), c.context),
    },
    valueGetter: (c) => markText(get(c)?.mark ?? null),
    valueFormatter: (c: ValueFormatterParams<ChartRow>) => formatCell(get(c)),
    valueSetter: () => false, // v0：編集の保存はまだない
    cellRenderer: MarkCell,
    cellRendererParams: { period: p },
    tooltipValueGetter: (c) => {
      const ch = get(c)?.change;
      if (!ch) return null;
      return T.change(ch.who ?? TEXT.author[ch.author], ch.reason, ch.before ? T.markName[ch.before] : T.markNone, ch.after ? T.markName[ch.after] : T.markRemoved);
    },
    // 畳んだ行の印は消せない（消すときは開いて消す）。未当てはめの行も編集しない
    editable: (c) => !!c.data && !c.data.folded && c.data.kind === "node",
    cellEditor: "agTextCellEditor",
    suppressKeyboardEvent: suppressTypingStart,
  };
}

/**
 * 似た施設の帯の列。間隔・工数・日数のうち人が選んだ 1 つを、段の列のすぐ右に置く（3 つを並べると、狭い画面で年度の列が見えなくなるため）。
 * 固定しない（左に固定した段の列と重ならないように）。3 つとも、行を選ぶと横の板に出る。
 */
function bandColumn(f: StatField): ColDef<ChartRow> {
  return {
    colId: `band.${f}`,
    headerName: T.peers.bandCols[f],
    width: 220,
    cellClass: "moyai-band moyai-num",
    headerClass: "moyai-band-head",
    valueGetter: (p) => bandCellText(p.data, f),
    tooltipValueGetter: (p) => bandCellText(p.data, f) || null,
    editable: false,
  };
}

/** 次回の列の字：作業の行だけ。作業の無い行（親の段・未当てはめ・似た施設・統計）は空ける */
export function dueCellText(row: ChartRow | undefined, due: ReadonlyMap<string, DueView> | undefined): string {
  if (!row || row.kind !== "node" || !due) return "";
  return rowDue(row.works, due)?.text ?? "";
}

/** 次回の列（docs/screens.md 3.2）：行の見出しのすぐ右に細く。左に固定して、年度の列を横に動かしても見える */
function dueColumn(): ColDef<ChartRow> {
  return {
    colId: "next",
    headerName: DUE_TEXT.col,
    pinned: "left",
    lockPinned: true,
    width: NEXT_WIDTH,
    cellClass: "moyai-next moyai-num",
    headerClass: "moyai-num",
    valueGetter: (p) => dueCellText(p.data, (p.context as GridContext | undefined)?.due),
    editable: false,
  };
}

function columns(model: ChartModel, foldLevel: number | null, h: GridHandlers, band: StatField): (ColDef<ChartRow> | ColGroupDef<ChartRow>)[] {
  const out: (ColDef<ChartRow> | ColGroupDef<ChartRow>)[] = [...levelColumns(model, foldLevel, h), dueColumn()];
  const monthly = model.periods.some((p) => p.month !== null);
  if (!monthly) {
    // 年だけの表は縦の罫を引かない（どの列も年度の境なので、罫が並んでうるさくなる）
    if (model.peersShown && !model.peersSummary) out.push(bandColumn(band));
    for (const p of model.periods) out.push(markColumn(p, YEAR_WIDTH, false));
    return out;
  }
  const groups = new Map<number, Period[]>();
  for (const p of model.periods) groups.set(p.fiscalYear, [...(groups.get(p.fiscalYear) ?? []), p]);
  for (const [fy, ps] of groups) {
    out.push({
      groupId: `g${fy}`,
      headerName: T.fiscalYear(fy),
      headerClass: "moyai-fy-group moyai-fy-start",
      children: ps.map((p, j) => ({ ...markColumn(p, p.month === null ? 64 : 56, j === 0), headerName: p.month === null ? T.yearOnly : String(p.month) })),
    });
  }
  return out;
}

/** 表の外枠。React の外で AG Grid を持ち、呼ぶ側の状態を写す */
export class ChartGrid {
  private api: GridApi<ChartRow>;
  private colKey = "";

  private mode: ChartModel["mode"] = "ledger";
  constructor(private el: HTMLElement, private h: GridHandlers) {
    this.api = createGrid<ChartRow>(el, {
      theme,
      columnDefs: [],
      rowData: [],
      getRowId: (p) => p.data.id,
      defaultColDef: { sortable: false, filter: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      suppressClickEdit: true, // ダブルクリックは畳んだ行の明細に使う。編集は Enter か F2
      stopEditingWhenCellsLoseFocus: true,
      // 切った名前の全文と、変えた印の理由は、セルの title に出す（Wire、11-06）
      enableBrowserTooltips: true,
      animateRows: false,
      suppressNoRowsOverlay: true,
      context: { proposals: NO_PROPOSALS, compare: null } satisfies GridContext,
      rowClassRules: {
        "moyai-row-folded": (p) => !!p.data?.folded,
        "moyai-row-unmapped": (p) => p.data?.kind === "unmapped",
        "moyai-row-peer": (p) => p.data?.kind === "peer",
        "moyai-row-stat": (p) => p.data?.kind === "stat",
        "moyai-row-own-missing": (p) => !!p.data?.ownMissing,
      },
      // 選んだ印：鍵盤で動かしたとき（focus）と、押したとき（click）の両方で受ける
      onCellFocused: (e) => {
        const node = e.rowIndex !== null && e.rowPinned == null ? this.api.getDisplayedRowAtIndex(e.rowIndex) : undefined;
        const col = typeof e.column === "object" && e.column ? e.column.getColId() : null;
        if (node?.data) this.select(node.data.id, col);
      },
      onCellClicked: (e) => {
        if (e.data && this.mode === "common" && e.column.getColId() === "lv1" && e.data.kind === "node" && e.data.level === 1 && e.data.hasChildren) this.h.onToggle?.(e.data.id);
        if (e.data) this.select(e.data.id, e.column.getColId());
      },
      onCellDoubleClicked: (e) => {
        if (e.data?.folded) this.h.onOpenFolded(e.data.id);
      },
      onCellEditingStopped: () => this.h.onEditStopped(),
    });
  }

  private fresh: ReadonlySet<string> = new Set();

  /** 新しく現れた星（答えの結果で計画が作り直されたとき）。その行だけ描き直す。次の描き直しで外れる */
  setFresh(fresh: ReadonlySet<string>) {
    const rowsOf = (set: ReadonlySet<string>) => [...set].map((k) => k.split("\u0000")[0]!);
    const ids = new Set([...rowsOf(this.fresh), ...rowsOf(fresh)]);
    this.fresh = fresh;
    const ctx = this.api.getGridOption("context") as GridContext;
    this.api.setGridOption("context", { ...ctx, fresh } satisfies GridContext);
    const rowNodes = [...ids].map((id) => this.api.getRowNode(id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (rowNodes.length) this.api.refreshCells({ rowNodes, force: true });
    // 現れ終えたら外す（あとで送った・描き直したセルが、もう一度現れないように）。描いた印は次の描き直しで消える
    if (this.freshTimer) clearTimeout(this.freshTimer);
    if (fresh.size > 0)
      this.freshTimer = setTimeout(() => {
        this.freshTimer = null;
        this.fresh = new Set();
        const c = this.api.getGridOption("context") as GridContext;
        this.api.setGridOption("context", { ...c, fresh: this.fresh } satisfies GridContext);
      }, 600);
  }
  private freshTimer: ReturnType<typeof setTimeout> | null = null;

  private ghosts: ReadonlySet<string> = new Set();
  private trials: ReadonlySet<string> = new Set();

  /** 人の試し（動かす前の薄い ○ と、動かした先）を描き直す。試しが変わったときだけ呼ぶ */
  setTrials(ghosts: ReadonlySet<string>, trials: ReadonlySet<string>) {
    this.ghosts = ghosts;
    this.trials = trials;
    const ctx = this.api.getGridOption("context") as GridContext;
    this.api.setGridOption("context", { ...ctx, ghosts, trials } satisfies GridContext);
    this.api.refreshCells({ force: true });
  }

  private picked: GridContext["picked"] = null;
  private cycle: GridContext["cycle"] = null;

  /** 選んだ星と周期の線を描き直す（行は渡し直さない）。星を選んでいるあいだ、ほかの星を薄くする（CSS。動きは --dur-base、prefers-reduced-motion では 0） */
  pick(picked: GridContext["picked"], cycle: GridContext["cycle"]) {
    if (JSON.stringify([picked, cycle?.rowId, cycle?.keys]) === JSON.stringify([this.picked, this.cycle?.rowId, this.cycle?.keys])) return;
    this.picked = picked;
    this.cycle = cycle;
    const ctx = this.api.getGridOption("context") as GridContext;
    this.api.setGridOption("context", { ...ctx, picked, cycle } satisfies GridContext);
    this.el.dataset.picked = picked ? "true" : "false";
    // 描き直すのは、前と今の選びの行だけ（矢印のキーで焦点を動かすたびに表全体を描き直さない）
    const ids = new Set([this.lastPickRows, [picked?.rowId, cycle?.rowId]].flat().filter((x): x is string => !!x));
    this.lastPickRows = [picked?.rowId, cycle?.rowId].filter((x): x is string => !!x);
    const rowNodes = [...ids].map((id) => this.api.getRowNode(id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (rowNodes.length) this.api.refreshCells({ rowNodes, force: true });
  }
  private lastPickRows: string[] = [];

  private select(rowId: string, colId: string | null) {
    this.h.onSelect(rowId, colId && !colId.startsWith("lv") && !colId.startsWith("band.") ? colId : null);
  }

  /** 列（段の名前・期・帯の列・階層の列の幅が変わったときだけ作り直す）と、見える行を渡す */
  update(
    model: ChartModel,
    foldLevel: number | null,
    band: StatField = "interval",
    proposals: ReadonlySet<string> = NO_PROPOSALS,
    compare: GridCompare = null,
    comments?: ReadonlyMap<string, string>,
    due?: ReadonlyMap<string, DueView>,
    kinds?: ReadonlyMap<string, "plan" | "actual">,
    removals?: ReadonlySet<string>,
  ) {
    this.mode = model.mode;
    this.api.setGridOption("context", { proposals, compare, comments, due, common: model.mode === "common", kinds, removals, picked: this.picked, cycle: this.cycle, ghosts: this.ghosts, trials: this.trials, fresh: this.fresh } satisfies GridContext);
    const cols = columns(model, foldLevel, this.h, band);
    const key = JSON.stringify([model.mode, model.levelNames, model.periods.map((p) => p.key), foldLevel, model.peersShown, model.peersSummary, band, cols.map((c) => ("width" in c ? c.width : null))]);
    if (key !== this.colKey) {
      this.colKey = key;
      this.api.setGridOption("columnDefs", cols);
    }
    this.api.setGridOption("rowData", model.mode === "common" ? commonRowsShown(model.rows) : model.rows);
    // 行の中身が同じ鍵のまま変わったとき（畳む・層の切り替え）に、セルの文字とクラスを描き直す
    this.api.refreshCells({ force: true });
    this.h.onRendered();
  }

  /** その行・期のセルを見える所へ送り、選ぶ（ほかのシートや横の板の「| 〜で見る」から。選ぶと横の板が開く） */
  reveal(rowId: string, colKey: string | null): boolean {
    const node = this.api.getRowNode(rowId);
    if (!node || node.rowIndex === null) return false;
    this.api.ensureNodeVisible(node, "middle");
    const col = colKey && this.api.getColumn(colKey) ? colKey : null;
    if (col) this.api.ensureColumnVisible(col, "middle");
    this.api.setFocusedCell(node.rowIndex, col ?? "lv1");
    return true;
  }

  destroy() {
    this.api.destroy();
  }
}
