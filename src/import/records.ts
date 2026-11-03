// 層 3 意味づけ（1）：層 2 の表から記録（資産の行・星取表の印・日報の行）を作る。決まらない所は質問にする。
// どのセルを何に使ったかを数えるため、記録はセルの位置を持つ。
import { cellRef, type SheetGrid } from "./grid";
import { cue, norm } from "./cues";
import { fiscalYearOf, nfkc, parseYearOnly, type Ymd } from "./era";
import { Asker, type QuestionItem, YES_NO, questionIdOf } from "./questions";
import { assignParents, cellDate, type ColInfo, type SheetLayout, type Table } from "./structure";
import { parseEffort, parseUnit, splitTag, tagTrailingNumber, type TagSplit, type UnitValue } from "./text";

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
  /** 凡例の意味が作業の名前のとき（例：◎ が特定の検査） */
  workName: string | null;
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
  date: Ymd | null;
  fiscalYear: number | null;
  manDays: number | null;
  /** 工数のセルに書いてあったが人・日に直せていない */
  effortPending: boolean;
  assetNames: string[];
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
  const rec: Records = { assets: [], marks: [], events: [], levelNames: new Map(), excluded: new Map(), pending: new Set(), gridYears: new Map() };
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
      issuesToQuestions(t, lay, ask, exclude, pend);
      if (t.shape === "tree") order = treeRecords(t, lay, ask, rec, order, exclude, pend, off);
      else if (t.shape === "grid") order = gridRecords(t, lay, ask, rec, order, exclude, pend, off);
      else eventRecords(t, lay, ask, rec, opts, date1904Of(lay.file), exclude, pend, off);
    }
  }
  return rec;
}

/** 層 2 の問いの種を質問にし、決定を当てる */
function issuesToQuestions(t: Table, lay: SheetLayout, ask: Asker, exclude: (ref: string, why: string) => void, pend: (ref: string) => void) {
  for (const is of t.issues) {
    if (is.kind === "levelJump") continue; // 段が決まってから（treeRecords で）
    const key = `${is.kind}|${t.id}|${is.pattern}`;
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
        if (a === "remark") col.role = "remark";
        else if (a === "workName") col.role = "workName";
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

function treeRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): number {
  const nameCol = t.cols.find((c) => c.role === "name");
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
    .map((r) => ({ r: r.r, cell: lay.index.resolved(r.r, nameCol.c) }))
    .filter((x): x is { r: number; cell: NonNullable<typeof x.cell> } => !!x.cell && x.cell.text !== "");
  const tags = tagDecision(t, lay, ask, nameCells.map((x) => ({ r: x.r, text: x.cell.text, ref: x.cell.ref })));
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
    const name = tagged ? tagged.name : raw;
    const a: AssetRec = {
      id: idOf(r.r),
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      shape: "tree",
      order: order++,
      level: r.level ?? 0,
      parentId: r.parentRow ? idOf(r.parentRow) : null,
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
    for (const c of cells) {
      if (c.c === nameCol.c || off(c.ref)) continue;
      const col = t.cols.find((k) => k.c === c.c);
      const key = col?.header || `列${c.c}`;
      if (!col || col.role === "unknown") {
        pend(c.ref);
        continue;
      }
      if (col.role === "installed") {
        const y = parseYearOnly(typeof c.value === "number" ? c.value : c.text);
        if (y !== null) {
          a.installed = { year: y, ref: c.ref };
          a.refs.push(c.ref);
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

function gridRecords(t: Table, lay: SheetLayout, ask: Asker, rec: Records, order: number, exclude: (ref: string, why: string) => void, pend: (ref: string) => void, off: Off): number {
  const hier = t.cols.filter((c) => c.role === "hier").sort((a, b) => (a.hierLevel ?? 0) - (b.hierLevel ?? 0));
  const unitCol = t.cols.find((c) => c.role === "unit");
  const marks = t.cols.filter((c) => c.role === "mark");
  const specCols = t.cols.filter((c) => c.role === "spec" || c.role === "remark" || c.role === "installed" || c.role === "number");
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
  for (const r of data) {
    if (lay.index.rowCells(r.r).every((c) => off(c.ref))) {
      rowNode.set(r.r, null);
      continue;
    }
    let parent = null as AssetRec | null;
    let node = null as AssetRec | null;
    let undecided = false;
    for (let i = 0; i < hier.length; i++) {
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
        const raw = text.replace(/\s*\n\s*/g, " ").trim();
        n = {
          id: isLeaf ? `${t.id}:r${r.r}` : `${t.id}:h${col.hierLevel}:${ref}`,
          file: lay.file,
          sheet: lay.sheet,
          sheetIndex: lay.sheetIndex,
          tableId: t.id,
          shape: "grid",
          order: order++,
          level: col.hierLevel ?? i + 1,
          parentId: parent?.id ?? null,
          rawName: raw,
          name: raw,
          tag: null,
          tagNumber: null,
          nameRef: ref,
          series: series ?? null,
          specs: [],
          installed: null,
          refs: [ref],
          excluded: null,
          pending: series === undefined,
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
      if (node.pending) for (const ref of node.refs) pend(ref);
    } else for (const c of lay.index.rowCells(r.r)) pend(c.ref);
    rowNode.set(r.r, node);
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
        assetId: node?.id ?? null,
        excluded: null,
        pending: !node || node.pending || t.yearKind === null,
      };
      const entry = legend.find((e) => nfkc(e.symbol) === sym);
      const colPA = col.planOrActual ?? null;
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
      if (answer === "exclude") {
        m.excluded = "印ではない記号（決定で外した）";
        exclude(cell.ref, m.excluded);
        continue;
      }
      if (answer === null || m.planOrActual === null) m.pending = true;
      if (m.pending) pend(cell.ref);
      rec.marks.push(m);
    }
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
  const effortCol = col("effort");
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
  const evs: (EventRec & { _hours: number | null; _persons: number | null; _bare: number | null })[] = [];
  for (const r of data) {
    const cells = lay.index.rowCells(r.r).filter((c) => !off(c.ref));
    if (!cells.length) continue;
    const refs = cells.map((c) => c.ref);
    const dc = dateCol ? lay.index.at(r.r, dateCol.c) : null;
    const date = dc ? cellDate(dc, date1904) : null;
    if (dc && !date) badDates.set(shapeOf(dc.text), [...(badDates.get(shapeOf(dc.text)) ?? []), dc.ref]);
    const ec = effortCol ? lay.index.at(r.r, effortCol.c) : null;
    let manDays: number | null = null;
    let hours: number | null = null;
    let persons: number | null = null;
    let bare: number | null = null;
    if (ec) {
      const e = parseEffort(typeof ec.value === "number" ? ec.value : ec.text);
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
    const unit = uc ? parseUnit(uc.text) : null;
    if (uc && uc.text !== "" && !unit) unitBadEv.set(nfkc(uc.text).trim(), [...(unitBadEv.get(nfkc(uc.text).trim()) ?? []), { row: r.r, ref: uc.ref }]);
    if (unit?.kind === "number") spellings.set(unit.spelling, [...(spellings.get(unit.spelling) ?? []), uc?.ref ?? ""]);
    const assetText = text(r.r, assetCol);
    const stripped = cue.stripSet(assetText);
    const workName = (workCol ? text(r.r, workCol) : text(r.r, titleCol)).trim();
    const fy = date ? fiscalYearOf(date, opts.fiscalYearStartMonth) : null;
    evs.push({
      id: `${t.id}:e${r.r}`,
      file: lay.file,
      sheet: lay.sheet,
      sheetIndex: lay.sheetIndex,
      tableId: t.id,
      row: r.r,
      date,
      fiscalYear: fy,
      manDays,
      effortPending: false,
      assetNames: stripped.text ? [stripped.text] : [],
      bundle: stripped.set,
      unit: uc && uc.text !== "" ? unit : null,
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
  let hoursPer: number | null = null;
  if (hourCells.length) {
    const a = ask.ask(`hoursPerManDay|${t.id}`, {
      kind: "hoursPerManDay",
      text: `工数が時間で書いてある行が ${hourCells.length} 行ある。1 人・日を何時間として人・日に直すか`,
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
    personsAsMD = ask.ask(`effortPersons|${t.id}`, {
      kind: "effortUnknown",
      text: `工数が「N 人」（延べの印なし）で書いてある行が ${personCells.length} 行ある。1 行が 1 日なら人・日と同じ。どう読むか`,
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
    bareAs = ask.ask(`effortBare|${t.id}`, {
      kind: "effortUnknown",
      text: `工数が数だけで単位が無い行が ${bareCells.length} 行ある。単位は何か`,
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
    const a = ask.ask(`dateBad|${t.id}|${shape}`, {
      kind: "dateUnknown",
      text: `日付として読めない書き方がある（${refs.length} 行）。日付に見えない書き方を日付と決めつけない`,
      options: [{ id: "exclude", label: "その行を外す" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [itemOf(lay, refs.slice(0, 10))],
    });
    if (a === "exclude")
      for (const e of evs) if (refs.some((ref) => e.refs.includes(ref))) e.excluded = "日付として読めない行（決定で外した）";
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
