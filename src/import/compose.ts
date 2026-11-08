// 層 4 当てはめと検算：元のセルを「データ／外した（理由）／未解決」に数え、小計・合計で検算し、
// 未解決が 0 のときだけ計画（src/shared/plan.ts の Plan）を作る（plan §2.3 の止める決まり）。
// 計画を作ったら、作った計画から数え直して「入れた行＝取り込んだ数＋外した数（理由ごと）」を出す。
import { Plan, type AssetNodeT, type WorkDetailT, type WorkT } from "../shared/plan";
import type { AuthorKind } from "../shared/fields";
import { CellIndex, type SourceFile } from "./grid";
import { Asker, questionIdOf, type Decision } from "./questions";
import { cellKey, type ContractRec, type CostCell, type EventRec, type MarkRec, type Records } from "./records";
import { ROW_ROLE_LABEL, type SheetLayout, type Table } from "./structure";
import { nk, seriesLabel, type Cluster, type Job, type Linked, type Occurrence, type WorkLink } from "./link";
import { daysInclusive, fiscalYearOf, parseDayCount, ymdString, type Ymd } from "./era";
import { costHeaderUnit, nameKey, parseEffort, unitInText } from "./text";
import { cue } from "./cues";
import { markPhotoRecords, type PhotoReview } from "./photo";
import { askReference, REFERENCE_REASON, referenceKey } from "./reference";

/**
 * セルの行き先。画面への写しだけに使う（版の記録・署名される字には入れない）。
 * qs：そのセルを決めた質問の ID の並び（答えが効いている質問だけ。機器の節・明細・除外を決めたときの decidedBy から）。無ければ付けない。
 * questionId：未解決のセルを決める質問（分かるときだけ）
 */
export type CellStatus =
  | { s: "data"; qs?: string[] }
  | { s: "excluded"; reason: string; qs?: string[] }
  | { s: "unresolved"; questionId: string | null };

export interface FileCounts {
  file: string;
  inputRows: number;
  importedRows: number;
  excludedRows: Record<string, number>;
  /** 一部のセルが未解決の行 */
  unresolvedRows: number;
  inputCells: number;
  dataCells: number;
  excludedCells: Record<string, number>;
  unresolvedCells: number;
  /** 入れた行＝取り込んだ数＋外した数＋未解決の行 */
  holds: boolean;
}

export interface CheckResult {
  file: string;
  sheet: string | null;
  row: number;
  kind: "subtotal" | "total";
  columns: number;
  matched: number;
  mismatches: { ref: string; written: number; counted: number }[];
}

export interface ComposeOptions {
  planId: string;
  displayName: string;
  packId: string;
  facility: Plan["facility"];
  /** パックの階層の名前（資料の見出しに名前の無い階層に使う） */
  defaultLevelNames?: readonly string[];
}

export interface Composition {
  plan: Plan | null;
  /** 計画を作れない理由（件数つき） */
  blockers: string[];
  status: Map<string, CellStatus>;
  counts: FileCounts[];
  checks: CheckResult[];
  /** 写真から作った記録の数（要確認のもの・写真ごと）。写真が無ければ 0 と空 */
  photoReview: PhotoReview;
  /**
   * 契約の記録（契約・発注の一覧の行。作業にしない）と、件名の語と期間で作業の年度の値と結ぶ案。
   * linked は結ぶと決めたもの、cost は結んで金額を費用に置いた明細。計画には入れない（版の記録・署名される字は変えない）
   */
  contracts: ContractLink[];
}

/** 契約の記録 1 つと、結ぶ案の明細 */
export interface ContractLink {
  contract: ContractRec;
  /** 件名の語と期間の合う作業の年度の値（実績）の明細の鍵。無ければ空 */
  proposed: string[];
  /** 結ぶと決めた（まとめた 1 問の答え） */
  linked: boolean;
  /** 金額を費用に置いた明細の鍵（結んで、契約と作業が 1 つずつ合い、明細に費用が無かったときだけ） */
  costTo: string | null;
}

function hash(s: string): string {
  return questionIdOf(s).slice(2, 14);
}

const AUTHOR_RANK: AuthorKind[] = ["ai", "ai_reading", "ai_relayed_human", "human", "rule_code"];

/** 同じ計画の中で機器を見分ける値が同じだった機器の鍵の頭（前の版と結ばず、当てはめの案にも並べない。台帳の中-8） */
export const AMBIGUOUS_KEY_PREFIX = "nx-";

/** 決めた質問の作者のうち、いちばん人の手に近いもの。まとめた質問の問いは、まとめた質問の決定で見る */
function authorOf(qids: Iterable<string>, decisionOf: (q: string) => Decision | null): AuthorKind {
  let best: AuthorKind = "rule_code";
  for (const q of qids) {
    const d = decisionOf(q);
    if (d && AUTHOR_RANK.indexOf(d.author) < AUTHOR_RANK.indexOf(best)) best = d.author;
  }
  return best;
}

/**
 * 小計・合計の行を検算する。星取表の形は印のあるセルの数、ほかの形は数の和と比べる。
 * 小計は自分の区切り（前の小計の行のあとから自分の前まで。上に置いた小計なら、自分のあとから次の小計の前まで）の中、
 * 合計は表のデータの行すべて（小計の行は数えない）と比べる。
 * 日報の形の表では、工数の欄は行ごとに人・日に直した工数の和と、日数の欄は日数の和か、行の期間の始まりから終わりまでの
 * 通しの日数（工期の日数）と比べる。人・日に直せていない行があれば、その答えを待つ（検算を推し量らない）。
 */
function checkTotals(
  lay: SheetLayout,
  t: Table,
  ask: Asker,
  exclude: (ref: string, why: string, qs?: readonly string[]) => void,
  pend: (ref: string, q: string | null) => void,
  eventOf: (r: number) => EventRec | undefined,
  /** 表の様式の鍵（同じ見出しの並びの表。合わない小計の問いを、シート・資料をまたいで 1 問にまとめる） */
  formKey: string = t.id,
): CheckResult[] {
  const out: CheckResult[] = [];
  const isData = (r: { role: string }) => r.role === "data" || r.role === "parent";
  const allData = t.rows.filter(isData);
  const sums = t.rows.filter((r) => r.role === "subtotal" || r.role === "total");
  const subs = t.rows.filter((r) => r.role === "subtotal").map((r) => r.r);
  // 小計を区切りの上に置く表か下に置く表か：最初の小計より前にデータの行が無ければ、上に置く表
  const above = subs.length > 0 && !allData.some((r) => r.r < (subs[0] ?? 0));
  // あいだにデータの行の無い、並んだ小計（区分ごとの小計「単年度整備 小計」「基幹改良 小計」）：同じ範囲を分けたものなので、並んだ小計の和と照らす
  const groupOf = new Map<number, number[]>();
  for (let i = 0; i < subs.length; i++) {
    const r = subs[i] ?? 0;
    const prev = subs[i - 1];
    const g = prev !== undefined && !allData.some((x) => x.r > prev && x.r < r) ? groupOf.get(prev) : undefined;
    if (g) g.push(r);
    groupOf.set(r, g ?? [r]);
  }
  for (const row of sums) {
    const group = row.role === "subtotal" ? (groupOf.get(row.r) ?? [row.r]) : [row.r];
    // 並んだ小計の 2 つ目からは、1 つ目と一緒に照らした
    if (group[0] !== row.r) continue;
    let data = allData;
    if (row.role === "subtotal") {
      if (above) {
        const next = Math.min(t.bottom + 1, ...subs.filter((x) => x > row.r));
        data = allData.filter((r) => r.r > row.r && r.r < next);
      } else {
        const prev = Math.max(t.top - 1, ...subs.filter((x) => x < row.r));
        data = allData.filter((r) => r.r > prev && r.r < row.r);
      }
    }
    // 並んだ小計は、列ごとに並んだ行の数の和を書いた値として照らす（セルは 1 つ目の行のもの。無ければ 2 つ目からの行のもの）
    const cells = group.length > 1 ? [...new Map(group.flatMap((g) => lay.index.rowCells(g)).map((c) => [c.c, c])).values()] : lay.index.rowCells(row.r);
    const groupCells = group.flatMap((g) => lay.index.rowCells(g));
    const res: CheckResult = { file: lay.file, sheet: lay.sheet, row: row.r, kind: row.role as "subtotal" | "total", columns: 0, matched: 0, mismatches: [] };
    let waiting = false;
    /**
     * 行の名前に金額の単位を書いた合計の行（「年度別概算費用　計（千円）」）の、星取の列のセル：星取の数ではなく金額の合計で、
     * 星取の数と照らせない（金額は作業の行ごとの費用と回数から決まり、表の中身だけでは検算できない）
     */
    const moneyRow = cells.some((x) => typeof x.value === "string" && costHeaderUnit(x.text) !== null && t.cols.find((k) => k.c === x.c)?.role !== "mark");
    const notCount = new Set<string>();
    const numberOf = (v: unknown): number | null =>
      typeof v === "number" ? v : typeof v === "string" && /^\s*[\d,.]+\s*$/.test(v) ? Number(v.replace(/,/g, "")) : null;
    for (const c of cells) {
      const col = t.cols.find((k) => k.c === c.c);
      let written = numberOf(c.value);
      if (group.length > 1) {
        const vs = group.map((g) => numberOf(lay.index.at(g, c.c)?.value)).filter((v): v is number => v !== null);
        written = vs.length ? vs.reduce((a, v) => a + v, 0) : null;
      }
      if (written === null && typeof c.value === "string" && t.shape === "events") {
        // 単位つきの合計（「253人・日」「61日」）
        const e = col?.role === "effort" ? parseEffort(c.value) : null;
        if (e && e.unit === "manDays") written = e.amount;
        else if (col?.role === "days") written = parseDayCount(c.value);
      }
      if (written === null) continue;
      let counted = 0;
      let alt: number | null = null;
      // 件数の行（「件数｜71」）：表の行の数と照らす
      const countRow = cells.some((x) => typeof x.value === "string" && cue.isCount(x.text));
      if (countRow) counted = data.length;
      // 年の欄に整備の内容、その下の行に金額を書く表（2 段の書き方）：年の列の小計は金額の行の数の和
      else if (col?.role === "mark" && t.amountRows) counted = data.filter((r) => t.amountRows?.has(r.r)).reduce((a, r) => a + (numberOf(lay.index.at(r.r, c.c)?.value) ?? 0), 0);
      else if (col?.role === "mark" && moneyRow) {
        notCount.add(c.ref);
        continue;
      } else if (col?.role === "mark") counted = data.filter((r) => (lay.index.at(r.r, c.c)?.text ?? "") !== "").length;
      else if (t.shape === "events" && col?.role === "effort") {
        const evs = data.map((r) => eventOf(r.r)).filter((e): e is EventRec => !!e && !e.excluded);
        if (evs.some((e) => e.effortPending)) {
          waiting = true;
          continue;
        }
        counted = evs.reduce((a, e) => a + (e.manDays ?? 0), 0);
        // 時間で書いた列の合計は、人・日に直す前の数（その列の数の和）とも照らす
        alt = data.reduce((a, r) => a + (numberOf(lay.index.at(r.r, c.c)?.value) ?? 0), 0);
      } else if (t.shape === "events" && col?.role === "days") {
        const evs = data.map((r) => eventOf(r.r)).filter((e): e is EventRec => !!e && !e.excluded);
        counted = evs.reduce((a, e) => a + (e.days ?? 0), 0);
        // 工期の日数：行の期間の始まりから終わりまでの通しの日数
        const ds = evs.flatMap((e) => [e.date, e.end ?? e.date]).filter((d): d is Ymd => !!d);
        if (ds.length) {
          const key = (d: Ymd) => d.y * 10000 + d.m * 100 + d.d;
          const lo = ds.reduce((a, d) => (key(d) < key(a) ? d : a));
          const hi = ds.reduce((a, d) => (key(d) > key(a) ? d : a));
          alt = daysInclusive(lo, hi);
        }
      } else
        counted = data.reduce((a, r) => {
          const v = numberOf(lay.index.at(r.r, c.c)?.value);
          return a + (v ?? 0);
        }, 0);
      res.columns++;
      if (Math.abs(counted - written) < 1e-9 || (alt !== null && Math.abs(alt - written) < 1e-9)) res.matched++;
      else res.mismatches.push({ ref: c.ref, written, counted });
    }
    const label = ROW_ROLE_LABEL[row.role];
    if (waiting) for (const c of groupCells) pend(c.ref, null);
    else if (res.mismatches.length === 0)
      for (const c of groupCells) exclude(c.ref, notCount.has(c.ref) ? `${label}（金額の合計。星取の数ではないので、検算せずに外した）` : `${label}（検算して合った）`);
    else {
      const key = `subtotalMismatch|${t.id}|${row.r}`;
      const a = ask.ask(key, {
        kind: "subtotalMismatch",
        text: `${label}の行（${res.columns} 列）のうち ${res.mismatches.length} 列が、表の中身から数えた値と合わない`,
        options: [{ id: "exclude", label: "合わないまま外す（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: 1,
        items: [{ file: lay.file, sheet: lay.sheet, cells: res.mismatches.map((m) => m.ref) }],
      },
      // 同じ様式の表の合わない小計（合計）の行は 1 問にまとめる（答えは「合わないまま外す」だけで、行ごとに変わらない）
      { key: `subtotalMismatch|${formKey}|${row.role}`, text: (rows) => `${label}の行のうち、表の中身から数えた値と合わない列がある行（${rows} 行）` },
      );
      for (const c of groupCells) a === "exclude" ? exclude(c.ref, `${label}（検算で合わなかった。決定で外した）`, [questionIdOf(key)]) : pend(c.ref, questionIdOf(key));
    }
    out.push(res);
  }
  return out;
}

export function compose(
  sources: SourceFile[],
  layouts: SheetLayout[],
  rec: Records,
  lk: Linked,
  ask: Asker,
  _decisions: ReadonlyMap<string, Decision>,
  opts: ComposeOptions,
  /** 参考として外すと決めた資料（記録は作っていない。セルは「参考の資料」として外す） */
  reference: ReadonlySet<string> = new Set(),
): Composition {
  // 決定は、見える質問（同じ形の問いをまとめた質問）の決定で引く
  const decisionOf = (q: string) => ask.decisionOf(q);
  const status = new Map<string, CellStatus>();
  const excluded = new Map(rec.excluded);
  /** 除外を決めた質問（セルの鍵 → 質問の ID。除外の理由と一緒に置き直す。画面の写しだけに使う） */
  const excludedBy = new Map<string, readonly string[]>();
  const exclude = (k: string, why: string, qs: Iterable<string> = []) => {
    excluded.set(k, why);
    const list = [...new Set(qs)];
    if (list.length) excludedBy.set(k, list);
    else excludedBy.delete(k);
  };
  const pending = new Map<string, string | null>([...rec.pending].map((k) => [k, rec.pendingBy.get(k) ?? null]));
  /** 未解決にする。決める質問が分からない（null）ときは、先に分かっていた質問を消さない */
  const pend = (k: string, q: string | null) => {
    if (q !== null || !pending.get(k)) pending.set(k, q);
  };
  const checks: CheckResult[] = [];
  const eventAt = new Map<string, EventRec>();
  for (const e of rec.events) eventAt.set(`${e.tableId}\u0000${e.row}`, e);
  for (const lay of layouts) {
    const ex = (ref: string, why: string, qs?: readonly string[]) => exclude(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), why, qs);
    const pd = (ref: string, q: string | null) => pend(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), q);
    if (reference.has(lay.file)) continue;
    // 工程表（ガント）の行の和の行は、施工の期間と工数から層 3 で検算した（records.ts の ganttRecords）
    for (const t of lay.tables) if (!t.gantt) checks.push(...checkTotals(lay, t, ask, ex, pd, (r) => eventAt.get(`${t.id}\u0000${r}`), rec.formOf.get(t.id)?.key ?? t.id));
  }

  // ─── 資産の節 ───
  // 同一性の鍵（台帳の中-8、Architect の決めた形）：機器番号があれば nk(機器番号) と系列から、無ければ nk(名前) と系列と親の機器の鍵から作る。
  // 資料のファイル名・シート・セルの位置とパックの項目は入れない（次の年の資料でも同じ機器は同じ鍵になり、前の版の当てはめを案に並べられる）。
  // 同じ計画の中で同じ鍵が 2 つできた機器は、資料の位置から作る別の形の鍵（AMBIGUOUS_KEY_PREFIX）にし、前の版と結ばず案にも並べない
  const live = lk.clusters.filter((c) => !c.excluded);
  const keyOf = new Map<Cluster, string>();
  const baseOf = new Map<Cluster, string>();
  const seriesKey = (s: Cluster["series"]) => (s === null ? "" : s.kind === "number" ? `#${s.n}` : `c:${nk(s.meaning)}`);
  const base = (c: Cluster, seen: Set<Cluster> = new Set()): string => {
    const known = baseOf.get(c);
    if (known !== undefined) return known;
    if (seen.has(c)) return "";
    seen.add(c);
    const b = c.tag ? `t|${nk(c.tag)}|${seriesKey(c.series)}` : `n|${nk(c.name)}|${seriesKey(c.series)}|${c.parent ? base(c.parent, seen) : ""}`;
    baseOf.set(c, b);
    return b;
  };
  const count = new Map<string, number>();
  for (const c of live) count.set(base(c), (count.get(base(c)) ?? 0) + 1);
  const used = new Set<string>();
  for (const c of live) {
    const b = base(c);
    let k: string;
    if (count.get(b) === 1) k = `n-${hash(b)}`;
    else {
      const first = [...c.recs].sort((x, y) => x.file.localeCompare(y.file) || x.sheetIndex - y.sheetIndex || x.order - y.order)[0];
      k = `${AMBIGUOUS_KEY_PREFIX}${hash(`${b}|${first?.file}|${first?.sheetIndex}|${first?.nameRef}`)}`;
      let i = 2;
      while (used.has(k)) k = `${AMBIGUOUS_KEY_PREFIX}${hash(`${b}|${first?.file}|${first?.sheetIndex}|${first?.nameRef}|${i++}`)}`;
    }
    used.add(k);
    keyOf.set(c, k);
  }
  const depth = (c: Cluster): number => {
    let d = 1;
    let p = c.parent;
    const seen = new Set<Cluster>();
    while (p && !seen.has(p)) {
      seen.add(p);
      d++;
      p = p.parent;
    }
    return d;
  };
  // 出どころ：頁のある資料（PDF）は、格子の位置に加えて頁と頁の上の位置も持つ
  const placeOf = new Map<string, { page: number; box: [number, number, number, number] | null }>();
  for (const lay of layouts)
    for (const c of lay.grid.cells) if (c.page !== undefined) placeOf.set(`${lay.file}\u0000${lay.sheet ?? ""}\u0000${c.ref}`, { page: c.page, box: c.box ?? null });
  const refOf = (file: string, sheet: string | null, ref: string) => {
    const p = placeOf.get(`${file}\u0000${sheet ?? ""}\u0000${ref}`);
    return { file, sheet, page: p?.page ?? null, cell: ref, box: p?.box ?? null };
  };
  // 印の出どころ：印のセルと、行ごとに作業の列を書く星取表ならその行の作業の名前のセル
  const markSources = (m: MarkRec) => [refOf(m.file, m.sheet, m.ref), ...(m.workRef ? [refOf(m.file, m.sheet, m.workRef)] : [])];
  const assets: AssetNodeT[] = [];
  /** 機器の節・明細を決めた質問（画面の写しの qs に使う。計画には入れない） */
  const decidedOf = new Map<AssetNodeT | WorkDetailT, readonly string[]>();
  for (const c of live) {
    if (c.pending) continue;
    const specs: { key: string; value: string }[] = [];
    const sources: AssetNodeT["sources"] = [];
    let installed: string | null = null;
    for (const r of c.recs) {
      if (r.excluded) continue;
      for (const s of r.specs) specs.push({ key: s.key, value: s.value });
      if (r.installed && !installed) installed = String(r.installed.year);
      for (const ref of r.refs) sources.push(refOf(r.file, r.sheet, ref));
    }
    const parent = c.parent && !c.parent.excluded && !c.parent.pending ? c.parent : null;
    const node: AssetNodeT = {
      nodeKey: keyOf.get(c) ?? "",
      tag: c.tag,
      name: c.name,
      level: depth(c),
      parentKey: parent ? (keyOf.get(parent) ?? null) : null,
      classCode: null,
      commonItem: null,
      commonItemAuthor: null,
      commonItemBasis: null,
      commonItemAccepted: false,
      specs,
      installedOn: installed,
      removedOn: null,
      replacedOn: null,
      series: c.series ? (c.series.kind === "number" ? String(c.series.n) : `common.${c.series.meaning}`) : null,
      sources,
    };
    assets.push(node);
    decidedOf.set(node, [...c.decidedBy]);
  }

  // ─── 作業と明細 ───
  const works = new Map<string, WorkT>();
  const details: WorkDetailT[] = [];
  const detailKeys = new Set<string>();
  const workFor = (key: string, kind: string, targets: string[], parent: string | null): string => {
    const wk = `w-${hash(key)}`;
    if (!works.has(wk))
      works.set(wk, {
        workKey: wk,
        kind,
        // 作業の属性は取り込みでは決めない（当てはめで AI が案を置き、人が受ける。plan §2.1）
        attribute: null,
        attributeAuthor: null,
        attributeBasis: null,
        attributeAccepted: false,
        strategy: null,
        targets,
        trigger: null,
        checkIds: [],
        contractor: null,
        parentWorkKey: parent,
        tagRange: null,
        tagList: [],
      });
    return wk;
  };
  // 作業の暦のきっかけ（src/plan/trigger.ts の Trigger）：星取表・作業の表のその行の周期（「周期(年)」「周期」）。
  // 同じ作業に違う周期が書いてあれば、どちらかに決めつけず置かない
  const cycleSeen = new Map<string, string>();
  const putCycle = (wk: string, cycle: { years?: number; months?: number } | undefined) => {
    const w = works.get(wk);
    if (!cycle || !w) return;
    const k = JSON.stringify(cycle);
    const prev = cycleSeen.get(wk);
    if (prev === undefined) {
      cycleSeen.set(wk, k);
      w.trigger = { branches: [{ kind: "calendar", ...cycle }], combine: "earliest" };
    } else if (prev !== k) {
      cycleSeen.set(wk, "conflict");
      w.trigger = null;
    }
  };
  // 読み方の決定（AI と会話から写した答え）ごとに、それで作者が決まった明細（決定のシートで、決定の行に付いて動く。Wire）
  const affected = new Map<string, string[]>();
  const addDetail = (d: Omit<WorkDetailT, "detailKey">, seed: string, qids: readonly string[]) => {
    let k = `d-${hash(seed)}`;
    let i = 2;
    while (detailKeys.has(k)) k = `d-${hash(`${seed}|${i++}`)}`;
    detailKeys.add(k);
    const detail: WorkDetailT = { ...d, detailKey: k };
    details.push(detail);
    decidedOf.set(detail, qids);
    for (const q of new Set(qids.map((x) => ask.resolve(x)))) {
      const a = decisionOf(q)?.author;
      if (a === "ai" || a === "ai_relayed_human") affected.set(q, [...(affected.get(q) ?? []), k]);
    }
  };
  const eventSources = (o: Occurrence) => o.events.flatMap((e) => e.refs.map((ref) => refOf(e.file, e.sheet, ref)));
  const jobSources = (j: Job) => j.units.flatMap(eventSources);
  /** 作業明細（日報の 1 行ずつ。足し上げる前の行）。日付の順。行が無ければ省く */
  // 読めない日付は null（推し量らない）。日付がその年度の外の行は、日付を null にして印を付ける（Architect の 43 の 3）
  // 計画中の行（行ごとの予定・実績の列が計画）は作業明細に入れない（実績の行だけ。Architect の 53）
  const linesOf = (events: readonly EventRec[], fy: number | null) => {
    const ls = events.filter((e) => e.planOrActual !== "plan").map((e) => {
      const date = e.date ? ymdString(e.date) : null;
      const outOfYear = !!e.date && fy !== null && fiscalYearOf(e.date, opts.facility.fiscalYearStartMonth) !== fy;
      return {
        date: outOfYear ? null : date,
        content: [e.workTitle, e.workName].filter((x): x is string => !!x && x.trim() !== "").join(" "),
        quantity: e.quantity ?? null,
        manDays: e.manDays,
        days: e.days,
        source: refOf(e.file, e.sheet, e.refs[0] ?? ""),
        ...(e.lineRemark ? { remark: e.lineRemark } : {}),
        ...(e.effortExcluded ? { flag: "effortExcluded" as const } : outOfYear ? { flag: "outOfYear" as const } : {}),
      };
    });
    ls.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    return ls.length ? { lines: ls } : {};
  };
  /** 日報の行から作る年度の値の計画・実績：どの行も計画中なら計画、ほかは実績（Architect の 53。計画中の行を次回の起点にしない） */
  const planOrActualOf = (events: readonly EventRec[]): "plan" | "actual" => (events.length > 0 && events.every((e) => e.planOrActual === "plan") ? "plan" : "actual");
  /** 暦年として書かれた印の根拠の注（年度 Y として読んだ。Architect の 58。言葉は Wire に確かめる） */
  const calNote = (m: MarkRec): string => (m.calendarYear ? "（暦年として書かれた年を年度として読んだ）" : "");
  /**
   * 根拠の文の星取の書き方：記号の星取は「の星取「○」」、年の欄に整備の内容を書いた表（2 段の書き方）は「の整備の内容」。セルの場所は残す。
   * これから作る版の字だけを変える（前の版の字は書き直さない。Architect の 67、11-06）
   */
  const markWord = (m: MarkRec): string => (m.content ? "の整備の内容" : `の星取「${m.symbol}」`);
  const okCluster = (c: Cluster | undefined): c is Cluster => !!c && !c.pending && !c.excluded;
  const linksOfMark = new Map<MarkRec, WorkLink[]>();
  for (const l of lk.links) if (l.mode === "mark" && l.mark) linksOfMark.set(l.mark, [...(linksOfMark.get(l.mark) ?? []), l]);
  const range = (us: Occurrence[]) => {
    const s = us.map((u) => u.start).filter((x): x is string => !!x).sort();
    const e = us.map((u) => u.end).filter((x): x is string => !!x).sort();
    return { start: s[0] ?? null, end: e[e.length - 1] ?? null };
  };
  const titlesOf = (us: Occurrence[]) => [...new Set(us.flatMap((u) => u.events.map((e) => e.workTitle ?? e.workName)))].join("・");
  const docsOf = (us: Occurrence[]) => us.map((u) => `${u.file} の ${u.events.length} 行（${titlesOf([u])}）`).join("と");
  // 資料をまたいで同じ値のはずの工数・日数：資料ごとの値が 1 つに決まればそれ、違えば聞く（黙ってどれかを選ばない）
  const settleValue = (what: "manDays" | "days", key: string, vals: { u: Occurrence; v: number }[], cName: string): { v: number | null; q: string | null; pend: boolean } => {
    const distinct = [...new Set(vals.map((x) => x.v))];
    if (distinct.length <= 1) return { v: distinct[0] ?? null, q: null, pend: false };
    const label = what === "manDays" ? "工数（人・日）" : "日数";
    const qkey = `effortConflict|${what}|${key}`;
    const a = ask.ask(qkey, {
      kind: "effortConflict",
      text: `「${cName}」の同じ作業の${label}が、資料で違う（${vals.map((x) => `${x.u.file} ${x.v}`).join("・")}）。どれを使うか`,
      options: [...distinct.map((v, i) => ({ id: `v${i}`, label: `${v}` })), { id: "none", label: `${label}を空にする` }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: vals.length,
      items: vals.map((x) => ({ file: x.u.file, sheet: x.u.sheet, cells: x.u.events.slice(0, 1).map((e) => e.refs[0] ?? "") })),
    });
    const q = questionIdOf(qkey);
    if (a === "none") return { v: null, q, pend: false };
    if (a?.startsWith("v")) return { v: distinct[Number(a.slice(1))] ?? null, q, pend: false };
    return { v: null, q, pend: true };
  };
  const conflictPending: { j: Job; q: string | null }[] = [];
  /** 1 つの機器の上の作業の明細の値：工数はまとめ工事でない資料から、日数は書いてある資料から */
  const jobValues = (j: Job) => {
    const md = settleValue(
      "manDays",
      j.id,
      j.units.filter((u) => !u.bundle && u.manDays !== null).map((u) => ({ u, v: u.manDays as number })),
      j.cluster.name,
    );
    const dy = settleValue(
      "days",
      j.id,
      j.units.filter((u) => u.days !== null).map((u) => ({ u, v: u.days as number })),
      j.cluster.name,
    );
    if (md.pend || dy.pend) conflictPending.push({ j, q: md.pend ? md.q : dy.q });
    return { manDays: md.v, days: dy.v, qids: [md.q, dy.q].filter((x): x is string => !!x) };
  };
  // まとめ工事（一式）：同じ作業と結んだまとめ工事どうしは、1 つのまとめ工事の明細にする
  const bundleRoot = new Map<Occurrence, Occurrence>();
  const rootOf = (o: Occurrence): Occurrence => {
    let r = o;
    while (bundleRoot.get(r) && bundleRoot.get(r) !== r) r = bundleRoot.get(r) as Occurrence;
    return r;
  };
  for (const o of lk.occurrences) if (o.bundle) bundleRoot.set(o, o);
  for (const j of lk.jobs) {
    const bs = j.units.filter((u) => u.bundle);
    for (let i = 1; i < bs.length; i++) {
      const a = rootOf(bs[0] as Occurrence);
      const b = rootOf(bs[i] as Occurrence);
      if (a !== b) bundleRoot.set(b, a);
    }
  }
  const bundleMembers = new Map<Occurrence, Occurrence[]>();
  for (const o of bundleRoot.keys()) bundleMembers.set(rootOf(o), [...(bundleMembers.get(rootOf(o)) ?? []), o]);
  for (const ms of bundleMembers.values()) ms.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
  const bundleTargets = (root: Occurrence) =>
    [...new Map((bundleMembers.get(root) ?? [root]).flatMap((o) => o.targets).map((t) => [t.id, t])).values()].filter(okCluster);
  const bundleWork = (o: Occurrence): string | null => {
    if (!o.bundle) return null;
    const root = rootOf(o);
    const lead = (bundleMembers.get(root) ?? [root])[0] ?? root;
    const targets = bundleTargets(root).map((c) => keyOf.get(c) ?? "").sort();
    return workFor(`bundle|${lead.workKey}|${targets.join(",")}`, lead.workName, targets, null);
  };
  /** 作業のまとまりの親（まとめ工事）。どれか 1 つの資料がまとめ工事なら、その親 */
  const parentOfJob = (j: Job): string | null => {
    const b = j.units.find((u) => u.bundle);
    return b ? bundleWork(b) : null;
  };
  /** 費用：候補の費用がどれも同じ値のときだけ（資料をまたいで違えば決めつけず置かない）。印の作業明細はその印の行の費用 */
  // 実績の年度の値には、計画としてだけ読む費用（予定・見積の列。Architect の 45）を置かない
  const costOfUnits = (m: MarkRec | null, events: readonly EventRec[], file: (x: MarkRec | EventRec) => { file: string; sheet: string | null }, pa: "plan" | "actual") => {
    const cands: { cost: CostCell; at: { file: string; sheet: string | null } }[] = [
      ...(m?.cost ? [{ cost: m.cost, at: file(m) }] : []),
      ...events.flatMap((e) => (e.cost ? [{ cost: e.cost, at: file(e) }] : [])),
    ].filter((x) => !(pa === "actual" && x.cost.planOnly));
    const pick = m?.planOrActual === "plan" && m.cost ? [{ cost: m.cost, at: file(m) }] : cands;
    if (!pick.length || new Set(pick.map((x) => x.cost.yen)).size !== 1) return { cost: null };
    const x = pick[0]!;
    return { cost: x.cost.yen, costSource: { file: x.at.file, sheet: x.at.sheet, ref: x.cost.ref, text: x.cost.text, tax: x.cost.tax } };
  };
  const at = (x: MarkRec | EventRec) => ({ file: x.file, sheet: x.sheet });
  const jobDetail = (j: Job, m: MarkRec | null, qids: Set<string>, kind: string, keyName: string) => {
    const c = j.cluster;
    const ak = keyOf.get(c) ?? "";
    const parent = parentOfJob(j);
    const wk = workFor(`asset|${ak}|${keyName}|${parent ?? ""}`, kind, [ak], parent);
    putCycle(wk, m?.cycle ?? j.units.flatMap((u) => u.events).find((e) => e.cycle)?.cycle);
    const v = jobValues(j);
    const r = range(j.units);
    const symbolQ = m ? [questionIdOf(`unknownSymbol|${m.tableId}|${m.symbol}`), questionIdOf(`noLegend|${m.tableId}|${m.symbol}`)] : [];
    const bundled = j.units.some((u) => u.bundle);
    const qs = [...c.decidedBy, ...qids, ...j.decidedBy, ...j.units.flatMap((u) => [...u.decidedBy]), ...v.qids, ...symbolQ];
    addDetail(
      {
        workKey: wk,
        planOrActual: m ? (m.planOrActual ?? "actual") : planOrActualOf(j.units.flatMap((u) => u.events)),
        step: null,
        startDate: r.start,
        endDate: r.end,
        fiscalYear: m ? m.fiscalYear : j.fiscalYear,
        ...costOfUnits(m, j.units.flatMap((u) => u.events), at, m ? (m.planOrActual ?? "actual") : planOrActualOf(j.units.flatMap((u) => u.events))),
        ...linesOf(j.units.flatMap((u) => u.events), m ? m.fiscalYear : j.fiscalYear),
        manDays: v.manDays,
        days: v.days,
        resultScale: null,
        resultValue: null,
        measuredValue: m?.measured ?? null,
        previousValue: null,
        performer: null,
        sources: [...(m ? markSources(m) : []), ...jobSources(j)],
        basis: `${m ? `星取表 ${m.ref} ${markWord(m)}${calNote(m)}と ` : ""}${docsOf(j.units)}${bundled && v.manDays === null ? "。工数はまとめ工事の明細に" : ""}`,
        author: authorOf(qs, decisionOf),
        needsReview: false,
      },
      m ? `mark|${m.file}|${m.sheetIndex}|${m.ref}|${j.id}` : `event|${j.id}`,
      qs,
    );
  };
  // 印から
  for (const m of rec.marks) {
    if (m.excluded || m.pending || !m.assetId || !m.planOrActual) continue;
    const c = lk.clusterOf.get(m.assetId);
    if (!okCluster(c)) continue;
    const ak = keyOf.get(c) ?? "";
    const ls = (linksOfMark.get(m) ?? []).filter((l) => okCluster(l.cluster));
    const symbolQ = [questionIdOf(`unknownSymbol|${m.tableId}|${m.symbol}`), questionIdOf(`noLegend|${m.tableId}|${m.symbol}`)];
    if (ls.length === 0) {
      const kind = m.workName ?? "";
      const wk = workFor(`asset|${ak}|${nameKey(kind)}|`, kind, [ak], null);
      putCycle(wk, m.cycle);
      addDetail(
        {
          workKey: wk,
          planOrActual: m.planOrActual,
          step: null,
          startDate: null,
          endDate: null,
          fiscalYear: m.fiscalYear,
          ...costOfUnits(m, [], at, m.planOrActual ?? "actual"),
          manDays: null,
          days: null,
          resultScale: null,
          resultValue: null,
          measuredValue: m.measured ?? null,
          previousValue: null,
          performer: null,
          sources: markSources(m),
          basis: `星取表 ${m.ref} ${markWord(m)}（${m.planOrActual === "plan" ? "予定" : "実績"}${m.workName ? `・${m.workName}` : ""}）${calNote(m)}`,
          author: authorOf([...c.decidedBy, ...symbolQ], decisionOf),
          needsReview: false,
        },
        `mark|${m.file}|${m.sheetIndex}|${m.ref}`,
        [...c.decidedBy, ...symbolQ],
      );
      continue;
    }
    for (const l of ls) {
      // 凡例の意味が作業の名前と合う印（◎ が特定の検査など）は、凡例の名前を作業の種類にする（星取表だけの年と同じ作業になる）
      const lead = l.job.units[0];
      const mk = nameKey(m.workName ?? "");
      const named = !!mk && l.job.units.some((u) => nameKey(u.workName) === mk || nameKey(u.workName).includes(mk) || (nameKey(u.workName) !== "" && mk.includes(nameKey(u.workName))));
      const kind = named ? (m.workName ?? "") : (lead?.workName ?? "");
      jobDetail(l.job, m, l.decidedBy, kind, named ? nameKey(m.workName ?? "") : (lead?.workKey ?? ""));
    }
  }
  // 日報・報告書だけの記録
  for (const l of lk.links) {
    if (l.mode !== "eventOnly" || !okCluster(l.cluster)) continue;
    const lead = l.job.units[0];
    jobDetail(l.job, null, l.decidedBy, lead?.workName ?? "", lead?.workKey ?? "");
  }
  // まとめ工事の明細（結んだまとめ工事は 1 つに）
  const bundleDone = new Set<Occurrence>();
  for (const l of lk.links) {
    if (l.mode !== "mark" && l.mode !== "eventOnly") continue;
    for (const o of l.job.units) {
      if (!o.bundle) continue;
      const root = rootOf(o);
      if (bundleDone.has(root)) continue;
      bundleDone.add(root);
      const members = bundleMembers.get(root) ?? [root];
      const parent = bundleWork(o);
      if (!parent) continue;
      const md = settleValue(
        "manDays",
        `bundle|${root.id}`,
        members.filter((u) => u.manDays !== null).map((u) => ({ u, v: u.manDays as number })),
        bundleTargets(root).map((t) => t.name).join("・"),
      );
      const dy = settleValue(
        "days",
        `bundle|${root.id}`,
        members.filter((u) => u.days !== null).map((u) => ({ u, v: u.days as number })),
        bundleTargets(root).map((t) => t.name).join("・"),
      );
      if (md.pend || dy.pend) conflictPending.push({ j: l.job, q: md.pend ? md.q : dy.q });
      const r = range(members);
      const qs = [...members.flatMap((u) => [...u.decidedBy]), ...[md.q, dy.q].filter((x): x is string => !!x)];
      addDetail(
        {
          workKey: parent,
          planOrActual: planOrActualOf(members.flatMap((u) => u.events)),
          step: null,
          startDate: r.start,
          endDate: r.end,
          fiscalYear: root.fiscalYear,
          ...costOfUnits(null, members.flatMap((u) => u.events), at, planOrActualOf(members.flatMap((u) => u.events))),
          ...linesOf(members.flatMap((u) => u.events), root.fiscalYear),
          manDays: md.v,
          days: dy.v,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: members.flatMap(eventSources),
          basis: `まとめ工事（${bundleTargets(root).map((t) => t.name + seriesLabel(t.series)).join("・")}）。${docsOf(members)}`,
          author: authorOf(qs, decisionOf),
          needsReview: false,
        },
        `bundle|${root.id}`,
        qs,
      );
    }
  }
  for (const l of lk.links) {
    const evs = l.job.units.flatMap((u) => u.events);
    if (l.mode === "excluded") for (const e of evs) for (const ref of e.refs) exclude(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), "作業を外した（決定）", l.decidedBy);
    if (l.mode === "pending") for (const e of evs) for (const ref of e.refs) pend(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), l.waitingOn ?? null);
  }
  for (const { j, q } of conflictPending) for (const e of j.units.flatMap((u) => u.events)) for (const ref of e.refs) pend(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), q);
  for (const e of rec.events) {
    if (lk.eventPending.has(e.id)) for (const ref of e.refs) pend(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), lk.eventWaitingOn.get(e.id) ?? null);
    const why = lk.eventExcluded.get(e.id);
    if (why) for (const ref of e.refs) exclude(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), why, lk.eventExcludedBy.get(e.id));
  }
  // 機器を外した決定の質問（機器の記録ごと）。外した機器の上の印にも付ける
  const assetExcludedQs = (c: Cluster) => c.recs.flatMap((r) => (r.excluded && lk.assetExcludedBy.has(r.id) ? [lk.assetExcludedBy.get(r.id) as string] : []));
  for (const c of lk.clusters) {
    if (c.excluded)
      for (const r of c.recs) {
        const q = lk.assetExcludedBy.get(r.id);
        for (const ref of r.refs) exclude(cellKey({ file: r.file, sheetIndex: r.sheetIndex, ref }), r.excluded ?? c.excluded, r.excluded && q ? [q] : []);
      }
    if (c.pending) for (const r of c.recs) for (const ref of r.refs) pend(cellKey({ file: r.file, sheetIndex: r.sheetIndex, ref }), lk.assetWaitingOn.get(r.id) ?? null);
    // 結ぶかの問いに答えが無い機器（held）は、節は持つが、その問いを待つセルは未確定に見せる（答えのあるまで推測で決めない。
    // 取り消した答えのセルが朱に戻る。11-07）。問いの無い held（先の資料の決定を待つだけ）はデータのまま数える
    else if (c.held)
      for (const r of c.recs) {
        const q = lk.assetWaitingOn.get(r.id);
        if (q) for (const ref of r.refs) pend(cellKey({ file: r.file, sheetIndex: r.sheetIndex, ref }), q);
      }
  }
  for (const m of rec.marks) {
    const c = m.assetId ? lk.clusterOf.get(m.assetId) : undefined;
    const k = cellKey({ file: m.file, sheetIndex: m.sheetIndex, ref: m.ref });
    if (c?.excluded && !m.excluded) exclude(k, "機器を外した（決定）", assetExcludedQs(c));
    if (c?.pending) pend(k, c.recs.map((r) => lk.assetWaitingOn.get(r.id)).find((q) => !!q) ?? null);
    else if (c?.held) {
      const q = c.recs.map((r) => lk.assetWaitingOn.get(r.id)).find((x) => !!x);
      if (q) pend(k, q);
    }
  }

  // ─── 発注明細の行：品名・仕様から取り出した号炉と機器が、ほかの資料の機器と同じ鍵（名前と号炉）のときだけ、その機器の作業の年度の値と費用にする案。
  // まとめた 1 問で聞く。取り出せない行・結ぶ相手の無い行は記録に残すだけで、作業にしない ───
  const lineGroups = proposeOrderLines(rec.contracts, assets, ask);
  const lineDrafts: ContractDraft[] = [];
  const lineGroupOf = new Map<ContractRec, OrderLineGroup>();
  for (const g of lineGroups) for (const c of g.lines) lineGroupOf.set(c, g);
  for (const g of lineGroups) {
    if (g.linked !== true) continue;
    const wk = workFor(`asset|${g.asset.nodeKey}|${nameKey(g.work)}|`, g.work, [g.asset.nodeKey], null);
    const cost = orderLinesCost(g.lines);
    const same = details.find((d) => d.workKey === wk && d.fiscalYear === g.fiscalYear && d.planOrActual === g.planOrActual);
    if (same) {
      // ほかの資料の同じ作業・年度の値：費用が無いときだけ、明細の金額を置く（ある費用は書き換えない）
      g.detail = same.detailKey;
      if (same.cost === null && cost.cost !== null) {
        same.cost = cost.cost;
        same.costSource = cost.costSource;
        g.costTo = same.detailKey;
      }
      continue;
    }
    const sources = g.lines.flatMap((c) => [c.line?.itemRef ?? c.refs[0] ?? "", c.line?.cost?.ref ?? ""].filter((r) => r !== "").map((r) => refOf(c.file, c.sheet, r)));
    const before = new Set(details.map((d) => d.detailKey));
    addDetail(
      {
        workKey: wk,
        planOrActual: g.planOrActual,
        step: null,
        // 発注の日・納期・検収の日は作業の期間にしない（Skillパックの決まり：発注台帳の工期を作業の期間にしない）
        startDate: null,
        endDate: null,
        fiscalYear: g.fiscalYear,
        ...cost,
        manDays: null,
        days: null,
        resultScale: null,
        resultValue: null,
        measuredValue: null,
        previousValue: null,
        performer: null,
        sources,
        basis: `発注明細 ${[...new Set(g.lines.map((c) => c.file))].join("・")} の ${g.lines.length} 行（${g.planOrActual === "actual" ? "検収あり" : "検収なし"}）`,
        author: authorOf([g.question], decisionOf),
        needsReview: false,
      },
      `orderLine|${g.key}`,
      [g.question],
    );
    const made = details.find((d) => !before.has(d.detailKey));
    if (made) {
      g.detail = made.detailKey;
      if (made.cost !== null) g.costTo = made.detailKey;
    }
  }
  for (const c of rec.contracts) {
    if (!c.line) continue;
    const g = lineGroupOf.get(c);
    lineDrafts.push({ contract: c, proposed: g?.detail ? [g.detail] : [], linked: g ? g.linked : null, costTo: g?.costTo ?? null, question: g?.question ?? null });
  }

  // ─── 契約の記録（契約・発注の一覧の行）：作業にしない。件名の語と期間の合う作業の年度の値と結ぶ案を、まとめた 1 問で聞く ───
  const contracts = [
    ...linkContracts(
      rec.contracts.filter((c) => !c.line),
      assets,
      works,
      details,
      ask,
      opts.facility.fiscalYearStartMonth,
    ),
    ...lineDrafts,
  ];

  // ─── 行き先を数える ───
  /** データのセル → そのセルを出どころにする機器の節・明細を決めた質問 */
  const dataKeys = new Map<string, Set<string>>();
  const sheetIndexOf = new Map<string, number>();
  for (const lay of layouts) sheetIndexOf.set(`${lay.file}\u0000${lay.sheet ?? ""}`, lay.sheetIndex);
  const addData = (s: { file: string; sheet: string | null; cell: string | null }, qs: readonly string[]) => {
    const si = sheetIndexOf.get(`${s.file}\u0000${s.sheet ?? ""}`) ?? 0;
    if (!s.cell) return;
    const k = cellKey({ file: s.file, sheetIndex: si, ref: s.cell });
    const set = dataKeys.get(k) ?? new Set<string>();
    for (const q of qs) set.add(q);
    dataKeys.set(k, set);
  };
  for (const a of assets) for (const s of a.sources) addData(s, decidedOf.get(a) ?? []);
  for (const d of details) for (const s of d.sources) addData(s, decidedOf.get(d) ?? []);
  // 契約の記録に読んだセル：データ（計画の外に残す記録。結ぶと決めた契約は、その問いを決めた質問に数える）
  const contractCells: { file: string; sheet: string | null; cell: string }[] = [];
  for (const x of contracts)
    for (const ref of x.contract.refs) {
      const s = { file: x.contract.file, sheet: x.contract.sheet, cell: ref };
      contractCells.push(s);
      addData(s, x.question && x.linked !== null ? [x.question] : []);
    }
  // セルを決めた質問は、答えが効いているものだけ（答えの無い質問・当てはまらない決定・聞かなかった質問の ID は付けない）
  // まとめた質問の問いは、まとめた質問の ID にする（画面が見える質問と結べるように）
  const qsOf = (qs: Iterable<string> | undefined): { qs?: string[] } => {
    const list = [...new Set([...(qs ?? [])].map((q) => ask.resolve(q)))].filter((q) => {
      const st = ask.asked.get(q);
      return !!st?.decision && !st.invalid;
    });
    return list.length ? { qs: list } : {};
  };
  const strays: { lay: SheetLayout; ref: string }[] = [];
  for (const lay of layouts) {
    if (reference.has(lay.file)) {
      // 参考として外した資料：どのセルも「参考の資料」に数える（記録は作っていない）
      const by = qsOf([questionIdOf(referenceKey(lay.file))]);
      for (const cell of lay.grid.cells) status.set(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }), { s: "excluded", reason: REFERENCE_REASON, ...by });
      continue;
    }
    for (const cell of lay.grid.cells) {
      const k = cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref });
      if (pending.has(k)) status.set(k, { s: "unresolved", questionId: ask.resolve(pending.get(k) ?? null) });
      else if (dataKeys.has(k)) status.set(k, { s: "data", ...qsOf(dataKeys.get(k)) });
      else if (excluded.has(k)) status.set(k, { s: "excluded", reason: excluded.get(k) ?? "", ...qsOf(excludedBy.get(k)) });
      else if (lay.rowReasons.has(cell.r)) status.set(k, { s: "excluded", reason: lay.rowReasons.get(cell.r) ?? "" });
      else {
        const role = lay.rowRoles.get(cell.r);
        if (role === "title" || role === "note" || role === "header" || role === "legend") {
          const why: Record<string, string> = {
            title: "題",
            note: "注記",
            header: "見出し（読み方に使った）",
            legend: "凡例（記号の意味に使った）",
          };
          status.set(k, { s: "excluded", reason: why[role] ?? role });
        } else strays.push({ lay, ref: cell.ref });
      }
    }
  }
  // どこにも行き先の無いセル（安全網）：黙って捨てず、まとめて聞く
  const strayBySheet = new Map<SheetLayout, string[]>();
  for (const s of strays) strayBySheet.set(s.lay, [...(strayBySheet.get(s.lay) ?? []), s.ref]);
  for (const [lay, refs] of strayBySheet) {
    const key = `stray|${lay.file}|${lay.sheetIndex}`;
    const a = ask.ask(key, {
      kind: "stray",
      text: `${lay.file}${lay.sheet ? ` の「${lay.sheet}」` : ""} に、意味の決まらないセルが ${refs.length} ある`,
      options: [{ id: "exclude", label: "外す（意味が決まらないため）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [{ file: lay.file, sheet: lay.sheet, cells: refs.slice(0, 20) }],
    });
    for (const ref of refs) {
      const k = cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref });
      status.set(k, a === "exclude" ? { s: "excluded", reason: "意味の決まらないセル（決定で外した）", ...qsOf([questionIdOf(key)]) } : { s: "unresolved", questionId: questionIdOf(key) });
    }
  }

  // 読めていない未解決のセル（決める質問の無いセルと、役目の決まらない列のセル）が多く残る資料：今回は参考として計画に使わないかを、資料ごとに 1 問聞く
  askReference(sources, layouts, status, ask, reference);

  // ─── 写真から読んだもの（photo.ts）：出どころに画像の位置を付け、人が画像と並べて確かめるまで要確認に数える ───
  const photoReview = markPhotoRecords(sources, assets, details);

  // ─── 止める決まり ───
  const blockers: string[] = [];
  const unresolved = [...status.values()].filter((s) => s.s === "unresolved").length;
  if (unresolved) blockers.push(`未解決のセル ${unresolved}`);
  const open = ask.open().filter((q) => !q.decision);
  if (open.length) blockers.push(`答えの無い質問 ${open.length}`);
  const invalid = ask.invalidDecisions();
  if (invalid.length) blockers.push(`当てはまらない決定 ${invalid.length}`);
  // どの資料も参考として外したときは、計画に使う資料が無い（空の計画を作らない）
  // 決まった答えのルールで外した資料があれば、そのルールの id を添える（どのルールを直すか・外すかが分かるように）
  if (reference.size && sources.length && sources.every((x) => reference.has(x.file))) {
    const byRules = [...new Set([...reference].map((f) => ask.ruleIdOf(questionIdOf(referenceKey(f)))).filter((x): x is string => x !== null))];
    blockers.push(`計画に使う資料が無い（どの資料も参考として外した ${reference.size}${byRules.length ? `。外したルール：${byRules.join("・")}` : ""}）`);
  }
  // 契約の一覧だけのとき（契約は作業にしないので、機器も作業も無い）：空の計画を作らない
  else if (!assets.length && !details.length && rec.contracts.length) blockers.push(`計画に使う資料が無い（契約の一覧の契約 ${rec.contracts.length} 件は作業にしない。機器か作業の資料と一緒に入れる）`);
  // 資料をまたいで結ぶかの決まらない機器（その資料だけの読みで節にしてある）：決まるまで計画を作らない。
  // 結ぶ問いか、先の資料の未解決のセルが必ず残るので上で止まる。止める理由が 1 つも無いときだけ、念のためここで止める（画面の理由の字は変えない）
  const held = lk.clusters.filter((c) => c.held && !c.pending && !c.excluded).length;
  if (held && !blockers.length) blockers.push(`資料をまたいで結ぶかの決まらない機器 ${held}`);
  // 要確認：明細の印と、確かめていない写真から作った機器の節（機器の節には要確認の欄が無いので写真の側で数える）
  const review = details.filter((d) => d.needsReview).length + photoReview.assets;
  if (review) blockers.push(`要確認 ${review}`);
  if (photoReview.photos) blockers.push(`確かめていない写真 ${photoReview.photos}`);
  let plan: Plan | null = null;
  const readingDecisions = ask.answered().map((q) => ({
    questionId: q.questionId,
    kind: q.kind,
    question: q.text,
    answer: q.valueKind === "number" ? q.decision!.answer : (q.options.find((o) => o.id === q.decision!.answer)?.label ?? q.decision!.answer),
    author: q.decision!.author,
    reason: q.decision!.reason,
    rows: q.sameShapeRows,
    details: affected.get(q.questionId) ?? [],
    where: whereOf(q.items),
  }));
  const draft = {
    schema: "moyai.plan/0" as const,
    planId: opts.planId,
    displayName: opts.displayName,
    packId: opts.packId,
    version: 0,
    levelNames: levelNames(rec, assets, opts.defaultLevelNames ?? []),
    facility: opts.facility,
    assets,
    works: [...works.values()],
    details,
    ...(readingDecisions.length ? { readingDecisions } : {}),
  };
  if (!blockers.length) {
    const parsed = Plan.safeParse(draft);
    if (parsed.success) plan = parsed.data;
    else blockers.push(`計画の形が違う：${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("、")}`);
  }
  // 保存した計画（作れなければ下書き）の出どころから数え直し、行の行き先が合わなければ計画を出さない
  const counts = countRows(sources, layouts, status, plan ? (JSON.parse(JSON.stringify(plan)) as Plan) : draft, contractCells);
  const lost = counts.filter((c) => !c.holds);
  if (lost.length) {
    blockers.push(`行の数え直しが合わない資料 ${lost.length}（${lost.map((c) => c.file).join("・")}）`);
    plan = null;
  }
  return { plan, blockers, status, counts, checks, photoReview, contracts: contracts.map(({ question: _q, ...x }) => ({ ...x, linked: x.linked === true })) };
}

/** 契約と結ぶ案の、明細の日付の重なり（両方に期間があるときだけ見る） */
function overlaps(a: { start: Ymd; end: Ymd }, start: string | null, end: string | null): boolean {
  if (!start || !end) return true;
  return ymdString(a.start) <= end && start <= ymdString(a.end);
}

/** 契約の金額のうち、作業の年度の値（実績）の費用にするもの：支払 → 検収 → 発注・契約 → そのほか。見積は使わない。単価契約は支払と検収だけ */
function actualCost(c: ContractRec): CostCell | null {
  const rank: Record<string, number> = { payAmount: 4, inspectAmount: 3, orderAmount: 2, amount: 1 };
  const xs = c.amounts.filter((a) => (rank[a.field] ?? 0) > 0 && (!c.unitPrice || (rank[a.field] ?? 0) >= 3)).sort((a, b) => (rank[b.field] ?? 0) - (rank[a.field] ?? 0));
  return xs[0]?.cost ?? null;
}

/** 結ぶ案を聞いている途中の契約の記録（linked は答えが無ければ null。question は案の問いの ID） */
type ContractDraft = Omit<ContractLink, "linked"> & { linked: boolean | null; question: string | null };

/** 結ぶ案を探す契約の期間の年度の数の上限（長い期間の契約で、明細を何十年分も見ない） */
const CONTRACT_YEARS_MAX = 10;

/** 契約と結ぶ案の問いの鍵（まとめる鍵。どの契約の一覧の案も、この 1 問にまとめる） */
export const CONTRACT_LINK_MERGE = "contractLink";

/**
 * 契約の記録と、件名の語と期間で結べる作業の年度の値（実績の明細）：件名に、作業の名前と、その作業の機器の名前がどちらも入っていて
 * （件名に号炉があれば機器の号炉と同じ）、明細の年度が契約の期間（無ければ契約の年度）に入り、両方に日付があれば重なるもの。
 * 変更契約の行と件名の無い行は結ばない。案のある契約ごとに問いを置き、どれも 1 問にまとめて聞く（既定は結ぶ）。
 * 結ぶと決めた契約は、契約と明細が 1 つずつ合い、明細に費用が無く、変更契約の行が無いときだけ、金額をその明細の費用にする（推し量って割らない・足さない）。
 * 結んでも結ばなくても、計画の作業と明細は増えない
 */
function linkContracts(
  contracts: readonly ContractRec[],
  assets: readonly AssetNodeT[],
  works: ReadonlyMap<string, WorkT>,
  details: WorkDetailT[],
  ask: Asker,
  startMonth: number,
): ContractDraft[] {
  const assetOf = new Map(assets.map((a) => [a.nodeKey, a]));
  // 実績の明細を年度ごとに、作業の名前と機器の名前（号炉）の比べる形にしておく（契約ごとに作り直さない）
  const byYear = new Map<number, { d: WorkDetailT; kind: string; names: { n: string; series: number | null }[] }[]>();
  for (const d of details) {
    if (d.planOrActual !== "actual") continue;
    const w = works.get(d.workKey);
    const kind = nameKey(w?.kind ?? "");
    if (!w || kind.length < 2) continue;
    const names = w.targets.flatMap((k) => {
      const a = assetOf.get(k);
      const n = nameKey(a?.name ?? "");
      return a && n.length >= 2 ? [{ n, series: a.series !== null && /^\d+$/.test(a.series) ? Number(a.series) : null }] : [];
    });
    if (names.length) byYear.set(d.fiscalYear, [...(byYear.get(d.fiscalYear) ?? []), { d, kind, names }]);
  }
  const out: ContractDraft[] = [];
  const text = (n: number) =>
    `契約の一覧の契約 ${n} 件が、件名の語（機器と作業の名前）と期間で、ほかの資料の作業の実績と合う。` +
    "結ぶと、契約の金額を、その作業の年度の値の費用にする（契約と作業が 1 つずつ合い、費用の無い年度の値だけ）。" +
    "結ばないと、契約は記録に残すだけで、計画は変わらない。どちらでも計画の作業は増えない。" +
    "推す：結ぶ（件名に機器と作業の名前があり、期間が合う）";
  const options = [
    { id: "yes", label: "結ぶ（金額を作業の年度の値の費用にする）" },
    { id: "no", label: "結ばない（契約は記録に残すだけ）" },
  ];
  for (const c of contracts) {
    const proposed: WorkDetailT[] = [];
    if (!c.changeOf && c.title && c.fiscalYear !== null) {
      const title = nameKey(c.title);
      const titleUnit = unitInText(c.title);
      const from = c.period ? fiscalYearOf(c.period.start, startMonth) : c.fiscalYear;
      const to = c.period ? fiscalYearOf(c.period.end, startMonth) : c.fiscalYear;
      for (let fy = from; fy <= to && fy - from < CONTRACT_YEARS_MAX; fy++)
        for (const x of byYear.get(fy) ?? []) {
          if (!title.includes(x.kind) || (c.period && !overlaps(c.period, x.d.startDate, x.d.endDate))) continue;
          if (x.names.some((a) => title.includes(a.n) && (titleUnit === null || a.series === null || a.series === titleUnit))) proposed.push(x.d);
        }
    }
    if (!proposed.length) {
      out.push({ contract: c, proposed: [], linked: null, costTo: null, question: null });
      continue;
    }
    const key = `contractLink|${c.id}|${proposed.map((d) => d.detailKey).sort().join(",")}`;
    const a = ask.ask(
      key,
      {
        kind: "workJoin",
        text: text(1),
        options,
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: 1,
        items: [
          {
            file: c.file,
            sheet: c.sheet,
            cells: c.titleRef ? [c.titleRef] : c.refs.slice(0, 1),
            target: proposed.map((d) => ({ file: d.sources[0]?.file ?? "", sheet: d.sources[0]?.sheet ?? null, cells: d.sources[0]?.cell ? [d.sources[0].cell] : [] })),
          },
        ],
      },
      { key: CONTRACT_LINK_MERGE, text },
    );
    out.push({ contract: c, proposed: proposed.map((d) => d.detailKey), linked: a === "yes" ? true : a === "no" ? false : null, costTo: null, question: questionIdOf(key) });
  }
  // 結ぶと決めた契約の金額：契約と明細が 1 つずつ合うときだけ、費用の無い明細に置く
  const linksOf = new Map<string, number>();
  for (const x of out) if (x.linked) for (const k of x.proposed) linksOf.set(k, (linksOf.get(k) ?? 0) + 1);
  const detailOf = new Map(details.map((d) => [d.detailKey, d]));
  // 変更契約の行のある契約は、どの金額が実績か決めつけない（足しも選びもしない）
  const changed = new Set(contracts.flatMap((c) => (c.changeOf ? [c.changeOf] : [])));
  for (const x of out) {
    if (!x.linked || x.proposed.length !== 1 || changed.has(x.contract.id)) continue;
    const k = x.proposed[0] ?? "";
    const d = detailOf.get(k);
    const cost = actualCost(x.contract);
    if (!d || d.cost !== null || linksOf.get(k) !== 1 || !cost) continue;
    d.cost = cost.yen;
    d.costSource = { file: x.contract.file, sheet: x.contract.sheet, ref: cost.ref, text: cost.text, tax: cost.tax };
    x.costTo = k;
  }
  return out;
}

/** 発注明細の結ぶ案の問いの鍵（まとめる鍵。どの発注明細の案も、この 1 問にまとめる） */
export const ORDER_LINE_LINK_MERGE = "orderLineLink";

/** 発注明細の、同じ機器・作業・年度・実績か予定の行のまとまり（結ぶ案の 1 つ） */
interface OrderLineGroup {
  key: string;
  asset: AssetNodeT;
  work: string;
  fiscalYear: number;
  planOrActual: "plan" | "actual";
  lines: ContractRec[];
  question: string;
  linked: boolean | null;
  /** 結んで置いた（か、同じ作業・年度の値に重ねた）明細の鍵 */
  detail?: string;
  costTo?: string;
}

/**
 * 発注明細の行の結ぶ案：品名・仕様から取り出した号炉と機器の名前が、ほかの資料の機器と同じ鍵（名前の比べる形と号炉）で、
 * その鍵の機器がただ 1 つのときだけ案にする（似た名前・号炉の違う機器とは結ばない）。年度の決まらない行・改訂の順の決まらない行は案にしない。
 * 同じ機器・作業・年度・実績か予定の行を 1 つの案にし、どの案も 1 問にまとめて聞く（既定は結ぶ）
 */
function proposeOrderLines(contracts: readonly ContractRec[], assets: readonly AssetNodeT[], ask: Asker): OrderLineGroup[] {
  const keyOfAsset = (name: string, series: string | null) => `${nameKey(name)}\u0000${series ?? ""}`;
  const byKey = new Map<string, AssetNodeT[]>();
  for (const a of assets) {
    const k = keyOfAsset(a.name, a.series);
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }
  const groups = new Map<string, OrderLineGroup>();
  for (const c of contracts) {
    const t = c.line?.target;
    if (!c.line || !t || c.line.revisionUnknown || c.fiscalYear === null) continue;
    // 検収が無く、発注額が 0 の行（取り消した明細の最後の改訂）は、予定にもしない
    if (c.line.planOrActual === "plan" && c.line.cost?.yen === 0) continue;
    const hits = byKey.get(keyOfAsset(t.asset, t.unit === null ? null : String(t.unit))) ?? [];
    const a = hits.length === 1 ? hits[0] : undefined;
    if (!a) continue;
    const key = `${a.nodeKey}|${nameKey(t.work)}|${c.fiscalYear}|${c.line.planOrActual}`;
    const g = groups.get(key);
    if (g) g.lines.push(c);
    else groups.set(key, { key, asset: a, work: t.work, fiscalYear: c.fiscalYear, planOrActual: c.line.planOrActual, lines: [c], question: "", linked: null });
  }
  const text = (n: number) =>
    `発注明細の ${n} 行が、品名・仕様の号炉と機器の名前で、ほかの資料の機器と同じ（名前と号炉が同じ機器がただ 1 つ）。` +
    "結ぶと、その機器の作業の年度の値にする（検収のある行は実績、無い行は予定。同じ機器・作業・年度の行の金額の和を、費用の無い年度の値の費用にする）。" +
    "結ばないと、明細は記録に残すだけで、計画は変わらない。取り出せない行（一式・諸経費・運搬など）は、どちらでも作業にしない。" +
    "推す：結ぶ（機器の名前と号炉が同じ）";
  const options = [
    { id: "yes", label: "結ぶ（その機器の作業の年度の値と費用にする）" },
    { id: "no", label: "結ばない（明細は記録に残すだけ）" },
  ];
  for (const g of groups.values()) {
    const qkey = `orderLineLink|${g.key}|${g.lines.map((c) => c.id).sort().join(",")}`;
    const byFile = new Map<string, ContractRec[]>();
    for (const c of g.lines) byFile.set(`${c.file}\u0000${c.sheet ?? ""}`, [...(byFile.get(`${c.file}\u0000${c.sheet ?? ""}`) ?? []), c]);
    const target = g.asset.sources.slice(0, 1).map((s) => ({ file: s.file, sheet: s.sheet, cells: s.cell ? [s.cell] : [] }));
    const a = ask.ask(
      qkey,
      {
        kind: "workJoin",
        text: text(g.lines.length),
        options,
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: g.lines.length,
        items: [...byFile.values()].map((cs) => ({
          file: cs[0]?.file ?? "",
          sheet: cs[0]?.sheet ?? null,
          cells: cs.map((c) => c.line?.itemRef ?? c.refs[0] ?? "").filter((r) => r !== ""),
          target,
        })),
      },
      { key: ORDER_LINE_LINK_MERGE, text },
    );
    g.question = questionIdOf(qkey);
    g.linked = a === "yes" ? true : a === "no" ? false : null;
  }
  return [...groups.values()];
}

/**
 * 結ぶ案の行の費用：どの行にも費用の候補（実績は検収累計額、予定は発注額）があるときだけ、その和（行の金額の和。割らない・推し量らない）。
 * 元の字は行の字を「＋」でつないだもの、元のセルは 1 行目のセル。税の扱いが行で違えば unknown
 */
function orderLinesCost(lines: readonly ContractRec[]): { cost: number | null; costSource?: NonNullable<WorkDetailT["costSource"]> } {
  const cs = lines.map((c) => c.line?.cost ?? null);
  if (!cs.length || cs.some((x) => x === null)) return { cost: null };
  const cells = cs as CostCell[];
  const first = lines[0]!;
  const taxes = new Set(cells.map((x) => x.tax));
  const tax = taxes.size === 1 ? (cells[0]?.tax ?? "unknown") : "unknown";
  return {
    cost: cells.reduce((a, x) => a + x.yen, 0),
    costSource: { file: first.file, sheet: first.sheet, ref: cells[0]?.ref ?? "", text: cells.map((x) => x.text).join("＋"), tax },
  };
}

/** 階層の名前：資料の見出しの名前、無ければパックの階層の名前（既定）、それも無ければ「第 n 階層」（docs/plan.md §2.2。運営者の指摘、11-06） */
function levelNames(rec: Records, assets: AssetNodeT[], defaults: readonly string[]): string[] {
  const depth = assets.reduce((a, x) => Math.max(a, x.level), 0);
  const names: string[] = [];
  const grid = [...rec.levelNames.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  for (let i = 0; i < depth; i++) names.push(grid[i] && grid[i] !== "" ? (grid[i] ?? "") : defaults[i] && defaults[i] !== "" ? defaults[i]! : `第${i + 1}階層`);
  return names;
}

/**
 * 行を数える。別々に数えて照らす：入れた行（格子から）、取り込んだ行（保存した計画の出どころと、計画の外に残す契約の記録のセルだけから）、
 * 外した行と未解決の行（セルの行き先だけから。外した行は、行のすべてのセルが外したもの）。
 * 行は「未解決のセルがある」「計画に入った」「すべて外した」の順に 1 つへ数える。
 * 計画に入った行がすべて外した行でもある・どこにも入らない行がある・データのセルが計画に無い、のどれかなら合わない。
 */
export function countRows(
  sources: SourceFile[],
  layouts: SheetLayout[],
  status: Map<string, CellStatus>,
  plan: { assets: { sources: { file: string; sheet: string | null; cell: string | null }[] }[]; details: { sources: { file: string; sheet: string | null; cell: string | null }[] }[] },
  /** 計画の外に残す記録（契約の記録）に読んだセル。計画の出どころと同じに、取り込んだ行に数える */
  kept: readonly { file: string; sheet: string | null; cell: string | null }[] = [],
): FileCounts[] {
  const SEP = "\u0000";
  const rowsInPlan = new Set<string>();
  const cellsInPlan = new Set<string>();
  for (const x of [...plan.assets, ...plan.details, { sources: kept }])
    for (const s of x.sources) {
      const r = /\d+$/.exec(s.cell ?? "")?.[0];
      rowsInPlan.add([s.file, s.sheet ?? "", r].join(SEP));
      cellsInPlan.add([s.file, s.sheet ?? "", s.cell].join(SEP));
    }
  const out: FileCounts[] = [];
  for (const src of sources) {
    const fc: FileCounts = { file: src.file, inputRows: 0, importedRows: 0, excludedRows: {}, unresolvedRows: 0, inputCells: 0, dataCells: 0, excludedCells: {}, unresolvedCells: 0, holds: false };
    let overlap = 0;
    let nowhere = 0;
    let dataNotInPlan = 0;
    for (const lay of layouts.filter((l) => l.file === src.file)) {
      const idx = new CellIndex(lay.grid);
      const rows = [...new Set(lay.grid.cells.map((c) => c.r))];
      fc.inputRows += rows.length;
      for (const r of rows) {
        const cells = idx.rowCells(r);
        const st = cells.map((c) => status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: c.ref })));
        for (const [i, s] of st.entries()) {
          fc.inputCells++;
          const c = cells[i];
          if (!s || s.s === "unresolved") fc.unresolvedCells++;
          else if (s.s === "excluded") fc.excludedCells[s.reason] = (fc.excludedCells[s.reason] ?? 0) + 1;
          else if (!c || !cellsInPlan.has([lay.file, lay.sheet ?? "", c.ref].join(SEP))) {
            // データの行き先なのに計画の出どころに無いセルは、データに数えず未解決に数える
            dataNotInPlan++;
            fc.unresolvedCells++;
          } else fc.dataCells++;
        }
        const inPlan = rowsInPlan.has([lay.file, lay.sheet ?? "", String(r)].join(SEP));
        const allExcluded = st.length > 0 && st.every((s) => s?.s === "excluded");
        const anyUnresolved = st.some((s) => !s || s.s === "unresolved");
        if (inPlan && allExcluded) overlap++;
        if (anyUnresolved) fc.unresolvedRows++;
        else if (inPlan) fc.importedRows++;
        else if (allExcluded) {
          const reasons = [...new Set(st.map((s) => (s && s.s === "excluded" ? s.reason : "")))];
          const why = reasons.length === 1 ? (reasons[0] ?? "") : `混在（${reasons.join("・")}）`;
          fc.excludedRows[why] = (fc.excludedRows[why] ?? 0) + 1;
        } else nowhere++;
      }
    }
    const ex = Object.values(fc.excludedRows).reduce((a, b) => a + b, 0);
    fc.holds = overlap === 0 && nowhere === 0 && dataNotInPlan === 0 && fc.inputRows === fc.importedRows + ex + fc.unresolvedRows;
    out.push(fc);
  }
  return out;
}

/** 決定が効く所の見出し（明細の数で言えない決定のため。資料と、シートがあればシート。Wire） */
function whereOf(items: readonly { file: string; sheet: string | null }[]): string {
  return [...new Set(items.map((i) => (i.sheet ? `${i.file} の ${i.sheet}` : i.file)))].slice(0, 3).join("・");
}
