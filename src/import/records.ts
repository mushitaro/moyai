// 層 3 意味づけ（1）：層 2 の表から記録（資産の行・星取表の印・日報の行）を作る。決まらない所は質問にする。
// どのセルを何に使ったかを数えるため、記録はセルの位置を持つ。
import { cellRef, colLetter, type GridCell, type SheetGrid } from "./grid";
import { CUES, containsAny, cue, norm, type ColumnCue } from "./cues";
import { fiscalYearInText, fiscalYearOf, nfkc, parseDayCount, parseMonthDay, parseYearLabel, parseYearOnly, validYmd, withFiscalYear, ymdString, type Ymd } from "./era";
import { parseWithFormat } from "./reading";
import { Asker, type MergeSpec, type QuestionItem, YES_NO, questionIdOf } from "./questions";
import { isAssignableRole } from "./roles";
import { GANTT_REASON, addDays, datesOfTimes, unitHeading, type GanttCol, type GanttRow, type GanttTable } from "./gantt";
import { blockPeriod, joinWrap, parseBlockName, parseEffortLine, type BlockTable, type RecordBlock } from "./blocks";
import { UNIT_LABEL, assignParents, cellPeriod, isTypedDate, type ColInfo, type SheetLayout, type Table } from "./structure";
import { assetFromTitle, costHeaderTax, costHeaderUnit, cycleHeaderUnit, lunchOverlap, parseCost, parseCycle, parseEffort, parsePersons, parseTimeSpan, parseUnit, personsHeaderUnit, splitFlatWork, splitNameUnits, splitOrderItem, splitSeriesCell, splitTag, tagTrailingNumber, type CycleSpan, type OrderItem, type TagSplit, type TimeSpan, type UnitValue } from "./text";

export type Series = { kind: "number"; n: number } | { kind: "common"; meaning: string };

export interface CellPos {
  file: string;
  sheet: string | null;
  sheetIndex: number;
  ref: string;
}

export const cellKey = (p: { file: string; sheetIndex: number; ref: string }) => `${p.file}\u0000${p.sheetIndex}\u0000${p.ref}`;

export interface AssetRec {
  id: string;
  file: string;
  sheet: string | null;
  sheetIndex: number;
  tableId: string;
  shape: "tree" | "grid";
  order: number;
  level: number;
  parentId: string | null;
  rawName: string;
  name: string;
  tag: string | null;
  tagNumber: number | null;
  nameRef: string;
  series: Series | null;
  specs: { key: string; value: string; ref: string }[];
  installed: { year: number; ref: string } | null;
  refs: string[];
  /** 決定で外したときの理由 */
  excluded: string | null;
  /** 決まらない（未解決のまま） */
  pending: boolean;
}

/** 費用のセル：円の整数・元のセルの場所と元の字・税の扱い（資料に書いていなければ unknown） */
export interface CostCell {
  yen: number;
  ref: string;
  text: string;
  tax: "incl" | "excl" | "unknown";
  /** 予定・概算・見積・予算の列だけを費用に読んだとき、計画の年度の値にだけ置く（実績の費用にしない。Architect の 45） */
  planOnly?: true;
}

export interface MarkRec {
  /** 列の年が暦年として書かれた（年度 Y として読んだ。Architect の 58） */
  calendarYear?: true;
  id: string;
  file: string;
  sheet: string | null;
  sheetIndex: number;
  tableId: string;
  ref: string;
  row: number;
  symbol: string;
  fiscalYear: number;
  planOrActual: "plan" | "actual" | null;
  /** 凡例の意味が作業の名前のとき（例：◎ が特定の検査）か、行ごとに作業の列を書く星取表のその行の作業 */
  workName: string | null;
  /** 行の作業の名前のセル（行ごとに作業の列を書く星取表）。記録の出どころに足す */
  workRef: string | null;
  /** その行の周期（「周期(年)」の列）：作業の暦のきっかけ。書いていなければ省く */
  cycle?: CycleSpan;
  /** その行の費用（「概算費用(千円/回)」の列。1 回あたり）。書いていなければ省く */
  cost?: CostCell;
  /** 記号でなく整備の内容の文を書いた年の欄（2 段の書き方の上の段）。workName がその文 */
  content?: true;
  /** 内容の文のうち、測った値の行（「最小厚 22.5mm」）。作業明細の測った値に残す */
  measured?: string;
  assetId: string | null;
  excluded: string | null;
  pending: boolean;
}

export interface EventRec {
  id: string;
  file: string;
  sheet: string | null;
  sheetIndex: number;
  tableId: string;
  row: number;
  /** 日付。期間（「始まり〜終わり」）の行は始まり */
  date: Ymd | null;
  /** 期間の行の終わり（1 日の日付の行は null） */
  end: Ymd | null;
  /** 日数の欄（工期の日数）。書いてなければ null */
  days: number | null;
  fiscalYear: number | null;
  manDays: number | null;
  /** 工数のセルに書いてあったが人・日に直せていない */
  effortPending: boolean;
  assetNames: string[];
  /** 機器の名前を書いたセル（機器の列・号炉と機器と作業を 1 つに書いたセル・帳票の頭書きの値）。無ければ省く */
  nameRef?: string;
  /** その行の周期（「周期」の列）：作業の暦のきっかけ。書いていなければ省く */
  cycle?: CycleSpan;
  /** その行の費用（「契約金額」の列）。書いていなければ省く */
  cost?: CostCell;
  /** 決定で工数を外した行 */
  effortExcluded?: true;
  /** 行ごとの予定・実績の列（「状態｜完了・計画中」）が計画の行（Architect の 53。実績の行と予定・実績の列の無い行は省く） */
  planOrActual?: "plan";
  /** 機器番号の列に書いた番号（同一性の鍵）。無ければ null */
  tag: string | null;
  bundle: boolean;
  unit: UnitValue | null;
  workName: string;
  workTitle: string | null;
  remark: string | null;
  /** 作業量の列（「数量」など）の文字。書いていなければ省く（Architect の 54） */
  quantity?: string;
  /** 作業明細に残す備考（備考の列のうち作業量の列を除いたもの）。書いていなければ省く */
  lineRemark?: string;
  refs: string[];
  excluded: string | null;
  pending: boolean;
  /**
   * 同じ記録の名前の欄から作った機器の記録の ID（PDF の表の、何行にも折り返した記録。blockRecords）。あれば、名前で引かずにその機器に当てる
   * （機器の記録が資料をまたいで結ばれれば、結んだ機器）。無ければ省く
   */
  assetId?: string;
}

/** 契約の記録の日付の欄（changeDate・due は発注明細の最終変更日・納期） */
export type ContractDateField = "orderDate" | "estimateDate" | "start" | "end" | "done" | "inspectDate" | "payDate" | "changeDate" | "due";
/** 契約の記録の金額の欄（amount は、契約の欄の語の無い金額の列。unitPrice・firstAmount・remainAmount は発注明細の単価・初回発注額・未検収残額） */
export type ContractAmountField = "orderAmount" | "estimateAmount" | "inspectAmount" | "payAmount" | "amount" | "unitPrice" | "firstAmount" | "remainAmount";

/** 発注明細の記録の字の欄 */
export type OrderLineTextField = "orderNo" | "lineNo" | "revision" | "item" | "spec" | "costKind" | "quantity" | "unitWord" | "vendorCode" | "inspectStatus" | "currency";

/**
 * 発注明細の 1 行の欄（契約の記録に足す）。品名・仕様から号炉・機器・作業を取り出せた行（target）だけを、ほかの資料の機器と同じ鍵のときに
 * 結ぶ案にする（compose.ts）。取り出せない行（一式・諸経費・運搬など）は記録に残すだけで、作業にしない
 */
export interface OrderLineRec {
  texts: Partial<Record<OrderLineTextField, string>>;
  /** 品名・仕様から取り出した号炉・機器・作業。取り出せなければ null */
  target: OrderItem | null;
  /** 品名のセル（無ければ仕様のセル）。結ぶ案の問いと出どころに使う */
  itemRef: string | null;
  /** 検収のある行（検収の額か検収の日がある）は実績、無い行は予定 */
  planOrActual: "plan" | "actual";
  /** 年度の値の費用の候補：実績は検収累計額（無ければ発注額）、予定は発注額（無ければ初回発注額）。読めなければ null */
  cost: CostCell | null;
  /** 改訂の順が決まらない（改訂番号が数でない・同じ番号が 2 つある）明細：結ぶ案にしない（費用を 2 重に数えないため） */
  revisionUnknown?: true;
  /** 行の中身のあるセル（前の改訂の行を、行ごと理由つきで外すため） */
  cells: string[];
}

/**
 * 契約の記録：契約・発注の一覧の 1 行（件名・業者・金額・工期・検収日・区分・契約方法）。作業にはしない（計画の作業を増やさない）。
 * 金額は費用の候補として持ち、件名の語と期間の合う作業の年度の値と結ぶ案にだけ使う（compose.ts）
 */
export interface ContractRec {
  id: string;
  file: string;
  sheet: string | null;
  sheetIndex: number;
  tableId: string;
  row: number;
  number: string | null;
  title: string | null;
  titleRef: string | null;
  /** 変更契約の行（件名が「〃（第1回変更）」のように「〃」で始まる）：上の契約の記録の id。件名は上の契約のもの */
  changeOf: string | null;
  category: string | null;
  method: string | null;
  vendor: string | null;
  /** 単価契約（件名・契約方法・区分に印がある）：予定の総額を実績の費用にしない */
  unitPrice: boolean;
  amounts: { field: ContractAmountField; header: string; cost: CostCell }[];
  dates: { field: ContractDateField; date: Ymd; ref: string }[];
  /** 工期（着手・完了）。片方だけなら、その日だけ。書いていなければ null */
  period: { start: Ymd; end: Ymd } | null;
  /** 契約の年度：工期の始まり、無ければ発注・見積・完了・検収・支払の日、年度の列、シートに書いた年度の順で決める。決まらなければ null */
  fiscalYear: number | null;
  /** 記録に読んだセル（データに数える） */
  refs: string[];
  /** 発注明細の行（表の形 orderLines）だけ：明細の欄と、取り出した号炉・機器・作業 */
  line?: OrderLineRec;
}

export interface Records {
  assets: AssetRec[];
  marks: MarkRec[];
  events: EventRec[];
  /** 契約・発注の一覧の行（作業にしない記録） */
  contracts: ContractRec[];
  /** 表ごとの段の名前（星取表の段の列の見出し） */
  levelNames: Map<string, string[]>;
  /** 外したセル（理由つき）と、未解決のまま残ったセル */
  excluded: Map<string, string>;
  pending: Set<string>;
  /** 未解決のセル → それを決める質問の ID（分かるときだけ。画面の写しに使う） */
  pendingBy: Map<string, string>;
  /** 星取表の年の範囲（表ごと） */
  gridYears: Map<string, { from: number; to: number }>;
  /** 表 → 同じ様式の表のまとまり（問いをまとめる鍵）。まとまりの表の顔ぶれが変われば鍵も変わる（聞き直す） */
  formOf: Map<string, FormGroup>;
}

export interface FormGroup {
  key: string;
  /** まとまりの表（id）と資料 */
  tables: string[];
  files: string[];
}

/** 同じ様式の表（列の見出しの文字と位置が同じ）をまとめる。1 つだけの様式は、その表だけのまとまり */
export function formGroups(layouts: SheetLayout[]): Map<string, FormGroup> {
  const byForm = new Map<string, { id: string; file: string }[]>();
  for (const lay of layouts) for (const t of lay.tables) byForm.set(t.form, [...(byForm.get(t.form) ?? []), { id: t.id, file: t.file }]);
  const out = new Map<string, FormGroup>();
  for (const ms of byForm.values()) {
    const tables = ms.map((m) => m.id).sort();
    const g: FormGroup = {
      key: tables.length === 1 ? (tables[0] ?? "") : `form:${questionIdOf(tables.join("\u0000")).slice(2)}`,
      tables,
      files: [...new Set(ms.map((m) => m.file))].sort(),
    };
    for (const id of tables) out.set(id, g);
  }
  return out;
}

/** 資料の名前の並び（多ければ「ほか n 冊」） */
export function filesLabel(files: string[]): string {
  return files.length <= 2 ? files.join(" と ") : `${files.slice(0, 2).join("・")} ほか ${files.length - 2} 冊`;
}

/** セルを未解決にする。q はそのセルを決める質問の ID（分かるときだけ） */
type Pend = (ref: string, q?: string | null) => void;

export interface RecordOptions {
  fiscalYearStartMonth: number;
}

function itemOf(t: { file: string; sheet: string | null }, cells: string[], extra: Partial<QuestionItem> = {}): QuestionItem {
  return { file: t.file, sheet: t.sheet, cells, ...extra };
}

/**
 * 同じ様式の表（formGroups）の同じ列の問いを、シート・塊・資料をまたいで 1 問にまとめる手がかり（questions.ts の MergeSpec）。
 * 鍵は「問いの名前|様式|列や書き方」。種類と選択肢は Asker が足す。text は合わせた行の数からまとめた質問の文を作る
 */
function sameForm(family: string, formKey: string, part: string, text?: (rows: number) => string): MergeSpec {
  return { key: `${family}|${formKey}|${part}`, ...(text ? { text } : {}) };
}

/** 表の様式の鍵（同じ様式の表が無ければ、その表の ID） */
function formKeyOf(rec: Records, t: { id: string }): string {
  return rec.formOf.get(t.id)?.key ?? t.id;
}

function shapeOf(text: string): string {
  return nfkc(text)
    .replace(/\d+/g, "n")
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu, "字")
    .slice(0, 24);
}

export function buildRecords(layouts: SheetLayout[], ask: Asker, opts: RecordOptions, date1904Of: (file: string) => boolean): Records {
  const rec: Records = { assets: [], marks: [], events: [], contracts: [], levelNames: new Map(), excluded: new Map(), pending: new Set(), pendingBy: new Map(), gridYears: new Map(), formOf: formGroups(layouts) };
  let order = 0;
  for (const lay of layouts) {
    const pos = (ref: string): CellPos => ({ file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, ref });
    const exclude = (ref: string, why: string) => rec.excluded.set(cellKey(pos(ref)), why);
    const pend: Pend = (ref, q = null) => {
      const k = cellKey(pos(ref));
      rec.pending.add(k);
      if (q && !rec.pendingBy.has(k)) rec.pendingBy.set(k, q);
    };
    // 計算済みの値の無い数式のセルは、決定（外す）か未解決のどちらかだけ。記録には使わない
    formulaQuestions(lay, ask, exclude, pend);
    const noCache = new Set(lay.grid.cells.filter((c) => c.formulaNoCache).map((c) => c.ref));
    const off: Off = (ref) => noCache.has(ref) || rec.excluded.has(cellKey(pos(ref)));
    for (const t of lay.tables) {
      issuesToQuestions(t, lay, ask, exclude, pend, rec.formOf.get(t.id)?.key ?? t.id);
      // 外す列（読み方の規則で外した列・費用の列）：作業の表は eventRecords で外す。木と星取表もここで理由つきで外す
      if (t.shape !== "events")
        for (const col of t.cols.filter((c) => c.ruleExclude))
          for (const r of t.rows) {
            const x = lay.index.at(r.r, col.c);
            if (x && x.text !== "" && !off(x.ref)) exclude(x.ref, col.ruleExclude as string);
          }
      if (t.shape === "tree") order = treeRecords(t, lay, ask, rec, order, exclude, pend, off);
      else if (t.shape === "grid") order = gridRecords(t, lay, ask, rec, order, exclude, pend, off);
      else if (t.shape === "contracts" || t.shape === "orderLines") contractRecords(t, lay, ask, rec, opts, date1904Of(lay.file), exclude, pend, off);
      else if (t.blocks) order = blockRecords(t, t.blocks, lay, ask, rec, order, opts, exclude, pend, off);
      else if (t.gantt) order = ganttRecords(t, t.gantt, lay, ask, rec, order, opts, exclude, pend, off);
      else eventRecords(t, lay, ask, rec, opts, date1904Of(lay.file), exclude, pend, off);
    }
  }
  supersedeRevisions(rec);
  return rec;
}


/**
 * 発注明細の改訂：同じ明細（発注番号か工事番号と、明細番号が同じ）の行のうち、改訂番号のいちばん大きい行だけを数え、前の改訂の行は行ごと理由つきで外す
 * （記録にもしない）。改訂番号の空欄は 0。改訂番号が数でない・いちばん大きい番号が 2 つある明細は、どれも記録に残し、結ぶ案にしない（順を推し量らない）
 */
function supersedeRevisions(rec: Records) {
  const groups = new Map<string, ContractRec[]>();
  for (const c of rec.contracts) {
    const t = c.line?.texts;
    const owner = t?.orderNo ?? c.number;
    if (!t?.lineNo || !owner) continue;
    const k = `${norm(owner)}\u0000${norm(t.lineNo)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const drop = new Set<ContractRec>();
  for (const cs of groups.values()) {
    if (cs.length < 2) continue;
    const revs = cs.map((c) => {
      const r = norm(c.line?.texts.revision ?? "");
      return r === "" ? 0 : /^\d{1,4}$/.test(r) ? Number(r) : null;
    });
    const top = Math.max(...revs.map((r) => r ?? -1));
    if (revs.includes(null) || revs.filter((r) => r === top).length > 1) {
      for (const c of cs) if (c.line) c.line.revisionUnknown = true;
      continue;
    }
    cs.forEach((c, i) => {
      if (revs[i] !== top) drop.add(c);
    });
  }
  if (!drop.size) return;
  for (const c of drop)
    for (const ref of c.line?.cells ?? []) {
      const k = cellKey({ file: c.file, sheetIndex: c.sheetIndex, ref });
      rec.excluded.set(k, ORDER_LINE_EXCLUDE.superseded);
      rec.pending.delete(k);
      rec.pendingBy.delete(k);
    }
  rec.contracts = rec.contracts.filter((c) => !drop.has(c));
}

/** 層 2 の問いの種を質問にし、決定を当てる */
function issuesToQuestions(t: Table, lay: SheetLayout, ask: Asker, exclude: (ref: string, why: string) => void, pend: Pend, formKey: string) {
  for (const is of t.issues) {
    if (is.kind === "levelJump") continue; // 段が決まってから（treeRecords で）
    // 列の役目は様式の決まり：同じ様式の表（年度ごとのシート・帳票の頁）は、同じ列をまとめて 1 回聞く
    const key = `${is.kind}|${is.kind === "columnRole" ? formKey : t.id}|${is.pattern}`;
    const text =
      is.kind === "levelSplit"
        ? `${is.detail}。この行は第何階層か`
        : is.kind === "yearKind"
          ? `${is.detail}。年の列を年度として読むか`
          : is.kind === "blankSameAsAbove"
            ? `${is.detail}は、上の行と同じか`
            : is.kind === "hiddenData"
              ? `${is.detail}。取り込むか`
              : `${is.detail}`;
    // 段の割れ方・年の見出し・空欄の列は、同じ様式の表の同じ書き方をまとめて 1 問にする（列の役目は鍵がもう様式ごと。隠した中身は表ごと）
    const merge =
      is.kind === "levelSplit" || is.kind === "yearKind"
        ? sameForm(is.kind, formKey, is.pattern)
        : is.kind === "blankSameAsAbove"
          ? sameForm(is.kind, formKey, is.pattern, (rows) => `${is.detail.replace(/（\d+ 行）$/u, `（${rows} 行）`)}は、上の行と同じか`)
          : undefined;
    const a = ask.ask(
      key,
      {
        kind: is.kind,
        text,
        options: is.options,
        valueKind: "option",
        defaultAnswer: is.proposal,
        sameShapeRows: Math.max(is.rows.length, 1),
        items: [itemOf(t, is.cells.length ? is.cells : is.rows.map((r) => cellRef(r, 1)))],
      },
      merge,
    );
    if (is.kind === "levelSplit") {
      const lv = a ? Number(a.slice("level:".length)) : null;
      for (const r of t.rows) if (is.rows.includes(r.r)) r.level = lv;
    } else if (is.kind === "yearKind") {
      t.yearKind = a === "fiscal" ? "fiscal" : a === "calendar" ? "calendar" : null;
      if (!a) for (const c of t.cols.filter((x) => x.role === "mark")) pendColumn(t, lay, c, pend, questionIdOf(key));
    } else if (is.kind === "hiddenData") {
      if (a === "exclude") {
        for (const c of t.cols.filter((x) => x.hidden)) for (const r of t.rows) {
          const cell = lay.index.at(r.r, c.c);
          if (cell) exclude(cell.ref, "隠した列（決定で外した）");
        }
        for (const r of t.rows.filter((x) => is.rows.includes(x.r))) for (const cell of lay.index.rowCells(r.r)) exclude(cell.ref, "隠した行（決定で外した）");
      } else if (!a) {
        for (const ref of is.cells) pend(ref, questionIdOf(key));
        for (const r of is.rows) for (const cell of lay.index.rowCells(r)) pend(cell.ref, questionIdOf(key));
      }
    } else if (is.kind === "blankSameAsAbove") {
      (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision ??= new Map();
      (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision?.set(Number(is.pattern.slice(4)), a);
    } else if (is.kind === "columnRole") {
      const c = Number(is.pattern.slice(4));
      const col = t.cols.find((x) => x.c === c);
      if (col) {
        if (isAssignableRole(a) && a !== "exclude") col.role = a;
        else if (a === "exclude") {
          col.role = "unknown";
          for (const r of t.rows) {
            const cell = lay.index.at(r.r, c);
            if (cell) exclude(cell.ref, "役目の決まらない列（決定で外した）");
          }
        } else pendColumn(t, lay, col, pend, questionIdOf(key));
      }
    }
  }
}

function pendColumn(t: Table, lay: SheetLayout, col: ColInfo, pend: Pend, q: string | null = null) {
  for (const r of t.rows) {
    const cell = lay.index.at(r.r, col.c);
    if (cell) pend(cell.ref, q);
  }
}

// ─── 名前の中の機器番号 ───────────────────────────────────────

type TagState = { state: "split"; split: TagSplit } | { state: "keep" } | { state: "undecided"; q: string };

function tagDecision(t: Table, lay: SheetLayout, ask: Asker, rows: { r: number; text: string; ref: string }[], formKey: string): Map<number, TagState> {
  const out = new Map<number, TagState>();
  const byPattern = new Map<string, { r: number; ref: string; split: TagSplit }[]>();
  for (const x of rows) {
    const s = splitTag(x.text);
    if (s) byPattern.set(s.pattern, [...(byPattern.get(s.pattern) ?? []), { r: x.r, ref: x.ref, split: s }]);
  }
  for (const [pattern, items] of byPattern) {
    const sample = items[0]?.split;
    const a = ask.ask(
      `tagSplit|${t.id}|${pattern}`,
      {
        kind: "tagSplit",
        text: `名前の${pattern === "trailingParen" ? "末尾の括弧の中" : "頭"}の英大文字の符号（例「${sample?.tag ?? ""}」）を、機器番号（タグ）として名前から分けるか`,
        options: YES_NO,
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: items.length,
        items: items.map((i) => itemOf(lay, [i.ref], { note: i.split.tag })),
      },
      sameForm("tagSplit", formKey, pattern),
    );
    const q = questionIdOf(`tagSplit|${t.id}|${pattern}`);
    for (const i of items) out.set(i.r, a === "yes" ? { state: "split", split: i.split } : a === "no" ? { state: "keep" } : { state: "undecided", q });
  }
  return out;
}

// ─── 木の表（台帳） ────────────────────────────────────────────

/** 記録に使わないセル（外したもの・値の無い数式） */
type Off = (ref: string) => boolean;

/**
 * 名前の前の号（「1号機ポンプ」「2号機 ポンプ」「1号炉焼却炉本体」）。号の印（号・系）のある書き方だけ（「3段ポンプ」は分けない）。
 * 号の後ろの字は 1 字まで（「系統」「系列」は 2 字）：空白なしで漢字の名前が続くとき、名前の頭を号の字にしない
 */
function splitUnitPrefix(text: string): { name: string; n: number; spelling: string } | null {
  const m = /^(\d{1,3}\s*(?:系統|系列|号\p{Script=Han}|号|系))\s*(\S.*)$/u.exec(nfkc(text).trim());
  if (!m) return null;
  const u = parseUnit(m[1] ?? "");
  return u?.kind === "number" ? { name: (m[2] ?? "").trim(), n: u.n, spelling: u.spelling } : null;
}

/** 「-」だけのセル（号なし・該当なし） */
function isNone(text: string): boolean {
  return /^[-－―—‐ー]+$/u.test(nfkc(text).trim());
}

/** 名前の後ろの号（「ポンプ（1号機）」「ポンプ (1号機)」）。括弧の中が号の書き方なら、名前と号に分ける */
function splitUnitSuffix(text: string): { name: string; n: number } | null {
  const m = /^(.*\S)\s*[(（]([^()（）]+)[)）]$/u.exec(nfkc(text).trim());
  if (!m) return null;
  const u = parseUnit(m[2] ?? "");
  return u?.kind === "number" ? { name: (m[1] ?? "").trim(), n: u.n } : null;
}

/** 「名前の欄が空」の質問の文に並べる行の番号の数 */
const NO_NAME_ROWS_SHOWN = 10;

function treeRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: Pend, off: Off): number {
  // 名前の列は 1 つか、段ごとに名前を書く列の組（どれも名前の列。行ごとに、名前のある列）
  const nameCols = t.cols.filter((c) => c.role === "name");
  const nameCol = nameCols[0];
  if (!nameCol) {
    // 答えが「この表を外す」なら外す（Architect の 51。答えても保留のまま残ると計画を作れない）
    const a = ask.ask(
      `noName|${t.id}`,
      {
        kind: "columnRole",
        text: "名前の列が見つからない表がある",
        options: [{ id: "exclude", label: "この表を外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: t.rows.length,
        items: [itemOf(lay, t.rows.slice(0, 10).map((r) => cellRef(r.r, 1)))],
      },
      sameForm("noName", formKeyOf(rec, t), "-"),
    );
    for (const r of t.rows) for (const cell of lay.index.rowCells(r.r)) (a === "exclude" ? exclude(cell.ref, "名前の列の無い表（決定で外した）") : pend(cell.ref, questionIdOf(`noName|${t.id}`)));
    return order;
  }
  assignParents(t, nameCol.c);
  // 表の上の頭書きに書いた名前（「設備名｜受入供給設備」。設備ごとに 1 シートの台帳）：表の行の親のまとまり。表の段は 1 つ下がる
  const head = t.heading && !off(t.heading.ref) ? t.heading : null;
  const headRec: AssetRec | null = head
    ? { id: `${t.id}:head`, file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, tableId: t.id, shape: "tree", order: order++, level: 1, parentId: null, rawName: head.text, name: head.text, tag: null, tagNumber: null, nameRef: head.ref, series: null, specs: [], installed: null, refs: [head.ref], excluded: null, pending: false }
    : null;
  if (headRec) rec.assets.push(headRec);
  // 段が飛ぶ・親が無い行
  for (const is of t.issues.filter((i) => i.kind === "levelJump")) {
    const a = ask.ask(
      `levelJump|${t.id}|${is.pattern}`,
      {
        kind: "levelJump",
        text: `${is.detail}。どう読むか`,
        options: is.options,
        valueKind: "option",
        defaultAnswer: is.proposal,
        sameShapeRows: is.rows.length,
        items: [itemOf(lay, is.cells)],
      },
      sameForm("levelJump", formKeyOf(rec, t), is.pattern),
    );
    for (const r of t.rows.filter((x) => is.rows.includes(x.r))) {
      if (a === "exclude") r.level = -1;
      else if (!a) r.level = null;
    }
  }
  const dataRows = t.rows.filter((r) => r.role === "data" || r.role === "parent");
  const nameCells = dataRows
    .map((r) => ({ r: r.r, cell: nameCols.map((c) => lay.index.resolved(r.r, c.c)).find((x) => !!x && x.text !== "") ?? null }))
    .filter((x): x is { r: number; cell: NonNullable<typeof x.cell> } => !!x.cell && x.cell.text !== "");
  const tags = tagDecision(t, lay, ask, nameCells.map((x) => ({ r: x.r, text: x.cell.text, ref: x.cell.ref })), formKeyOf(rec, t));
  // 号・系列の列：数の号と共通（〃 は上の行と同じ、「-」は号なし）
  const unitCol = t.cols.find((c) => c.role === "unit");
  let prevSeries: Series | null = null;
  let prevInstalled: number | null = null;
  const idOf = (r: number) => `${t.id}:r${r}`;
  const yearUnknown: { ref: string; text: string }[] = [];
  // 名前の欄の 〃 を先に解く：同じ親の下の同じ段の上の行の名前。上の行が無いものはまとめて 1 回聞く
  const resolvedName = new Map<number, string | null>();
  const lastAt = new Map<string, string>();
  const orphans: { r: number; ref: string; above: string | null }[] = [];
  let aboveName: string | null = null;
  for (const r of dataRows) {
    // 本処理で資産にならない行（決定で外した行・名前の欄を外した行・段を外した行）は、〃 の参照先にしない。
    // そのすぐ下の 〃 には「すぐ上の行と同じ」を出さない（外した行を飛ばして別の行を「すぐ上」と言わない）
    const nc = nameCells.find((x) => x.r === r.r)?.cell;
    if (r.level === -1 || lay.index.rowCells(r.r).every((c) => off(c.ref)) || (nc && off(nc.ref))) {
      aboveName = null;
      continue;
    }
    if (!nc) continue;
    const k = `${r.level}|${r.parentRow ?? ""}`;
    let nm: string | null = nc.text.replace(/\s*\n\s*/g, " ").trim();
    if (cue.isDitto(nc.text)) {
      nm = r.level === null ? null : (lastAt.get(k) ?? null);
      if (r.level !== null && nm === null) orphans.push({ r: r.r, ref: nc.ref, above: aboveName });
      resolvedName.set(r.r, nm);
    }
    if (nm !== null) {
      lastAt.set(k, nm);
      aboveName = nm;
    }
  }
  let orphanAnswer: string | null = null;
  if (orphans.length) {
    const canAbove = orphans.every((o) => o.above !== null);
    // 鍵に孤立した行の組と「上と同じ」を出せるかを入れる（組が変わったら聞き直す）
    const group = questionIdOf(`${orphans.map((o) => o.r).join(",")}|${canAbove ? "above" : "no-above"}`).slice(2, 14);
    const example = orphans[0]?.above ?? "なし";
    orphanAnswer = ask.ask(
      `dittoNoAbove|${t.id}|${group}`,
      {
        kind: "stray",
        text: `名前の欄の「〃」で、同じ親の下の同じ階層に上の行が無いものが ${orphans.length} 行ある（例：すぐ上の行は「${example}」）。どう読むか`,
        options: [
          ...(canAbove ? [{ id: "above", label: "すぐ上の行と同じ名前として読む" }] : []),
          { id: "literal", label: "「〃」の文字のまま名前にする" },
          { id: "exclude", label: "外す" },
        ],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: orphans.length,
        items: orphans.map((o) => itemOf(lay, [o.ref], { note: o.above ?? "" })),
      },
      sameForm("dittoNoAbove", formKeyOf(rec, t), canAbove ? "above" : "no-above", (rows) => `名前の欄の「〃」で、同じ親の下の同じ階層に上の行が無いものが ${rows} 行ある（例：すぐ上の行は「${example}」）。どう読むか`),
    );
  }
  // 名前の無い行（ほかの列だけに中身がある）：表ごとに 1 回聞く。文に資料・シート・行の番号を添える（人が資料を開いて探せるように）
  const noNameRows: { r: number; cells: GridCell[] }[] = [];
  for (const r of dataRows) {
    const cells = lay.index.rowCells(r.r);
    if (cells.every((c) => off(c.ref))) continue;
    const nc = nameCells.find((x) => x.r === r.r)?.cell;
    if (!nc || off(nc.ref)) {
      noNameRows.push({ r: r.r, cells });
      continue;
    }
    if (r.level === -1) {
      for (const c of cells) exclude(c.ref, "階層の決まらない行（決定で外した）");
      continue;
    }
    const ts = tags.get(r.r);
    const tagged = ts?.state === "split" ? ts.split : null;
    const tagUndecided = ts?.state === "undecided";
    // 〃：同じ親の下の同じ段の上の行と同じ名前（名前だけ同じの別の行）。段の決まらない行は、段の質問を先にする
    const dittoName = cue.isDitto(nc.text);
    let prevName = r.level === null ? null : (resolvedName.get(r.r) ?? null);
    let dittoPending = false;
    let literalDitto = false;
    const orphan = orphans.find((o) => o.r === r.r);
    if (orphan) {
      if (orphanAnswer === "exclude") {
        for (const c of cells) if (!off(c.ref)) exclude(c.ref, "上の行の無い 〃（決定で外した）");
        continue;
      }
      if (orphanAnswer === "above" && orphan.above !== null) prevName = orphan.above;
      else if (orphanAnswer === "literal") literalDitto = true;
      else dittoPending = true; // 答えを待つ（「上と同じ」でも上の行が無ければここ）：資産は未解決のまま置く（子の行の親が欠けないように）
    }
    const raw = dittoName && !literalDitto ? (prevName ?? nc.text) : nc.text.replace(/\s*\n\s*/g, " ").trim();
    // 名前の中の号：番号を分けた名前（「1号炉ストーカ（STK-1）」→「1号炉ストーカ」）からも分ける
    const unitInName = tagged ? (splitUnitSuffix(tagged.name) ?? splitUnitPrefix(tagged.name)) : (splitUnitSuffix(raw) ?? splitUnitPrefix(raw));
    const name = unitInName ? unitInName.name : tagged ? tagged.name : raw;
    const a: AssetRec = {
      id: idOf(r.r),
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      shape: "tree",
      order: order++,
      level: r.level === null ? 0 : r.level + (headRec ? 1 : 0),
      parentId: r.parentRow ? idOf(r.parentRow) : (headRec?.id ?? null),
      rawName: raw,
      name,
      tag: tagged ? tagged.tag : null,
      tagNumber: tagged ? tagTrailingNumber(tagged.tag) : null,
      nameRef: nc.ref,
      series: null,
      specs: [],
      installed: null,
      refs: [nc.ref],
      excluded: null,
      pending: r.level === null || tagUndecided || dittoPending,
    };
    if (unitInName) a.series = { kind: "number", n: unitInName.n };
    for (const c of cells) {
      if (nameCols.some((k) => k.c === c.c) || off(c.ref)) continue;
      const col = t.cols.find((k) => k.c === c.c);
      const key = col?.header || `列${c.c}`;
      if (!col || col.role === "unknown") {
        pend(c.ref);
        continue;
      }
      if (col === unitCol && !isNone(c.text)) {
        const u = parseUnit(c.text);
        const s: Series | null | undefined = !u ? undefined : u.kind === "ditto" ? prevSeries : u.kind === "common" ? { kind: "common", meaning: "" } : { kind: "number", n: u.n };
        if (s !== undefined) {
          a.series = s;
          prevSeries = s;
          a.refs.push(c.ref);
          continue;
        }
      }
      if (col.role === "installed" && cue.isDitto(c.text) && prevInstalled !== null) {
        // 設置年の 〃：上の行と同じ年
        a.installed = { year: prevInstalled, ref: c.ref };
        a.refs.push(c.ref);
        continue;
      }
      // 機器番号の列：名前から番号を分けていなければ、その番号を機器の番号にする（分けていれば仕様として持つ）
      if (col.role === "tag" && !a.tag) {
        const tag = nfkc(c.text).trim();
        a.tag = tag;
        a.tagNumber = tagTrailingNumber(tag);
        a.refs.push(c.ref);
        continue;
      }
      if (col.role === "installed") {
        const y = parseYearOnly(typeof c.value === "number" ? c.value : c.text);
        if (y !== null) {
          a.installed = { year: y, ref: c.ref };
          a.refs.push(c.ref);
          prevInstalled = y;
        } else yearUnknown.push({ ref: c.ref, text: c.text });
        continue;
      }
      a.specs.push({ key, value: c.text, ref: c.ref });
      a.refs.push(c.ref);
    }
    // 機器番号の分け方だけを待っている行は、その質問が決める
    const waiting = ts?.state === "undecided" && r.level !== null && !dittoPending ? ts.q : null;
    if (a.pending) for (const ref of a.refs) pend(ref, waiting);
    rec.assets.push(a);
  }
  if (noNameRows.length) {
    // 答えが「外す」なら外す（Architect の 51）。質問の鍵は表ごと（文の行の番号が変わっても、前の答えが効く）
    const shown = noNameRows.slice(0, NO_NAME_ROWS_SHOWN).map((x) => x.r);
    const more = noNameRows.length - shown.length;
    const where = `${lay.file}${lay.sheet ? `「${lay.sheet}」` : ""}の ${shown.join("・")}${more > 0 ? ` ほか ${more}` : ""} 行目`;
    const a = ask.ask(
      `noNameRow|${t.id}`,
      {
        kind: "stray",
        text: `名前の欄が空で、ほかの欄だけに中身がある行がある（${where}。${noNameRows.length} 行）`,
        options: [{ id: "exclude", label: "外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: noNameRows.length,
        items: noNameRows.map((x) => itemOf(lay, x.cells.map((c) => c.ref))),
      },
      sameForm("noNameRow", formKeyOf(rec, t), "-", (rows) => `名前の欄が空で、ほかの欄だけに中身がある行がある（${rows} 行）`),
    );
    for (const x of noNameRows) for (const c of x.cells) if (!off(c.ref)) (a === "exclude" ? exclude(c.ref, "名前の欄が空の行（決定で外した）") : pend(c.ref, questionIdOf(`noNameRow|${t.id}`)));
  }
  // 年として読めない設置年：書き方ごとにまとめて聞く（日付に見えない書き方を年と決めつけない）
  const byShape = new Map<string, { ref: string; text: string }[]>();
  for (const y of yearUnknown) byShape.set(shapeOf(y.text), [...(byShape.get(shapeOf(y.text)) ?? []), y]);
  for (const [shape, ys] of byShape) {
    const ans = ask.ask(
      `yearUnknown|${t.id}|${shape}`,
      {
        kind: "yearUnknown",
        text: `年の欄に、年として読めない書き方がある（例「${ys[0]?.text ?? ""}」）。どう扱うか`,
        options: [
          { id: "spec", label: "年にせず、仕様の文として持つ" },
          { id: "exclude", label: "外す" },
        ],
        valueKind: "option",
        defaultAnswer: "spec",
        sameShapeRows: ys.length,
        items: ys.map((y) => itemOf(lay, [y.ref])),
      },
      sameForm("yearUnknown", formKeyOf(rec, t), `${t.cols.find((k) => k.role === "installed")?.c ?? "-"}|${shape}`),
    );
    for (const y of ys) {
      const owner = rec.assets.find((x) => x.tableId === t.id && Number(/\d+$/.exec(y.ref)?.[0]) === Number(/\d+$/.exec(x.nameRef)?.[0]));
      if (ans === "spec" && owner) {
        const col = t.cols.find((k) => k.role === "installed");
        owner.specs.push({ key: col?.header || "年", value: y.text, ref: y.ref });
        owner.refs.push(y.ref);
      } else if (ans === "exclude") exclude(y.ref, "年として読めない（決定で外した）");
      else pend(y.ref);
    }
  }
  return order;
}

// ─── 星取表の形 ────────────────────────────────────────────────

/** 行ごとの周期（「周期(年)」「周期」の列）：その行の作業の暦のきっかけ。数だけの書き方は見出しの単位で読む。読めない書き方（「毎回」）は推し量らず、同じ様式の表をまとめて聞く */
function readCycles(t: Table, lay: SheetLayout, ask: Asker, rec: Records, rows: number[], exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): Map<number, CycleSpan> {
  const out = new Map<number, CycleSpan>();
  const cycleCol = t.cols.find((c) => c.role === "cycle");
  if (!cycleCol) return out;
  const unit = cycleHeaderUnit(cycleCol.header);
  const bad: { ref: string; text: string }[] = [];
  for (const r of rows) {
    const c = lay.index.at(r, cycleCol.c);
    if (!c || c.text.trim() === "" || off(c.ref)) continue;
    const sp = parseCycle(typeof c.value === "number" ? String(c.value) : c.text, unit);
    if (sp) out.set(r, sp);
    else bad.push({ ref: c.ref, text: c.text });
  }
  if (bad.length) {
    const a = ask.ask(`cycleBad|${rec.formOf.get(t.id)?.key ?? t.id}|${cycleCol.c}`, {
      kind: "cycleText",
      text: `「${cycleCol.header.replace(/\s*\n\s*/g, "")}」の列に、周期として読めない書き方がある（${bad.length} 行、見本 ${[...new Set(bad.map((b) => b.text))].slice(0, 3).map((x) => `「${x}」`).join("")}）。周期を推し量らない`,
      options: [{ id: "none", label: "その行の作業に周期を置かない（理由を残す）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: bad.length,
      items: [itemOf(lay, bad.slice(0, 10).map((b) => b.ref))],
    });
    for (const b of bad) {
      if (a === "none") exclude(b.ref, "周期として読めない書き方（決定で周期を置かない）");
      else pend(b.ref);
    }
  }
  return out;
}

/**
 * 行ごとの費用（費用の列）。単位は見出しから（「千円」「円」）、決まらなければ件数を添えて聞く。税込・税抜も見出しから、決まらなければ聞く。
 * 読めない書き方は推し量らず聞き、外すと答えたら理由つきで外す。値は円の整数
 */
function readCosts(t: Table, lay: SheetLayout, ask: Asker, rec: Records, rows: number[], exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): Map<number, CostCell> {
  const out = new Map<number, CostCell>();
  // 費用の列がいくつもあるとき（発注台帳の「予定価格」「契約金額」「支払額」）：実際に払った額に近い列を選ぶ（支払・実績 → 契約 → そのほか → 予定・概算・見積）。
  // 選んだ列は costSource のセルで分かる。ほかの費用の列は読まない（行の中のセルとして読取に数える）
  const rank = (h: string) => (/支払|実績/u.test(h) ? 3 : /契約|請負/u.test(h) ? 2 : /予定|概算|見積|予算/u.test(h) ? 0 : 1);
  const col = t.cols.filter((c) => c.role === "cost").sort((a, b) => rank(b.header) - rank(a.header))[0];
  if (!col) return out;
  const header = col.header.replace(/\s*\n\s*/g, "");
  const key = `${rec.formOf.get(t.id)?.key ?? t.id}|${col.c}`;
  const cells = rows.map((r) => lay.index.at(r, col.c)).filter((c): c is GridCell => !!c && c.text.trim() !== "" && !off(c.ref));
  if (!cells.length) return out;
  // 費用の列が予定・概算・見積・予算だけ：実績の費用にしない。計画（予算）として読むかを 1 回聞く（Architect の 45。既定は計画としてだけ読む）
  let planOnly = false;
  if (rank(col.header) === 0) {
    const a = ask.ask(`costKind|${key}`, {
      kind: "costKind",
      text: `費用の列が「${header}」だけ（${cells.length} 行）。実績の費用ではない`,
      options: [
        { id: "plan", label: "予算として読む" },
        { id: "actual", label: "予算と実績として読む" },
        { id: "none", label: "この列を読まない" },
      ],
      valueKind: "option",
      defaultAnswer: "plan",
      sameShapeRows: cells.length,
      items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
    });
    if (a === "none") {
      for (const c of cells) exclude(c.ref, "費用の列（予定・見積の列なので読まない）");
      return out;
    }
    if (a === null) {
      for (const c of cells) pend(c.ref);
      return out;
    }
    planOnly = a === "plan";
  }
  let unit = costHeaderUnit(col.header);
  if (unit === null) {
    const a = ask.ask(`costUnit|${key}`, {
      kind: "costUnit",
      text: `「${header}」の列の金額の単位が、見出しに書いてない（${cells.length} 行）。単位を推し量らない`,
      options: [
        { id: "1", label: "円" },
        { id: "1000", label: "千円" },
        { id: "10000", label: "万円" },
        { id: "none", label: "この列を読まない（理由を残す）" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: cells.length,
      items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
    });
    if (a === "none") {
      for (const c of cells) exclude(c.ref, "費用の列（単位が決まらないので読まない）");
      return out;
    }
    if (a === null) {
      for (const c of cells) pend(c.ref);
      return out;
    }
    unit = Number(a);
  }
  let tax = costHeaderTax(col.header);
  if (tax === null) {
    const a = ask.ask(`costTax|${key}`, {
      kind: "costTax",
      text: `「${header}」の列の金額が税込か税抜か、見出しに書いてない（${cells.length} 行）`,
      options: [
        { id: "incl", label: "税込" },
        { id: "excl", label: "税抜" },
        { id: "unknown", label: "資料に書いていない（そのまま読む）" },
      ],
      valueKind: "option",
      defaultAnswer: "unknown",
      sameShapeRows: cells.length,
      items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
    });
    if (a === null) {
      for (const c of cells) pend(c.ref);
      return out;
    }
    tax = a === "incl" || a === "excl" ? a : null;
  }
  const bad: GridCell[] = [];
  for (const c of cells) {
    const yen = parseCost(c.text, c.value, unit);
    if (yen === null) bad.push(c);
    else out.set(c.r, { yen, ref: c.ref, text: c.text, tax: tax ?? "unknown", ...(planOnly ? { planOnly: true as const } : {}) });
  }
  if (bad.length) {
    const a = ask.ask(`costBad|${key}`, {
      kind: "costBad",
      // 費用の字は AI に渡さない（見本を出さず、件数だけ。Architect の注文 1）
      text: `「${header}」の列に、金額として読めない書き方がある（${bad.length} 行）。金額を推し量らない`,
      options: [{ id: "none", label: "その行の費用を置かない（理由を残す）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: bad.length,
      items: [itemOf(lay, bad.slice(0, 10).map((b) => b.ref))],
    });
    for (const b of bad) {
      if (a === "none") exclude(b.ref, "金額として読めない書き方（決定で費用を置かない）");
      else pend(b.ref);
    }
  }
  return out;
}

function gridRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: Pend, off: Off): number {
  const hier = t.cols.filter((c) => c.role === "hier").sort((a, b) => (a.hierLevel ?? 0) - (b.hierLevel ?? 0));
  const unitCol = t.cols.find((c) => c.role === "unit");
  const marks = t.cols.filter((c) => c.role === "mark");
  const specCols = t.cols.filter((c) => c.role === "spec" || c.role === "remark" || c.role === "quantity" || c.role === "installed" || c.role === "number");
  const tagCol = t.cols.find((c) => c.role === "tag");
  // 行ごとの作業の列（行が「機器 × 作業」の星取表）
  const workCol = t.cols.find((c) => c.role === "workName");
  const rowWork = (r: number) => {
    const c = workCol ? lay.index.at(r, workCol.c) : null;
    return c && c.text.trim() !== "" && !off(c.ref) ? c : null;
  };
  // 行ごとの予定・実績（予定の段と実績の段に分けて書く書き方）
  const paCol = t.cols.find((c) => c.role === "planActual");
  const rowPA = (r: number) => {
    const c = paCol ? lay.index.at(r, paCol.c) : null;
    return c ? cue.planActual(c.text) : null;
  };
  rec.levelNames.set(t.id, hier.map((h) => h.header));
  const years = marks.map((m) => m.fiscalYear ?? 0);
  if (years.length) rec.gridYears.set(t.id, { from: Math.min(...years), to: Math.max(...years) });
  const blankDecision = (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision ?? new Map<number, string | null>();
  // 金額の行（2 段の書き方の下の段）は、機器の行でも星取の行でもない（上の行の内容の費用）
  const amountRows = t.amountRows ?? new Map<number, number>();
  // 表の上の題・注記に書いた凡例の符号（「重要度 A：安全・環境・共通系　B：…」）
  const legendCodes = codeLegend([...lay.titles, ...lay.notes].map((x) => x.text));
  const data = t.rows.filter((r) => r.role === "data" && !amountRows.has(r.r));
  // 号炉・系統の列の位置：階層の列のあいだ（「設備｜機器｜号炉・系統｜部位」）なら、その左の階層（機器）の系列。
  // 階層の列より右か左なら、葉（いちばん下の階層）の系列（これまでの書き方）
  const leftOfUnit = unitCol ? hier.filter((h) => h.c < unitCol.c).length - 1 : -1;
  const seriesIdx = leftOfUnit >= 0 && leftOfUnit < hier.length - 1 ? leftOfUnit : hier.length - 1;
  // 号炉・系統の欄に号炉と号機を並べた書き方（「1号炉 No.1」）の号機：機器の側の番号（号炉ではない）
  const machineOf = new Map<number, string>();
  // 号の列：〃 は上と同じ、共通は意味を聞く
  let commonMeaning: string | null | undefined;
  const commonCells: string[] = [];
  const unitBad: string[] = [];
  const unitOf = new Map<number, Series | null | undefined>();
  if (unitCol) {
    let prev: Series | null | undefined = null;
    for (const r of data) {
      const cell = lay.index.resolved(r.r, unitCol.c);
      if (!cell || cell.text === "") {
        unitOf.set(r.r, null);
        prev = null;
        continue;
      }
      let u: UnitValue | null = parseUnit(cell.text);
      if (!u) {
        const sp = splitSeriesCell(cell.text);
        if (sp) {
          u = sp.unit;
          if (sp.machine) machineOf.set(r.r, sp.machine);
        }
      }
      if (!u) {
        unitBad.push(cell.ref);
        unitOf.set(r.r, undefined);
        prev = undefined;
        continue;
      }
      if (u.kind === "ditto") {
        unitOf.set(r.r, prev);
        continue;
      }
      if (u.kind === "common") {
        commonCells.push(cell.ref);
        prev = { kind: "common", meaning: "" };
      } else prev = { kind: "number", n: u.n };
      unitOf.set(r.r, prev);
    }
    if (commonCells.length) {
      commonMeaning = ask.ask(
        `commonMeaning|${t.id}`,
        {
          kind: "commonMeaning",
          text: `「${unitCol.header}」の列の「共通」（${commonCells.length} 行）は、どの意味の共通か`,
          options: cue.commonMeanings.map((m) => ({ id: m.id, label: m.label })),
          valueKind: "option",
          defaultAnswer: "facility",
          sameShapeRows: commonCells.length,
          items: [itemOf(lay, [...new Set(commonCells)].slice(0, 10))],
        },
        sameForm("commonMeaning", formKeyOf(rec, t), String(unitCol.c), (rows) => `「${unitCol.header}」の列の「共通」（${rows} 行）は、どの意味の共通か`),
      );
      for (const [r, s] of unitOf) if (s?.kind === "common") unitOf.set(r, commonMeaning ? { kind: "common", meaning: commonMeaning } : undefined);
    }
    if (unitBad.length) {
      const a = ask.ask(
        `unitUnknown|${t.id}`,
        {
          kind: "unitMissing",
          text: `「${unitCol.header}」の列に、号として読めない書き方がある（${unitBad.length} 行）`,
          options: [{ id: "none", label: "号なしとして読む" }],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: unitBad.length,
          items: [itemOf(lay, unitBad.slice(0, 10))],
        },
        sameForm("unitUnknown", formKeyOf(rec, t), String(unitCol.c), (rows) => `「${unitCol.header}」の列に、号として読めない書き方がある（${rows} 行）`),
      );
      if (a === "none") for (const [r, s] of unitOf) if (s === undefined) unitOf.set(r, null);
    }
  }
  // 段の節：同じ道の節は 1 つ
  const nodeOf = new Map<string, AssetRec>();
  const rowNode = new Map<number, AssetRec | null>();
  const pathPrev: (string | null)[] = hier.map(() => null);
  const pathPrevRef: (string | null)[] = hier.map(() => null);
  const leafCol = hier[hier.length - 1];
  let prevLeaf: { r: number; node: AssetRec } | null = null;
  // 直前の行の機器（作業だけを書いた行が、上の行の機器の別の作業として使う）
  let lastLeaf: AssetRec | null = null;
  // まとまりの見出しの行（名前の列が 1 つの星取表で、名前だけを書いて印の無い行。「受入供給設備」）：下の行の親になる
  const isSection = (r: number) => {
    if (hier.length !== 1) return false;
    const cs = lay.index.rowCells(r).filter((c) => c.text !== "" && !off(c.ref));
    return cs.length === 1 && cs[0]?.c === hier[0]?.c;
  };
  let group: AssetRec | null = null;
  for (const r of data) {
    if (lay.index.rowCells(r.r).every((c) => off(c.ref))) {
      rowNode.set(r.r, null);
      prevLeaf = null;
      continue;
    }
    if (isSection(r.r)) {
      const cell = lay.index.at(r.r, hier[0]?.c ?? 0);
      if (cell) {
        const name = cell.text.replace(/\s*\n\s*/g, " ").trim();
        group = { id: `${t.id}:g${r.r}`, file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, tableId: t.id, shape: "grid", order: order++, level: 1, parentId: null, rawName: name, name, tag: null, tagNumber: null, nameRef: cell.ref, series: null, specs: [], installed: null, refs: [cell.ref], excluded: null, pending: false };
        rec.assets.push(group);
      }
      rowNode.set(r.r, null);
      prevLeaf = null;
      lastLeaf = null;
      for (let k = 0; k < hier.length; k++) {
        pathPrev[k] = null;
        pathPrevRef[k] = null;
      }
      continue;
    }
    const offset = group ? 1 : 0;
    // 名前の無い続きの段：葉の名前の欄が空で（結合でもなく）、すぐ上の行が機器の行で、2 つの行の予定・実績が違う。
    // 予定の段と実績の段に分けて書く書き方の 2 段目。上の行の機器の印として読む
    const leafCell = leafCol ? lay.index.at(r.r, leafCol.c) : null;
    const leafMerged = leafCol ? lay.index.merge(r.r, leafCol.c) : null;
    const pa = rowPA(r.r);
    if (paCol && leafCol && (!leafCell || leafCell.text === "") && !leafMerged && prevLeaf && pa !== null && rowPA(prevLeaf.r) !== null && rowPA(prevLeaf.r) !== pa) {
      const pc = lay.index.at(r.r, paCol.c);
      if (pc && !prevLeaf.node.refs.includes(pc.ref)) prevLeaf.node.refs.push(pc.ref);
      rowNode.set(r.r, prevLeaf.node);
      continue;
    }
    let parent = group as AssetRec | null;
    let node = null as AssetRec | null;
    let undecided = false;
    // 作業だけを書いた行（機器の名前の欄が空で、結合でもなく、作業の欄がある）：上の行と同じ機器か（答えに従う）
    const workOnly = !!workCol && !!leafCol && (!leafCell || leafCell.text === "") && !leafMerged && !!rowWork(r.r) && !!lastLeaf;
    const workOnlyAnswer = workOnly && leafCol ? blankDecision.get(leafCol.c) : undefined;
    // 行が「機器 × 作業」の星取表で、機器の欄の「〃」と作業の欄がある行：上の行と同じ機器の別の作業（作業の列が無い星取表の「〃」は、名前だけ同じ別の機器）
    const dittoSame = !!workCol && !!leafCell && cue.isDitto(leafCell.text) && !!rowWork(r.r) && !!lastLeaf;
    if (dittoSame && lastLeaf) {
      node = lastLeaf;
      if (leafCell && !node.refs.includes(leafCell.ref)) node.refs.push(leafCell.ref);
    } else if (workOnly && workOnlyAnswer !== "none") {
      if (workOnlyAnswer === "same") node = lastLeaf;
      else undecided = true;
    } else for (let i = 0; i < hier.length; i++) {
      const col = hier[i];
      if (!col) continue;
      const own = lay.index.at(r.r, col.c);
      const merged = lay.index.merge(r.r, col.c);
      let text: string | null = null;
      let ref: string | null = null;
      let dittoRef: string | null = null;
      const isLeafCol = i === hier.length - 1;
      if (own && cue.isDitto(own.text)) {
        // 〃：上の行と同じ名前。上の段の節は同じ節（〃 のセルも出どころに足す）、葉は名前だけ同じの別の行
        if (pathPrev[i]) {
          text = pathPrev[i] ?? null;
          ref = isLeafCol ? own.ref : (pathPrevRef[i] ?? null);
          dittoRef = isLeafCol ? null : own.ref;
        } else undecided = true;
      } else if (own && own.text !== "") {
        text = own.text;
        ref = own.ref;
      } else if (merged) {
        const master = lay.index.at(merged.top, merged.left);
        if (master && master.text !== "") {
          text = master.text;
          ref = master.ref;
        }
      } else if (i < hier.length - 1 && pathPrev[i]) {
        const d = blankDecision.get(col.c);
        if (d === "same") {
          text = pathPrev[i] ?? null;
          ref = pathPrevRef[i] ?? null;
        } else if (d === undefined || d === null) undecided = true;
      }
      if (text === null || ref === null) {
        if (i === hier.length - 1) break;
        continue;
      }
      // 上の段の節が変わったときだけ、下の段の「上の行」を忘れる（結合の中の行では同じ節のまま）
      if (pathPrev[i] !== text || pathPrevRef[i] !== ref)
        for (let k = i + 1; k < hier.length; k++) {
          pathPrev[k] = null;
          pathPrevRef[k] = null;
        }
      pathPrev[i] = text;
      pathPrevRef[i] = ref;
      const isLeaf = i === hier.length - 1;
      const isSeriesCol = i === seriesIdx;
      const series = isSeriesCol ? (unitCol ? unitOf.get(r.r) : null) : null;
      const machine = isSeriesCol && !isLeaf ? (machineOf.get(r.r) ?? null) : null;
      // 機器の階層（号炉・系統の列のすぐ左）の節は、同じ親の下の同じ名前・号炉・号機で 1 つ（頁ごとに書き直した結合も同じ機器）。
      // それより上の階層（設備）の節も、同じ親の下の同じ名前で 1 つ。号炉・系統の列の無い表は、これまでどおり結合ごと
      const key = isLeaf
        ? `${parent?.id ?? ""}>${norm(text)}#${seriesKey(series ?? null)}#r${r.r}`
        : isSeriesCol
          ? `${parent?.id ?? ""}>${norm(text)}#${seriesKey(series ?? null)}#${machine ?? ""}`
          : seriesIdx < hier.length - 1 && i < seriesIdx
            ? `${parent?.id ?? ""}>${norm(text)}`
            : `${parent?.id ?? ""}>${norm(text)}@${ref}`;
      let n = nodeOf.get(key);
      if (!n) {
        const whole = text.replace(/\s*\n\s*/g, " ").trim();
        // 葉の名前の後ろの号（「ポンプ（1号機）」）：号の列が無いか空なら、名前から号を分ける
        const sfx = isLeaf && isSeriesCol && (series === null || series === undefined) ? splitUnitSuffix(whole) : null;
        // 機器の系列を号炉・系統の列から決めた表の葉：名前の中の号炉（その行の号炉と同じもの）と号機（「1号炉 No.1 減温塔噴霧P」）を名前から分ける。号機は葉の番号
        const rowSeries = seriesIdx < hier.length - 1 ? unitOf.get(r.r) : null;
        const inName = isLeaf && !isSeriesCol ? splitNameUnits(whole) : null;
        const units = inName && (inName.unit === null || (rowSeries?.kind === "number" && rowSeries.n === inName.unit)) ? inName : null;
        const named = sfx ? sfx.name : units ? units.name : whole;
        // 凡例で決めた頭の符号（「重要度 A：安全…　B：…」の「A：」）：名前から分け、凡例の題を項目にして仕様に残す
        const code = codePrefix(named, legendCodes);
        const raw = code ? code.name : named;
        n = {
          // 1 つの結合に号炉・号機の違う機器がいくつもあるとき（機器群の結合の右に「1号炉 No.2」「2号炉 No.1」…）、節は号炉・号機ごと
          id: isLeaf ? `${t.id}:r${r.r}` : isSeriesCol && seriesIdx < hier.length - 1 ? `${t.id}:h${col.hierLevel}:${ref}#${seriesKey(series ?? null)}#${machine ?? ""}` : `${t.id}:h${col.hierLevel}:${ref}`,
          file: lay.file,
          sheet: lay.sheet,
          sheetIndex: lay.sheetIndex,
          tableId: t.id,
          shape: "grid",
          order: order++,
          level: (col.hierLevel ?? i + 1) + offset,
          parentId: parent?.id ?? null,
          rawName: raw,
          name: raw,
          tag: machine ?? units?.machine ?? null,
          tagNumber: null,
          nameRef: ref,
          series: sfx ? { kind: "number", n: sfx.n } : (series ?? null),
          specs: code ? [{ key: code.title, value: code.value, ref }] : [],
          installed: null,
          refs: [ref],
          excluded: null,
          pending: !sfx && series === undefined,
        };
        if (isSeriesCol && unitCol) {
          const uc = isLeaf ? lay.index.at(r.r, unitCol.c) : lay.index.resolved(r.r, unitCol.c);
          if (uc && (isLeaf || !n.refs.includes(uc.ref))) n.refs.push(uc.ref);
        }
        nodeOf.set(key, n);
        rec.assets.push(n);
      } else if (!isLeaf) {
        // 同じ節を別の所に書き直したもの（頁ごとに書き直した設備・機器の結合）：そのセルも出どころに足す
        if (!n.refs.includes(ref)) n.refs.push(ref);
        const uc = isSeriesCol && unitCol ? lay.index.resolved(r.r, unitCol.c) : null;
        if (uc && !n.refs.includes(uc.ref)) n.refs.push(uc.ref);
      }
      if (dittoRef && !n.refs.includes(dittoRef)) n.refs.push(dittoRef);
      parent = n;
      node = n;
    }
    if (undecided) {
      // この行の段が決まらない（空欄の上と同じ・〃 の答え待ち）。上の段の節は決まっているので、この行だけを未解決にする
      for (const c of lay.index.rowCells(r.r)) if (!off(c.ref)) pend(c.ref);
      rowNode.set(r.r, null);
      continue;
    }
    if (node) {
      for (const sc of specCols) {
        const c = lay.index.at(r.r, sc.c);
        if (c && c.text !== "" && !off(c.ref)) {
          node.specs.push({ key: sc.header || `列${sc.c}`, value: c.text, ref: c.ref });
          node.refs.push(c.ref);
        }
      }
      if (tagCol) {
        const c = lay.index.at(r.r, tagCol.c);
        if (c && c.text !== "" && !off(c.ref)) {
          if (!node.tag) {
            node.tag = nfkc(c.text).trim();
            node.tagNumber = tagTrailingNumber(node.tag);
          } else node.specs.push({ key: tagCol.header || `列${tagCol.c}`, value: c.text, ref: c.ref });
          node.refs.push(c.ref);
        }
      }
      if (paCol) {
        const c = lay.index.at(r.r, paCol.c);
        if (c && !off(c.ref) && !node.refs.includes(c.ref)) node.refs.push(c.ref);
      }
      if (node.pending) for (const ref of node.refs) pend(ref);
    } else for (const c of lay.index.rowCells(r.r)) pend(c.ref);
    rowNode.set(r.r, node);
    prevLeaf = node && node.level === (leafCol?.hierLevel ?? -1) + offset ? { r: r.r, node } : null;
    if (prevLeaf) lastLeaf = prevLeaf.node;
  }
  // 行ごとの周期（「周期(年)」）：その行の作業の暦のきっかけ。数だけの書き方は見出しの単位で読む。読めない書き方は推し量らず聞く
  const cycleOf = readCycles(t, lay, ask, rec, data.map((r) => r.r), exclude, pend, off);
  const cycleCol = t.cols.find((c) => c.role === "cycle");
  if (cycleCol)
    for (const r of cycleOf.keys()) {
      const node = rowNode.get(r);
      const ref = lay.index.at(r, cycleCol.c)?.ref;
      if (node && ref && !node.refs.includes(ref)) node.refs.push(ref);
    }
  // 行ごとの費用（「概算費用(千円/回)」）：その行の印（1 回ごと）の作業明細の費用。印や作業にはしない
  const costOf = readCosts(t, lay, ask, rec, data.map((r) => r.r), exclude, pend, off);
  for (const [r, c] of costOf) {
    const node = rowNode.get(r);
    if (node && !node.refs.includes(c.ref)) node.refs.push(c.ref);
  }
  // 2 段の書き方（年の欄に整備の内容、その下の行に金額）：内容のセルを星取として読む。金額はその費用
  const content = amountRows.size ? contentMarks(t, lay, ask, rec, data, rowNode, marks, amountRows, exclude, pend, off) : null;
  // 印
  const legend = t.legend;
  for (const r of data) {
    for (const col of marks) {
      const cell = lay.index.at(r.r, col.c);
      if (!cell || cell.text === "" || off(cell.ref)) continue;
      if (content?.has(cell.ref)) continue;
      const sym = nfkc(cell.text);
      const node = rowNode.get(r.r) ?? null;
      const m: MarkRec = {
        id: `${t.id}:m:${cell.ref}`,
        file: lay.file,
        sheet: lay.sheet,
        sheetIndex: lay.sheetIndex,
        tableId: t.id,
        ref: cell.ref,
        row: r.r,
        symbol: sym,
        fiscalYear: col.fiscalYear ?? 0,
        planOrActual: null,
        workName: null,
        workRef: null,
        ...(cycleOf.has(r.r) ? { cycle: cycleOf.get(r.r) } : {}),
        ...(costOf.has(r.r) ? { cost: costOf.get(r.r) } : {}),
        assetId: node?.id ?? null,
        excluded: null,
        pending: !node || node.pending || t.yearKind === null,
        // 暦年と答えた表の印：日付が無いので年度を決められない。年度 Y として読み、根拠に残す（Architect の 58）
        ...(t.yearKind === "calendar" ? { calendarYear: true as const } : {}),
      };
      const entry = legend.find((e) => nfkc(e.symbol) === sym);
      if (entry?.rule) ask.hit(entry.rule, lay.file, cell.ref);
      // 行の予定・実績の欄があれば、それを列の見出しより先に使う（行の方が細かいため）
      const colPA = rowPA(r.r) ?? col.planOrActual ?? null;
      let answer: string | null = "ok";
      /** この印に聞いた質問の鍵（答えが無ければ、印のセルはこの質問を待つ） */
      let askedKey: string | null = null;
      if (!entry) {
        const noLegend = legend.length === 0;
        // 同じ様式の表の同じ記号は 1 問（凡例の無い表と、凡例に無い記号は別の問い）
        const family = noLegend ? "noLegend" : "unknownSymbol";
        askedKey = `${family}|${t.id}|${sym}`;
        answer = ask.ask(
          `${family}|${t.id}|${sym}`,
          {
            kind: noLegend ? "noLegend" : "unknownSymbol",
            text: noLegend
              ? `凡例が無い。記号「${sym}」は何の星取か`
              : `記号「${sym}」は凡例に無い。何の星取か`,
            options: [
              ...(colPA ? [{ id: "column", label: `列の見出しのとおり（${colPA === "plan" ? "予定" : "実績"}）` }] : []),
              { id: "plan", label: "計画の星取" },
              { id: "actual", label: "実績の星取" },
              { id: "exclude", label: "星取ではない（外す）" },
            ],
            valueKind: "option",
            defaultAnswer: colPA ? "column" : null,
            sameShapeRows: 1,
            items: [itemOf(lay, [cell.ref])],
          },
          sameForm(family, formKeyOf(rec, t), sym),
        );
        if (answer === "column") m.planOrActual = colPA;
        else if (answer === "plan" || answer === "actual") m.planOrActual = answer;
      } else if (entry.planOrActual === null) {
        m.workName = entry.meaning;
        m.planOrActual = colPA;
        if (!colPA) {
          askedKey = `legendNoPA|${t.id}|${sym}`;
          answer = ask.ask(
            `legendNoPA|${t.id}|${sym}`,
            {
              kind: "planActualConflict",
              text: `記号「${sym}」（凡例「${entry.meaning}」）は、予定か実績か（列の見出しにも書いていない）`,
              options: [
                { id: "plan", label: "予定（計画）" },
                { id: "actual", label: "実績（実施）" },
                { id: "exclude", label: "外す" },
              ],
              valueKind: "option",
              defaultAnswer: null,
              sameShapeRows: 1,
              items: [itemOf(lay, [cell.ref])],
            },
            sameForm("legendNoPA", formKeyOf(rec, t), `${sym}|${entry.meaning}`),
          );
          if (answer === "plan" || answer === "actual") m.planOrActual = answer;
        }
      } else if (colPA && entry.planOrActual !== colPA) {
        askedKey = `paConflict|${t.id}|${sym}|${colPA}`;
        answer = ask.ask(
          `paConflict|${t.id}|${sym}|${colPA}`,
          {
            kind: "planActualConflict",
            text: `記号「${sym}」は凡例では「${entry.meaning}」だが、「${colPA === "plan" ? "予定" : "実績"}」の列にある`,
            options: [
              { id: "column", label: "列の見出しのとおり" },
              { id: "legend", label: "凡例のとおり" },
              { id: "exclude", label: "外す" },
            ],
            valueKind: "option",
            defaultAnswer: null,
            sameShapeRows: 1,
            items: [itemOf(lay, [cell.ref])],
          },
          sameForm("paConflict", formKeyOf(rec, t), `${sym}|${entry.meaning}|${colPA}`),
        );
        if (answer === "column") m.planOrActual = colPA;
        else if (answer === "legend") m.planOrActual = entry.planOrActual;
      } else m.planOrActual = entry.planOrActual;
      // 行ごとの作業の列：その行の作業の名前（凡例の意味より行が細かい）
      const wc = rowWork(r.r);
      if (wc) {
        m.workName = wc.text.replace(/\s*\n\s*/g, " ").trim();
        m.workRef = wc.ref;
      }
      if (answer === "exclude") {
        m.excluded = "星取ではない記号（決定で外した）";
        exclude(cell.ref, m.excluded);
        continue;
      }
      if (answer === null || m.planOrActual === null) m.pending = true;
      if (m.pending) {
        const waiting = answer === null && askedKey ? questionIdOf(askedKey) : null;
        pend(cell.ref, waiting);
        if (m.workRef) pend(m.workRef, waiting);
      }
      rec.marks.push(m);
    }
    // 作業の名前のセルで、印の 1 つも無い行のもの：理由つきで外す（印のある行は、印の記録の出どころ）
    const wc = rowWork(r.r);
    if (wc && !rec.marks.some((m) => m.tableId === t.id && m.workRef === wc.ref && !m.excluded)) exclude(wc.ref, "星取の無い行の作業の名前");
  }
  return order;
}

/**
 * 凡例の行の、英数の短い符号と意味（「重要度 A：安全・環境・共通系　B：炉・能力影響」→ A・B）。符号の前の語（「重要度」）を題にする。
 * 符号は英数 1〜3 字だけ（「【改】：」などの印の字は名前の頭の符号にしない）
 */
function codeLegend(texts: string[]): Map<string, { title: string; meaning: string }> {
  const out = new Map<string, { title: string; meaning: string }>();
  for (const text of texts) {
    let title = "凡例";
    for (const tok of nfkc(text).split(/\s+/u).filter(Boolean)) {
      const m = /^([A-Za-z0-9]{1,3})[:：](.+)$/u.exec(tok);
      if (m) {
        if (!out.has(m[1] ?? "")) out.set(m[1] ?? "", { title, meaning: m[2] ?? "" });
      } else if (!/[:：]/u.test(tok) && out.size === 0) title = tok;
    }
  }
  return out;
}

/** 名前の頭の、凡例で決めた符号（「A：汽水ドラム」）。凡例に無い符号・符号のあとに名前の無いものは null */
function codePrefix(name: string, codes: Map<string, { title: string; meaning: string }>): { name: string; title: string; value: string } | null {
  if (!codes.size) return null;
  const m = /^([A-Za-z0-9]{1,3})[:：]\s*(\S.*)$/u.exec(nfkc(name).trim());
  const c = m ? codes.get(m[1] ?? "") : undefined;
  return m && c ? { name: (m[2] ?? "").trim(), title: c.title, value: `${m[1]}：${c.meaning}` } : null;
}

/** 測った値だけの行（「最小厚 22.5mm」「振動 1.56mm/s」「設定差 0.4%」）：短い名前・数・英字や記号の単位。作業の名前ではない */
function isMeasureLine(line: string): boolean {
  return /^[^\d\s]{1,12}\s*[-+]?\d+(?:\.\d+)?\s*[A-Za-zμ°℃%‰/.²³]{0,8}$/u.test(nfkc(line).trim());
}

/**
 * 2 段の書き方の内容のセルを星取にする：内容の文は作業の名前（測った値の行は明細の測った値）、すぐ下の金額の行の同じ列の数は、その費用。
 * 測った値だけのセルは作業ではないので、その行の機器の仕様に残す（年の見出しを項目に）。予定・実績は列の見出し（帯）から。
 * 帯の見出しに書いていなければ、帯ごとに 1 回聞く。金額の単位と税は見出しと表の上の題・注記から。決まらなければ 1 回聞く。
 * 読んだ内容のセルの位置を返す（記号の星取の読み方に回さない）
 */
function contentMarks(
  t: Table,
  lay: SheetLayout,
  ask: Asker,
  rec: Records,
  data: Table["rows"],
  rowNode: Map<number, AssetRec | null>,
  marks: ColInfo[],
  amountRows: Map<number, number>,
  exclude: (ref: string, why: string) => void,
  pend: (ref: string) => void,
  off: Off,
): Set<string> {
  const done = new Set<string>();
  const formKey = rec.formOf.get(t.id)?.key ?? t.id;
  const below = new Map<number, number>();
  for (const [a, c] of amountRows) below.set(c, a);
  const amountAt = (r: number, c: number) => {
    const a = below.get(r);
    const x = a !== undefined ? lay.index.at(a, c) : null;
    return x && x.text.trim() !== "" && !off(x.ref) ? x : null;
  };
  const bandOf = (col: ColInfo) => col.headerParts.filter((p) => p !== col.yearLabel).join(" / ").replace(/\s*\n\s*/g, "") || "年の列";
  type At = { r: number; col: ColInfo; cell: GridCell };
  type Cell = At & { work: string | null; measured: string | null };
  const cells: Cell[] = [];
  const amountOnly: At[] = [];
  for (const r of data) {
    for (const col of marks) {
      const cell = lay.index.at(r.r, col.c);
      if (!cell || cell.text.trim() === "" || off(cell.ref)) {
        // 内容の無い年の欄に、下の金額だけがある：名前の無い作業の費用（黙って捨てない）
        const a = amountAt(r.r, col.c);
        if (a && rowNode.get(r.r)) amountOnly.push({ r: r.r, col, cell: a });
        continue;
      }
      if (typeof cell.value === "number") continue;
      done.add(cell.ref);
      const lines = nfkc(cell.text)
        .split(/\r?\n/u)
        .map((x) => x.trim())
        .filter(Boolean);
      const meas = lines.filter(isMeasureLine);
      const work = lines.filter((x) => !isMeasureLine(x)).join(" ");
      cells.push({ r: r.r, col, cell, work: work || null, measured: meas.length ? meas.join(" ") : null });
    }
  }
  // 予定・実績：帯の見出しから。書いていない帯は、帯ごとに 1 回聞く（内容の文のあるセルを見本に）
  const paOf = new Map<string, { pa: "plan" | "actual" | null; state: "ok" | "exclude" | "open" }>();
  for (const x of [...cells.filter((c) => c.work !== null), ...amountOnly]) {
    const band = bandOf(x.col);
    if (paOf.has(band)) continue;
    if (x.col.planOrActual) {
      paOf.set(band, { pa: x.col.planOrActual, state: "ok" });
      continue;
    }
    const inBand: At[] = cells.filter((c) => c.work !== null && bandOf(c.col) === band);
    const sample = inBand.length ? inBand : amountOnly.filter((a) => bandOf(a.col) === band);
    const cols = [...new Set(sample.map((c) => c.col))].sort((a, b) => a.c - b.c);
    const years = cols.map((c) => c.fiscalYear ?? 0);
    const a = ask.ask(`contentPA|${formKey}|${band}`, {
      kind: "planActualConflict",
      text: `「${band}」の年の列（${colLetter(cols[0]?.c ?? 1)}〜${colLetter(cols[cols.length - 1]?.c ?? 1)}、${Math.min(...years)}〜${Math.max(...years)} 年度）に書いた整備の内容（${sample.length} セル）は、予定か実績か（列の見出しに書いていない）`,
      options: [
        { id: "plan", label: "予定（計画）" },
        { id: "actual", label: "実績（実施）" },
        { id: "exclude", label: "外す" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: sample.length,
      items: [itemOf(lay, sample.slice(0, 10).map((c) => c.cell.ref))],
    });
    paOf.set(band, a === "plan" || a === "actual" ? { pa: a, state: "ok" } : { pa: null, state: a === "exclude" ? "exclude" : "open" });
  }
  // 金額の単位と税：年の列の見出し、表の上の題・注記（「下段：原価予算［千円・税抜］」）。いくつもの単位が書いてあれば決めない
  const texts = [...t.cols.flatMap((c) => c.headerParts), ...lay.titles.filter((x) => x.r < t.top).map((x) => x.text), ...lay.notes.filter((x) => x.r < t.top).map((x) => x.text)];
  const units = [...new Set(texts.map((x) => costHeaderUnit(x)).filter((u): u is number => u !== null))];
  const taxes = [...new Set(texts.map((x) => costHeaderTax(x)).filter((x): x is "incl" | "excl" => x !== null))];
  const amountCells = [...cells.map((c) => amountAt(c.r, c.col.c)), ...amountOnly.map((a) => a.cell)].filter((x): x is GridCell => !!x);
  let unit: number | null = units.length === 1 ? (units[0] ?? null) : null;
  let tax: "incl" | "excl" | "unknown" | null = taxes.length === 1 ? (taxes[0] ?? null) : null;
  let costOff: string | null = null;
  let costOpen = false;
  if (amountCells.length && unit === null) {
    const a = ask.ask(`costUnit|${formKey}|amountRows`, {
      kind: "costUnit",
      text: `年の列の下の段の金額（${amountCells.length} セル）の単位が、見出しにも表の上の題にも書いてない。単位を推し量らない`,
      options: [
        { id: "1", label: "円" },
        { id: "1000", label: "千円" },
        { id: "10000", label: "万円" },
        { id: "none", label: "金額を読まない（理由を残す）" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: amountCells.length,
      items: [itemOf(lay, amountCells.slice(0, 10).map((c) => c.ref))],
    });
    if (a === "none") costOff = "年の列の下の段の金額（単位が決まらないので読まない）";
    else if (a === null) costOpen = true;
    else unit = Number(a);
  }
  if (amountCells.length && unit !== null && tax === null) {
    const a = ask.ask(`costTax|${formKey}|amountRows`, {
      kind: "costTax",
      text: `年の列の下の段の金額（${amountCells.length} セル）が税込か税抜か、見出しにも表の上の題にも書いてない`,
      options: [
        { id: "incl", label: "税込" },
        { id: "excl", label: "税抜" },
        { id: "unknown", label: "資料に書いていない（そのまま読む）" },
      ],
      valueKind: "option",
      defaultAnswer: "unknown",
      sameShapeRows: amountCells.length,
      items: [itemOf(lay, amountCells.slice(0, 10).map((c) => c.ref))],
    });
    if (a === null) costOpen = true;
    else tax = a === "incl" || a === "excl" ? a : "unknown";
  }
  const costOf = (x: GridCell, node: AssetRec | null): CostCell | undefined => {
    if (costOff) {
      exclude(x.ref, costOff);
      return undefined;
    }
    if (costOpen || unit === null) {
      pend(x.ref);
      return undefined;
    }
    const yen = parseCost(typeof x.value === "number" ? String(x.value) : x.text, x.value, unit);
    if (yen === null) {
      pend(x.ref);
      return undefined;
    }
    if (node && !node.refs.includes(x.ref)) node.refs.push(x.ref);
    return { yen, ref: x.ref, text: x.text, tax: tax ?? "unknown" };
  };
  const push = (x: At, work: string | null, measured: string | null, cost: GridCell | null) => {
    const node = rowNode.get(x.r) ?? null;
    const band = bandOf(x.col);
    const st = paOf.get(band) ?? { pa: null, state: "open" as const };
    if (st.state === "exclude") {
      exclude(x.cell.ref, "年の列の整備の内容（決定で外した）");
      if (cost) exclude(cost.ref, "年の列の整備の内容（決定で外した）");
      return;
    }
    const m: MarkRec = {
      id: `${t.id}:m:${x.cell.ref}`,
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      ref: x.cell.ref,
      row: x.r,
      symbol: work ?? "",
      fiscalYear: x.col.fiscalYear ?? 0,
      planOrActual: st.pa,
      workName: work,
      workRef: null,
      content: true,
      ...(measured ? { measured } : {}),
      assetId: node?.id ?? null,
      excluded: null,
      pending: !node || node.pending || t.yearKind === null || st.state === "open",
      ...(t.yearKind === "calendar" ? { calendarYear: true as const } : {}),
    };
    const c = cost ? costOf(cost, node) : undefined;
    if (c) m.cost = c;
    if (m.pending) pend(x.cell.ref);
    rec.marks.push(m);
  };
  for (const c of cells) {
    const node = rowNode.get(c.r) ?? null;
    if (c.work === null) {
      // 測った値だけ（作業ではない）：その行の機器の仕様に、年の見出しを項目にして残す。下の段に金額があれば、名前の無い作業の費用
      if (node) {
        node.specs.push({ key: `${bandOf(c.col)} ${c.col.yearLabel ?? ""}`.replace(/\s*\n\s*/g, " ").trim(), value: c.cell.text, ref: c.cell.ref });
        node.refs.push(c.cell.ref);
        const a = amountAt(c.r, c.col.c);
        if (a) push({ r: c.r, col: c.col, cell: a }, null, null, a);
      } else pend(c.cell.ref);
      continue;
    }
    push(c, c.work, c.measured, amountAt(c.r, c.col.c));
  }
  for (const a of amountOnly) push(a, null, null, a.cell);
  return done;
}

function seriesKey(s: Series | null): string {
  if (!s) return "-";
  return s.kind === "number" ? `n${s.n}` : `c:${s.meaning}`;
}

// ─── 日報の形 ──────────────────────────────────────────────────

/**
 * 人数の欄（作業日報の工数を、人数 × 作業時間の幅で数えるため）：1 つの列に人数を書く列（「作業人員」：数・「計 n 名」・職種の語＋数の並び）か、
 * 上の段が「…人員（人）」で、下の段に職種ごとの列を並べた列（数の和。空欄は 0）。読み方の規則で役目を決めた列・外した列は使わない
 */
interface PersonsSource {
  cols: ColInfo[];
  /** 職種ごとの列の和で読む */
  sum: boolean;
  /** 職種ごとの列と並べた計の列（あれば、和と照らす） */
  total: ColInfo | null;
}

function personsSource(t: Table): PersonsSource | null {
  const cands = t.cols.filter((c) => c.role === "remark" && c.cue === "persons" && !c.ruleExclude && !(c as ColInfo & { forced?: string }).forced);
  const top = cands.find((c) => c.headerParts.length >= 2 && personsHeaderUnit(c.headerParts[0] ?? ""));
  if (top) {
    const group = cands.filter((c) => c.headerParts.length >= 2 && c.headerParts[0] === top.headerParts[0]);
    const sub = (c: ColInfo) => c.headerParts.slice(1).join(" ");
    // 下の段が予定・実績の列なら、職種ごとの列ではない（足すと 2 重に数える）
    if (!group.some((c) => cue.planActual(sub(c)) !== null)) {
      const total = group.find((c) => cue.isTotal(sub(c))) ?? null;
      return { cols: group.filter((c) => c !== total), sum: true, total };
    }
  }
  const one = cands.find((c) => c.headerParts.length === 1);
  return one ? { cols: [one], sum: false, total: null } : null;
}

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

function eventRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, opts: RecordOptions, date1904: boolean, exclude: (ref: string, why: string) => void, pend: Pend, off: Off) {
  const col = (role: ColInfo["role"]) => t.cols.find((c) => c.role === role);
  const dateCol = col("date");
  const endCol = col("end");
  const tagCol = col("tag");
  const blankDecision = (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision ?? new Map<number, string | null>();
  const daysCol = col("days");
  // 行ごとの予定・実績の列：計画中の行は実績にしない（Architect の 53）
  const paCol = col("planActual");
  // 工数の列がいくつか（「予定工数」「実績工数」）：行ごとに、実績の列を先に、書いてある列を使う
  const effortCols = t.cols.filter((c) => c.role === "effort").sort((a, b) => (cue.planActual(b.header) === "actual" ? 1 : 0) - (cue.planActual(a.header) === "actual" ? 1 : 0));
  const effortCol = effortCols[0];
  const effortColAt = (r: number) => {
    const filled = effortCols.filter((c) => {
      const x = lay.index.at(r, c.c);
      return !!x && x.text !== "";
    });
    // 作業時間の幅（「9:00-12:00」）と、工数として読める列（「延べ時間」）を並べた行は、読める列を読む
    const first = filled[0];
    const firstCell = first ? lay.index.at(r, first.c) : null;
    if (firstCell && parseTimeSpan(firstCell.text)) {
      const other = filled.find((c) => {
        const x = lay.index.at(r, c.c);
        return c !== first && !!x && parseEffort(typeof x.value === "number" ? x.value : nfkc(x.text).replace(/,/g, "")) !== null;
      });
      if (other) return other;
    }
    return first ?? effortCol;
  };
  const assetCol = col("assetRef");
  const unitCol = col("unit");
  const workCol = col("workName");
  const titleCol = col("workTitle");
  // 作業量の列（「数量」の見出しの備考の列か、答え・ルールで作業量にした列）：備考と同じに読み、作業明細の作業量に残す
  const remarkCols = t.cols.filter((c) => c.role === "remark" || c.role === "quantity");
  const quantityCols = remarkCols.filter((c) => c.role === "quantity" || c.cue === "quantity");
  const data = t.rows.filter((r) => r.role === "data");
  const text = (r: number, c: ColInfo | undefined) => (c ? (lay.index.at(r, c.c)?.text ?? "") : "");
  // 工数の時間：1 人・日の時間を聞く（表ごとに 1 回）
  const hourCells: string[] = [];
  const personCells: string[] = [];
  const bareCells: string[] = [];
  const badEffort = new Map<string, string[]>();
  // 人数 × 作業時間の幅で工数を数える表（作業日報）：工数の列に幅の書き方があり、人数の欄がある表だけ。ほかの表は今までどおり読む
  const ps = personsSource(t);
  const spanTable =
    !!ps &&
    data.some((r) =>
      effortCols.some((c) => {
        const x = lay.index.at(r.r, c.c);
        return !!x && parseTimeSpan(x.text) !== null;
      }),
    );
  /** その行の人数（読めない書き方なら bad にそのセル。書いていなければ n は null） */
  const personsAt = (r: number): { n: number | null; bad: GridCell | null; refs: string[] } => {
    if (!ps) return { n: null, bad: null, refs: [] };
    const cells = ps.cols.map((c) => lay.index.at(r, c.c)).filter((x): x is GridCell => !!x && x.text.trim() !== "" && !off(x.ref));
    const refs = cells.map((x) => x.ref);
    const read = (x: GridCell) => parsePersons(typeof x.value === "number" ? x.value : x.text);
    if (!ps.sum) {
      const x = cells[0];
      if (!x) return { n: null, bad: null, refs };
      const p = read(x);
      return p ? { n: p.n, bad: null, refs } : { n: null, bad: x, refs };
    }
    // 職種ごとの列：数の和（空欄は 0）。計の列があれば和と照らす（合わなければ読めないとする）
    let n = 0;
    for (const x of cells) {
      const p = read(x);
      if (!p || p.style !== "数") return { n: null, bad: x, refs };
      n += p.n;
    }
    const tc = ps.total ? lay.index.at(r, ps.total.c) : null;
    if (tc && tc.text.trim() !== "" && !off(tc.ref)) {
      refs.push(tc.ref);
      const p = read(tc);
      if (!p || p.style !== "数" || (cells.length > 0 && p.n !== n)) return { n: null, bad: tc, refs };
      return { n: p.n, bad: null, refs };
    }
    return { n: cells.length ? n : null, bad: null, refs };
  };
  /** 人数と幅で数える行（問いの見本は、表ごとに幅の書き方の違う行を 3 つまで） */
  const spanItems: QuestionItem[] = [];
  const spanSeen = new Set<string>();
  let spanRows = 0;
  /** 人数は書いてあるが作業時間の無い行 */
  const noTimeItems: QuestionItem[] = [];
  let noTimeRows = 0;
  /** 人数の書き方が読めない行（幅はある）：書き方 → 見本と、その行の工数のセル・人数のセル */
  const badPersons = new Map<string, { sample: string; refs: string[] }[]>();
  const spellings = new Map<string, string[]>();
  /** 系列の欄の、読めない書き方 → その行（書き方ごとに聞く） */
  const unitBadEv = new Map<string, { row: number; ref: string }[]>();
  const badDates = new Map<string, string[]>();
  const badDays = new Map<string, string[]>();
  const evs: (EventRec & { _hours: number | null; _persons: number | null; _bare: number | null; _span: (TimeSpan & { persons: number; ref: string }) | null; _noTime: { persons: number; refs: string[] } | null })[] = [];
  /** 未解決の行 → その行が待つ質問の ID（最初に分かったもの。画面の写しと、質問の無い未解決のセルを数えるのに使う） */
  const waits = new Map<string, string>();
  const wait = (id: string, key: string) => {
    if (!waits.has(id)) waits.set(id, questionIdOf(key));
  };
  // 日付のセルを読む：〃 は上の行と同じ、年の無い日付はシートに書いた年度から、空欄は「上と同じ」の答えに従う
  const prevDate = new Map<number, { start: Ymd; end: Ymd; range: boolean } | null>();
  const readDate = (r: number, c: ColInfo | undefined): { period: { start: Ymd; end: Ymd; range: boolean } | null; cell: ReturnType<typeof lay.index.at>; bad: boolean; blank: boolean } => {
    if (!c) return { period: null, cell: null, bad: false, blank: false };
    const cell = lay.index.at(r, c.c);
    if (!cell || cell.text === "") {
      const d = blankDecision.get(c.c);
      return { period: d === "same" ? (prevDate.get(c.c) ?? null) : null, cell: null, bad: false, blank: true };
    }
    let p: { start: Ymd; end: Ymd; range: boolean } | null = null;
    if (cue.isDitto(cell.text)) p = prevDate.get(c.c) ?? null;
    else if (c.dateFormat && !isTypedDate(cell)) {
      // 読み方の規則で決めた書き方（yyyymmdd・yymmdd・月/日）
      const f = parseWithFormat(String(cell.value ?? cell.text), c.dateFormat);
      const ymd = !f ? null : f.y !== null ? { y: f.y, m: f.m, d: f.d } : lay.contextFiscalYear !== null ? withFiscalYear({ m: f.m, d: f.d }, lay.contextFiscalYear, opts.fiscalYearStartMonth) : null;
      if (ymd) p = { start: ymd, end: ymd, range: false };
    } else {
      p = cellPeriod(cell, date1904);
      if (!p && lay.contextFiscalYear !== null && typeof cell.value === "string") {
        const md = parseMonthDay(cell.value);
        const ymd = md ? withFiscalYear(md, lay.contextFiscalYear, opts.fiscalYearStartMonth) : null;
        if (ymd) p = { start: ymd, end: ymd, range: false };
      }
    }
    if (p) prevDate.set(c.c, p);
    return { period: p, cell, bad: !p, blank: false };
  };
  // 帳票の頭書き（同じ頁の、表の上の「日付｜…」「設備名｜…」「機器番号｜…」「号炉｜…」）：表に無い欄を、表の行に付ける
  const headCell = (...ks: ColumnCue[]) => ks.map((k) => t.head?.find((f) => f.cue === k)?.cell).find((c) => !!c) ?? null;
  const headPeriod = (c: GridCell | null) => {
    if (!c) return null;
    const p = cellPeriod(c, date1904);
    if (p) return p;
    const md = lay.contextFiscalYear !== null && typeof c.value === "string" ? parseMonthDay(c.value) : null;
    const ymd = md && lay.contextFiscalYear !== null ? withFiscalYear(md, lay.contextFiscalYear, opts.fiscalYearStartMonth) : null;
    return ymd ? { start: ymd, end: ymd, range: false } : null;
  };
  const headStart = dateCol ? null : headPeriod(headCell("date"));
  const headEnd = dateCol || endCol ? null : headPeriod(headCell("end"));
  const headDate = headStart && headEnd ? { start: headStart.start, end: headEnd.end, range: true } : headStart;
  const headAsset = assetCol ? null : (headCell("name", "assetRef")?.text.replace(/\s*\n\s*/g, " ").trim() ?? null);
  const headTag = tagCol ? null : (headCell("tag")?.text.trim() || null);
  const headUnitCell = unitCol ? null : headCell("series");
  const headUnit = headUnitCell && !isNone(headUnitCell.text) ? parseUnit(headUnitCell.text) : null;
  // 号炉・機器・作業を 1 つのセルに書いた列（「号炉・系統・機器・作業内容」）：機器の列が無いときだけ、見出しの順に分けて読む
  const flatCol = !assetCol && workCol?.compound ? workCol : null;
  const unsplit: { id: string; ref: string }[] = [];
  const flatSplit: { id: string; ref: string; sep: string }[] = [];
  // 機器の欄も機器番号も無い台帳（発注台帳など）：件名の中の機器の名前の案（あとでまとめて聞く。推し量って決めない）
  const titleOnly = !assetCol && !tagCol && !flatCol && !headAsset && !headTag && titleCol ? titleCol : null;
  const titleRows: { id: string; ref: string; title: string; guess: { asset: string; work: string } | null }[] = [];
  // 行ごとの周期（「周期」の列）：その行の作業の暦のきっかけ
  const cycleOf = readCycles(t, lay, ask, rec, data.map((r) => r.r), exclude, pend, off);
  // 行ごとの費用（「契約金額」の列）：その行の作業明細の費用
  const costOf = readCosts(t, lay, ask, rec, data.map((r) => r.r), exclude, pend, off);
  // 読み方の規則で外した列のセル：理由つきで外す
  for (const col of t.cols.filter((c) => c.ruleExclude)) for (const r of data) {
    const x = lay.index.at(r.r, col.c);
    if (x && x.text !== "" && !off(x.ref)) exclude(x.ref, col.ruleExclude as string);
  }
  for (const r of data) {
    const cells = lay.index.rowCells(r.r).filter((c) => !off(c.ref) && !t.cols.some((k) => k.ruleExclude && k.c === c.c));
    if (!cells.length) continue;
    const refs = cells.map((c) => c.ref);
    const sd = readDate(r.r, dateCol);
    const ed = readDate(r.r, endCol);
    const dc = sd.cell;
    // 始まりと終わりを別の列に書く書き方は、2 つの日付で期間にする
    const period = sd.period && ed.period ? { start: sd.period.start, end: ed.period.end, range: true } : (sd.period ?? headDate);
    const date = period?.start ?? null;
    if (dc && sd.bad) badDates.set(shapeOf(dc.text), [...(badDates.get(shapeOf(dc.text)) ?? []), dc.ref]);
    if (ed.cell && ed.bad) badDates.set(shapeOf(ed.cell.text), [...(badDates.get(shapeOf(ed.cell.text)) ?? []), ed.cell.ref]);
    if ((sd.blank && blankDecision.get(dateCol?.c ?? -1) === undefined) || (ed.blank && endCol && blankDecision.get(endCol.c) === undefined)) for (const ref of refs) pend(ref);
    const yc = daysCol ? lay.index.at(r.r, daysCol.c) : null;
    const days = yc && !off(yc.ref) ? parseDayCount(typeof yc.value === "number" ? yc.value : yc.text) : null;
    if (yc && !off(yc.ref) && days === null) badDays.set(shapeOf(yc.text), [...(badDays.get(shapeOf(yc.text)) ?? []), yc.ref]);
    const rowEffortCol = effortColAt(r.r);
    const ec = rowEffortCol ? lay.index.at(r.r, rowEffortCol.c) : null;
    // 見出しに書いた工数の単位（「工数(人日)」「延工数(h)」）
    // 見出しの段ごとに見る（「延人員」の下に「(人)」と書く書き方）
    const effortUnit = rowEffortCol ? (rowEffortCol.effortUnit ?? rowEffortCol.headerParts.map((h) => cue.headerUnit(h)).find((u) => u !== null) ?? cue.headerUnit(rowEffortCol.header)) : null;
    let manDays: number | null = null;
    let hours: number | null = null;
    let persons: number | null = null;
    let bare: number | null = null;
    let span: (TimeSpan & { persons: number; ref: string }) | null = null;
    let noTime: { persons: number; refs: string[] } | null = null;
    if (ec && !off(ec.ref)) {
      const raw = parseEffort(typeof ec.value === "number" ? ec.value : nfkc(ec.text).replace(/,/g, ""));
      // 数だけの工数は、見出しの単位で読む
      const e = raw && raw.unit === "bare" && effortUnit ? { ...raw, unit: effortUnit } : raw;
      // 作業時間の幅（「8:30～17:00」）：同じ行の人数とかけて数える（昼休みと 1 人・日の時間は、あとでまとめて聞く）
      const sp = !e && spanTable ? parseTimeSpan(ec.text) : null;
      const pa = sp ? personsAt(r.r) : null;
      if (sp && pa?.n) {
        span = { ...sp, persons: pa.n, ref: ec.ref };
        spanRows++;
        const k = `${sp.start}-${sp.end}`;
        if (spanItems.length < 3 && !spanSeen.has(k)) {
          spanSeen.add(k);
          spanItems.push(itemOf(lay, [ec.ref, ...pa.refs], { note: `人数 ${pa.n}・幅 ${hhmm(sp.start)}～${hhmm(sp.end)}` }));
        }
      } else if (sp && pa?.bad) {
        const k = shapeOf(pa.bad.text);
        badPersons.set(k, [...(badPersons.get(k) ?? []), { sample: pa.bad.text, refs: [ec.ref, pa.bad.ref] }]);
      } else if (!e) badEffort.set(shapeOf(ec.text), [...(badEffort.get(shapeOf(ec.text)) ?? []), ec.ref]);
      else if (e.unit === "manDays") manDays = e.amount;
      else if (e.unit === "hours") {
        hours = e.amount;
        hourCells.push(ec.ref);
      } else if (e.unit === "persons") {
        persons = e.amount;
        personCells.push(ec.ref);
      } else {
        bare = e.amount;
        bareCells.push(ec.ref);
      }
    } else if (spanTable && !ec) {
      // 人数だけで作業時間の無い行：人数を人・日の数としない（あとでまとめて聞く）
      const pa = personsAt(r.r);
      if (pa.n) {
        noTime = { persons: pa.n, refs: pa.refs };
        noTimeRows++;
        if (noTimeItems.length < 3) noTimeItems.push(itemOf(lay, pa.refs, { note: `人数 ${pa.n}` }));
      }
    }
    const uc = unitCol ? lay.index.at(r.r, unitCol.c) : null;
    // 号・系列の見出しの列（「炉」「号炉」）の数だけの書き方は、その数の号
    const bareNo = uc && unitCol?.cue === "series" ? /^\d{1,3}$/.exec(nfkc(uc.text).trim()) : null;
    const unit: UnitValue | null = uc && !isNone(uc.text) ? (parseUnit(uc.text) ?? (bareNo ? { kind: "number", n: Number(bareNo[0]), spelling: "{n}" } : null)) : null;
    if (uc && uc.text !== "" && !isNone(uc.text) && !unit) unitBadEv.set(nfkc(uc.text).trim(), [...(unitBadEv.get(nfkc(uc.text).trim()) ?? []), { row: r.r, ref: uc.ref }]);
    if (unit?.kind === "number") spellings.set(unit.spelling, [...(spellings.get(unit.spelling) ?? []), uc?.ref ?? ""]);
    // 号炉・機器・作業を 1 つのセルに書いた列：見出しの順に分ける（区切りが無ければ、あとでまとめて聞く）
    const flatText = flatCol ? text(r.r, flatCol) : "";
    const flat = flatText ? splitFlatWork(flatText) : null;
    if (flatText && !flat) unsplit.push({ id: `${t.id}:e${r.r}`, ref: lay.index.at(r.r, flatCol?.c ?? 0)?.ref ?? "" });
    // 読み手が区切り（空白か括弧）で分けた行：分けたのは取り込みの判断なので、人が受けるまで決めない（Architect の 64(b)・Wire）
    if (flatText && flat) flatSplit.push({ id: `${t.id}:e${r.r}`, ref: lay.index.at(r.r, flatCol?.c ?? 0)?.ref ?? "", sep: /\s/u.test(nfkc(flatText).trim().replace(/[(（][^()（）]*[)）]/gu, "")) ? "空白" : "括弧" });
    const titleText = titleOnly ? text(r.r, titleOnly).trim() : "";
    if (titleText) titleRows.push({ id: `${t.id}:e${r.r}`, ref: lay.index.at(r.r, titleOnly?.c ?? 0)?.ref ?? "", title: titleText, guess: assetFromTitle(titleText) });
    const assetText0 = text(r.r, assetCol) || flat?.asset || (headAsset ?? "");
    // 名前の前の号（「1号機ポンプ」）：号の欄が無いか空なら、名前から号を分ける
    const lead = (!uc || uc.text === "") ? splitUnitPrefix(assetText0) : null;
    const assetText = lead ? lead.name : assetText0;
    // 号の欄も名前の前の号も無ければ、同じ行の工事の件名・作業の名前の頭の号（「1号炉 定期整備工事」）。ほかの号を並べた件名（「1号炉・2号炉 …」）は使わない
    const titleLead = !lead && !flat && (!uc || uc.text === "") ? [text(r.r, titleCol), text(r.r, workCol)].map(splitUnitPrefix).find((x) => !!x && !/\d\s*(?:号|系)/u.test(x.name)) ?? null : null;
    const stripped = cue.stripSet(assetText);
    const workName = flat ? flat.work : (workCol ? text(r.r, workCol) : text(r.r, titleCol)).trim();
    const fy = date ? fiscalYearOf(date, opts.fiscalYearStartMonth) : null;
    evs.push({
      id: `${t.id}:e${r.r}`,
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      row: r.r,
      date,
      end: period?.range ? period.end : null,
      days,
      fiscalYear: fy,
      manDays,
      effortPending: false,
      assetNames: stripped.text ? [stripped.text] : [],
      ...(cycleOf.has(r.r) ? { cycle: cycleOf.get(r.r) } : {}),
      ...(costOf.has(r.r) ? { cost: costOf.get(r.r) } : {}),
      ...(paCol && cue.planActual(text(r.r, paCol)) === "plan" ? { planOrActual: "plan" as const } : {}),
      ...(() => {
        const ref = (assetCol && text(r.r, assetCol) ? lay.index.at(r.r, assetCol.c)?.ref : flat ? lay.index.at(r.r, flatCol?.c ?? 0)?.ref : headAsset ? headCell("name", "assetRef")?.ref : undefined) ?? undefined;
        return ref ? { nameRef: ref } : {};
      })(),
      tag: (() => {
        const tc = tagCol ? lay.index.at(r.r, tagCol.c) : null;
        return tc && tc.text !== "" && !cue.isDitto(tc.text) ? nfkc(tc.text).trim() : headTag ? nfkc(headTag) : null;
      })(),
      bundle: stripped.set,
      unit: lead ? { kind: "number", n: lead.n, spelling: lead.spelling } : uc && uc.text !== "" && !isNone(uc.text) ? unit : (flat?.unit ?? (titleLead ? { kind: "number", n: titleLead.n, spelling: titleLead.spelling } : headUnit)),
      workName,
      workTitle: titleCol && workCol ? text(r.r, titleCol) || null : null,
      remark: remarkCols.map((c) => text(r.r, c)).filter(Boolean).join(" / ") || null,
      ...((q) => (q ? { quantity: q } : {}))(quantityCols.map((c) => text(r.r, c).trim()).filter(Boolean).join(" / ")),
      ...((x) => (x ? { lineRemark: x } : {}))(remarkCols.filter((c) => c.cue !== "quantity").map((c) => text(r.r, c).trim()).filter(Boolean).join(" / ")),
      refs,
      excluded: null,
      pending: !date || !workName,
      _hours: hours,
      _persons: persons,
      _bare: bare,
      _span: span,
      _noTime: noTime,
    });
  }
  // 日付の欄の無い作業の表（工程表など）：表の外に書いた期間を使うか、まとめて 1 回聞く（推し量らない）
  if (!dateCol && !headDate && evs.length) {
    const cp = lay.contextPeriod;
    // 同じ様式の表（シートごと・日ごとの塊）は 1 問。表の外の期間の答えは、表ごとに自分の表の外の期間を使う
    const dateText = (rows: number) =>
      cp
        ? `作業の行に日付が書いていない（${rows} 行）。表の外に書いた期間（見本「${cp.text.slice(0, 60)}」）をその行の期間にするか`
        : `作業の行に日付が書いていない（${rows} 行）`;
    const a = ask.ask(
      `dateMissing|${t.id}`,
      {
        kind: "dateUnknown",
        text: cp
          ? `作業の行に日付が書いていない（${evs.length} 行）。表の外に書いた期間（「${cp.text.slice(0, 60)}」）をその行の期間にするか`
          : `作業の行に日付が書いていない（${evs.length} 行）`,
        options: [...(cp ? [{ id: "heading", label: "表の外に書いた期間にする" }] : []), { id: "exclude", label: "その行を外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: evs.length,
        items: [itemOf(lay, evs.slice(0, 10).map((e) => e.refs[0] ?? ""))],
      },
      sameForm("dateMissing", formKeyOf(rec, t), "-", dateText),
    );
    for (const e of evs) {
      if (a === "heading" && cp) {
        e.date = cp.start;
        e.end = cp.end;
        e.fiscalYear = fiscalYearOf(cp.start, opts.fiscalYearStartMonth);
        e.pending = !e.workName;
      } else if (a === "exclude") e.excluded = "日付の書いていない行（決定で外した）";
      else wait(e.id, `dateMissing|${t.id}`);
    }
  }
  // 工数の単位の問いは、同じ様式の表をまとめて 1 回聞く（同じ鍵で聞くと、件数と見本は足される）
  const form = rec.formOf.get(t.id);
  const fkey = form?.key ?? t.id;
  const many = (form?.tables.length ?? 1) > 1;
  const where = many ? `${filesLabel(form?.files ?? [])}（同じ様式）の表に、` : "";
  // 号炉・機器・作業を 1 つのセルに書いた列を、読み手が区切りで分けた行：分けて読むかを 1 回聞く（既定は分けて読む。Architect の 64(b)・Wire）
  if (flatSplit.length && flatCol) {
    const seps = [...new Set(flatSplit.map((x) => x.sep))].join("・");
    const a = ask.ask(`flatSplit|${fkey}`, {
      kind: "flatSplit",
      text: `${where}「${flatCol.headerParts[0] ?? ""}」の列は、1 つのセルに号炉・機器・作業を書いている。${seps}で機器と作業に分けて読むか`,
      options: [
        { id: "split", label: `${seps}で分けて読む（${flatSplit.length} 行）` },
        { id: "exclude", label: "その行を外す" },
      ],
      valueKind: "option",
      defaultAnswer: "split",
      sameShapeRows: flatSplit.length,
      items: [itemOf(lay, flatSplit.slice(0, 10).map((u) => u.ref))],
    });
    const ids = new Set(flatSplit.map((u) => u.id));
    for (const e of evs)
      if (ids.has(e.id)) {
        if (a === "exclude") e.excluded = "1 つのセルに書いた号炉・機器・作業の行（決定で外した）";
        else if (a !== "split") {
          e.pending = true;
          wait(e.id, `flatSplit|${fkey}`);
        }
      }
  }
  // 号炉・機器・作業の区切り（空白・括弧）の無いセル：機器と作業に分けられない。推し量らず、同じ様式の表をまとめて 1 回聞く
  if (unsplit.length && flatCol) {
    const a = ask.ask(`flatUnsplit|${fkey}`, {
      kind: "eventAsset",
      text: `${where}「${flatCol.headerParts[0] ?? ""}」の列は、1 つのセルにいくつかの欄を書いている。区切り（空白・括弧）が無く、機器と作業に分けられないセルが${many ? "" : ` ${unsplit.length}`} ある。どう読むか`,
      options: [{ id: "exclude", label: "その行を外す（理由を残す）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: unsplit.length,
      items: [itemOf(lay, unsplit.slice(0, 10).map((u) => u.ref))],
    });
    const ids = new Set(unsplit.map((u) => u.id));
    for (const e of evs)
      if (ids.has(e.id)) {
        if (a === "exclude") e.excluded = "機器と作業の区切りの無いセルの行（決定で外した）";
        else {
          e.pending = true;
          wait(e.id, `flatUnsplit|${fkey}`);
        }
      }
  }
  // 件名の中の機器の名前：見本を添えて、同じ様式の表をまとめて 1 回聞く
  if (titleRows.length && titleOnly) {
    const shown = titleRows.filter((x) => x.guess).slice(0, 3).map((x) => `「${x.title.slice(0, 30)}」→「${x.guess?.asset ?? ""}」`).join("");
    const a = ask.ask(`titleAsset|${fkey}`, {
      kind: "eventAsset",
      text: `${where}機器の欄が無い。「${titleOnly.headerParts[0] ?? ""}」の文から、頭の年度・後ろの括弧・後ろの作業の語（「点検」「業務委託」など）を除いた残りを、機器の名前として読むか（見本 ${shown}）`,
      options: [
        { id: "title", label: "そう読む（機器の名前が取れない行は外す）" },
        { id: "exclude", label: "機器の欄の無い行を外す" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: titleRows.length,
      items: [itemOf(lay, titleRows.slice(0, 10).map((x) => x.ref))],
    });
    const byId = new Map(titleRows.map((x) => [x.id, x]));
    for (const e of evs) {
      const x = byId.get(e.id);
      if (!x) continue;
      if (a === "exclude") e.excluded = "機器の欄の無い行（決定で外した）";
      else if (a === "title" && !x.guess) e.excluded = "件名から機器の名前を取れない行（決定で外した）";
      else if (a === "title" && x.guess) {
        const lead = splitUnitPrefix(x.guess.asset);
        e.assetNames = [cue.stripSet(lead ? lead.name : x.guess.asset).text];
        if (lead && !e.unit) e.unit = { kind: "number", n: lead.n, spelling: lead.spelling };
        e.nameRef = x.ref;
      }
    }
  }
  // 人数と作業時間の幅で数える行：幅に昼休みを含むかを、同じ様式の表をまとめて 1 回聞く（既定の答えは無い。昼休みを黙って引かない）
  let lunch: string | null = null;
  let lunchHours: number | null = null;
  if (spanRows) {
    lunch = ask.ask(`effortSpanLunch|${fkey}`, {
      kind: "effortUnknown",
      text: `${where}作業時間の幅に昼休みを含むか（人数と作業時間の幅「開始～終了」で工数を数える行${many ? "" : ` ${spanRows} 行`}。工数＝人数 × 幅の時間 ÷ 1 人・日の時間）`,
      options: [
        { id: "no", label: "含まない（幅のまま時間にする）" },
        { id: "noon", label: "含む（12:00 からの昼休みと重なる分を幅から引く。何時間かは次に聞く）" },
        { id: "perDay", label: "幅は工数に使わない（1 行を 1 日として、人数を人・日にする）" },
        { id: "exclude", label: "工数を外す（理由を残す）" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: spanRows,
      items: spanItems,
    });
    if (lunch === "noon") {
      const a = ask.ask(`effortSpanLunchHours|${fkey}`, {
        kind: "effortUnknown",
        text: `${where}昼休みは 12:00 から何時間か（作業時間の幅と重なる分を引く）`,
        options: [],
        valueKind: "number",
        defaultAnswer: null,
        sameShapeRows: spanRows,
        items: spanItems,
      });
      lunchHours = a ? Number(a) : null;
    }
  }
  let hoursPer: number | null = null;
  const spanHours = spanRows > 0 && lunch !== "perDay" && lunch !== "exclude";
  if (hourCells.length || spanHours) {
    const n = hourCells.length + (spanHours ? spanRows : 0);
    const a = ask.ask(`hoursPerManDay|${fkey}`, {
      kind: "hoursPerManDay",
      text: !spanHours
        ? many
          ? `${where}工数が時間で書いてある行がある。1 人・日を何時間として人・日に直すか`
          : `工数が時間で書いてある行が ${hourCells.length} 行ある。1 人・日を何時間として人・日に直すか`
        : many
          ? `${where}工数を時間で数える行（時間で書いた工数か、人数 × 作業時間の幅）がある。1 人・日を何時間として人・日に直すか`
          : `工数を時間で数える行（時間で書いた工数か、人数 × 作業時間の幅）が ${n} 行ある。1 人・日を何時間として人・日に直すか`,
      options: [],
      valueKind: "number",
      defaultAnswer: "8",
      sameShapeRows: n,
      items: [...(hourCells.length ? [itemOf(lay, hourCells.slice(0, 10))] : []), ...(spanHours ? spanItems : [])],
    });
    hoursPer = a ? Number(a) : null;
  }
  // 人数だけで作業時間の無い行：人数を人・日の数としない。どう読むかを、同じ様式の表をまとめて 1 回聞く
  let noTimeAs: string | null = null;
  if (noTimeRows) {
    noTimeAs = ask.ask(`effortNoTime|${fkey}`, {
      kind: "effortUnknown",
      text: `${where}人数は書いてあるが、作業時間が書いていない行がある${many ? "" : `（${noTimeRows} 行）`}。人数を人・日の数としない。どう読むか`,
      options: [
        { id: "perDay", label: "1 行を 1 日として、人数を人・日にする" },
        { id: "exclude", label: "工数を外す（人数だけ分かる）" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: noTimeRows,
      items: noTimeItems,
    });
  }
  let personsAsMD: string | null = null;
  if (personCells.length) {
    personsAsMD = ask.ask(`effortPersons|${fkey}`, {
      kind: "effortUnknown",
      text: many
        ? `${where}工数が「N 人」（「延べ」の字なし）で書いてある行がある。1 行が 1 日なら人・日と同じ。どう読むか`
        : `工数が「N 人」（「延べ」の字なし）で書いてある行が ${personCells.length} 行ある。1 行が 1 日なら人・日と同じ。どう読むか`,
      options: [
        { id: "manDays", label: "1 行 1 日として人・日に読む" },
        { id: "exclude", label: "工数を外す（人数だけ分かる）" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: personCells.length,
      items: [itemOf(lay, personCells.slice(0, 10))],
    });
  }
  let bareAs: string | null = null;
  if (bareCells.length) {
    bareAs = ask.ask(`effortBare|${fkey}`, {
      kind: "effortUnknown",
      text: many ? `${where}工数が数だけで単位が無い行がある。単位は何か` : `工数が数だけで単位が無い行が ${bareCells.length} 行ある。単位は何か`,
      options: [
        { id: "manDays", label: "人・日" },
        { id: "hours", label: "時間" },
        { id: "exclude", label: "工数を外す" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: bareCells.length,
      items: [itemOf(lay, bareCells.slice(0, 10))],
    });
  }
  const effortExcluded = new Set<string>();
  for (const [shape, refs] of badEffort) {
    // 同じ様式の表の工数の列の読めない書き方は、書き方をまたいで 1 問（答えは「工数を外す」だけで、書き方によらない）
    const a = ask.ask(
      `effortBad|${t.id}|${shape}`,
      {
        kind: "effortUnknown",
        text: `工数の書き方が読めない（${refs.length} 行）`,
        options: [{ id: "exclude", label: "工数を外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: refs.length,
        items: [itemOf(lay, refs.slice(0, 10))],
      },
      sameForm("effortBad", fkey, String(effortCol?.c ?? "-"), (rows) => `工数の書き方が読めない（${rows} 行）`),
    );
    for (const ref of refs) a === "exclude" ? (exclude(ref, "読めない工数（決定で外した）"), effortExcluded.add(ref)) : pend(ref, questionIdOf(`effortBad|${t.id}|${shape}`));
  }
  // 作業時間の幅はあるが、人数の書き方が読めない行（書き方ごとに 1 回聞く。人数を推し量らない）
  const header = (ps?.cols[0]?.headerParts[0] ?? "人数").replace(/\s*\n\s*/g, "");
  for (const [shape, xs] of badPersons) {
    const refs = xs.flatMap((x) => x.refs);
    const a = ask.ask(`effortPersonsBad|${t.id}|${shape}`, {
      kind: "effortUnknown",
      text: `「${header}」の欄の人数の書き方が読めない（${xs.length} 行、見本「${(xs[0]?.sample ?? "").replace(/\s+/g, " ").slice(0, 24)}」）。人数を推し量らない`,
      options: [{ id: "exclude", label: "工数を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: xs.length,
      items: [itemOf(lay, refs.slice(0, 10))],
    });
    for (const ref of refs) a === "exclude" ? (exclude(ref, "人数の読めない行の工数（決定で外した）"), effortExcluded.add(ref)) : pend(ref);
  }
  for (const [shape, refs] of badDates) {
    // 読めなかった理由：年の無い月/日（シートに年度が 1 つだけ書いてあれば、その年度で読む）・読み方の規則の書き方に合わない・日付の書き方でない
    const sample = (() => {
      const m = /^([A-Z]+)(\d+)$/.exec(refs[0] ?? "");
      if (!m) return "";
      const c = t.cols.find((k) => colLetter(k.c) === m[1]);
      return c ? (lay.index.at(Number(m[2]), c.c)?.text ?? "") : "";
    })();
    const ruleFormat = [dateCol, endCol].find((c) => c?.dateFormat)?.dateFormat;
    const why = ruleFormat
      ? `ルールの書き方（${ruleFormat}）に合わない`
      : parseMonthDay(sample)
        ? "年が書いていない（シートの文に年度がただ 1 つ書いてあれば、その年度で読む）"
        : "日付の書き方として読めない";
    // 同じ様式の表の日付の列の、同じ理由で読めない書き方は 1 問（理由が違えば別の問い）
    const dateCols = [dateCol, endCol].map((c) => c?.c ?? "-").join(",");
    const a = ask.ask(
      `dateBad|${t.id}|${shape}`,
      {
        kind: "dateUnknown",
        text: `日付として読めない書き方がある（${refs.length} 行、見本「${sample.slice(0, 24)}」：${why}）。日付に見えない書き方を日付と決めつけない`,
        options: [{ id: "exclude", label: "その行を外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: refs.length,
        items: [itemOf(lay, refs.slice(0, 10))],
      },
      sameForm("dateBad", fkey, `${dateCols}|${why}`, (rows) => `日付として読めない書き方がある（${rows} 行、見本「${sample.slice(0, 24)}」：${why}）。日付に見えない書き方を日付と決めつけない`),
    );
    for (const e of evs)
      if (refs.some((ref) => e.refs.includes(ref))) {
        if (a === "exclude") e.excluded = "日付として読めない行（決定で外した）";
        else wait(e.id, `dateBad|${t.id}|${shape}`);
      }
  }
  // 日数の欄の、日数として読めない書き方（書き方ごとに 1 回聞く。答えるまで、そのセルは未解決）
  for (const [shape, refs] of badDays) {
    const a = ask.ask(
      `daysBad|${t.id}|${shape}`,
      {
        kind: "dateUnknown",
        text: `「${daysCol?.header ?? "日数"}」の列に、日数として読めない書き方がある（${refs.length} 行）。日数を推し量らない`,
        options: [{ id: "exclude", label: "日数を外す（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: refs.length,
        items: [itemOf(lay, refs.slice(0, 10))],
      },
      sameForm("daysBad", fkey, String(daysCol?.c ?? "-"), (rows) => `「${daysCol?.header ?? "日数"}」の列に、日数として読めない書き方がある（${rows} 行）。日数を推し量らない`),
    );
    for (const ref of refs) a === "exclude" ? exclude(ref, "日数として読めない（決定で外した）") : pend(ref, questionIdOf(`daysBad|${t.id}|${shape}`));
    if (a === "exclude") for (const e of evs) e.refs = e.refs.filter((x) => !refs.includes(x));
  }
  // 系列の欄の、号・系列として読めない書き方（書き方ごとに 1 回聞く。答えるまで、その行は未解決）
  for (const [text, cells] of unitBadEv) {
    const a = ask.ask(
      `unitUnknownEv|${t.id}|${text}`,
      {
        kind: "unitMissing",
        text: `「${unitCol?.header ?? "号"}」の列の「${text}」（${cells.length} 行）は、号・系列として読めない`,
        options: [{ id: "none", label: "号・系列なしとして読む" }, { id: "exclude", label: "この行を外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: cells.length,
        items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
      },
      sameForm("unitUnknownEv", fkey, `${unitCol?.c ?? "-"}|${text}`, (rows) => `「${unitCol?.header ?? "号"}」の列の「${text}」（${rows} 行）は、号・系列として読めない`),
    );
    const rows = new Set(cells.map((c) => c.row));
    for (const e of evs) {
      if (!rows.has(e.row)) continue;
      if (a === "none") e.unit = null;
      else if (a === "exclude") e.excluded = "号・系列として読めない行（決定で外した）";
      else {
        e.pending = true;
        wait(e.id, `unitUnknownEv|${t.id}|${text}`);
      }
    }
  }
  // 予定・実績の列の、計画とも実績とも読めない値（「延期」「中止」）：推し量らず、同じ字ごとに 1 回聞く（Architect の 62。前は黙って実績になった）
  if (paCol) {
    const odd = new Map<string, typeof evs>();
    for (const e of evs) {
      const x = text(e.row, paCol).trim();
      if (x === "" || cue.planActual(x) !== null) continue;
      odd.set(x, [...(odd.get(x) ?? []), e]);
    }
    for (const [x, es] of odd) {
      const a = ask.ask(
        `planActualUnknown|${t.id}|${x}`,
        {
          kind: "planActualUnknown",
          text: `「${paCol.header}」の列の「${x}」（${es.length} 行）は、計画か実績か読めない`,
          options: [
            { id: "plan", label: "計画" },
            { id: "actual", label: "実績" },
            { id: "exclude", label: "その行を外す" },
          ],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: es.length,
          items: [itemOf(lay, es.slice(0, 10).map((e) => lay.index.at(e.row, paCol.c)?.ref ?? ""))],
        },
        sameForm("planActualUnknown", fkey, `${paCol.c}|${x}`, (rows) => `「${paCol.header}」の列の「${x}」（${rows} 行）は、計画か実績か読めない`),
      );
      for (const e of es) {
        if (a === "plan") e.planOrActual = "plan";
        else if (a === "exclude") e.excluded = "予定・実績の読めない行（決定で外した）";
        else if (a !== "actual") {
          e.pending = true;
          wait(e.id, `planActualUnknown|${t.id}|${x}`);
        }
      }
    }
  }
  let spellOk: string | null = "yes";
  if (spellings.size > 1) {
    const all = [...spellings.values()].flat();
    // 同じ様式の表の同じ列で、書き方の組が同じものは 1 問（書き方の組ごとに 1 問）
    const kinds = [...spellings.keys()].sort();
    const spellText = `「${unitCol?.header ?? "号"}」の書き方が ${spellings.size} 通りある（${[...spellings.keys()].map((s) => s.replace("{n}", "1")).join("・")}）。数が同じなら同じ号として読むか`;
    spellOk = ask.ask(
      `unitSpelling|${t.id}`,
      {
        kind: "unitSpelling",
        text: spellText,
        options: YES_NO,
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: all.length,
        items: [...spellings.entries()].map(([s, refs]) => itemOf(lay, refs.slice(0, 5), { note: s })),
      },
      sameForm("unitSpelling", fkey, `${unitCol?.c ?? "-"}|${kinds.join("\u0001")}`),
    );
  }
  for (const e of evs) {
    if (e._hours !== null) {
      if (hoursPer) e.manDays = e._hours / hoursPer;
      else {
        e.effortPending = true;
        wait(e.id, `hoursPerManDay|${fkey}`);
      }
    }
    if (e._persons !== null) {
      if (personsAsMD === "manDays") e.manDays = e._persons;
      else if (personsAsMD !== "exclude") {
        e.effortPending = true;
        wait(e.id, `effortPersons|${fkey}`);
      } else effortExcluded.add(effortCol ? cellRef(e.row, effortCol.c) : "");
    }
    if (e._bare !== null) {
      if (bareAs === "manDays") e.manDays = e._bare;
      else if (bareAs === "hours" && hoursPer) e.manDays = e._bare / hoursPer;
      else if (bareAs === "exclude") effortExcluded.add(effortCol ? cellRef(e.row, effortCol.c) : "");
      else {
        e.effortPending = true;
        wait(e.id, bareAs === "hours" ? `hoursPerManDay|${fkey}` : `effortBare|${fkey}`);
      }
    }
    if (spellOk !== "yes" && e.unit?.kind === "number" && spellings.size > 1) {
      e.pending = true;
      if (spellOk === null) wait(e.id, `unitSpelling|${t.id}`);
    }
    // 人数 × 作業時間の幅 ÷ 1 人・日の時間（昼休みは答えのとおり）
    if (e._span) {
      const sp = e._span;
      if (lunch === "perDay") e.manDays = sp.persons;
      else if (lunch === "exclude") effortExcluded.add(sp.ref);
      else {
        const h = lunch === "no" ? sp.hours : lunch === "noon" && lunchHours ? sp.hours - lunchOverlap(sp, lunchHours) : null;
        if (h !== null && h > 0 && hoursPer) e.manDays = (sp.persons * h) / hoursPer;
        else e.effortPending = true;
      }
    }
    if (e._noTime) {
      if (noTimeAs === "perDay") e.manDays = e._noTime.persons;
      else if (noTimeAs === "exclude") for (const ref of e._noTime.refs) effortExcluded.add(ref);
      else e.effortPending = true;
    }
    if (spellOk !== "yes" && e.unit?.kind === "number" && spellings.size > 1) e.pending = true;
    for (const ref of effortExcluded) if (e.refs.includes(ref)) {
      e.refs = e.refs.filter((x) => x !== ref);
      exclude(ref, "工数を外した（決定）");
      // 作業明細の行に印を残す（年度の値の工数の和が合わない理由が見えるように。Architect の 43 の 4）
      e.effortExcluded = true;
    }
    if (e.excluded) for (const ref of e.refs) exclude(ref, e.excluded);
    else if (e.pending || e.effortPending) for (const ref of e.refs) pend(ref, waits.get(e.id) ?? null);
    const { _hours, _persons, _bare, _span, _noTime, ...clean } = e;
    void _hours;
    void _persons;
    void _bare;
    void _span;
    void _noTime;
    rec.events.push(clean);
  }
}

// ─── PDF の表の、何行にも折り返した記録（reader-pdf-blocks-v1） ─────────────────

/** 何行にも折り返した記録の、決定で外した理由（行き先の字） */
export const BLOCK_EXCLUDE = {
  stray: "名前の欄が空の行（決定で外した）",
  name: "名前の欄の並びが読めない記録（決定で外した）",
  work: "作業の内容の欄が空の記録（決定で外した）",
  period: "期間の書いていない記録（決定で外した）",
  state: "予定・実績の読めない記録（決定で外した）",
} as const;

/**
 * PDF の表の、何行にも折り返した記録（blocks.ts の塊）を、塊ごとに 1 つの記録にする。行ごとには聞かない。
 * - 名前の欄の行をつないで「設備 号炉 設備／部位」の並びを読み、機器の階層（設備 › 部位）の機器の記録にする。作業の記録は、その記録のいちばん下の段の機器に当てる。
 * - 期間（年月日のそろった期間・年の無い月-日の期間）→ 作業の期間と年度。年の無い期間は、資料の属性の工期、無ければシートの文の年度で年を補う。補えなければ 1 問にまとめて聞く。
 * - 状態の列の 1 行目（「実施済」→ 実績、「予定」→ 予定）。予定・実績の語で読めない短い字は 1 問にまとめて聞く。
 * - 施工量と工数の行 → 作業量と人・日（工数の前の語は職種として注記に残す）。
 * - ほかのまとまり（「根拠：」「判断：」「備考：」「施工記録 …」・結果の文）→ 記録の注記（作業明細の備考）。塊のどのセルも記録の出どころ（読めたもの）に数える。
 * 決まらないものは、同じ様式の表をまとめて 1 問にする（鍵は intake-group-v1 の形：問いの名前|様式|書き方）
 */
function blockRecords(t: Table, bt: BlockTable, lay: SheetLayout, ask: Asker, rec: Records, order: number, opts: RecordOptions, exclude: (ref: string, why: string) => void, pend: Pend, off: Off): number {
  const fkey = formKeyOf(rec, t);
  const form = rec.formOf.get(t.id);
  const many = (form?.tables.length ?? 1) > 1;
  const where = many ? `${filesLabel(form?.files ?? [])}（同じ様式）の表に、` : "";
  // 塊にできなかった行（名前の欄が空で、前に記録の無い行）：表ごとに 1 回聞く。同じ様式の表は 1 問（木の表の問いと同じ鍵の形）
  if (bt.strays.length) {
    const shown = bt.strays.slice(0, NO_NAME_ROWS_SHOWN).map((x) => x.r);
    const more = bt.strays.length - shown.length;
    const at = `${lay.file}${lay.sheet ? `「${lay.sheet}」` : ""}の ${shown.join("・")}${more > 0 ? ` ほか ${more}` : ""} 行目`;
    const key = `noNameRow|${t.id}`;
    const a = ask.ask(
      key,
      {
        kind: "stray",
        text: `名前の欄が空で、ほかの欄だけに中身がある行がある（${at}。${bt.strays.length} 行）`,
        options: [{ id: "exclude", label: "外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: bt.strays.length,
        items: bt.strays.map((x) => itemOf(lay, x.refs)),
      },
      sameForm("noNameRow", fkey, "-", (rows) => `名前の欄が空で、ほかの欄だけに中身がある行がある（${rows} 行）`),
    );
    for (const x of bt.strays) for (const ref of x.refs) if (!off(ref)) (a === "exclude" ? exclude(ref, BLOCK_EXCLUDE.stray) : pend(ref, questionIdOf(key)));
  }
  type Period = { start: Ymd; end: Ymd } | { md: { start: { m: number; d: number }; end: { m: number; d: number } } };
  interface Parsed {
    b: RecordBlock;
    refs: string[];
    lines: string[];
    nameRefs: string[][];
    name: ReturnType<typeof parseBlockName>;
    work: string | null;
    period: Period | null;
    periodText: string;
    state: "plan" | "actual" | null;
    stateText: string | null;
    quantity: string | null;
    manDays: number | null;
    notes: string[];
  }
  const parsed: Parsed[] = bt.records.map((b) => {
    const used = new Set<object>();
    const effortText = new Map<object, string>();
    const items = (c: number) => b.items.get(c) ?? [];
    // 期間：作業の内容の欄から、無ければほかの欄から（最初に読めたもの）
    let period: Period | null = null;
    let periodText = "";
    for (const c of [bt.workCol, ...[...b.items.keys()].filter((k) => k !== bt.workCol)]) {
      const it = items(c).find((x) => blockPeriod(x.text) !== null);
      if (it) {
        period = blockPeriod(it.text);
        periodText = it.text;
        used.add(it);
        break;
      }
    }
    // 作業の内容：作業の内容の欄の、期間でない最初のまとまり
    const workIt = items(bt.workCol).find((x) => !used.has(x));
    if (workIt) used.add(workIt);
    // 状態：状態の列の、記録の 1 行目の字
    let state: Parsed["state"] = null;
    let stateText: string | null = null;
    const st = bt.stateCol !== null ? items(bt.stateCol)[0] : undefined;
    if (st && st.rows[0] === b.rows[0]) {
      const x = st.text.replace(/[。．.]$/u, "").trim();
      const pa = cue.planActual(x);
      if (pa || (norm(x).length <= 10 && !/\d/u.test(x))) {
        state = pa;
        stateText = x;
        used.add(st);
      }
    }
    // 施工量と工数（最初の 1 行）
    let quantity: string | null = null;
    let manDays: number | null = null;
    for (const its of b.items.values())
      for (const it of its) {
        if (used.has(it) || manDays !== null) continue;
        const e = parseEffortLine(it.text);
        if (!e) continue;
        manDays = e.manDays;
        quantity = e.quantity.join(" / ") || null;
        effortText.set(it, e.trades.join(" / "));
      }
    // 注記：ほかのまとまり（列の順、行の順）。工数の行は職種と人工の字だけを残す
    const notes: string[] = [];
    for (const its of b.items.values())
      for (const it of its) {
        if (used.has(it)) continue;
        notes.push(effortText.get(it) ?? it.text);
      }
    return {
      b,
      refs: b.refs.filter((r) => !off(r)),
      lines: b.name.map((l) => l.text),
      nameRefs: b.name.map((l) => l.refs.filter((r) => !off(r))),
      name: parseBlockName(b.name.map((l) => l.text)),
      work: workIt ? workIt.text : null,
      period,
      periodText,
      state,
      stateText,
      quantity,
      manDays,
      notes,
    };
  });
  // ─── 決まらないものを、同じ様式の表をまとめて 1 問ずつ聞く ───
  const excluded = new Map<Parsed, string>();
  const waiting = new Map<Parsed, string>();
  const askAll = (key: string, part: string, list: Parsed[], q: Omit<Parameters<Asker["ask"]>[1], "sameShapeRows" | "items">, text: (rows: number) => string): string | null => {
    if (!list.length) return null;
    return ask.ask(
      key,
      { ...q, sameShapeRows: list.length, items: list.slice(0, 10).map((p) => itemOf(lay, p.refs.slice(0, 3))) },
      sameForm(key.split("|")[0] ?? key, fkey, part, text),
    );
  };
  const holdOrDrop = (list: Parsed[], key: string, a: string | null, why: string) => {
    for (const p of list) {
      if (excluded.has(p)) continue;
      if (a === "exclude") excluded.set(p, why);
      else if (!waiting.has(p)) waiting.set(p, questionIdOf(key));
    }
  };
  // 名前の欄の並びが読めない（号炉が 2 つ・名前が残らない）
  const badName = parsed.filter((p) => !p.name);
  const nameKeyQ = `blockName|${t.id}`;
  const nameAns = askAll(
    nameKeyQ,
    "-",
    badName,
    {
      kind: "eventAsset",
      text: `${where}名前の欄の並び（設備 号炉 設備／部位）が読めない記録がある（${badName.length} 記録、見本「${(badName[0]?.lines ?? []).join(" ").slice(0, 40)}」）。どう読むか`,
      options: [
        { id: "literal", label: "名前の欄の字のまま、1 つの機器にする" },
        { id: "exclude", label: "外す" },
      ],
      valueKind: "option",
      defaultAnswer: null,
    },
    (rows) => `${where}名前の欄の並び（設備 号炉 設備／部位）が読めない記録がある（${rows} 記録）。どう読むか`,
  );
  if (nameAns !== "literal") holdOrDrop(badName, nameKeyQ, nameAns, BLOCK_EXCLUDE.name);
  // 作業の内容が空
  const noWork = parsed.filter((p) => !p.work);
  const workKeyQ = `blockWork|${t.id}`;
  holdOrDrop(
    noWork,
    workKeyQ,
    askAll(workKeyQ, "-", noWork, { kind: "eventAsset", text: `${where}作業の内容の欄が空の記録がある（${noWork.length} 記録）`, options: [{ id: "exclude", label: "外す" }], valueKind: "option", defaultAnswer: null }, (rows) => `${where}作業の内容の欄が空の記録がある（${rows} 記録）`),
    BLOCK_EXCLUDE.work,
  );
  // 期間が書いていない
  const noPeriod = parsed.filter((p) => !p.period);
  const periodKeyQ = `blockPeriod|${t.id}`;
  holdOrDrop(
    noPeriod,
    periodKeyQ,
    askAll(
      periodKeyQ,
      "-",
      noPeriod,
      { kind: "dateUnknown", text: `${where}期間の書いていない記録がある（${noPeriod.length} 記録）。期間を推し量らない`, options: [{ id: "exclude", label: "外す" }], valueKind: "option", defaultAnswer: null },
      (rows) => `${where}期間の書いていない記録がある（${rows} 記録）。期間を推し量らない`,
    ),
    BLOCK_EXCLUDE.period,
  );
  // 年の無い期間：資料の属性の工期、無ければシートの文の年度で年を補う。補えなければ年度を 1 問で聞く
  const attrsPeriod = bt.attrs?.period ?? null;
  const withYear = (md: { start: { m: number; d: number }; end: { m: number; d: number } }, fiscal: number | null): { start: Ymd; end: Ymd } | null => {
    let start: Ymd | null = null;
    if (attrsPeriod && fiscal === null)
      for (const y of new Set([attrsPeriod.start.y, attrsPeriod.end.y])) {
        const s = { y, m: md.start.m, d: md.start.d };
        if (validYmd(s.y, s.m, s.d) && ymdString(s) >= ymdString(attrsPeriod.start) && ymdString(s) <= ymdString(attrsPeriod.end)) {
          start = s;
          break;
        }
      }
    const fy = fiscal ?? lay.contextFiscalYear;
    if (!start && fy !== null) start = withFiscalYear(md.start, fy, opts.fiscalYearStartMonth);
    if (!start) return null;
    const ey = md.end.m < md.start.m ? start.y + 1 : start.y;
    if (!validYmd(ey, md.end.m, md.end.d)) return null;
    const end = { y: ey, m: md.end.m, d: md.end.d };
    return ymdString(end) >= ymdString(start) ? { start, end } : null;
  };
  const dates = new Map<Parsed, { start: Ymd; end: Ymd }>();
  const noYear: Parsed[] = [];
  for (const p of parsed) {
    if (!p.period) continue;
    if ("md" in p.period) {
      const d = withYear(p.period.md, null);
      if (d) dates.set(p, d);
      else noYear.push(p);
    } else dates.set(p, p.period);
  }
  if (noYear.length) {
    const yearKeyQ = `blockYear|${t.id}`;
    const a = askAll(
      yearKeyQ,
      "-",
      noYear,
      {
        kind: "dateUnknown",
        text: `${where}期間に年が書いていない記録がある（${noYear.length} 記録、見本「${noYear[0]?.periodText.slice(0, 24) ?? ""}」）。資料の題・工期・年度から年を補えない。何年度の記録か（年度を数で答える）`,
        options: [],
        valueKind: "number",
        defaultAnswer: null,
      },
      (rows) => `${where}期間に年が書いていない記録がある（${rows} 記録）。資料の題・工期・年度から年を補えない。何年度の記録か（年度を数で答える）`,
    );
    const fy = a !== null && /^\d{4}$/.test(a.trim()) ? Number(a) : null;
    for (const p of noYear) {
      const d = fy !== null && p.period && "md" in p.period ? withYear(p.period.md, fy) : null;
      if (d) dates.set(p, d);
      else if (!waiting.has(p) && !excluded.has(p)) waiting.set(p, questionIdOf(yearKeyQ));
    }
  }
  // 予定・実績の語で読めない状態（「延期」「中止」など）：同じ字ごとに 1 問
  const odd = new Map<string, Parsed[]>();
  for (const p of parsed) if (p.stateText !== null && p.state === null) odd.set(p.stateText, [...(odd.get(p.stateText) ?? []), p]);
  for (const [x, list] of odd) {
    const key = `blockState|${t.id}|${x}`;
    const a = askAll(
      key,
      x,
      list,
      {
        kind: "planActualUnknown",
        text: `${where}状態の欄の「${x}」（${list.length} 記録）は、予定か実績か読めない`,
        options: [
          { id: "plan", label: "予定" },
          { id: "actual", label: "実績" },
          { id: "exclude", label: "その記録を外す" },
        ],
        valueKind: "option",
        defaultAnswer: null,
      },
      (rows) => `${where}状態の欄の「${x}」（${rows} 記録）は、予定か実績か読めない`,
    );
    for (const p of list) {
      if (a === "plan" || a === "actual") p.state = a;
      else holdOrDrop([p], key, a, BLOCK_EXCLUDE.state);
    }
  }
  // ─── 機器の階層と作業の記録 ───
  const assetIds = new Map<string, string>();
  const seriesOf = (u: UnitValue | null): Series | null => (!u ? null : u.kind === "number" ? { kind: "number", n: u.n } : u.kind === "common" ? { kind: "common", meaning: "" } : null);
  for (const p of parsed) {
    const why = excluded.get(p);
    if (why) {
      for (const ref of p.refs) exclude(ref, why);
      continue;
    }
    const nm = p.name ?? (nameAns === "literal" ? { unit: null, path: [p.lines.reduce((a, b) => joinWrap(a, b), "")], unitLevel: null } : null);
    let leaf: string | null = null;
    if (nm && nm.path.length) {
      const ukey = !nm.unit ? "-" : nm.unit.kind === "number" ? `n${nm.unit.n}` : nm.unit.kind;
      // 段の名前のセル：設備の短い名前が下の名前と同じなら、2 行目から（「号炉 設備／部位」の行）
      const shift = p.lines.length >= 2 && nm.path.length < p.lines.length ? 1 : 0;
      let parent: string | null = null;
      nm.path.forEach((name, i) => {
        const key = `${nm.unitLevel !== null && i >= nm.unitLevel ? ukey : "-"}|${nm.path
          .slice(0, i + 1)
          .map((x) => norm(x))
          .join("\u0001")}`;
        let id = assetIds.get(key);
        if (!id) {
          id = `${t.id}:a${questionIdOf(key).slice(2)}`;
          const ref = p.nameRefs[Math.min(i + shift, p.nameRefs.length - 1)]?.[0] ?? p.nameRefs[0]?.[0] ?? p.refs[0] ?? "";
          rec.assets.push({ id, file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, tableId: t.id, shape: "tree", order: order++, level: i + 1, parentId: parent, rawName: name, name, tag: null, tagNumber: null, nameRef: ref, series: i === nm.unitLevel ? seriesOf(nm.unit) : null, specs: [], installed: null, refs: [ref], excluded: null, pending: false });
          assetIds.set(key, id);
        }
        parent = id;
        leaf = id;
      });
    }
    const d = dates.get(p) ?? null;
    const same = d && ymdString(d.start) === ymdString(d.end);
    const remark = p.notes.join(" / ") || null;
    const q = waiting.get(p) ?? null;
    const e: EventRec = {
      id: `${t.id}:b${p.b.rows[0] ?? 0}`,
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      row: p.b.rows[0] ?? 0,
      date: d?.start ?? null,
      end: d && !same ? d.end : null,
      days: null,
      fiscalYear: d ? fiscalYearOf(d.start, opts.fiscalYearStartMonth) : null,
      manDays: p.manDays,
      effortPending: false,
      assetNames: nm?.path.length ? [nm.path[nm.path.length - 1] ?? ""] : [],
      ...(p.nameRefs[0]?.[0] ? { nameRef: p.nameRefs[0][0] } : {}),
      tag: null,
      bundle: false,
      unit: nm?.unit ?? null,
      workName: p.work ?? "",
      workTitle: null,
      remark,
      ...(p.quantity ? { quantity: p.quantity } : {}),
      ...(remark ? { lineRemark: remark } : {}),
      ...(p.state === "plan" ? { planOrActual: "plan" as const } : {}),
      refs: p.refs,
      excluded: null,
      pending: q !== null || !d || !p.work || !leaf,
      ...(leaf ? { assetId: leaf } : {}),
    };
    if (e.pending) for (const ref of e.refs) pend(ref, q);
    rec.events.push(e);
  }
  return order;
}

// ─── 契約・発注の一覧 ──────────────────────────────────────────

const CONTRACT_EXCLUDE_NONE = "空欄の印（「－」など）";

const CONTRACT_DATE_FIELDS: ReadonlySet<string> = new Set(["orderDate", "estimateDate", "period", "start", "end", "done", "inspectDate", "payDate", "changeDate", "due"]);
const CONTRACT_AMOUNT_FIELDS: ReadonlySet<string> = new Set(["orderAmount", "estimateAmount", "inspectAmount", "payAmount", "amount", "unitPrice", "firstAmount", "remainAmount"]);
/** 発注明細の字の欄（記録に字のまま持つ） */
const LINE_TEXT_FIELDS: ReadonlySet<string> = new Set<OrderLineTextField>(["orderNo", "lineNo", "revision", "item", "spec", "costKind", "quantity", "unitWord", "vendorCode", "inspectStatus", "currency"]);

/** 契約の一覧で外すセルの理由（行き先の字） */
export const CONTRACT_EXCLUDE = {
  staff: "契約の一覧の担当の欄（人の名前。契約の記録に使わない）",
  remark: "契約の一覧の備考の欄（契約の記録に使わない）",
  other: "契約の一覧の、契約の記録の形に無い欄",
  fiscal: "契約の一覧の年度の欄の、年度として読めない字",
  none: CONTRACT_EXCLUDE_NONE,
  emptyRow: "契約の一覧の、件名・業者・金額・日付の無い行",
  unitNone: "金額の欄（単位が決まらないので読まない）",
  badAmount: "金額として読めない書き方（決定で金額を置かない）",
  badDate: "日付として読めない書き方（決定で日付を置かない）",
} as const;

/** 発注明細で外すセルの理由（行き先の字）。前の改訂の行は行ごと外す */
export const ORDER_LINE_EXCLUDE = {
  superseded: "発注明細の前の改訂の行（同じ明細番号のあとの改訂に置き換わった。最後の改訂だけを数える）",
  staff: "発注明細の担当の欄（人の名前。記録に使わない）",
  remark: "発注明細の備考の欄（記録に使わない）",
  other: "発注明細の、記録の形に無い欄",
  fiscal: "発注明細の年度の欄の、年度として読めない字",
  none: CONTRACT_EXCLUDE_NONE,
  emptyRow: "発注明細の、品名・件名・業者・金額・日付の無い行",
  unitNone: "金額の欄（単位が決まらないので読まない）",
  badAmount: "金額として読めない書き方（決定で金額を置かない）",
  badDate: "日付として読めない書き方（決定で日付を置かない）",
} as const;

/**
 * 表の上の題と抽出の条件の行の、金額の単位と税の扱い（「金額：円・税抜」）と年度（「工事年度｜2019」）。
 * 違う値が 2 つ以上書いてあれば、どれも使わない（null）
 */
function tableConditions(t: Table): { unit: number | null; tax: "incl" | "excl" | null; fiscalYear: number | null } {
  const conds = t.conditions ?? [];
  const one = <T>(xs: T[]): T | null => (new Set(xs).size === 1 ? (xs[0] ?? null) : null);
  const money = conds.filter((c) => cue.column(c.label) === "cost" || (UNIT_LABEL.test(norm(c.label)) && costHeaderUnit(c.value) !== null));
  const units = money.map((c) => costHeaderUnit(c.value)).filter((u): u is number => u !== null);
  const taxes = money.map((c) => costHeaderTax(c.value)).filter((x): x is "incl" | "excl" => x !== null);
  const years = conds.filter((c) => cue.column(c.label) === "fiscal").map((c) => parseYearLabel(c.value)?.year ?? null).filter((y): y is number => y !== null);
  return { unit: one(units), tax: one(taxes), fiscalYear: one(years) };
}

/** 列の見出しの名前（2 段の見出しは「上の段（下の段）」） */
function contractLabel(c: ColInfo): string {
  const ps = c.headerParts.map((p) => p.replace(/\s*\n\s*/g, "").trim()).filter((p) => p !== "");
  return ps.length >= 2 ? `${ps[0]}（${ps[ps.length - 1]}）` : (ps[0] ?? "");
}

/**
 * 契約・発注の一覧の表（structure.ts の contracts の形）：1 行を 1 つの契約の記録にする。作業にはしない。
 * どのセルも、記録に読んだもの（データ）か、理由つきで外したもの（担当・備考・記録の形に無い欄）に数える。
 * 決まらない所（金額の単位・読めない金額・読めない日付）だけを、同じ様式の表をまとめて聞く（年度ごとのシート・年度ごとの CSV で 1 問）
 */
function contractRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, opts: RecordOptions, date1904: boolean, exclude: (ref: string, why: string) => void, pend: Pend, off: Off) {
  const formKey = formKeyOf(rec, t);
  const data = t.rows.filter((r) => r.role === "data");
  const colAt = new Map(t.cols.map((c) => [c.c, c]));
  const lines = t.shape === "orderLines";
  const what = lines ? "発注明細" : "契約の一覧";
  const EX = lines ? ORDER_LINE_EXCLUDE : CONTRACT_EXCLUDE;
  const cellsOf = (c: ColInfo) => data.map((r) => lay.index.at(r.r, c.c)).filter((x): x is GridCell => !!x && x.text.trim() !== "" && !off(x.ref) && !isNone(x.text));
  // 表の上の題と抽出の条件の行の、金額の項目（「金額：円・税抜」）と年度の項目（「工事年度｜2019」）。どちらも 1 つに決まるときだけ使う
  const cond = tableConditions(t);
  // 金額の単位：見出しに書いてあればそれ、無ければ題と条件の行の金額の項目。どちらにも書いていない金額の欄は、まとめて 1 回聞く（推し量らない）
  const amountCols = t.cols.filter((c) => !c.ruleExclude && CONTRACT_AMOUNT_FIELDS.has(c.contract ?? ""));
  const unitOf = new Map<number, number | "none" | null>();
  for (const c of amountCols) {
    const u = costHeaderUnit(c.header) ?? cond.unit;
    if (u !== null) unitOf.set(c.c, u);
  }
  const taxOf = (c: ColInfo) => costHeaderTax(c.header) ?? (costHeaderUnit(c.header) === null ? cond.tax : null) ?? "unknown";
  const noUnit = amountCols.filter((c) => !unitOf.has(c.c) && cellsOf(c).length > 0);
  let unitQ: string | null = null;
  if (noUnit.length) {
    const key = `contractUnit|${t.id}`;
    const cells = noUnit.flatMap(cellsOf);
    const rows = new Set(cells.map((c) => c.r)).size;
    const names = noUnit.map((c) => `「${contractLabel(c)}」`).join("");
    const text = (n: number) => `${what}の金額の欄（${names}）の単位が、見出しに書いてない（${n} 行）。単位を推し量らない`;
    const a = ask.ask(
      key,
      {
        kind: "costUnit",
        text: text(rows),
        options: [
          { id: "1", label: "円" },
          { id: "1000", label: "千円" },
          { id: "10000", label: "万円" },
          { id: "none", label: "この欄を読まない（理由を残す）" },
        ],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: rows,
        items: [itemOf(t, cells.slice(0, 10).map((c) => c.ref))],
      },
      sameForm("contractUnit", formKey, noUnit.map((c) => c.c).join(","), text),
    );
    unitQ = questionIdOf(key);
    for (const c of noUnit) unitOf.set(c.c, a === null ? null : a === "none" ? "none" : Number(a));
  }
  const badAmounts: GridCell[] = [];
  const badDates: GridCell[] = [];
  const prevText = new Map<number, string>();
  const prevDate = new Map<number, { start: Ymd; end: Ymd }>();
  let prev: ContractRec | null = null;
  const text1 = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
  for (const r of data) {
    const cells = lay.index.rowCells(r.r).filter((c) => !off(c.ref));
    if (!cells.length) continue;
    const c0: ContractRec = {
      id: `${t.id}#${r.r}`,
      file: t.file,
      sheet: t.sheet,
      sheetIndex: t.sheetIndex,
      tableId: t.id,
      row: r.r,
      number: null,
      title: null,
      titleRef: null,
      changeOf: null,
      category: null,
      method: null,
      vendor: null,
      unitPrice: false,
      amounts: [],
      dates: [],
      period: null,
      fiscalYear: null,
      refs: [],
    };
    const texts: OrderLineRec["texts"] = {};
    let itemRef: string | null = null;
    let fiscalCol: number | null = null;
    const putText = (col: ColInfo, cell: GridCell): string => {
      const v = cue.isDitto(cell.text) ? (prevText.get(col.c) ?? "") : text1(cell.text);
      prevText.set(col.c, v);
      return v;
    };
    const putDate = (f: string, d: Ymd, ref: string) => c0.dates.push({ field: f as ContractRec["dates"][number]["field"], date: d, ref });
    for (const cell of cells) {
      const col = colAt.get(cell.c);
      const f = col?.contract ?? "other";
      if (!col || cell.text.trim() === "") {
        if (col && f !== "staff" && f !== "remark" && f !== "other") c0.refs.push(cell.ref);
        else exclude(cell.ref, f === "staff" ? EX.staff : f === "remark" ? EX.remark : EX.other);
        continue;
      }
      if (f === "staff") exclude(cell.ref, EX.staff);
      else if (f === "remark") exclude(cell.ref, EX.remark);
      else if (f === "other") exclude(cell.ref, EX.other);
      else if (lines && LINE_TEXT_FIELDS.has(f)) {
        texts[f as OrderLineTextField] = putText(col, cell);
        if (f === "item" || (f === "spec" && itemRef === null)) itemRef = cell.ref;
        c0.refs.push(cell.ref);
      } else if (f === "title") {
        // 変更契約の行（「〃（第1回変更）」）：上の契約と同じ件名。別の契約として結ばない
        if (cue.startsWithDitto(cell.text) && prev) {
          c0.changeOf = prev.changeOf ?? prev.id;
          c0.title = prev.title;
        } else c0.title = text1(cell.text);
        c0.titleRef = cell.ref;
        c0.refs.push(cell.ref);
      } else if (f === "number" || f === "rowNo") {
        if (f === "number") c0.number = text1(cell.text);
        c0.refs.push(cell.ref);
      } else if (f === "category" || f === "method" || f === "vendor") {
        c0[f] = putText(col, cell);
        c0.refs.push(cell.ref);
      } else if (f === "fiscal") {
        const y = typeof cell.value === "number" && Number.isInteger(cell.value) ? (parseYearLabel(String(cell.value))?.year ?? null) : (parseYearLabel(cell.text)?.year ?? null);
        if (y === null) exclude(cell.ref, EX.fiscal);
        else {
          fiscalCol = y;
          c0.refs.push(cell.ref);
        }
      } else if (isNone(cell.text)) exclude(cell.ref, EX.none);
      else if (CONTRACT_AMOUNT_FIELDS.has(f)) {
        const unit = unitOf.get(col.c) ?? null;
        if (unit === null) pend(cell.ref, unitQ);
        else if (unit === "none") exclude(cell.ref, EX.unitNone);
        else {
          const yen = parseCost(cell.text, cell.value, unit);
          if (yen === null) badAmounts.push(cell);
          else {
            c0.amounts.push({ field: f as ContractRec["amounts"][number]["field"], header: contractLabel(col), cost: { yen, ref: cell.ref, text: cell.text, tax: taxOf(col) } });
            c0.refs.push(cell.ref);
          }
        }
      } else if (CONTRACT_DATE_FIELDS.has(f)) {
        let p: { start: Ymd; end: Ymd } | null = cue.isDitto(cell.text) ? (prevDate.get(col.c) ?? null) : cellPeriod(cell, date1904);
        if (!p && lay.contextFiscalYear !== null && typeof cell.value === "string") {
          const md = parseMonthDay(cell.value);
          const ymd = md ? withFiscalYear(md, lay.contextFiscalYear, opts.fiscalYearStartMonth) : null;
          if (ymd) p = { start: ymd, end: ymd };
        }
        if (!p) badDates.push(cell);
        else {
          prevDate.set(col.c, p);
          if (f === "period") {
            putDate("start", p.start, cell.ref);
            putDate("end", p.end, cell.ref);
          } else putDate(f, f === "end" ? p.end : p.start, cell.ref);
          c0.refs.push(cell.ref);
        }
      } else c0.refs.push(cell.ref);
    }
    // 件名・品名・業者・金額・日付のどれも無い行（番号だけの行など）は、記録にしない
    if (c0.title === null && !texts.item && !texts.spec && c0.vendor === null && !c0.amounts.length && !c0.dates.length) {
      for (const ref of c0.refs) exclude(ref, EX.emptyRow);
      continue;
    }
    const at = (f: string) => c0.dates.find((d) => d.field === f)?.date ?? null;
    const start = at("start");
    const end = at("end");
    c0.period = start && end ? { start, end } : start ? { start, end: start } : end ? { start: end, end } : null;
    c0.unitPrice = [c0.title, c0.method, c0.category].some((x) => !!x && cue.isUnitPrice(x));
    if (lines) {
      // 発注明細の年度：題と条件の行の年度（「工事年度｜2019」）→ 年度の列 → 工事名称の年度 → 検収・納期・発注の日の年度。
      // 実績（検収のある行）・予定（無い行）と、年度の値の費用の候補（実績は検収累計額、予定は発注額）
      const dated = at("inspectDate") ?? at("due") ?? at("orderDate") ?? at("changeDate");
      c0.fiscalYear = cond.fiscalYear ?? fiscalCol ?? (c0.title ? fiscalYearInText([c0.title]) : null) ?? (dated ? fiscalYearOf(dated, opts.fiscalYearStartMonth) : null);
      const amount = (f: string) => c0.amounts.find((a) => a.field === f)?.cost ?? null;
      const inspected = (amount("inspectAmount")?.yen ?? 0) > 0 || at("inspectDate") !== null;
      const pa = inspected ? "actual" : "plan";
      const cost = inspected ? ((amount("inspectAmount")?.yen ?? 0) > 0 ? amount("inspectAmount") : amount("orderAmount")) : (amount("orderAmount") ?? amount("firstAmount"));
      c0.line = {
        texts,
        target: splitOrderItem([texts.item ?? null, texts.spec ?? null]),
        itemRef,
        planOrActual: pa,
        cost,
        cells: cells.map((c) => c.ref),
      };
    } else {
      const first = start ?? at("orderDate") ?? at("estimateDate") ?? at("done") ?? at("inspectDate") ?? at("payDate") ?? end;
      c0.fiscalYear = first ? fiscalYearOf(first, opts.fiscalYearStartMonth) : (fiscalCol ?? cond.fiscalYear ?? lay.contextFiscalYear);
    }
    rec.contracts.push(c0);
    prev = c0;
  }
  if (badAmounts.length) {
    const key = `contractCostBad|${t.id}`;
    const text = (n: number) => `${what}の金額の欄に、金額として読めない書き方がある（${n} 行）。金額を推し量らない`;
    const rows = new Set(badAmounts.map((c) => c.r)).size;
    const a = ask.ask(
      key,
      {
        kind: "costBad",
        // 費用の字は AI に渡さない（見本を出さず、件数だけ）
        text: text(rows),
        options: [{ id: "none", label: "その金額を置かない（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: "none",
        sameShapeRows: rows,
        items: [itemOf(t, badAmounts.slice(0, 10).map((c) => c.ref))],
      },
      sameForm("contractCostBad", formKey, "", text),
    );
    for (const c of badAmounts) a === "none" ? exclude(c.ref, EX.badAmount) : pend(c.ref, questionIdOf(key));
  }
  if (badDates.length) {
    const key = `contractDate|${t.id}`;
    const rows = new Set(badDates.map((c) => c.r)).size;
    const samples = [...new Set(badDates.map((c) => text1(c.text).slice(0, 20)))].slice(0, 3).map((x) => `「${x}」`).join("");
    const text = (n: number) => `${what}の日付の欄に、日付として読めない書き方がある（${n} 行。見本 ${samples}）。日付を推し量らない`;
    const a = ask.ask(
      key,
      {
        kind: "dateUnknown",
        text: text(rows),
        options: [{ id: "exclude", label: "その日付を置かない（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: "exclude",
        sameShapeRows: rows,
        items: [itemOf(t, badDates.slice(0, 10).map((c) => c.ref))],
      },
      sameForm("contractDate", formKey, "", text),
    );
    for (const c of badDates) a === "exclude" ? exclude(c.ref, EX.badDate) : pend(c.ref, questionIdOf(key));
  }
}

// ─── 工程表（ガント）（reader-gantt-v1） ─────────────────────────────

/**
 * 工程表の表（gantt.ts で見分けたもの）を記録にする。
 * - 名前の段の行 → 機器の階層（左の列から段。号炉の見出し・号炉の列・名前の頭の号は、いちばん深い段の機器の系列）。
 * - 作業の行（作業の欄の行。作業の欄の無い表は、時の列に数・線・日数・工数のある名前の行）→ 作業の記録。機器は、その行か上の名前の段の機器（名前で引かない）。
 * - 施工の期間：行の上の線・四角の図形の、from の列から to の列までの時の列の日。時の列に数のある行は、数のある続く列を 1 つの期間にし、
 *   飛んだ列は別の期間にする。週の列の期間の終わりは週の終わりの日（数から決めない。数は期間の中の施工の日数）。
 * - 年度の値は実績（工程表は施工の記録）。題・注記に予定・計画の語があれば予定にし、1 問で確かめる。
 * - 工数：工数の列（「人工計」「延べ人工」）。1 つの行のいくつかの期間には、行の工数を最初の期間に置く（期間に割り振らない）。
 * - 行の和の行（号炉の見出しの数・「本頁 ○○計」）は、下（上）の作業の行から数えた値と照らす。合えば理由つきで外し、合わなければ小計の食い違いの問い。
 */
function ganttRecords(t: Table, g: GanttTable, lay: SheetLayout, ask: Asker, rec: Records, order: number, opts: RecordOptions, exclude: (ref: string, why: string) => void, pend: Pend, off: Off): number {
  const fkey = formKeyOf(rec, t);
  const form = rec.formOf.get(t.id);
  const many = (form?.tables.length ?? 1) > 1;
  const where = many ? `${filesLabel(form?.files ?? [])}（同じ様式）の工程表に、` : "工程表に、";
  const at = (r: number, c: number) => lay.index.at(r, c);
  const live = (x: GridCell | null | undefined): x is GridCell => !!x && x.text.trim() !== "" && !off(x.ref);
  const colsOf = (role: GanttCol["role"]) => g.cols.filter((c) => c.role === role).sort((a, b) => a.c - b.c);
  const effortCol = colsOf("effort")[0];
  const daysCol = colsOf("days")[0];
  const tagCol = colsOf("tag")[0];
  const workCol = colsOf("work")[0];
  const unitCols = colsOf("unit");
  const remarkCols = colsOf("remark");
  const first = g.times[0]?.c ?? 0;
  const last = g.times[g.times.length - 1]?.c ?? 0;
  const timeIndex = new Map(g.times.map((x, i) => [x.c, i]));
  const num = (x: GridCell | null | undefined): number | null =>
    !x ? null : typeof x.value === "number" ? x.value : typeof x.value === "string" && /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(x.value) ? Number(x.value.replace(/,/g, "")) : null;
  const items = (refs: string[]) => [itemOf(lay, refs.slice(0, 10))];
  for (const ref of g.monthRefs) if (!off(ref)) exclude(ref, GANTT_REASON.month);

  // ─── 時の列の日：年の無い月/日は、シートの名前・題の年度と年度の始まりの月から年を補う。補えなければ年度を 1 問で聞く ───
  let fiscal: number | null = g.yearHint?.fiscalYear ?? null;
  let dates: Ymd[] | null = g.times.every((x) => x.ymd) ? g.times.map((x) => x.ymd as Ymd) : fiscal !== null ? datesOfTimes(g.times, fiscal, opts.fiscalYearStartMonth) : null;
  let datesQ: string | null = null;
  if (!dates) {
    const key = `ganttYear|${t.id}`;
    const sample = g.times
      .slice(0, 3)
      .map((x) => `${x.md.m}/${x.md.d}`)
      .join("・");
    const a = ask.ask(key, {
      kind: "yearUnknown",
      text: `${lay.file}${lay.sheet ? `「${lay.sheet}」` : ""}の工程表の時の列の日付（${sample}…）に年が書いていない。シートの名前・題から年度を補えない。何年度の工程表か（年度を数で答える）`,
      options: [],
      valueKind: "number",
      defaultAnswer: null,
      sameShapeRows: 1,
      items: items(g.times.slice(0, 3).map((x) => x.ref)),
    });
    const fy = a !== null && /^\d{4}$/.test(a.trim()) ? Number(a) : null;
    if (fy !== null) {
      fiscal = fy;
      dates = datesOfTimes(g.times, fy, opts.fiscalYearStartMonth);
    }
    if (!dates) datesQ = questionIdOf(key);
  }
  if (fiscal === null && dates) {
    // 日付のそろった時の列：年度の中の日がいちばん多い年度
    const n = new Map<number, number>();
    for (const d of dates) n.set(fiscalYearOf(d, opts.fiscalYearStartMonth), (n.get(fiscalYearOf(d, opts.fiscalYearStartMonth)) ?? 0) + 1);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    fiscal = top && top[1] * 2 > dates.length ? top[0] : null;
  }
  const workRows = g.rows.filter((x) => x.kind === "work" || (x.kind === "node" && x.work));

  // ─── 予定・実績：工程表は施工の記録（実績）。題・注記に予定・計画の語があれば、予定として読むかを 1 問で確かめる ───
  let plan = false;
  let planQ: string | null = null;
  if (g.planWord && workRows.length) {
    const key = `ganttPlan|${t.id}`;
    const text = (rows: number) => `${where}題・注記に「${g.planWord}」の語がある（見本「${g.title.slice(0, 40)}」。作業の行 ${rows}）。行の期間を予定として読むか`;
    const a = ask.ask(
      key,
      {
        kind: "planActualUnknown",
        text: text(workRows.length),
        options: [
          { id: "plan", label: "予定として読む" },
          { id: "actual", label: "実績（施工の記録）として読む" },
        ],
        valueKind: "option",
        defaultAnswer: "plan",
        sameShapeRows: workRows.length,
        items: items(workRows.slice(0, 10).map((x) => at(x.r, workCol?.c ?? 0)?.ref ?? x.names[x.names.length - 1]?.cell.ref ?? "")),
      },
      sameForm("ganttPlan", fkey, g.planWord, text),
    );
    if (a === "plan") plan = true;
    else if (a !== "actual") planQ = questionIdOf(key);
  }

  // ─── 工数の単位：見出し（「人工計」「延べ人工」は人・日、「時間」は時間）。決まらなければ 1 問。時間は題・注記の「人工＝8時間」で人・日に直す ───
  const headerEffortUnit = (h: string): "manDays" | "hours" | null =>
    cue.headerUnit(h) ?? (containsAny(h, CUES.headerUnit.manDays) ? "manDays" : CUES.headerUnit.hours.some((w) => norm(w).length > 1 && norm(h).includes(norm(w))) ? "hours" : null);
  let effortUnit = effortCol ? headerEffortUnit(effortCol.header) : null;
  let effortQ: string | null = null;
  const effortCells = effortCol ? workRows.map((x) => at(x.r, effortCol.c)).filter(live) : [];
  if (effortCol && effortUnit === null && effortCells.some((x) => num(x) !== null)) {
    const key = `ganttEffortUnit|${t.id}`;
    const text = (rows: number) => `${where}工数の欄「${effortCol.header}」の数に単位が無い（${rows} 行）。単位は何か`;
    const a = ask.ask(
      key,
      {
        kind: "effortUnknown",
        text: text(effortCells.length),
        options: [
          { id: "manDays", label: "人・日（人工）" },
          { id: "hours", label: "時間" },
        ],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: effortCells.length,
        items: items(effortCells.map((x) => x.ref)),
      },
      sameForm("ganttEffortUnit", fkey, norm(effortCol.header), text),
    );
    if (a === "manDays" || a === "hours") effortUnit = a;
    else effortQ = questionIdOf(key);
  }
  let hoursPer: number | null = g.hoursPerManDay?.hours ?? null;
  const needHours = effortUnit === "hours" || effortCells.some((x) => parseEffort(x.text)?.unit === "hours");
  if (needHours && hoursPer === null) {
    const key = `ganttHoursPerManDay|${t.id}`;
    const a = ask.ask(
      key,
      {
        kind: "hoursPerManDay",
        text: `${where}工数が時間で書いてある。題・注記に 1 人・日の時間（「人工＝8時間」）が無い。1 人・日を何時間として人・日に直すか`,
        options: [],
        valueKind: "number",
        defaultAnswer: "8",
        sameShapeRows: effortCells.length,
        items: items(effortCells.map((x) => x.ref)),
      },
      sameForm("ganttHoursPerManDay", fkey, "-"),
    );
    hoursPer = a !== null && Number(a) > 0 ? Number(a) : null;
    if (hoursPer === null) effortQ ??= questionIdOf(key);
  }
  /** 工数のセル → 人・日。決まらなければ null（effortQ を待つ） */
  const manDaysOf = (x: GridCell): number | null => {
    const e = parseEffort(typeof x.value === "number" ? x.value : x.text);
    if (!e) return null;
    const unit = e.unit === "bare" ? effortUnit : e.unit === "manDays" || e.unit === "hours" ? e.unit : null;
    if (unit === "manDays") return e.amount;
    if (unit === "hours" && hoursPer) return Math.round((e.amount / hoursPer) * 1000) / 1000;
    return null;
  };

  // ─── 機器の階層 ───
  const assetIds = new Map<string, AssetRec>();
  const path: (AssetRec | null)[] = [];
  let heading: { series: Series; ref: string; used: boolean } | null = null;
  const headings: { ref: string; used: () => boolean }[] = [];
  /** 名前の段の行の、名前のほかのセル（作業の番号など）：その機器の下の作業の行の備考 */
  const nodeNotes = new Map<string, string[]>();
  const seriesOfUnit = (u: UnitValue | null): Series | null => (!u ? null : u.kind === "number" ? { kind: "number", n: u.n } : u.kind === "common" ? { kind: "common", meaning: "" } : null);
  const nodeOf = (x: GanttRow): AssetRec | null => {
    let leaf: AssetRec | null = null;
    const deepest = x.names[x.names.length - 1]?.level ?? 0;
    for (const { level, cell } of x.names) {
      if (off(cell.ref)) continue;
      const raw = cell.text.replace(/\s*\n\s*/g, " ").trim();
      let name = raw;
      let series: Series | null = null;
      const refs = [cell.ref];
      let tag: string | null = null;
      if (level === deepest) {
        const lead = splitUnitPrefix(raw);
        if (lead) {
          name = lead.name;
          series = { kind: "number", n: lead.n };
        }
        for (const uc of unitCols) {
          const u = at(x.r, uc.c);
          if (!live(u) || isNone(u.text)) continue;
          const s = seriesOfUnit(parseUnit(u.text));
          if (s) {
            series ??= s;
            refs.push(u.ref);
          }
        }
        // 号炉の見出しの系列は、いちばん深い名前の段（機器）の機器にだけ付ける（上の段の設備は号炉をまたいで 1 つ）
        if (!series && heading && level === g.levels) series = heading.series;
        const tc = tagCol ? at(x.r, tagCol.c) : null;
        if (live(tc)) {
          tag = nfkc(tc.text).trim();
          refs.push(tc.ref);
        }
      }
      if (heading) {
        heading.used = true;
        refs.push(heading.ref);
      }
      let parent: AssetRec | null = null;
      for (let k = level - 1; k >= 1 && !parent; k--) parent = path[k] ?? null;
      const key = `${parent?.id ?? "-"}|${norm(name)}|${seriesKey(series)}|${tag ? norm(tag) : ""}`;
      let a = assetIds.get(key);
      if (!a) {
        a = { id: `${t.id}:a${questionIdOf(key).slice(2)}`, file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, tableId: t.id, shape: "tree", order: order++, level, parentId: parent?.id ?? null, rawName: raw, name, tag, tagNumber: tag ? tagTrailingNumber(tag) : null, nameRef: cell.ref, series, specs: [], installed: null, refs: [], excluded: null, pending: false };
        assetIds.set(key, a);
        rec.assets.push(a);
      }
      for (const ref of refs) if (!a.refs.includes(ref)) a.refs.push(ref);
      path[level] = a;
      for (let k = level + 1; k < path.length; k++) path[k] = null;
      leaf = a;
    }
    // 名前の段の行の、名前・号・番号のほかのセル（作業の行でない行）：その機器の出どころにし、下の作業の行の備考にする
    if (leaf && !x.work) {
      const own = new Set([...leaf.refs]);
      const rest = lay.index.rowCells(x.r).filter((c) => live(c) && !own.has(c.ref) && !x.names.some((n) => n.cell.ref === c.ref));
      for (const c of rest) {
        leaf.refs.push(c.ref);
        nodeNotes.set(leaf.id, [...(nodeNotes.get(leaf.id) ?? []), c.text.trim()]);
      }
    }
    return leaf;
  };
  const nearest = (): AssetRec | null => {
    for (let k = path.length - 1; k >= 1; k--) if (path[k]) return path[k] ?? null;
    return null;
  };

  // ─── 行ごと ───
  interface Period {
    from: number;
    to: number;
    days: number | null;
    refs: string[];
  }
  interface Work {
    x: GanttRow;
    asset: AssetRec | null;
    periods: Period[];
    /** 時の列の数のある行（数で施工の日を書いた行） */
    counted: boolean;
    effort: number | null;
    effortRef: string | null;
    effortPending: boolean;
    daysCell: GridCell | null;
    refs: string[];
    notes: string[];
  }
  const works: Work[] = [];
  const sums: { x: GanttRow; heading: boolean; index: number }[] = [];
  const strays: GanttRow[] = [];
  g.rows.forEach((x, index) => {
    if (x.kind === "band") return;
    if (x.kind === "unit") {
      const label = lay.index.rowCells(x.r).find((c) => live(c) && (c.c < first || c.c > last) && !colsOf("effort").concat(colsOf("days")).some((k) => k.c === c.c));
      const u = label ? unitHeading(label.text) : null;
      const s = seriesOfUnit(u);
      if (label && s) {
        const h = { series: s, ref: label.ref, used: false };
        heading = h;
        headings.push({ ref: label.ref, used: () => h.used });
        for (let k = 0; k < path.length; k++) path[k] = null;
      }
      if (lay.index.rowCells(x.r).some((c) => live(c) && c !== label && num(c) !== null)) sums.push({ x, heading: true, index });
      return;
    }
    if (x.kind === "sum") {
      sums.push({ x, heading: false, index });
      return;
    }
    if (x.kind === "stray") {
      strays.push(x);
      return;
    }
    const node = x.names.length ? nodeOf(x) : null;
    if (!x.work) return;
    const asset = x.kind === "node" ? node : nearest();
    const refs: string[] = [];
    const notes: string[] = [];
    const cells = lay.index.rowCells(x.r).filter(live);
    const own = new Set(node ? node.refs : []);
    // 時の列：数のある列（0 より大きい）の続く並びを 1 つの期間にする。数が無ければ線・四角の図形
    const marks = cells.filter((c) => timeIndex.has(c.c));
    const numbered = marks.filter((c) => (num(c) ?? 0) > 0).sort((a, b) => a.c - b.c);
    const periods: Period[] = [];
    if (numbered.length) {
      for (const c of numbered) {
        const i = timeIndex.get(c.c) ?? 0;
        const p = periods[periods.length - 1];
        const n = num(c) ?? 0;
        if (p && (timeIndex.get(p.to) ?? -9) === i - 1) {
          p.to = c.c;
          p.days = (p.days ?? 0) + (g.step === 7 ? n : 1);
          p.refs.push(c.ref);
        } else periods.push({ from: c.c, to: c.c, days: g.step === 7 ? n : 1, refs: [c.ref] });
      }
    } else {
      const spans = [...x.bars].sort((a, b) => a.from - b.from);
      for (const b of spans) {
        const p = periods[periods.length - 1];
        if (p && (timeIndex.get(b.from) ?? 0) <= (timeIndex.get(p.to) ?? 0) + 1) p.to = Math.max(p.to, b.to);
        else periods.push({ from: b.from, to: b.to, days: null, refs: [] });
      }
      for (const p of periods) p.days = g.step === 1 ? (timeIndex.get(p.to) ?? 0) - (timeIndex.get(p.from) ?? 0) + 1 : null;
    }
    // 時の列のほかのセル（数の 0・字の印）：記録の出どころ。字は作業明細の備考
    for (const c of marks) {
      if (numbered.includes(c)) continue;
      refs.push(c.ref);
      if (num(c) === null) notes.push(c.text.trim());
    }
    const wc = workCol ? at(x.r, workCol.c) : null;
    if (live(wc)) refs.push(wc.ref);
    const ec = effortCol ? at(x.r, effortCol.c) : null;
    let effort: number | null = null;
    let effortPending = false;
    if (live(ec)) {
      refs.push(ec.ref);
      effort = manDaysOf(ec);
      if (effort === null) effortPending = true;
    }
    const dc = daysCol ? at(x.r, daysCol.c) : null;
    if (live(dc)) refs.push(dc.ref);
    for (const rc of remarkCols) {
      const c = at(x.r, rc.c);
      if (!live(c) || own.has(c.ref)) continue;
      refs.push(c.ref);
      notes.push(`${rc.header}：${c.text.trim()}`);
    }
    // ほかのセル（号の欄・機器番号の欄で機器にしなかったもの）
    for (const c of cells) if (!refs.includes(c.ref) && !own.has(c.ref) && !timeIndex.has(c.c) && !x.names.some((n) => n.cell.ref === c.ref)) refs.push(c.ref);
    works.push({ x, asset, periods, counted: numbered.length > 0, effort, effortRef: live(ec) ? ec.ref : null, effortPending, daysCell: live(dc) ? dc : null, refs, notes });
  });
  for (const h of headings) if (!h.used() && !off(h.ref)) exclude(h.ref, GANTT_REASON.unitUnused);

  // ─── 決まらないものを、同じ様式の表をまとめて 1 問ずつ聞く ───
  const dropped = new Map<Work, string>();
  const waiting = new Map<Work, string>();
  const askRows = (family: string, list: Work[], q: Omit<Parameters<Asker["ask"]>[1], "sameShapeRows" | "items">, text: (rows: number) => string, why: string) => {
    if (!list.length) return;
    const key = `${family}|${t.id}`;
    const a = ask.ask(key, { ...q, text: text(list.length), sameShapeRows: list.length, items: items(list.flatMap((w) => w.refs.slice(0, 1))) }, sameForm(family, fkey, "-", text));
    for (const w of list) {
      if (a === "exclude") dropped.set(w, why);
      else if (!waiting.has(w)) waiting.set(w, questionIdOf(key));
    }
  };
  askRows(
    "ganttNoPeriod",
    works.filter((w) => !w.periods.length),
    { kind: "dateUnknown", text: "", options: [{ id: "exclude", label: "その行を外す" }], valueKind: "option", defaultAnswer: null },
    (rows) => `${where}施工の期間（行の上の線の図形・時の列の数）の無い作業の行がある（${rows} 行）。期間を推し量らない`,
    GANTT_REASON.noPeriod,
  );
  askRows(
    "ganttNoAsset",
    works.filter((w) => !w.asset),
    { kind: "eventAsset", text: "", options: [{ id: "exclude", label: "その行を外す" }], valueKind: "option", defaultAnswer: null },
    (rows) => `${where}上に機器の名前の行の無い作業の行がある（${rows} 行）`,
    "機器の決まらない工程表の作業の行（決定で外した）",
  );
  // 日数の欄が、時の列の数から数えた日数と合わない行
  const daysOff = works.filter((w) => {
    const d = num(w.daysCell);
    const sum = w.periods.every((p) => p.days !== null) && w.periods.length ? w.periods.reduce((a, p) => a + (p.days ?? 0), 0) : null;
    return w.daysCell !== null && (d === null || (sum !== null && Math.abs(d - sum) > 1e-9));
  });
  let daysAs: string | null = null;
  if (daysOff.length) {
    const key = `ganttDays|${t.id}`;
    const text = (rows: number) => `${where}日数の欄が、時の列から数えた施工の日数と合わない行がある（${rows} 行）。どちらを日数にするか`;
    daysAs = ask.ask(
      key,
      {
        kind: "effortConflict",
        text: text(daysOff.length),
        options: [
          { id: "periods", label: "時の列から数えた日数にする" },
          { id: "none", label: "日数を空にする" },
        ],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: daysOff.length,
        items: items(daysOff.map((w) => w.daysCell?.ref ?? "")),
      },
      sameForm("ganttDays", fkey, "-", text),
    );
    for (const w of daysOff) if (daysAs !== "periods" && daysAs !== "none" && !waiting.has(w)) waiting.set(w, questionIdOf(key));
  }
  if (strays.length) {
    const key = `ganttStray|${t.id}`;
    const text = (rows: number) => `${where}名前も作業も無い行がある（${rows} 行）`;
    const a = ask.ask(
      key,
      { kind: "stray", text: text(strays.length), options: [{ id: "exclude", label: "外す" }], valueKind: "option", defaultAnswer: null, sameShapeRows: strays.length, items: items(strays.flatMap((x) => lay.index.rowCells(x.r).filter(live).map((c) => c.ref)).slice(0, 10)) },
      sameForm("ganttStray", fkey, "-", text),
    );
    for (const x of strays) for (const c of lay.index.rowCells(x.r)) if (live(c)) a === "exclude" ? exclude(c.ref, GANTT_REASON.stray) : pend(c.ref, questionIdOf(key));
  }

  // ─── 作業の記録：期間ごとに 1 つ（同じ行の期間は、link.ts が 1 つの作業のまとまりにする） ───
  const dayAt = (c: number): Ymd | null => {
    const i = timeIndex.get(c);
    return dates && i !== undefined ? (dates[i] ?? null) : null;
  };
  for (const w of works) {
    const why = dropped.get(w);
    const allRefs = [...w.refs, ...w.periods.flatMap((p) => p.refs)];
    if (why) {
      for (const ref of allRefs) exclude(ref, why);
      continue;
    }
    const q = waiting.get(w) ?? (w.effortPending ? effortQ : null) ?? datesQ ?? planQ;
    const workName = workCol ? (at(w.x.r, workCol.c)?.text ?? "").replace(/\s*\n\s*/g, " ").trim() : "";
    const notes = [...(w.asset ? (nodeNotes.get(w.asset.id) ?? []) : []), ...w.notes];
    const split = w.periods.length > 1;
    w.periods.forEach((p, i) => {
      const start = dayAt(p.from);
      const endDay = dayAt(p.to);
      const end = endDay ? addDays(endDay, g.step - 1) : null;
      const fy = start && end ? (fiscal !== null && fiscalYearOf(end, opts.fiscalYearStartMonth) >= fiscal && fiscalYearOf(start, opts.fiscalYearStartMonth) <= fiscal ? fiscal : fiscalYearOf(start, opts.fiscalYearStartMonth)) : null;
      const days = daysAs === "none" ? null : p.days;
      const remark = [...notes, ...(split ? [`工数は行の工数（${w.periods.length} つの期間の和）を最初の期間に置いた`] : [])].join(" / ") || null;
      const refs = i === 0 ? [...w.refs, ...p.refs] : [...p.refs];
      const e: EventRec = {
        id: `${t.id}:g${w.x.r}:${i}`,
        file: lay.file,
        sheet: lay.sheet,
        sheetIndex: lay.sheetIndex,
        tableId: t.id,
        row: w.x.r,
        date: start,
        end,
        days,
        fiscalYear: fy,
        manDays: i === 0 ? w.effort : null,
        effortPending: i === 0 && w.effortPending && effortQ !== null,
        assetNames: w.asset ? [w.asset.name] : [],
        ...(w.asset ? { nameRef: w.asset.nameRef } : {}),
        tag: w.asset?.tag ?? null,
        bundle: false,
        unit: w.asset?.series?.kind === "number" ? { kind: "number", n: w.asset.series.n, spelling: "{n}" } : null,
        workName,
        workTitle: null,
        remark,
        ...(remark ? { lineRemark: remark } : {}),
        ...(plan ? { planOrActual: "plan" as const } : {}),
        refs: refs.length ? refs : [w.asset?.nameRef ?? ""],
        excluded: null,
        pending: q !== null || !start || !w.asset,
        ...(w.asset ? { assetId: w.asset.id } : {}),
      };
      if (e.pending) for (const ref of refs) pend(ref, q);
      rec.events.push(e);
    });
    if (!w.periods.length) for (const ref of allRefs) pend(ref, waiting.get(w) ?? null);
  }

  // ─── 行の和の行：号炉の見出しの数（下の行の和）と、下に置いた「本頁 ○○計」（上の行の和。続けて並んだものは並んだ行の和） ───
  const isWorkAt = (i: number) => {
    const x = g.rows[i];
    return !!x && (x.kind === "work" || (x.kind === "node" && x.work));
  };
  const workOf = new Map(works.map((w) => [w.x.r, w]));
  const groups: { rows: number[]; covered: Work[]; heading: boolean }[] = [];
  let lastBelow = -1;
  for (let k = 0; k < sums.length; k++) {
    const s = sums[k];
    if (!s) continue;
    if (s.heading) {
      const covered: Work[] = [];
      for (let i = s.index + 1; i < g.rows.length; i++) {
        const x = g.rows[i];
        if (!x || x.kind === "unit" || x.kind === "sum") break;
        if (isWorkAt(i)) {
          const w = workOf.get(x.r);
          if (w) covered.push(w);
        }
      }
      groups.push({ rows: [s.x.r], covered, heading: true });
      continue;
    }
    const prev = groups[groups.length - 1];
    const prevSum = sums[k - 1];
    if (prev && !prev.heading && prevSum && !prevSum.heading && prevSum.index === s.index - 1) {
      prev.rows.push(s.x.r);
      lastBelow = s.index;
      continue;
    }
    const covered: Work[] = [];
    for (let i = lastBelow + 1; i < s.index; i++) {
      const x = g.rows[i];
      if (x && isWorkAt(i)) {
        const w = workOf.get(x.r);
        if (w) covered.push(w);
      }
    }
    groups.push({ rows: [s.x.r], covered, heading: false });
    lastBelow = s.index;
  }
  const amountCol = (c: number) => timeIndex.has(c) || c === effortCol?.c || c === daysCol?.c;
  for (const grp of groups) {
    const cells = grp.rows.flatMap((r) => lay.index.rowCells(r).filter((c) => live(c) && amountCol(c.c)));
    const labels = grp.heading ? [] : grp.rows.flatMap((r) => lay.index.rowCells(r).filter((c) => live(c) && !amountCol(c.c)));
    const cols = [...new Set(cells.map((c) => c.c))].sort((a, b) => a - b);
    const mismatches: string[] = [];
    let columns = 0;
    for (const c of cols) {
      const written = cells.filter((x) => x.c === c).reduce((a, x) => a + (num(x) ?? 0), 0);
      if (cells.filter((x) => x.c === c).every((x) => num(x) === null)) continue;
      columns++;
      const counts: number[] = [];
      if (c === effortCol?.c) counts.push(grp.covered.reduce((a, w) => a + (num(at(w.x.r, c)) ?? 0), 0));
      else if (c === daysCol?.c) {
        counts.push(grp.covered.reduce((a, w) => a + (num(at(w.x.r, c)) ?? 0), 0));
        counts.push(grp.covered.reduce((a, w) => a + w.periods.reduce((b, p) => b + (p.days ?? 0), 0), 0));
      } else {
        // 時の列：数で書いた行はその数、線の行は工数をその行の施工の日に等しく割り振った値（と、その日に施工した行の数）
        let share = 0;
        let rowsOn = 0;
        for (const w of grp.covered) {
          if (w.counted) {
            const v = num(at(w.x.r, c)) ?? 0;
            share += v;
            rowsOn += v;
            continue;
          }
          const i = timeIndex.get(c) ?? -1;
          const on = w.periods.some((p) => i >= (timeIndex.get(p.from) ?? 0) && i <= (timeIndex.get(p.to) ?? 0));
          if (!on) continue;
          const span = w.periods.reduce((a, p) => a + (timeIndex.get(p.to) ?? 0) - (timeIndex.get(p.from) ?? 0) + 1, 0);
          share += span > 0 && w.effort !== null ? w.effort / span : 0;
          rowsOn++;
        }
        counts.push(share, rowsOn);
      }
      const tol = timeIndex.has(c) ? 0.005 : 1e-6;
      if (!counts.some((n) => Math.abs(n - written) <= tol)) mismatches.push(cellRef(grp.rows[0] ?? 0, c));
    }
    const all = [...cells, ...labels];
    if (!mismatches.length) {
      for (const x of all) exclude(x.ref, GANTT_REASON.subtotal);
      continue;
    }
    const key = `subtotalMismatch|${t.id}|${grp.rows[0] ?? 0}`;
    const a = ask.ask(key, {
      kind: "subtotalMismatch",
      text: `小計の行（${columns} 列）のうち ${mismatches.length} 列が、表の中身から数えた値と合わない`,
      options: [{ id: "exclude", label: "合わないまま外す（理由を残す）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: 1,
      items: [itemOf(lay, mismatches)],
    });
    for (const x of all) a === "exclude" ? exclude(x.ref, GANTT_REASON.subtotalMismatch) : pend(x.ref, questionIdOf(key));
  }
  return order;
}

// ─── 数式があって計算済みの値が無いセル ─────────────────────────

function formulaQuestions(lay: SheetLayout, ask: Asker, exclude: (ref: string, why: string) => void, pend: Pend) {
  const cells = lay.grid.cells.filter((c) => c.formulaNoCache);
  if (!cells.length) return;
  const a = ask.ask(`formulaNoCache|${lay.file}|${lay.sheetIndex}`, {
    kind: "formulaNoCache",
    text: `数式があって計算済みの値が無いセルが ${cells.length} ある（Excel で開いて保存し直すと値が入る）。どうするか`,
    options: [{ id: "exclude", label: "値が無いまま外す" }],
    valueKind: "option",
    defaultAnswer: null,
    sameShapeRows: cells.length,
    items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
  });
  for (const c of cells) a === "exclude" ? exclude(c.ref, "数式に計算済みの値が無い（決定で外した）") : pend(c.ref, questionIdOf(`formulaNoCache|${lay.file}|${lay.sheetIndex}`));
}

export function gridOf(lay: SheetLayout): SheetGrid {
  return lay.grid;
}
