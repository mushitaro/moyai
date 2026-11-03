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
import { TEXT } from "../text";

ModuleRegistry.registerModules([AllCommunityModule]);

const T = TEXT.chart;

const theme = themeQuartz.withParams({
  fontFamily: "var(--moyai-font)",
  fontSize: 13,
  backgroundColor: "var(--moyai-surface)",
  foregroundColor: "var(--moyai-fg)",
  headerBackgroundColor: "var(--moyai-chart-header-bg)",
  borderColor: "var(--moyai-border)",
  accentColor: "var(--moyai-accent)",
  rowHoverColor: "var(--moyai-chart-selected)",
  rowHeight: 28,
  headerHeight: 30,
  spacing: 4,
  wrapperBorderRadius: 4,
});

export interface GridHandlers {
  onFold(level: number): void;
  onSelect(rowId: string, periodKey: string | null): void;
  onOpenFolded(rowId: string): void;
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

/** セルの aria-label：階層の道・期・印の意味 */
export function cellAria(row: ChartRow, p: Period, cell: ChartCell | undefined): string {
  const path = row.path.filter((x): x is string => x !== null).join(T.pathSep);
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

/** 段の列のセルの文字：畳んだ行は台数、未当てはめの行は件数を添える */
function levelText(row: ChartRow, i: number): string {
  const name = row.levelCells[i] ?? "";
  if (i !== row.level - 1 || row.count === null) return name;
  return row.kind === "unmapped" ? `${name}（${T.records(row.count)}）` : `${name}（${T.units(row.count)}）`;
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
    if (p.data && period) p.eGridCell.setAttribute("aria-label", cellAria(p.data, period, p.data.cells[period.key]));
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

function levelColumns(model: ChartModel, foldLevel: number | null, h: GridHandlers): ColDef<ChartRow>[] {
  return model.levelNames.map((name, i) => ({
    colId: `lv${i + 1}`,
    headerName: name,
    pinned: "left",
    lockPinned: true,
    width: i === 0 ? 170 : 160,
    valueGetter: (p) => (p.data ? levelText(p.data, i) : ""),
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

function markColumn(p: Period, width: number): ColDef<ChartRow> {
  const get = (c: { data?: ChartRow | undefined }) => c.data?.cells[p.key];
  return {
    colId: p.key,
    headerName: periodLabel(p),
    width,
    cellClass: "moyai-mark moyai-num",
    cellClassRules: {
      "moyai-mark-summary": (c: CellClassParams<ChartRow>) => !!get(c)?.summary,
      "moyai-mark-changed": (c: CellClassParams<ChartRow>) => !!get(c)?.change,
      "moyai-mark-review": (c: CellClassParams<ChartRow>) => !!get(c)?.review,
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

function columns(model: ChartModel, foldLevel: number | null, h: GridHandlers): (ColDef<ChartRow> | ColGroupDef<ChartRow>)[] {
  const out: (ColDef<ChartRow> | ColGroupDef<ChartRow>)[] = levelColumns(model, foldLevel, h);
  const monthly = model.periods.some((p) => p.month !== null);
  if (!monthly) {
    for (const p of model.periods) out.push(markColumn(p, 86));
    return out;
  }
  const groups = new Map<number, Period[]>();
  for (const p of model.periods) groups.set(p.fiscalYear, [...(groups.get(p.fiscalYear) ?? []), p]);
  for (const [fy, ps] of groups) {
    out.push({
      groupId: `g${fy}`,
      headerName: T.fiscalYear(fy),
      headerClass: "moyai-fy-group",
      children: ps.map((p) => ({ ...markColumn(p, p.month === null ? 50 : 42), headerName: p.month === null ? T.yearOnly : String(p.month) })),
    });
  }
  return out;
}

/** 表の外枠。React の外で AG Grid を持ち、呼ぶ側の状態を写す */
export class ChartGrid {
  private api: GridApi<ChartRow>;
  private colKey = "";

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
      rowClassRules: {
        "moyai-row-folded": (p) => !!p.data?.folded,
        "moyai-row-unmapped": (p) => p.data?.kind === "unmapped",
      },
      // 選んだ印：鍵盤で動かしたとき（focus）と、押したとき（click）の両方で受ける
      onCellFocused: (e) => {
        const node = e.rowIndex !== null && e.rowPinned == null ? this.api.getDisplayedRowAtIndex(e.rowIndex) : undefined;
        const col = typeof e.column === "object" && e.column ? e.column.getColId() : null;
        if (node?.data) this.select(node.data.id, col);
      },
      onCellClicked: (e) => {
        if (e.data) this.select(e.data.id, e.column.getColId());
      },
      onCellDoubleClicked: (e) => {
        if (e.data?.folded) this.h.onOpenFolded(e.data.id);
      },
      onCellEditingStopped: () => this.h.onEditStopped(),
    });
  }

  private select(rowId: string, colId: string | null) {
    this.h.onSelect(rowId, colId && !colId.startsWith("lv") ? colId : null);
  }

  /** 列（段の名前と期が変わったときだけ作り直す）と、見える行を渡す */
  update(model: ChartModel, foldLevel: number | null) {
    const key = JSON.stringify([model.levelNames, model.periods.map((p) => p.key), foldLevel]);
    if (key !== this.colKey) {
      this.colKey = key;
      this.api.setGridOption("columnDefs", columns(model, foldLevel, this.h));
    }
    this.api.setGridOption("rowData", model.rows);
    // 行の中身が同じ鍵のまま変わったとき（畳む・層の切り替え）に、セルの文字とクラスを描き直す
    this.api.refreshCells({ force: true });
    this.h.onRendered();
  }

  destroy() {
    this.api.destroy();
  }
}
