// 層 3 意味づけ（1）：層 2 の表から記録（資産の行・星取表の印・日報の行）を作る。決まらない所は質問にする。
// どのセルを何に使ったかを数えるため、記録はセルの位置を持つ。
import { cellRef, colLetter, type GridCell, type SheetGrid } from "./grid";
import { cue, norm, type ColumnCue } from "./cues";
import { fiscalYearOf, nfkc, parseDayCount, parseMonthDay, parseYearOnly, withFiscalYear, type Ymd } from "./era";
import { parseWithFormat } from "./reading";
import { Asker, type QuestionItem, YES_NO, questionIdOf } from "./questions";
import { assignParents, cellPeriod, isTypedDate, type ColInfo, type SheetLayout, type Table } from "./structure";
import { assetFromTitle, cycleHeaderUnit, parseCycle, parseEffort, parseUnit, splitFlatWork, splitTag, tagTrailingNumber, type CycleSpan, type TagSplit, type UnitValue } from "./text";

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

export interface MarkRec {
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
  /** 機器番号の列に書いた番号（同一性の鍵）。無ければ null */
  tag: string | null;
  bundle: boolean;
  unit: UnitValue | null;
  workName: string;
  workTitle: string | null;
  remark: string | null;
  refs: string[];
  excluded: string | null;
  pending: boolean;
}

export interface Records {
  assets: AssetRec[];
  marks: MarkRec[];
  events: EventRec[];
  /** 表ごとの段の名前（星取表の段の列の見出し） */
  levelNames: Map<string, string[]>;
  /** 外したセル（理由つき）と、未解決のまま残ったセル */
  excluded: Map<string, string>;
  pending: Set<string>;
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

export interface RecordOptions {
  fiscalYearStartMonth: number;
}

function itemOf(t: { file: string; sheet: string | null }, cells: string[], extra: Partial<QuestionItem> = {}): QuestionItem {
  return { file: t.file, sheet: t.sheet, cells, ...extra };
}

function shapeOf(text: string): string {
  return nfkc(text)
    .replace(/\d+/g, "n")
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu, "字")
    .slice(0, 24);
}

export function buildRecords(layouts: SheetLayout[], ask: Asker, opts: RecordOptions, date1904Of: (file: string) => boolean): Records {
  const rec: Records = { assets: [], marks: [], events: [], levelNames: new Map(), excluded: new Map(), pending: new Set(), gridYears: new Map(), formOf: formGroups(layouts) };
  let order = 0;
  for (const lay of layouts) {
    const pos = (ref: string): CellPos => ({ file: lay.file, sheet: lay.sheet, sheetIndex: lay.sheetIndex, ref });
    const exclude = (ref: string, why: string) => rec.excluded.set(cellKey(pos(ref)), why);
    const pend = (ref: string) => rec.pending.add(cellKey(pos(ref)));
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
      else eventRecords(t, lay, ask, rec, opts, date1904Of(lay.file), exclude, pend, off);
    }
  }
  return rec;
}

/** 層 2 の問いの種を質問にし、決定を当てる */
function issuesToQuestions(t: Table, lay: SheetLayout, ask: Asker, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, formKey: string) {
  for (const is of t.issues) {
    if (is.kind === "levelJump") continue; // 段が決まってから（treeRecords で）
    // 列の役目は様式の決まり：同じ様式の表（年度ごとのシート・帳票の頁）は、同じ列をまとめて 1 回聞く
    const key = `${is.kind}|${is.kind === "columnRole" ? formKey : t.id}|${is.pattern}`;
    const text =
      is.kind === "levelSplit"
        ? `${is.detail}。この行は何段目か`
        : is.kind === "yearKind"
          ? `${is.detail}。年の列を年度として読むか`
          : is.kind === "blankSameAsAbove"
            ? `${is.detail}は、上の行と同じか`
            : is.kind === "hiddenData"
              ? `${is.detail}。取り込むか`
              : `${is.detail}`;
    const a = ask.ask(key, {
      kind: is.kind,
      text,
      options: is.options,
      valueKind: "option",
      defaultAnswer: is.proposal,
      sameShapeRows: Math.max(is.rows.length, 1),
      items: [itemOf(t, is.cells.length ? is.cells : is.rows.map((r) => cellRef(r, 1)))],
    });
    if (is.kind === "levelSplit") {
      const lv = a ? Number(a.slice("level:".length)) : null;
      for (const r of t.rows) if (is.rows.includes(r.r)) r.level = lv;
    } else if (is.kind === "yearKind") {
      t.yearKind = a === "fiscal" ? "fiscal" : a === "calendar" ? "calendar" : null;
      if (!a) for (const c of t.cols.filter((x) => x.role === "mark")) pendColumn(t, lay, c, pend);
    } else if (is.kind === "hiddenData") {
      if (a === "exclude") {
        for (const c of t.cols.filter((x) => x.hidden)) for (const r of t.rows) {
          const cell = lay.index.at(r.r, c.c);
          if (cell) exclude(cell.ref, "隠した列（決定で外した）");
        }
        for (const r of t.rows.filter((x) => is.rows.includes(x.r))) for (const cell of lay.index.rowCells(r.r)) exclude(cell.ref, "隠した行（決定で外した）");
      } else if (!a) {
        for (const ref of is.cells) pend(ref);
        for (const r of is.rows) for (const cell of lay.index.rowCells(r)) pend(cell.ref);
      }
    } else if (is.kind === "blankSameAsAbove") {
      (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision ??= new Map();
      (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision?.set(Number(is.pattern.slice(4)), a);
    } else if (is.kind === "columnRole") {
      const c = Number(is.pattern.slice(4));
      const col = t.cols.find((x) => x.c === c);
      if (col) {
        if (a === "remark" || a === "workName" || a === "assetRef" || a === "tag" || a === "date" || a === "end" || a === "days" || a === "effort") col.role = a;
        else if (a === "exclude") {
          col.role = "unknown";
          for (const r of t.rows) {
            const cell = lay.index.at(r.r, c);
            if (cell) exclude(cell.ref, "役目の決まらない列（決定で外した）");
          }
        } else pendColumn(t, lay, col, pend);
      }
    }
  }
}

function pendColumn(t: Table, lay: SheetLayout, col: ColInfo, pend: (ref: string) => void) {
  for (const r of t.rows) {
    const cell = lay.index.at(r.r, col.c);
    if (cell) pend(cell.ref);
  }
}

// ─── 名前の中の機器番号 ───────────────────────────────────────

type TagState = { state: "split"; split: TagSplit } | { state: "keep" } | { state: "undecided" };

function tagDecision(t: Table, lay: SheetLayout, ask: Asker, rows: { r: number; text: string; ref: string }[]): Map<number, TagState> {
  const out = new Map<number, TagState>();
  const byPattern = new Map<string, { r: number; ref: string; split: TagSplit }[]>();
  for (const x of rows) {
    const s = splitTag(x.text);
    if (s) byPattern.set(s.pattern, [...(byPattern.get(s.pattern) ?? []), { r: x.r, ref: x.ref, split: s }]);
  }
  for (const [pattern, items] of byPattern) {
    const sample = items[0]?.split;
    const a = ask.ask(`tagSplit|${t.id}|${pattern}`, {
      kind: "tagSplit",
      text: `名前の${pattern === "trailingParen" ? "末尾の括弧の中" : "頭"}の英大文字の符号（例「${sample?.tag ?? ""}」）を、機器番号（タグ）として名前から分けるか`,
      options: YES_NO,
      valueKind: "option",
      defaultAnswer: "yes",
      sameShapeRows: items.length,
      items: items.map((i) => itemOf(lay, [i.ref], { note: i.split.tag })),
    });
    for (const i of items) out.set(i.r, a === "yes" ? { state: "split", split: i.split } : a === "no" ? { state: "keep" } : { state: "undecided" });
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

function treeRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): number {
  // 名前の列は 1 つか、段ごとに名前を書く列の組（どれも名前の列。行ごとに、名前のある列）
  const nameCols = t.cols.filter((c) => c.role === "name");
  const nameCol = nameCols[0];
  if (!nameCol) {
    for (const r of t.rows) for (const cell of lay.index.rowCells(r.r)) pend(cell.ref);
    ask.ask(`noName|${t.id}`, {
      kind: "columnRole",
      text: "名前の列が見つからない表がある",
      options: [{ id: "exclude", label: "この表を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: t.rows.length,
      items: [itemOf(lay, t.rows.slice(0, 10).map((r) => cellRef(r.r, 1)))],
    });
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
    const a = ask.ask(`levelJump|${t.id}|${is.pattern}`, {
      kind: "levelJump",
      text: `${is.detail}。どう読むか`,
      options: is.options,
      valueKind: "option",
      defaultAnswer: is.proposal,
      sameShapeRows: is.rows.length,
      items: [itemOf(lay, is.cells)],
    });
    for (const r of t.rows.filter((x) => is.rows.includes(x.r))) {
      if (a === "exclude") r.level = -1;
      else if (!a) r.level = null;
    }
  }
  const dataRows = t.rows.filter((r) => r.role === "data" || r.role === "parent");
  const nameCells = dataRows
    .map((r) => ({ r: r.r, cell: nameCols.map((c) => lay.index.resolved(r.r, c.c)).find((x) => !!x && x.text !== "") ?? null }))
    .filter((x): x is { r: number; cell: NonNullable<typeof x.cell> } => !!x.cell && x.cell.text !== "");
  const tags = tagDecision(t, lay, ask, nameCells.map((x) => ({ r: x.r, text: x.cell.text, ref: x.cell.ref })));
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
    orphanAnswer = ask.ask(`dittoNoAbove|${t.id}|${group}`, {
      kind: "stray",
      text: `名前の欄の「〃」で、同じ親の下の同じ段に上の行が無いものが ${orphans.length} 行ある（例：すぐ上の行は「${orphans[0]?.above ?? "なし"}」）。どう読むか`,
      options: [
        ...(canAbove ? [{ id: "above", label: "すぐ上の行と同じ名前として読む" }] : []),
        { id: "literal", label: "「〃」の文字のまま名前にする" },
        { id: "exclude", label: "外す" },
      ],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: orphans.length,
      items: orphans.map((o) => itemOf(lay, [o.ref], { note: o.above ?? "" })),
    });
  }
  for (const r of dataRows) {
    const cells = lay.index.rowCells(r.r);
    if (cells.every((c) => off(c.ref))) continue;
    const nc = nameCells.find((x) => x.r === r.r)?.cell;
    if (!nc || off(nc.ref)) {
      // 名前の無い行：ほかの列だけに中身がある
      for (const c of cells) if (!off(c.ref)) pend(c.ref);
      ask.ask(`noNameRow|${t.id}`, {
        kind: "stray",
        text: "名前の欄が空で、ほかの欄だけに中身がある行がある",
        options: [{ id: "exclude", label: "外す" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: 1,
        items: [itemOf(lay, cells.map((c) => c.ref))],
      });
      continue;
    }
    if (r.level === -1) {
      for (const c of cells) exclude(c.ref, "段の決まらない行（決定で外した）");
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
    if (a.pending) for (const ref of a.refs) pend(ref);
    rec.assets.push(a);
  }
  // 年として読めない設置年：書き方ごとにまとめて聞く（日付に見えない書き方を年と決めつけない）
  const byShape = new Map<string, { ref: string; text: string }[]>();
  for (const y of yearUnknown) byShape.set(shapeOf(y.text), [...(byShape.get(shapeOf(y.text)) ?? []), y]);
  for (const [shape, ys] of byShape) {
    const ans = ask.ask(`yearUnknown|${t.id}|${shape}`, {
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
    });
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
      kind: "yearUnknown",
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

function gridRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): number {
  const hier = t.cols.filter((c) => c.role === "hier").sort((a, b) => (a.hierLevel ?? 0) - (b.hierLevel ?? 0));
  const unitCol = t.cols.find((c) => c.role === "unit");
  const marks = t.cols.filter((c) => c.role === "mark");
  const specCols = t.cols.filter((c) => c.role === "spec" || c.role === "remark" || c.role === "installed" || c.role === "number");
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
  const data = t.rows.filter((r) => r.role === "data");
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
      const u = parseUnit(cell.text);
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
      commonMeaning = ask.ask(`commonMeaning|${t.id}`, {
        kind: "commonMeaning",
        text: `「${unitCol.header}」の列の「共通」（${commonCells.length} 行）は、どの意味の共通か`,
        options: cue.commonMeanings.map((m) => ({ id: m.id, label: m.label })),
        valueKind: "option",
        defaultAnswer: "facility",
        sameShapeRows: commonCells.length,
        items: [itemOf(lay, commonCells.slice(0, 10))],
      });
      for (const [r, s] of unitOf) if (s?.kind === "common") unitOf.set(r, commonMeaning ? { kind: "common", meaning: commonMeaning } : undefined);
    }
    if (unitBad.length) {
      const a = ask.ask(`unitUnknown|${t.id}`, {
        kind: "unitMissing",
        text: `「${unitCol.header}」の列に、号として読めない書き方がある（${unitBad.length} 行）`,
        options: [{ id: "none", label: "号なしとして読む" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: unitBad.length,
        items: [itemOf(lay, unitBad.slice(0, 10))],
      });
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
      const series = isLeaf ? (unitCol ? unitOf.get(r.r) : null) : null;
      const key = isLeaf ? `${parent?.id ?? ""}>${norm(text)}#${seriesKey(series ?? null)}#r${r.r}` : `${parent?.id ?? ""}>${norm(text)}@${ref}`;
      let n = nodeOf.get(key);
      if (!n) {
        const whole = text.replace(/\s*\n\s*/g, " ").trim();
        // 葉の名前の後ろの号（「ポンプ（1号機）」）：号の列が無いか空なら、名前から号を分ける
        const sfx = isLeaf && (series === null || series === undefined) ? splitUnitSuffix(whole) : null;
        const raw = sfx ? sfx.name : whole;
        n = {
          id: isLeaf ? `${t.id}:r${r.r}` : `${t.id}:h${col.hierLevel}:${ref}`,
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
          tag: null,
          tagNumber: null,
          nameRef: ref,
          series: sfx ? { kind: "number", n: sfx.n } : (series ?? null),
          specs: [],
          installed: null,
          refs: [ref],
          excluded: null,
          pending: !sfx && series === undefined,
        };
        if (isLeaf && unitCol) {
          const uc = lay.index.at(r.r, unitCol.c);
          if (uc) n.refs.push(uc.ref);
        }
        nodeOf.set(key, n);
        rec.assets.push(n);
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
  // 印
  const legend = t.legend;
  for (const r of data) {
    for (const col of marks) {
      const cell = lay.index.at(r.r, col.c);
      if (!cell || cell.text === "" || off(cell.ref)) continue;
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
        assetId: node?.id ?? null,
        excluded: null,
        pending: !node || node.pending || t.yearKind === null,
      };
      const entry = legend.find((e) => nfkc(e.symbol) === sym);
      // 行の予定・実績の欄があれば、それを列の見出しより先に使う（行の方が細かいため）
      const colPA = rowPA(r.r) ?? col.planOrActual ?? null;
      let answer: string | null = "ok";
      if (!entry) {
        const noLegend = legend.length === 0;
        answer = ask.ask(`${noLegend ? "noLegend" : "unknownSymbol"}|${t.id}|${sym}`, {
          kind: noLegend ? "noLegend" : "unknownSymbol",
          text: noLegend
            ? `凡例が無い。記号「${sym}」は何の印か`
            : `記号「${sym}」は凡例に無い。何の印か`,
          options: [
            ...(colPA ? [{ id: "column", label: `列の見出しのとおり（${colPA === "plan" ? "予定" : "実績"}）` }] : []),
            { id: "plan", label: "予定（計画）の印" },
            { id: "actual", label: "実績（実施）の印" },
            { id: "exclude", label: "印ではない（外す）" },
          ],
          valueKind: "option",
          defaultAnswer: colPA ? "column" : null,
          sameShapeRows: 1,
          items: [itemOf(lay, [cell.ref])],
        });
        if (answer === "column") m.planOrActual = colPA;
        else if (answer === "plan" || answer === "actual") m.planOrActual = answer;
      } else if (entry.planOrActual === null) {
        m.workName = entry.meaning;
        m.planOrActual = colPA;
        if (!colPA) {
          answer = ask.ask(`legendNoPA|${t.id}|${sym}`, {
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
          });
          if (answer === "plan" || answer === "actual") m.planOrActual = answer;
        }
      } else if (colPA && entry.planOrActual !== colPA) {
        answer = ask.ask(`paConflict|${t.id}|${sym}|${colPA}`, {
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
        });
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
        m.excluded = "印ではない記号（決定で外した）";
        exclude(cell.ref, m.excluded);
        continue;
      }
      if (answer === null || m.planOrActual === null) m.pending = true;
      if (m.pending) {
        pend(cell.ref);
        if (m.workRef) pend(m.workRef);
      }
      rec.marks.push(m);
    }
    // 作業の名前のセルで、印の 1 つも無い行のもの：理由つきで外す（印のある行は、印の記録の出どころ）
    const wc = rowWork(r.r);
    if (wc && !rec.marks.some((m) => m.tableId === t.id && m.workRef === wc.ref && !m.excluded)) exclude(wc.ref, "印の無い行の作業の名前");
  }
  return order;
}

function seriesKey(s: Series | null): string {
  if (!s) return "-";
  return s.kind === "number" ? `n${s.n}` : `c:${s.meaning}`;
}

// ─── 日報の形 ──────────────────────────────────────────────────

function eventRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, opts: RecordOptions, date1904: boolean, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off) {
  const col = (role: ColInfo["role"]) => t.cols.find((c) => c.role === role);
  const dateCol = col("date");
  const endCol = col("end");
  const tagCol = col("tag");
  const blankDecision = (t as Table & { blankDecision?: Map<number, string | null> }).blankDecision ?? new Map<number, string | null>();
  const daysCol = col("days");
  // 工数の列がいくつか（「予定工数」「実績工数」）：行ごとに、実績の列を先に、書いてある列を使う
  const effortCols = t.cols.filter((c) => c.role === "effort").sort((a, b) => (cue.planActual(b.header) === "actual" ? 1 : 0) - (cue.planActual(a.header) === "actual" ? 1 : 0));
  const effortCol = effortCols[0];
  const effortColAt = (r: number) => effortCols.find((c) => {
    const x = lay.index.at(r, c.c);
    return !!x && x.text !== "";
  }) ?? effortCol;
  const assetCol = col("assetRef");
  const unitCol = col("unit");
  const workCol = col("workName");
  const titleCol = col("workTitle");
  const remarkCols = t.cols.filter((c) => c.role === "remark");
  const data = t.rows.filter((r) => r.role === "data");
  const text = (r: number, c: ColInfo | undefined) => (c ? (lay.index.at(r, c.c)?.text ?? "") : "");
  // 工数の時間：1 人・日の時間を聞く（表ごとに 1 回）
  const hourCells: string[] = [];
  const personCells: string[] = [];
  const bareCells: string[] = [];
  const badEffort = new Map<string, string[]>();
  const spellings = new Map<string, string[]>();
  /** 系列の欄の、読めない書き方 → その行（書き方ごとに聞く） */
  const unitBadEv = new Map<string, { row: number; ref: string }[]>();
  const badDates = new Map<string, string[]>();
  const badDays = new Map<string, string[]>();
  const evs: (EventRec & { _hours: number | null; _persons: number | null; _bare: number | null })[] = [];
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
  // 機器の欄も機器番号も無い台帳（発注台帳など）：件名の中の機器の名前の案（あとでまとめて聞く。推し量って決めない）
  const titleOnly = !assetCol && !tagCol && !flatCol && !headAsset && !headTag && titleCol ? titleCol : null;
  const titleRows: { id: string; ref: string; title: string; guess: { asset: string; work: string } | null }[] = [];
  // 行ごとの周期（「周期」の列）：その行の作業の暦のきっかけ
  const cycleOf = readCycles(t, lay, ask, rec, data.map((r) => r.r), exclude, pend, off);
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
    if (ec && !off(ec.ref)) {
      const raw = parseEffort(typeof ec.value === "number" ? ec.value : nfkc(ec.text).replace(/,/g, ""));
      // 数だけの工数は、見出しの単位で読む
      const e = raw && raw.unit === "bare" && effortUnit ? { ...raw, unit: effortUnit } : raw;
      if (!e) badEffort.set(shapeOf(ec.text), [...(badEffort.get(shapeOf(ec.text)) ?? []), ec.ref]);
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
      refs,
      excluded: null,
      pending: !date || !workName,
      _hours: hours,
      _persons: persons,
      _bare: bare,
    });
  }
  // 日付の欄の無い作業の表（工程表など）：表の外に書いた期間を使うか、まとめて 1 回聞く（推し量らない）
  if (!dateCol && !headDate && evs.length) {
    const cp = lay.contextPeriod;
    const a = ask.ask(`dateMissing|${t.id}`, {
      kind: "dateUnknown",
      text: cp
        ? `作業の行に日付が書いていない（${evs.length} 行）。表の外に書いた期間（「${cp.text.slice(0, 60)}」）をその行の期間にするか`
        : `作業の行に日付が書いていない（${evs.length} 行）`,
      options: [...(cp ? [{ id: "heading", label: "表の外に書いた期間にする" }] : []), { id: "exclude", label: "その行を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: evs.length,
      items: [itemOf(lay, evs.slice(0, 10).map((e) => e.refs[0] ?? ""))],
    });
    for (const e of evs) {
      if (a === "heading" && cp) {
        e.date = cp.start;
        e.end = cp.end;
        e.fiscalYear = fiscalYearOf(cp.start, opts.fiscalYearStartMonth);
        e.pending = !e.workName;
      } else if (a === "exclude") e.excluded = "日付の書いていない行（決定で外した）";
    }
  }
  // 工数の単位の問いは、同じ様式の表をまとめて 1 回聞く（同じ鍵で聞くと、件数と見本は足される）
  const form = rec.formOf.get(t.id);
  const fkey = form?.key ?? t.id;
  const many = (form?.tables.length ?? 1) > 1;
  const where = many ? `${filesLabel(form?.files ?? [])}（同じ様式）の表に、` : "";
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
        else e.pending = true;
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
  let hoursPer: number | null = null;
  if (hourCells.length) {
    const a = ask.ask(`hoursPerManDay|${fkey}`, {
      kind: "hoursPerManDay",
      text: many ? `${where}工数が時間で書いてある行がある。1 人・日を何時間として人・日に直すか` : `工数が時間で書いてある行が ${hourCells.length} 行ある。1 人・日を何時間として人・日に直すか`,
      options: [],
      valueKind: "number",
      defaultAnswer: "8",
      sameShapeRows: hourCells.length,
      items: [itemOf(lay, hourCells.slice(0, 10))],
    });
    hoursPer = a ? Number(a) : null;
  }
  let personsAsMD: string | null = null;
  if (personCells.length) {
    personsAsMD = ask.ask(`effortPersons|${fkey}`, {
      kind: "effortUnknown",
      text: many
        ? `${where}工数が「N 人」（延べの印なし）で書いてある行がある。1 行が 1 日なら人・日と同じ。どう読むか`
        : `工数が「N 人」（延べの印なし）で書いてある行が ${personCells.length} 行ある。1 行が 1 日なら人・日と同じ。どう読むか`,
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
    const a = ask.ask(`effortBad|${t.id}|${shape}`, {
      kind: "effortUnknown",
      text: `工数の書き方が読めない（${refs.length} 行）`,
      options: [{ id: "exclude", label: "工数を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [itemOf(lay, refs.slice(0, 10))],
    });
    for (const ref of refs) a === "exclude" ? (exclude(ref, "読めない工数（決定で外した）"), effortExcluded.add(ref)) : pend(ref);
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
      ? `読み方の規則の書き方（${ruleFormat}）に合わない`
      : parseMonthDay(sample)
        ? "年が書いていない（シートの文に年度がただ 1 つ書いてあれば、その年度で読む）"
        : "日付の書き方として読めない";
    const a = ask.ask(`dateBad|${t.id}|${shape}`, {
      kind: "dateUnknown",
      text: `日付として読めない書き方がある（${refs.length} 行、見本「${sample.slice(0, 24)}」：${why}）。日付に見えない書き方を日付と決めつけない`,
      options: [{ id: "exclude", label: "その行を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [itemOf(lay, refs.slice(0, 10))],
    });
    if (a === "exclude")
      for (const e of evs) if (refs.some((ref) => e.refs.includes(ref))) e.excluded = "日付として読めない行（決定で外した）";
  }
  // 日数の欄の、日数として読めない書き方（書き方ごとに 1 回聞く。答えるまで、そのセルは未解決）
  for (const [shape, refs] of badDays) {
    const a = ask.ask(`daysBad|${t.id}|${shape}`, {
      kind: "dateUnknown",
      text: `「${daysCol?.header ?? "日数"}」の列に、日数として読めない書き方がある（${refs.length} 行）。日数を推し量らない`,
      options: [{ id: "exclude", label: "日数を外す（理由を残す）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [itemOf(lay, refs.slice(0, 10))],
    });
    for (const ref of refs) a === "exclude" ? exclude(ref, "日数として読めない（決定で外した）") : pend(ref);
    if (a === "exclude") for (const e of evs) e.refs = e.refs.filter((x) => !refs.includes(x));
  }
  // 系列の欄の、号・系列として読めない書き方（書き方ごとに 1 回聞く。答えるまで、その行は未解決）
  for (const [text, cells] of unitBadEv) {
    const a = ask.ask(`unitUnknownEv|${t.id}|${text}`, {
      kind: "unitMissing",
      text: `「${unitCol?.header ?? "号"}」の列の「${text}」（${cells.length} 行）は、号・系列として読めない`,
      options: [{ id: "none", label: "号・系列なしとして読む" }, { id: "exclude", label: "この行を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: cells.length,
      items: [itemOf(lay, cells.slice(0, 10).map((c) => c.ref))],
    });
    const rows = new Set(cells.map((c) => c.row));
    for (const e of evs) {
      if (!rows.has(e.row)) continue;
      if (a === "none") e.unit = null;
      else if (a === "exclude") e.excluded = "号・系列として読めない行（決定で外した）";
      else e.pending = true;
    }
  }
  let spellOk: string | null = "yes";
  if (spellings.size > 1) {
    const all = [...spellings.values()].flat();
    spellOk = ask.ask(`unitSpelling|${t.id}`, {
      kind: "unitSpelling",
      text: `「${unitCol?.header ?? "号"}」の書き方が ${spellings.size} 通りある（${[...spellings.keys()].map((s) => s.replace("{n}", "1")).join("・")}）。数が同じなら同じ号として読むか`,
      options: YES_NO,
      valueKind: "option",
      defaultAnswer: "yes",
      sameShapeRows: all.length,
      items: [...spellings.entries()].map(([s, refs]) => itemOf(lay, refs.slice(0, 5), { note: s })),
    });
  }
  for (const e of evs) {
    if (e._hours !== null) {
      if (hoursPer) e.manDays = e._hours / hoursPer;
      else e.effortPending = true;
    }
    if (e._persons !== null) {
      if (personsAsMD === "manDays") e.manDays = e._persons;
      else if (personsAsMD !== "exclude") e.effortPending = true;
      else effortExcluded.add(effortCol ? cellRef(e.row, effortCol.c) : "");
    }
    if (e._bare !== null) {
      if (bareAs === "manDays") e.manDays = e._bare;
      else if (bareAs === "hours" && hoursPer) e.manDays = e._bare / hoursPer;
      else if (bareAs === "exclude") effortExcluded.add(effortCol ? cellRef(e.row, effortCol.c) : "");
      else e.effortPending = true;
    }
    if (spellOk !== "yes" && e.unit?.kind === "number" && spellings.size > 1) e.pending = true;
    for (const ref of effortExcluded) if (e.refs.includes(ref)) {
      e.refs = e.refs.filter((x) => x !== ref);
      exclude(ref, "工数を外した（決定）");
    }
    if (e.excluded) for (const ref of e.refs) exclude(ref, e.excluded);
    else if (e.pending || e.effortPending) for (const ref of e.refs) pend(ref);
    const { _hours, _persons, _bare, ...clean } = e;
    void _hours;
    void _persons;
    void _bare;
    rec.events.push(clean);
  }
}

// ─── 数式があって計算済みの値が無いセル ─────────────────────────

function formulaQuestions(lay: SheetLayout, ask: Asker, exclude: (ref: string, why: string) => void, pend: (ref: string) => void) {
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
  for (const c of cells) a === "exclude" ? exclude(c.ref, "数式に計算済みの値が無い（決定で外した）") : pend(c.ref);
}

export function gridOf(lay: SheetLayout): SheetGrid {
  return lay.grid;
}
