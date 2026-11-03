// 層 4 当てはめと検算：元のセルを「データ／外した（理由）／未解決」に数え、小計・合計で検算し、
// 未解決が 0 のときだけ計画（src/shared/plan.ts の Plan）を作る（plan §2.3 の止める決まり）。
// 計画を作ったら、作った計画から数え直して「入れた行＝取り込んだ数＋外した数（理由ごと）」を出す。
import { Plan, type AssetNodeT, type WorkDetailT, type WorkT } from "../shared/plan";
import type { AuthorKind } from "../shared/fields";
import { CellIndex, type SourceFile } from "./grid";
import { Asker, questionIdOf, type Decision } from "./questions";
import { cellKey, type MarkRec, type Records } from "./records";
import { ROW_ROLE_LABEL, type SheetLayout, type Table } from "./structure";
import { seriesLabel, type Cluster, type Linked, type Occurrence } from "./link";
import { nameKey } from "./text";

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
}

function hash(s: string): string {
  return questionIdOf(s).slice(2, 14);
}

const AUTHOR_RANK: AuthorKind[] = ["ai", "ai_reading", "ai_relayed_human", "human", "rule_code"];

function authorOf(qids: Iterable<string>, decisions: ReadonlyMap<string, Decision>): AuthorKind {
  let best: AuthorKind = "rule_code";
  for (const q of qids) {
    const d = decisions.get(q);
    if (d && AUTHOR_RANK.indexOf(d.author) < AUTHOR_RANK.indexOf(best)) best = d.author;
  }
  return best;
}

/** 小計・合計の行を検算する。星取表の形は印のあるセルの数、ほかの形は数の和と比べる */
function checkTotals(lay: SheetLayout, t: Table, ask: Asker, exclude: (ref: string, why: string) => void, pend: (ref: string, q: string) => void): CheckResult[] {
  const out: CheckResult[] = [];
  const data = t.rows.filter((r) => r.role === "data" || r.role === "parent");
  for (const row of t.rows.filter((r) => r.role === "subtotal" || r.role === "total")) {
    const cells = lay.index.rowCells(row.r);
    const res: CheckResult = { file: lay.file, sheet: lay.sheet, row: row.r, kind: row.role as "subtotal" | "total", columns: 0, matched: 0, mismatches: [] };
    for (const c of cells) {
      const written = typeof c.value === "number" ? c.value : typeof c.value === "string" && /^\s*[\d,.]+\s*$/.test(c.value) ? Number(c.value.replace(/,/g, "")) : null;
      if (written === null) continue;
      const col = t.cols.find((k) => k.c === c.c);
      let counted = 0;
      if (col?.role === "mark") counted = data.filter((r) => (lay.index.at(r.r, c.c)?.text ?? "") !== "").length;
      else
        counted = data.reduce((a, r) => {
          const v = lay.index.at(r.r, c.c)?.value;
          return a + (typeof v === "number" ? v : 0);
        }, 0);
      res.columns++;
      if (Math.abs(counted - written) < 1e-9) res.matched++;
      else res.mismatches.push({ ref: c.ref, written, counted });
    }
    const label = ROW_ROLE_LABEL[row.role];
    if (res.mismatches.length === 0) for (const c of cells) exclude(c.ref, `${label}（検算して合った）`);
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
  for (const lay of layouts) {
    const ex = (ref: string, why: string) => excluded.set(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), why);
    const pd = (ref: string, q: string) => pending.set(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref }), q);
    for (const t of lay.tables) checks.push(...checkTotals(lay, t, ask, ex, pd));
  }

  // ─── 資産の節 ───
  const live = lk.clusters.filter((c) => !c.excluded);
  const keyOf = new Map<Cluster, string>();
  const used = new Set<string>();
  for (const c of live) {
    const first = [...c.recs].sort((a, b) => a.file.localeCompare(b.file) || a.sheetIndex - b.sheetIndex || a.order - b.order)[0];
    let k = `n-${hash(`${first?.file}|${first?.sheetIndex}|${first?.nameRef}`)}`;
    let i = 2;
    while (used.has(k)) k = `n-${hash(`${first?.file}|${first?.sheetIndex}|${first?.nameRef}|${i++}`)}`;
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
  const refOf = (file: string, sheet: string | null, ref: string) => ({ file, sheet, page: null, cell: ref, box: null });
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
        attribute: null,
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
  const addDetail = (d: Omit<WorkDetailT, "detailKey">, seed: string) => {
    let k = `d-${hash(seed)}`;
    let i = 2;
    while (detailKeys.has(k)) k = `d-${hash(`${seed}|${i++}`)}`;
    detailKeys.add(k);
    details.push({ ...d, detailKey: k });
  };
  const eventSources = (o: Occurrence) => o.events.flatMap((e) => e.refs.map((ref) => refOf(e.file, e.sheet, ref)));
  const markLinks = new Map<MarkRec, { o: Occurrence; qids: Set<string> }[]>();
  const okCluster = (c: Cluster | undefined): c is Cluster => !!c && !c.pending && !c.excluded;
  for (const l of lk.links) {
    if (l.mode === "mark" && l.mark) markLinks.set(l.mark, [...(markLinks.get(l.mark) ?? []), { o: l.occurrence, qids: l.decidedBy }]);
  }
  const markDetailsDone = new Set<MarkRec>();
  const bundleWork = (o: Occurrence): string | null => {
    if (!o.bundle) return null;
    const targets = o.targets.filter(okCluster).map((c) => keyOf.get(c) ?? "").sort();
    return workFor(`bundle|${o.workKey}|${targets.join(",")}`, o.workName, targets, null);
  };
  // 印から
  for (const m of rec.marks) {
    if (m.excluded || m.pending || !m.assetId || !m.planOrActual) continue;
    const c = lk.clusterOf.get(m.assetId);
    if (!okCluster(c)) continue;
    const ak = keyOf.get(c) ?? "";
    const ls = markLinks.get(m) ?? [];
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
          sources: [refOf(m.file, m.sheet, m.ref)],
          basis: `星取表 ${m.ref} の印「${m.symbol}」（${m.planOrActual === "plan" ? "予定" : "実績"}${m.workName ? `・${m.workName}` : ""}）`,
          author: authorOf([...c.decidedBy, ...symbolQ], decisions),
          needsReview: false,
        },
        `mark|${m.file}|${m.sheetIndex}|${m.ref}`,
      );
    } else
      for (const { o, qids } of ls) {
        const parent = bundleWork(o);
        const wk = workFor(`asset|${ak}|${o.workKey}|${parent ?? ""}`, o.workName, [ak], parent);
        addDetail(
          {
            workKey: wk,
            planOrActual: m.planOrActual,
            step: null,
            startDate: o.start,
            endDate: o.end,
            fiscalYear: m.fiscalYear,
            cost: null,
            manDays: o.bundle ? null : o.manDays,
            days: null,
            resultScale: null,
            resultValue: null,
            measuredValue: null,
            previousValue: null,
            performer: null,
            sources: [refOf(m.file, m.sheet, m.ref), ...eventSources(o)],
            basis: `星取表 ${m.ref} の印「${m.symbol}」と ${o.file} の ${o.events.length} 行（${[...new Set(o.events.map((e) => e.workTitle ?? e.workName))].join("・")}）${o.bundle ? "。工数はまとめ工事の明細に" : ""}`,
            author: authorOf([...c.decidedBy, ...qids, ...o.decidedBy, ...symbolQ], decisions),
            needsReview: false,
          },
          `mark|${m.file}|${m.sheetIndex}|${m.ref}|${o.id}`,
        );
      }
    markDetailsDone.add(m);
  }
  // 日報だけの記録と、まとめ工事の明細
  const occDone = new Set<Occurrence>();
  for (const l of lk.links) {
    const o = l.occurrence;
    if (l.mode === "eventOnly" && okCluster(l.cluster)) {
      const ak = keyOf.get(l.cluster) ?? "";
      const parent = bundleWork(o);
      const wk = workFor(`asset|${ak}|${o.workKey}|${parent ?? ""}`, o.workName, [ak], parent);
      addDetail(
        {
          workKey: wk,
          planOrActual: "actual",
          step: null,
          startDate: o.start,
          endDate: o.end,
          fiscalYear: o.fiscalYear,
          cost: null,
          manDays: o.bundle ? null : o.manDays,
          days: null,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: eventSources(o),
          basis: `${o.file} の ${o.events.length} 行（${[...new Set(o.events.map((e) => e.workTitle ?? e.workName))].join("・")}）`,
          author: authorOf([...l.cluster.decidedBy, ...l.decidedBy, ...o.decidedBy], decisions),
          needsReview: false,
        },
        `event|${o.id}|${ak}`,
      );
    }
    if (o.bundle && !occDone.has(o) && (l.mode === "mark" || l.mode === "eventOnly")) {
      occDone.add(o);
      const parent = bundleWork(o);
      if (parent)
        addDetail(
          {
            workKey: parent,
            planOrActual: "actual",
            step: null,
            startDate: o.start,
            endDate: o.end,
            fiscalYear: o.fiscalYear,
            cost: null,
            manDays: o.manDays,
            days: null,
            resultScale: null,
            resultValue: null,
            measuredValue: null,
            previousValue: null,
            performer: null,
            sources: eventSources(o),
            basis: `まとめ工事（${o.targets.map((t) => t.name + seriesLabel(t.series)).join("・")}）。${o.file} の ${o.events.length} 行`,
            author: authorOf(o.decidedBy, decisions),
            needsReview: false,
          },
          `bundle|${o.id}`,
        );
    }
  }
  for (const l of lk.links) {
    if (l.mode === "excluded") for (const e of l.occurrence.events) for (const ref of e.refs) excluded.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), "作業を外した（決定）");
    if (l.mode === "pending") for (const e of l.occurrence.events) for (const ref of e.refs) pending.set(cellKey({ file: e.file, sheetIndex: e.sheetIndex, ref }), null);
  }
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

  // ─── 止める決まり ───
  const blockers: string[] = [];
  const unresolved = [...status.values()].filter((s) => s.s === "unresolved").length;
  if (unresolved) blockers.push(`未解決のセル ${unresolved}`);
  const open = ask.open().filter((q) => !q.decision);
  if (open.length) blockers.push(`答えの無い質問 ${open.length}`);
  const invalid = ask.invalidDecisions();
  if (invalid.length) blockers.push(`当てはまらない決定 ${invalid.length}`);
  const review = details.filter((d) => d.needsReview).length;
  if (review) blockers.push(`要確認 ${review}`);
  let plan: Plan | null = null;
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
  };
  if (!blockers.length) {
    const parsed = Plan.safeParse(draft);
    if (parsed.success) plan = parsed.data;
    else blockers.push(`計画の形が違う：${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("、")}`);
  }
  const counts = countRows(sources, layouts, status, plan ?? draft);
  return { plan, blockers, status, counts, checks };
}

function levelNames(rec: Records, assets: AssetNodeT[]): string[] {
  const depth = assets.reduce((a, x) => Math.max(a, x.level), 0);
  const names: string[] = [];
  const grid = [...rec.levelNames.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  for (let i = 0; i < depth; i++) names.push(grid[i] && grid[i] !== "" ? (grid[i] ?? "") : `第${i + 1}階層`);
  return names;
}

/**
 * 行を数える。取り込んだ行は、作った計画（または計画の下書き）の出どころから数え直す。
 * 外した行は、行のすべてのセルが外したもの（理由が 1 つならその理由、いくつかなら「混在」）。
 */
function countRows(sources: SourceFile[], layouts: SheetLayout[], status: Map<string, CellStatus>, plan: { assets: { sources: { file: string; sheet: string | null; cell: string | null }[] }[]; details: { sources: { file: string; sheet: string | null; cell: string | null }[] }[] }): FileCounts[] {
  const rowsInPlan = new Set<string>();
  const cellsInPlan = new Set<string>();
  for (const x of [...plan.assets, ...plan.details])
    for (const s of x.sources) {
      const r = /\d+$/.exec(s.cell ?? "")?.[0];
      rowsInPlan.add(`${s.file}\u0000${s.sheet ?? ""}\u0000${r}`);
      cellsInPlan.add(`${s.file}\u0000${s.sheet ?? ""}\u0000${s.cell}`);
    }
  const out: FileCounts[] = [];
  for (const src of sources) {
    const fc: FileCounts = { file: src.file, inputRows: 0, importedRows: 0, excludedRows: {}, unresolvedRows: 0, inputCells: 0, dataCells: 0, excludedCells: {}, unresolvedCells: 0, holds: false };
    for (const lay of layouts.filter((l) => l.file === src.file)) {
      const idx = new CellIndex(lay.grid);
      const rows = new Set(lay.grid.cells.map((c) => c.r));
      for (const r of rows) {
        fc.inputRows++;
        const cells = idx.rowCells(r);
        const st = cells.map((c) => status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: c.ref })));
        for (const [i, s] of st.entries()) {
          fc.inputCells++;
          const c = cells[i];
          if (!s || s.s === "unresolved") fc.unresolvedCells++;
          else if (s.s === "excluded") fc.excludedCells[s.reason] = (fc.excludedCells[s.reason] ?? 0) + 1;
          else if (c && cellsInPlan.has(`${lay.file}\u0000${lay.sheet ?? ""}\u0000${c.ref}`)) fc.dataCells++;
          else fc.unresolvedCells++;
        }
        if (st.some((s) => !s || s.s === "unresolved")) fc.unresolvedRows++;
        else if (rowsInPlan.has(`${lay.file}\u0000${lay.sheet ?? ""}\u0000${r}`)) fc.importedRows++;
        else {
          const reasons = [...new Set(st.map((s) => (s && s.s === "excluded" ? s.reason : "?")))];
          const why = reasons.length === 1 ? (reasons[0] ?? "?") : `混在（${reasons.join("・")}）`;
          fc.excludedRows[why] = (fc.excludedRows[why] ?? 0) + 1;
        }
      }
    }
    const ex = Object.values(fc.excludedRows).reduce((a, b) => a + b, 0);
    fc.holds = fc.inputRows === fc.importedRows + ex + fc.unresolvedRows;
    out.push(fc);
  }
  return out;
}
