// 層 4 当てはめと検算：元のセルを「データ／外した（理由）／未解決」に数え、小計・合計で検算し、
// 未解決が 0 のときだけ計画（src/shared/plan.ts の Plan）を作る（plan §2.3 の止める決まり）。
// 計画を作ったら、作った計画から数え直して「入れた行＝取り込んだ数＋外した数（理由ごと）」を出す。
import { Plan, type AssetNodeT, type WorkDetailT, type WorkT } from "../shared/plan";
import type { AuthorKind } from "../shared/fields";
import { CellIndex, type SourceFile } from "./grid";
import { Asker, questionIdOf, type Decision } from "./questions";
import { cellKey, type EventRec, type MarkRec, type Records } from "./records";
import { ROW_ROLE_LABEL, type SheetLayout, type Table } from "./structure";
import { nk, seriesLabel, type Cluster, type Job, type Linked, type Occurrence, type WorkLink } from "./link";
import { daysInclusive, parseDayCount, type Ymd } from "./era";
import { nameKey, parseEffort } from "./text";
import { cue } from "./cues";
import { markPhotoRecords, type PhotoReview } from "./photo";

export type CellStatus = { s: "data" } | { s: "excluded"; reason: string } | { s: "unresolved"; questionId: string | null };

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
}

function hash(s: string): string {
  return questionIdOf(s).slice(2, 14);
}

const AUTHOR_RANK: AuthorKind[] = ["ai", "ai_reading", "ai_relayed_human", "human", "rule_code"];

/** 同じ計画の中で機器を見分ける値が同じだった機器の鍵の頭（前の版と結ばず、当てはめの案にも並べない。台帳の中-8） */
export const AMBIGUOUS_KEY_PREFIX = "nx-";

function authorOf(qids: Iterable<string>, decisions: ReadonlyMap<string, Decision>): AuthorKind {
  let best: AuthorKind = "rule_code";
  for (const q of qids) {
    const d = decisions.get(q);
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
  exclude: (ref: string, why: string) => void,
  pend: (ref: string, q: string | null) => void,
  eventOf: (r: number) => EventRec | undefined,
): CheckResult[] {
  const out: CheckResult[] = [];
  const isData = (r: { role: string }) => r.role === "data" || r.role === "parent";
  const allData = t.rows.filter(isData);
  const sums = t.rows.filter((r) => r.role === "subtotal" || r.role === "total");
  const subs = t.rows.filter((r) => r.role === "subtotal").map((r) => r.r);
  // 小計を区切りの上に置く表か下に置く表か：最初の小計より前にデータの行が無ければ、上に置く表
  const above = subs.length > 0 && !allData.some((r) => r.r < (subs[0] ?? 0));
  for (const row of sums) {
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
    const cells = lay.index.rowCells(row.r);
    const res: CheckResult = { file: lay.file, sheet: lay.sheet, row: row.r, kind: row.role as "subtotal" | "total", columns: 0, matched: 0, mismatches: [] };
    let waiting = false;
    const numberOf = (v: unknown): number | null =>
      typeof v === "number" ? v : typeof v === "string" && /^\s*[\d,.]+\s*$/.test(v) ? Number(v.replace(/,/g, "")) : null;
    for (const c of cells) {
      const col = t.cols.find((k) => k.c === c.c);
      let written = numberOf(c.value);
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
      else if (col?.role === "mark") counted = data.filter((r) => (lay.index.at(r.r, c.c)?.text ?? "") !== "").length;
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
    if (waiting) for (const c of cells) pend(c.ref, null);
    else if (res.mismatches.length === 0) for (const c of cells) exclude(c.ref, `${label}（検算して合った）`);
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
      });
      for (const c of cells) a === "exclude" ? exclude(c.ref, `${label}（検算で合わなかった。決定で外した）`) : pend(c.ref, questionIdOf(key));
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
  decisions: ReadonlyMap<string, Decision>,
  opts: ComposeOptions,
): Composition {
  const status = new Map<string, CellStatus>();
  const excluded = new Map(rec.excluded);
  const pending = new Map<string, string | null>([...rec.pending].map((k) => [k, null]));
  const checks: CheckResult[] = [];
  const eventAt = new Map<string, EventRec>();
  for (const e of rec.events) eventAt.set(`${e.tableId}\u0000${e.row}`, e);
  for (const lay of layouts) {
    const ex = (ref: string, why: string) => excluded.set(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), why);
    const pd = (ref: string, q: string | null) => pending.set(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), q);
    for (const t of lay.tables) checks.push(...checkTotals(lay, t, ask, ex, pd, (r) => eventAt.get(`${t.id}\u0000${r}`)));
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
    assets.push({
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
    });
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
  // 読み方の決定（AI と会話から写した答え）ごとに、それで作者が決まった明細（決定のシートで、決定の行に付いて動く。Wire）
  const affected = new Map<string, string[]>();
  const addDetail = (d: Omit<WorkDetailT, "detailKey">, seed: string, qids: readonly string[]) => {
    let k = `d-${hash(seed)}`;
    let i = 2;
    while (detailKeys.has(k)) k = `d-${hash(`${seed}|${i++}`)}`;
    detailKeys.add(k);
    details.push({ ...d, detailKey: k });
    for (const q of new Set(qids)) {
      const a = decisions.get(q)?.author;
      if (a === "ai" || a === "ai_relayed_human") affected.set(q, [...(affected.get(q) ?? []), k]);
    }
  };
  const eventSources = (o: Occurrence) => o.events.flatMap((e) => e.refs.map((ref) => refOf(e.file, e.sheet, ref)));
  const jobSources = (j: Job) => j.units.flatMap(eventSources);
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
  const jobDetail = (j: Job, m: MarkRec | null, qids: Set<string>, kind: string, keyName: string) => {
    const c = j.cluster;
    const ak = keyOf.get(c) ?? "";
    const parent = parentOfJob(j);
    const wk = workFor(`asset|${ak}|${keyName}|${parent ?? ""}`, kind, [ak], parent);
    const v = jobValues(j);
    const r = range(j.units);
    const symbolQ = m ? [questionIdOf(`unknownSymbol|${m.tableId}|${m.symbol}`), questionIdOf(`noLegend|${m.tableId}|${m.symbol}`)] : [];
    const bundled = j.units.some((u) => u.bundle);
    const qs = [...c.decidedBy, ...qids, ...j.decidedBy, ...j.units.flatMap((u) => [...u.decidedBy]), ...v.qids, ...symbolQ];
    addDetail(
      {
        workKey: wk,
        planOrActual: m ? (m.planOrActual ?? "actual") : "actual",
        step: null,
        startDate: r.start,
        endDate: r.end,
        fiscalYear: m ? m.fiscalYear : j.fiscalYear,
        cost: null,
        manDays: v.manDays,
        days: v.days,
        resultScale: null,
        resultValue: null,
        measuredValue: null,
        previousValue: null,
        performer: null,
        sources: [...(m ? markSources(m) : []), ...jobSources(j)],
        basis: `${m ? `星取表 ${m.ref} の印「${m.symbol}」と ` : ""}${docsOf(j.units)}${bundled && v.manDays === null ? "。工数はまとめ工事の明細に" : ""}`,
        author: authorOf(qs, decisions),
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
      addDetail(
        {
          workKey: wk,
          planOrActual: m.planOrActual,
          step: null,
          startDate: null,
          endDate: null,
          fiscalYear: m.fiscalYear,
          cost: null,
          manDays: null,
          days: null,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: markSources(m),
          basis: `星取表 ${m.ref} の印「${m.symbol}」（${m.planOrActual === "plan" ? "予定" : "実績"}${m.workName ? `・${m.workName}` : ""}）`,
          author: authorOf([...c.decidedBy, ...symbolQ], decisions),
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
          planOrActual: "actual",
          step: null,
          startDate: r.start,
          endDate: r.end,
          fiscalYear: root.fiscalYear,
          cost: null,
          manDays: md.v,
          days: dy.v,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: members.flatMap(eventSources),
          basis: `まとめ工事（${bundleTargets(root).map((t) => t.name + seriesLabel(t.series)).join("・")}）。${docsOf(members)}`,
          author: authorOf(qs, decisions),
          needsReview: false,
        },
        `bundle|${root.id}`,
        qs,
      );
    }
  }
  for (const l of lk.links) {
    const evs = l.job.units.flatMap((u) => u.events);
    if (l.mode === "excluded") for (const e of evs) for (const ref of e.refs) excluded.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), "作業を外した（決定）");
    if (l.mode === "pending") for (const e of evs) for (const ref of e.refs) pending.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), null);
  }
  for (const { j, q } of conflictPending) for (const e of j.units.flatMap((u) => u.events)) for (const ref of e.refs) pending.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), q);
  for (const e of rec.events) {
    if (lk.eventPending.has(e.id)) for (const ref of e.refs) pending.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), null);
    const why = lk.eventExcluded.get(e.id);
    if (why) for (const ref of e.refs) excluded.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), why);
  }
  for (const c of lk.clusters) {
    if (c.excluded) for (const r of c.recs) for (const ref of r.refs) excluded.set(cellKey({ file: r.file, sheetIndex: r.sheetIndex, ref }), r.excluded ?? c.excluded);
    if (c.pending) for (const r of c.recs) for (const ref of r.refs) pending.set(cellKey({ file: r.file, sheetIndex: r.sheetIndex, ref }), null);
  }
  for (const m of rec.marks) {
    const c = m.assetId ? lk.clusterOf.get(m.assetId) : undefined;
    const k = cellKey({ file: m.file, sheetIndex: m.sheetIndex, ref: m.ref });
    if (c?.excluded && !m.excluded) excluded.set(k, "機器を外した（決定）");
    if (c?.pending) pending.set(k, null);
  }

  // ─── 行き先を数える ───
  const dataKeys = new Set<string>();
  const sheetIndexOf = new Map<string, number>();
  for (const lay of layouts) sheetIndexOf.set(`${lay.file}\u0000${lay.sheet ?? ""}`, lay.sheetIndex);
  const addData = (s: { file: string; sheet: string | null; cell: string | null }) => {
    const si = sheetIndexOf.get(`${s.file}\u0000${s.sheet ?? ""}`) ?? 0;
    if (s.cell) dataKeys.add(cellKey({ file: s.file, sheetIndex: si, ref: s.cell }));
  };
  for (const a of assets) for (const s of a.sources) addData(s);
  for (const d of details) for (const s of d.sources) addData(s);
  const strays: { lay: SheetLayout; ref: string }[] = [];
  for (const lay of layouts) {
    for (const cell of lay.grid.cells) {
      const k = cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref });
      if (pending.has(k)) status.set(k, { s: "unresolved", questionId: pending.get(k) ?? null });
      else if (dataKeys.has(k)) status.set(k, { s: "data" });
      else if (excluded.has(k)) status.set(k, { s: "excluded", reason: excluded.get(k) ?? "" });
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
      text: `${lay.file}${lay.sheet ? ` の「${lay.sheet}」` : ""} に、読み方の決まらないセルが ${refs.length} ある`,
      options: [{ id: "exclude", label: "外す（読み方が決まらないため）" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: refs.length,
      items: [{ file: lay.file, sheet: lay.sheet, cells: refs.slice(0, 20) }],
    });
    for (const ref of refs) {
      const k = cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref });
      status.set(k, a === "exclude" ? { s: "excluded", reason: "読み方の決まらないセル（決定で外した）" } : { s: "unresolved", questionId: questionIdOf(key) });
    }
  }

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
    levelNames: levelNames(rec, assets),
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
  const counts = countRows(sources, layouts, status, plan ? (JSON.parse(JSON.stringify(plan)) as Plan) : draft);
  const lost = counts.filter((c) => !c.holds);
  if (lost.length) {
    blockers.push(`行の数え直しが合わない資料 ${lost.length}（${lost.map((c) => c.file).join("・")}）`);
    plan = null;
  }
  return { plan, blockers, status, counts, checks, photoReview };
}

function levelNames(rec: Records, assets: AssetNodeT[]): string[] {
  const depth = assets.reduce((a, x) => Math.max(a, x.level), 0);
  const names: string[] = [];
  const grid = [...rec.levelNames.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  for (let i = 0; i < depth; i++) names.push(grid[i] && grid[i] !== "" ? (grid[i] ?? "") : `第${i + 1}階層`);
  return names;
}

/**
 * 行を数える。別々に数えて照らす：入れた行（格子から）、取り込んだ行（保存した計画の出どころだけから）、
 * 外した行と未解決の行（セルの行き先だけから。外した行は、行のすべてのセルが外したもの）。
 * 行は「未解決のセルがある」「計画に入った」「すべて外した」の順に 1 つへ数える。
 * 計画に入った行がすべて外した行でもある・どこにも入らない行がある・データのセルが計画に無い、のどれかなら合わない。
 */
export function countRows(sources: SourceFile[], layouts: SheetLayout[], status: Map<string, CellStatus>, plan: { assets: { sources: { file: string; sheet: string | null; cell: string | null }[] }[]; details: { sources: { file: string; sheet: string | null; cell: string | null }[] }[] }): FileCounts[] {
  const SEP = "\u0000";
  const rowsInPlan = new Set<string>();
  const cellsInPlan = new Set<string>();
  for (const x of [...plan.assets, ...plan.details])
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
