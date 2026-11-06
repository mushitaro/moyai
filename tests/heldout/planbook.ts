// 中長期の計画表（階層の列が何列もあり、年度の欄に整備の内容と、その下の行の金額が 2 段で並ぶ表）を、
// 作り手の正解（answer/files/<stem>.json の records：path・marks{年度: 整備の内容}・cost_<年度>）と、
// answer/plan_locations.json の cell_map（"<plan_id>:<年度>" → 内容のセル・金額のセル）で測る道具。
// 台本（harness.ts の runScript と answer）で質問に答え、作った計画を、資料のとおりかで数える。
// 正解を読むのは測る人（この道具）だけ。読み手（src/）には渡さない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../../src/import/grid";
import type { Plan } from "../../src/shared/plan";
import { HeldoutTruth, nf, type Asset, type HeldoutWorld, type LoadedSet, type Mark } from "./contract";
import { runSet } from "./harness";
import { buildChart, catalogFromPack } from "../../src/plan/chart";

type J = any;

export interface PlanbookRecord {
  sheet: string;
  r: number;
  planId: string;
  assetId: string;
  path: string[];
  marks: Record<string, string>;
  costs: Record<string, number>;
}

export interface PlanbookTruth {
  file: string;
  records: PlanbookRecord[];
  /** "<plan_id>:<年度>" → 内容のセルと金額のセル */
  cells: Map<string, { sheet: string; text: string; cost: string | null }>;
  unit: string | null;
}

export function loadPlanbook(answerDir: string, stem: string): PlanbookTruth {
  const a: J = JSON.parse(readFileSync(join(answerDir, "files", `${stem}.json`), "utf8"));
  const loc: J = JSON.parse(readFileSync(join(answerDir, "plan_locations.json"), "utf8"));
  // 2 つの書き方：records（行ごとに path・marks・cost_<年度>）か、plan_rows（行ごとの path）と fiscal_year_cells（年度の欄ごとの内容・千円・セル）
  if (!a.records && a.plan_rows) {
    const byPlan = new Map<string, J[]>();
    for (const c of a.fiscal_year_cells as J[]) byPlan.set(c.plan_id, [...(byPlan.get(c.plan_id) ?? []), c]);
    a.records = (a.plan_rows as J[]).map((x) => {
      const fields = { ...x.fields };
      fields.marks = {};
      for (const c of byPlan.get(fields.plan_id) ?? []) {
        if (c.source.sheet !== x.sheet) continue;
        fields.marks[String(c.fiscal_year)] = c.text;
        if (typeof c.manufacturer_budget_thousand_yen === "number") fields[`cost_${c.fiscal_year}`] = c.manufacturer_budget_thousand_yen;
      }
      return { ...x, fields };
    });
    a.file = String(a.file).split("/").pop();
  }
  // 3 つ目の書き方：records は path だけで、年度の欄は year_values（plan_id → 年度 → 内容・千円）。シートは cell_map で決める
  if (a.year_values && (a.records as J[]).every((x) => !x.fields.marks)) {
    const yv = new Map<string, Record<string, J>>(Array.isArray(a.year_values) ? a.year_values : Object.entries(a.year_values));
    for (const x of a.records as J[]) {
      x.fields.marks = {};
      for (const [y, v] of Object.entries(yv.get(x.fields.plan_id) ?? {})) {
        if (!v || typeof v.text !== "string" || v.text === "" || loc.cell_map[`${x.fields.plan_id}:${y}`]?.sheet !== x.sheet) continue;
        x.fields.marks[y] = v.text;
        if (typeof v.cost_k === "number") x.fields[`cost_${y}`] = v.cost_k;
      }
    }
  }
  const records: PlanbookRecord[] = (a.records as J[]).map((x) => {
    const f = x.fields;
    const costs: Record<string, number> = {};
    for (const [k, v] of Object.entries(f)) if (k.startsWith("cost_") && typeof v === "number") costs[k.slice(5)] = v;
    return { sheet: x.sheet, r: x.r, planId: f.plan_id, assetId: f.asset_id ?? `共通費:${f.plan_id}`, path: f.path, marks: f.marks ?? {}, costs };
  });
  const cells = new Map<string, { sheet: string; text: string; cost: string | null }>();
  for (const [k, v] of Object.entries(loc.cell_map as Record<string, J>)) cells.set(k, { sheet: v.sheet, text: v.text_cell, cost: v.cost_cell ?? null });
  return { file: a.file, records, cells, unit: (a.records as J[])[0]?.fields?.unit ?? null };
}

const furnaceOf = (s: string): number | null => {
  const m = /(\d+)\s*号/.exec(s.normalize("NFKC"));
  return m ? Number(m[1]) : null;
};
const unitNoOf = (s: string): string | null => /No\.?\s*(\d+)/i.exec(s.normalize("NFKC"))?.[1] ?? null;

/** 正解 → 書き方に依らない正解の形（台本が質問に答えるためだけに使う。物差しは measurePlanbook） */
export function toHeldout(t: PlanbookTruth): { truth: HeldoutTruth; world: HeldoutWorld } {
  const assets: Asset[] = [];
  const marks: Mark[] = [];
  const eq = new Map<string, HeldoutWorld["equipment"][number]>();
  const works: HeldoutWorld["works"] = [];
  const seenCell = new Set<string>();
  for (const r of t.records) {
    const furnace = furnaceOf(r.path[2] ?? "");
    if (!eq.has(r.assetId)) eq.set(r.assetId, { id: r.assetId, name: r.path[1] ?? "", base_name: r.path[1] ?? "", tag: unitNoOf(r.path[2] ?? "") ? `No.${unitNoOf(r.path[2] ?? "")}` : "", system: r.path[0] ?? "", path: r.path.slice(0, 2), parts: [], furnace, furnace_label: r.path[2] ?? "", install_year: 0, spec: [] });
    // 設備（A）・機器群（B）・号炉（C）の欄：結合の主のセルにある、まとまりの正解（同じものかの質問に答えるため）
    for (const [col, depth] of [["A", 1], ["B", 3], ["C", 3]] as const) {
      const ref = `${col}${r.r}`;
      const k = `${r.sheet}|${ref}`;
      if (seenCell.has(k)) continue;
      seenCell.add(k);
      // 機器群（B）は機器（号炉ごと）。設備（A）・号炉（C）はまとまり
      if (col === "B") assets.push({ file: t.file, at: { cell: ref, sheet: r.sheet }, kind: "equipment", level: null, equipment_id: r.assetId, name_text: r.path[1] ?? "?", measure: false });
      else assets.push({ file: t.file, at: { cell: ref, sheet: r.sheet }, kind: "group", level: null, equipment_id: null, path: r.path.slice(0, depth).map((x) => x.normalize("NFKC").replace(/\s+/g, "")), name_text: r.path[depth - 1] ?? "?", measure: false });
    }
    const key = `${r.sheet}|D${r.r}`;
    if (!seenCell.has(key)) {
      seenCell.add(key);
      assets.push({ file: t.file, at: { cell: `D${r.r}`, sheet: r.sheet }, kind: "part", level: null, equipment_id: r.assetId, name_text: r.path[3] ?? "?", measure: false });
    }
    for (const [y, text] of Object.entries(r.marks)) {
      const c = t.cells.get(`${r.planId}:${y}`);
      if (!c) continue;
      const id = `${r.planId}:${y}`;
      works.push({ id, equipment_id: r.assetId, fiscal_year: Number(y), status: "planned", label: text, attr: "", start: null, end: null, man_days: null, duration_days: null, precision: false });
      marks.push({ file: t.file, at: { cell: c.text, sheet: c.sheet }, fiscal_year: Number(y), status: "planned", equipment_id: r.assetId, work_ids: [id], symbol: "○" });
    }
  }
  const truth = HeldoutTruth.parse({ schema: "moyai.heldout.truth/0", set: "planbook", world: "world.json", files: [{ file: t.file, format: "xlsx", kind: "star" }], assets, marks, events: [] });
  const world: HeldoutWorld = { schema: "moyai.heldout.world/0", facility: { id: "planbook", name: "【架空】計画表", furnace_type: "", furnaces: [] }, fiscal_years: [], today: "2026-11-06", man_day_hours: 8, equipment: [...eq.values()], works };
  return { truth, world };
}

export interface Ratio {
  correct: number;
  total: number;
  pct: number | null;
  misses: string[];
}
const ratio = (): Ratio => ({ correct: 0, total: 0, pct: null, misses: [] });
const done = (x: Ratio) => ({ ...x, pct: x.total ? Math.round((x.correct / x.total) * 1000) / 10 : null, misses: x.misses.slice(0, 15) });

export interface PlanbookResult {
  chartRows: { levelNames: string[]; seriesColumn: number | null; rows: string[] } | null;
  file: string;
  asked: number;
  answered: number;
  open: number;
  askedKinds: Record<string, number>;
  askedSample: string[];
  openKinds: Record<string, number>;
  openSample: string[];
  planMade: boolean;
  blockers: string[];
  surveyBytes: number;
  stuck: string[];
  plan: { assets: number; works: number; details: number } | null;
  unresolvedBefore: number;
  unresolvedAfter: number;
  facility: Ratio;
  machine: Ratio;
  series: Ratio;
  part: Ratio;
  work: Ratio;
  mark: Ratio;
  cost: Ratio;
  extraNodes: { count: number; sample: string[] };
  extraDetails: { count: number; byColumnHeader: Record<string, number>; sample: string[] };
}

const isCommon = (s: string | null) => s !== null && (s === "common" || s.startsWith("common"));
/** 名前の比べ：空白・改行を除き、号炉（「1号炉」）と号機（「No.1」）を外したもの */
const bare = (s: string) => nf(s).replace(/\d+号炉/g, "").replace(/No\.?\d+/gi, "").replace(/^[【\[].*?[】\]]/, "");

export function measurePlanbook(plan: Plan | null, t: PlanbookTruth, src: SourceFile | undefined): Omit<PlanbookResult, "chartRows" | "file" | "asked" | "answered" | "open" | "askedKinds" | "askedSample" | "openKinds" | "openSample" | "stuck" | "planMade" | "blockers" | "surveyBytes" | "unresolvedBefore" | "unresolvedAfter"> {
  const facility = ratio(), machine = ratio(), series = ratio(), part = ratio(), work = ratio(), mark = ratio(), cost = ratio();
  const assets = plan?.assets ?? [];
  const byKey = new Map(assets.map((a) => [a.nodeKey, a]));
  const nodeAt = (sheet: string, ref: string) => assets.find((a) => a.sources.some((s) => s.sheet === sheet && s.cell === ref)) ?? null;
  const ancestors = (a: (typeof assets)[number]) => {
    const out: (typeof assets)[number][] = [];
    let p = a.parentKey ? byKey.get(a.parentKey) : undefined;
    while (p) {
      out.push(p);
      p = p.parentKey ? byKey.get(p.parentKey) : undefined;
    }
    return out;
  };
  const works = new Map((plan?.works ?? []).map((w) => [w.workKey, w]));
  const truthCells = new Set<string>();
  for (const [, c] of t.cells) {
    truthCells.add(`${c.sheet}|${c.text}`);
    if (c.cost) truthCells.add(`${c.sheet}|${c.cost}`);
  }
  const truthRows = new Set(t.records.map((r) => `${r.sheet}|${r.r}`));
  for (const r of t.records) {
    const where = `${r.sheet} ${r.r} 行「${r.path.map((x) => x.replace(/\n/g, " ")).join("｜")}」`;
    const p = nodeAt(r.sheet, `D${r.r}`);
    const sameAsMachine = bare(r.path[3] ?? "") === bare(r.path[1] ?? "");
    // 機器：部位の節の親（部位の名前が機器と同じなら、その節そのものでもよい）
    const up = p ? ancestors(p) : [];
    const m = p ? ([...up, ...(sameAsMachine ? [p] : [])].find((a) => bare(a.name) === bare(r.path[1] ?? "") && a.level > 1) ?? null) : null;
    facility.total++;
    if (p && [p, ...up].some((a) => a.level === 1 && nf(a.name) === nf(r.path[0] ?? ""))) facility.correct++;
    else facility.misses.push(`${where}：設備の節${p ? `（根 ${[p, ...up].at(-1)?.name}）` : "（節が無い）"}`);
    machine.total++;
    if (m) machine.correct++;
    else machine.misses.push(`${where}：機器の節（${p ? `${[p, ...up].map((a) => a.name).join(" ‹ ")}` : "節が無い"}）`);
    series.total++;
    const fz = furnaceOf(r.path[2] ?? "");
    const no = unitNoOf(r.path[2] ?? "");
    const sOk = m && (fz !== null ? m.series === String(fz) : nf(r.path[2] ?? "") === "共通" ? isCommon(m.series) : m.series === null || isCommon(m.series)) && (no === null || (m.tag !== null && nf(m.tag).includes(no)));
    if (sOk) series.correct++;
    else series.misses.push(`${where}：号炉 ${m ? `series=${m.series} tag=${m.tag}` : "（機器の節が無い）"}`);
    part.total++;
    const pOk = p && (sameAsMachine ? bare(p.name) === bare(r.path[3] ?? "") : bare(p.name) === bare(r.path[3] ?? "") && m !== null && p.parentKey === m.nodeKey);
    if (pOk) part.correct++;
    else part.misses.push(`${where}：部位 ${p ? `「${p.name}」親「${p.parentKey ? byKey.get(p.parentKey)?.name : "なし"}」` : "節が無い"}`);
    for (const [y, text] of Object.entries(r.marks)) {
      const c = t.cells.get(`${r.planId}:${y}`);
      if (!c) continue;
      const ds = (plan?.details ?? []).filter((d) => d.sources.some((s) => s.sheet === c.sheet && s.cell === c.text));
      const w = ds.map((d) => works.get(d.workKey)).find((x) => x && p && x.targets.includes(p.nodeKey) && nf(x.kind).includes(bare(text)));
      work.total++;
      if (w) work.correct++;
      else work.misses.push(`${c.sheet} ${c.text}「${text}」：作業 ${ds.length ? ds.map((d) => `${works.get(d.workKey)?.kind}→${works.get(d.workKey)?.targets.map((k) => byKey.get(k)?.name).join(",")}`).join("／") : "明細が無い"}`);
      mark.total++;
      const okD = ds.find((d) => d.fiscalYear === Number(y) && d.planOrActual === "plan");
      if (okD) mark.correct++;
      else mark.misses.push(`${c.sheet} ${c.text}：星取 ${ds.map((d) => `${d.fiscalYear}${d.planOrActual}`).join(",") || "なし"}≠${y}plan`);
      const want = r.costs[y];
      if (want !== undefined) {
        cost.total++;
        const yen = Math.round(want * 1000);
        if (okD && okD.cost === yen && okD.costSource?.ref === c.cost) cost.correct++;
        else cost.misses.push(`${c.sheet} ${c.cost}：費用 ${okD ? `${okD.cost}（${okD.costSource?.ref ?? "元のセルなし"}）` : "明細なし"}≠${yen}`);
      }
    }
  }
  // 余分の節：正解の行（と、その上の結合の主のセル）のどれでもない所だけを出どころに持つ節
  const extraNodes = assets.filter((a) => a.sources.length && a.sources.every((s) => !s.cell || !truthRowsOf(s.sheet, s.cell, truthRows, src)));
  // 余分の明細：正解のセルのどれでもないセルを出どころに持つ明細（列の見出しごとに数える）
  const header = (sheet: string | null, ref: string) => {
    const sh = src?.sheets.find((s) => s.name === sheet);
    const col = /^[A-Z]+/.exec(ref)?.[0] ?? "";
    const top = sh?.cells.find((c) => c.ref === `${col}6`)?.text ?? "?";
    return top.replace(/\n/g, " ");
  };
  const extraD = (plan?.details ?? []).filter((d) => d.sources.every((s) => s.cell && !truthCells.has(`${s.sheet}|${s.cell}`)));
  const byColumnHeader: Record<string, number> = {};
  for (const d of extraD) {
    const s = d.sources[0]!;
    const h = `${s.sheet} ${header(s.sheet, s.cell ?? "")}`;
    byColumnHeader[h] = (byColumnHeader[h] ?? 0) + 1;
  }
  return {
    plan: plan ? { assets: plan.assets.length, works: plan.works.length, details: plan.details.length } : null,
    facility: done(facility),
    machine: done(machine),
    series: done(series),
    part: done(part),
    work: done(work),
    mark: done(mark),
    cost: done(cost),
    extraNodes: { count: extraNodes.length, sample: extraNodes.slice(0, 15).map((a) => `${a.name}（${a.sources[0]?.sheet} ${a.sources[0]?.cell}）`) },
    extraDetails: { count: extraD.length, byColumnHeader, sample: extraD.slice(0, 10).map((d) => `${works.get(d.workKey)?.kind}（${d.sources[0]?.sheet} ${d.sources[0]?.cell} ${d.fiscalYear}${d.planOrActual}）`) },
  };
}

/** そのセルが正解の行にあるか（結合の主のセルなら、結合が正解の行にかかるか） */
function truthRowsOf(sheet: string | null, ref: string, rows: Set<string>, src: SourceFile | undefined): boolean {
  const r = Number(/\d+$/.exec(ref)?.[0] ?? 0);
  if (rows.has(`${sheet}|${r}`)) return true;
  const sh = src?.sheets.find((s) => s.name === sheet);
  const m = sh?.merges.find((x) => x.ref.startsWith(`${ref}:`));
  if (m) for (let i = m.top; i <= m.bottom; i++) if (rows.has(`${sheet}|${i}`)) return true;
  return false;
}

/** 1 冊を、台本で答えながら取り込み、測る */
export async function runPlanbook(filesDir: string, answerDir: string, stem: string): Promise<PlanbookResult> {
  const t = loadPlanbook(answerDir, stem);
  const { truth, world } = toHeldout(t);
  const set: LoadedSet = { dir: answerDir, filesDir, truth, world };
  const r = await runSet(set, { read: [t.file] });
  const src = r.analysis.sources.find((s) => s.file === t.file);
  const askedKinds: Record<string, number> = {};
  for (const q of r.analysis.questions) askedKinds[q.kind] = (askedKinds[q.kind] ?? 0) + 1;
  const askedSample = Object.keys(askedKinds).map((k) => {
    const q = r.analysis.questions.find((x) => x.kind === k)!;
    return `${k}：${q.text.slice(0, 140)}｜${q.items.slice(0, 2).map((it) => `${it.sheet} ${it.cells.slice(0, 20).join(",")}`).join("；")}`;
  });
  const openKinds: Record<string, number> = {};
  const openSample = r.analysis.open.slice(0, 6).map((q) => `${q.kind}：${q.text.slice(0, 160)}｜${q.options.map((o) => o.id).join(",")}｜${q.items.slice(0, 3).map((it) => `${it.sheet} ${it.cells.join(",")}→${(it.target ?? []).map((t) => t.cells.join(",")).join("/")}`).join("；")}`);
  for (const q of r.result.openAtEnd) openKinds[q.kind] = (openKinds[q.kind] ?? 0) + 1;
  // 星取表の見え方（台帳の段）：階層の名前と、はじめの行の階層の欄
  const pj = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  const chart = r.plan
    ? buildChart(r.plan, catalogFromPack(pj("packs/waste-incineration/common.json"), pj("packs/_kinds/work.json")), { levelFallback: (n) => `第 ${n} 階層`, commonLevels: ["1", "2", "3"], unmapped: "未紐付け", series: (x) => x }, { mode: "ledger", period: "year", layer: "original", foldLevel: null })
    : null;
  const chartRows = chart ? { levelNames: chart.levelNames, seriesColumn: chart.seriesColumn, rows: chart.rows.slice(0, 14).map((x) => x.path.map((y) => y ?? "―").join(" › ")) } : null;
  return {
    chartRows,
    file: t.file,
    asked: r.result.asked,
    answered: r.result.answered,
    open: r.result.openAtEnd.length,
    askedKinds,
    askedSample,
    openKinds,
    openSample,
    planMade: r.result.planMade,
    blockers: r.result.blockers,
    surveyBytes: Buffer.byteLength(JSON.stringify(r.survey), "utf8"),
    stuck: r.survey.stuck.map((x) => `${x.cells} セル：${x.rows.slice(0, 4).map((y) => `${y.sheet} ${y.row}「${y.cells.join("｜").slice(0, 80)}」未解決 ${y.unresolved.join(",")}`).join("；")}`),
    unresolvedBefore: r.result.unresolvedBefore,
    unresolvedAfter: r.result.unresolvedAfter,
    ...measurePlanbook(r.plan, t, src),
  };
}
