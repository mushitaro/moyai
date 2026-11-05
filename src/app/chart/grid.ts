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
import type { ChartCell, ChartModel, ChartRow, Mark, Period } from "../../plan/chart";
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

/** 期の見出しの名前 */
export function periodLabel(p: Period): string {
  return p.month === null ? T.fiscalYear(p.fiscalYear) : T.month(p.month);
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
    if (cell?.mark) this.el.dataset.mark = cell.mark;
    else delete this.el.dataset.mark;
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
          (isChanged(p.data, period, cell, p.context) ? T.legend.changedFromAria(version) : "") +
          (was ? T.legend.oldPlanAria(version, T.markName[was]) : ""),
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

/** 段の名前の見込みの幅（13px の字：全角 13px・半角 7.5px と字間、左右の余白） */
function textWidth(t: string): number {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) > 0xff ? 14 : 8;
  return w;
}
const LEVEL_MIN = [170, 160];
const LEVEL_MAX = 360;

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
        width: Math.min(LEVEL_MAX + 120, Math.max(LEVEL_MIN[0]!, ...model.rows.map((r) => textWidth(commonRowText(r)) + 40))),
        tooltipValueGetter: (p) => (p.data ? commonRowText(p.data) : null),
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
    // その段のいちばん長い名前が切れない幅（上限を越える名前は切り、title に全文）
    width: Math.min(LEVEL_MAX, Math.max(LEVEL_MIN[i === 0 ? 0 : 1]!, ...model.rows.map((r) => textWidth(levelText(r, i)) + 40))),
    tooltipValueGetter: (p) => {
      const t = p.data ? levelText(p.data, i) : "";
      return t && textWidth(t) + 40 > LEVEL_MAX ? t : null;
    },
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
    headerClass: fyStart ? "moyai-num moyai-fy-start" : "moyai-num",
    cellClassRules: {
      "moyai-mark-summary": (c: CellClassParams<ChartRow>) => !!get(c)?.summary,
      "moyai-mark-changed": (c: CellClassParams<ChartRow>) => !!get(c)?.change,
      "moyai-mark-review": (c: CellClassParams<ChartRow>) => !!get(c)?.review,
      "moyai-mark-proposal": (c: CellClassParams<ChartRow>) => isProposal(get(c), c.context),
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
    width: 120,
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
    for (const p of model.periods) out.push(markColumn(p, 112, false));
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
  constructor(el: HTMLElement, private h: GridHandlers) {
    this.api = createGrid<ChartRow>(el, {
      theme,
      columnDefs: [],
      rowData: [],
      getRowId: (p) => p.data.id,
      defaultColDef: { sortable: false, filter: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      suppressClickEdit: true, // ダブルクリックは畳んだ行の明細に使う。編集は Enter か F2
      stopEditingWhenCellsLoseFocus: true,
      tooltipShowDelay: 300,
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

  private select(rowId: string, colId: string | null) {
    this.h.onSelect(rowId, colId && !colId.startsWith("lv") && !colId.startsWith("band.") ? colId : null);
  }

  /** 列（段の名前・期・帯の列が変わったときだけ作り直す）と、見える行を渡す */
  update(model: ChartModel, foldLevel: number | null, band: StatField = "interval", proposals: ReadonlySet<string> = NO_PROPOSALS, compare: GridCompare = null, comments?: ReadonlyMap<string, string>, due?: ReadonlyMap<string, DueView>) {
    this.mode = model.mode;
    this.api.setGridOption("context", { proposals, compare, comments, due } satisfies GridContext);
    const key = JSON.stringify([model.levelNames, model.periods.map((p) => p.key), foldLevel, model.peersShown, model.peersSummary, band]);
    if (key !== this.colKey) {
      this.colKey = key;
      this.api.setGridOption("columnDefs", columns(model, foldLevel, this.h, band));
    }
    this.api.setGridOption("rowData", model.mode === "common" ? commonRowsShown(model.rows) : model.rows);
    // 行の中身が同じ鍵のまま変わったとき（畳む・層の切り替え）に、セルの文字とクラスを描き直す
    this.api.refreshCells({ force: true });
    this.h.onRendered();
  }

  destroy() {
    this.api.destroy();
  }
}
