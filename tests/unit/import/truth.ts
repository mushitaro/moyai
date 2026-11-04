// 試験だけが読む：工場の正解（samples/truth）と原本の事実（samples/facts）から、
// 質問に答える決まった台本と、物差し ①②③⑤ を作る。src/ からは読まない。
import { readFileSync, existsSync } from "node:fs";
import type { Analysis } from "../../../src/import/session";
import type { Decision, QuestionState, QuestionItem } from "../../../src/import/questions";
import type { SourceFile } from "../../../src/import/grid";
import type { Plan } from "../../../src/shared/plan";

const nf = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const rowOf = (ref: string) => Number(/\d+$/.exec(ref)?.[0] ?? 0);
const colOf = (ref: string) => /^[A-Z]+/.exec(ref)?.[0] ?? "";

type J = Record<string, unknown> & any;

export interface Truth {
  pack: string;
  facility: string;
  world: J;
  ledger: J | null;
  star: J | null;
  daily: J | null;
  crossdoc: J | null;
  /** 工事報告書（PDF）の正解。report-f<炉>-fy<年度> ごとの行（No.・機器・作業・工期・日数・工数） */
  reports: J | null;
  /** 写真の正解：どの報告書のどの頁を撮ったか（写真の格子の行は、その報告書の正解の行で照らす） */
  photos: J | null;
  facts: Record<string, J>;
}

export function loadTruth(pack: string, facility: string): Truth {
  const base = `samples/truth/${pack}/${facility}/`;
  const read = (n: string) => (existsSync(base + n) ? JSON.parse(readFileSync(base + n, "utf8")) : null);
  const facts: Record<string, J> = {};
  for (const [n, ext] of [["equipment-ledger", "xlsx"], ["plan-hoshitori", "xlsx"], ["daily-report", "csv"]] as const) {
    const p = `samples/facts/${pack}/${facility}/${n}.facts.json`;
    if (existsSync(p)) facts[`${n}.${ext}`] = JSON.parse(readFileSync(p, "utf8"));
  }
  return {
    pack,
    facility,
    world: read("world.json"),
    ledger: read("equipment-ledger.truth.json"),
    star: read("plan-hoshitori.truth.json"),
    daily: read("daily-report.truth.json"),
    crossdoc: read("crossdoc.truth.json"),
    reports: read("reports.truth.json"),
    photos: read("photos.truth.json"),
    facts,
  };
}

// ─── 報告書の PDF の格子の行 ↔ 正解の行 ─────────────────────────────────
// 正解は報告書の No. と機器の文字で行を持つ。読み手の格子の行の番号は読み手が決めるので、
// 格子の行の中に「No. の数」と「機器の文字」が両方あるものを、その正解の行とする（比べるためだけ）。

export class ReportRows {
  /** 資料（PDF）→ 正解の行 → 格子の行の番号 */
  private readonly rowOf = new Map<string, Map<number, number>>();
  private readonly byRow = new Map<string, Map<number, J>>();
  readonly files: string[];
  constructor(
    private readonly t: Truth,
    sources: SourceFile[],
  ) {
    this.files = ((t.reports?.reports ?? []) as J[]).map((r) => r.file_pdf as string);
    // 写真は、撮った報告書の頁の正解の行で照らす（写真の資料の名前は、取り込みに入れたファイルの名前）
    const photoOf = (r: J) => ((t.photos?.photos ?? []) as J[]).filter((ph) => ph.source_pdf === r.file_pdf);
    const targets: { file: string; r: J }[] = [];
    for (const r of (t.reports?.reports ?? []) as J[]) {
      targets.push({ file: r.file_pdf, r });
      for (const ph of photoOf(r)) targets.push({ file: String(ph.file).split("/").pop() as string, r });
    }
    for (const { file, r } of targets) {
      const src = sources.find((s) => s.file === file);
      const g = src?.sheets[0];
      const m = new Map<number, number>();
      const back = new Map<number, J>();
      if (g) {
        const rows = new Map<number, string[]>();
        for (const c of g.cells) rows.set(c.r, [...(rows.get(c.r) ?? []), nf(c.text)]);
        for (const x of r.rows as J[]) {
          const hit = [...rows.entries()].find(([, ts]) => ts.includes(String(x.no)) && ts.includes(nf(x.equipment_text)));
          if (hit) {
            m.set(x.no, hit[0]);
            back.set(hit[0], x);
          }
        }
      }
      this.rowOf.set(file, m);
      this.byRow.set(file, back);
    }
  }
  report(file: string): J | null {
    return ((this.t.reports?.reports ?? []) as J[]).find((r) => r.file_pdf === file) ?? null;
  }
  /** 格子のセル → 正解の行 */
  rowAt(file: string, ref: string): J | null {
    return this.byRow.get(file)?.get(rowOf(ref)) ?? null;
  }
  /** 正解の行 → 格子の行の番号 */
  gridRow(file: string, no: number): number | null {
    return this.rowOf.get(file)?.get(no) ?? null;
  }
}

/** 日報か報告書のセルが指す正解の行（機器と作業の id） */
function eventTruth(t: Truth, reps: ReportRows | null, file: string, ref: string): { equipment_ids: string[]; work_ids: string[] } | null {
  if (t.daily && file === t.daily.file) return ((t.daily.rows as J[]).find((x) => x.line === rowOf(ref)) as J) ?? null;
  return reps?.rowAt(file, ref) ?? null;
}

// ─── 正解の「もの」：セルが指す機器・段の道 ─────────────────────────

export class Entities {
  readonly eq = new Map<string, J>();
  constructor(private readonly t: Truth) {
    for (const e of t.world.equipment) this.eq.set(e.id, e);
  }
  /** 台帳の行 → もの */
  ledgerRow(row: number): string | null {
    const rows: J[] = this.t.ledger?.rows ?? [];
    const r = rows.find((x) => x.row === row);
    if (!r) return null;
    if (r.kind === "equipment") return `e:${r.equipment_id}`;
    if (r.kind === "part") return `part:${r.equipment_id}:${nf(r.name_text)}`;
    // まとまりの行：下にある最初の機器の道の、その段まで
    const after = rows.filter((x) => x.row > row);
    for (const x of after) {
      if (x.level <= r.level) break;
      if (x.kind === "equipment") {
        const e = this.eq.get(x.equipment_id);
        return `p:${(e?.path ?? []).slice(0, r.level).join("/")}`;
      }
    }
    return `p?:${r.name_text}`;
  }
  /** 星取表のセル → もの（段の列は道、葉の列は機器） */
  starCell(ref: string): string | null {
    const s = this.t.star;
    if (!s) return null;
    const row = rowOf(ref);
    const col = colOf(ref);
    const tr = (s.rows as J[]).find((x) => x.row === row);
    const levels: string[] = s.columns.levels ?? [];
    if (col === s.columns.equipment) return tr ? `e:${tr.equipment_id}` : null;
    const li = levels.indexOf(col);
    if (li >= 0) {
      // 結合の主のセルなら、その範囲の最初の行の機器の道
      const e = tr ? this.eq.get(tr.equipment_id) : null;
      return e ? `p:${e.path.slice(0, li + 1).join("/")}` : null;
    }
    return null;
  }
  of(file: string, ref: string): string | null {
    if (file === this.t.ledger?.file) return this.ledgerRow(rowOf(ref));
    if (file === this.t.star?.file) return this.starCell(ref);
    return null;
  }
}

// ─── 決まった台本：正解から質問に答える ───────────────────────────

const AUTHOR_REASON = "試験の台本が押した（正解の世界から）";

export function answer(q: QuestionState, t: Truth, ents: Entities, reps: ReportRows | null = null): string | null {
  const dailyLine = (ref: string) => (t.daily?.rows as J[] | undefined)?.find((x) => x.line === rowOf(ref));
  const ev = (file: string, ref: string) => eventTruth(t, reps, file, ref);
  const eqOfEntity = (e: string | null) => (e && e.startsWith("e:") ? e.slice(2) : null);
  /** 2 つの出どころが指す正解の作業が重なるか（資料をまたぐ同じ作業） */
  const sameWork = (a: { file: string; cells: string[] }, b: { file: string; cells: string[] }) => {
    const wa = new Set(a.cells.flatMap((c) => ev(a.file, c)?.work_ids ?? []));
    const wb = b.cells.flatMap((c) => ev(b.file, c)?.work_ids ?? []);
    return wa.size > 0 && wb.some((w) => wa.has(w));
  };
  const targetEntity = (it: QuestionItem) => {
    const tg = it.target?.[0];
    return tg ? ents.of(tg.file, tg.cells[0] ?? "") : null;
  };
  switch (q.kind) {
    case "tagSplit": {
      const ok = q.items.every((it) => {
        const e = ents.of(it.file, it.cells[0] ?? "");
        const eq = eqOfEntity(e);
        if (!eq) return false;
        const w = ents.eq.get(eq);
        return !!w && typeof it.note === "string" && it.note.startsWith(w.tag);
      });
      return ok ? "yes" : "no";
    }
    case "levelSplit": {
      const rows: J[] = t.ledger?.rows ?? [];
      const levels = new Set(q.items.flatMap((it) => it.cells.map((c) => rows.find((r) => r.row === rowOf(c))?.level)));
      return levels.size === 1 ? `level:${[...levels][0]}` : null;
    }
    case "levelJump":
      return "keep";
    case "yearKind":
      return "fiscal";
    case "blankSameAsAbove":
      return "same";
    case "hiddenData":
      return "include";
    case "unknownSymbol":
    case "noLegend": {
      const u = t.star?.unknown_symbol;
      const cell = q.items[0]?.cells[0];
      if (u && cell === u.cell) return u.means === "PLANNED" ? "plan" : u.means === "ACTUAL" ? "actual" : null;
      const c = cell ? t.star?.cells?.[cell] : null;
      return c ? (c.kind === "planned" ? "plan" : "actual") : "exclude";
    }
    case "commonMeaning": {
      // 正解の世界は「共通」を号炉に属さない機器（furnace が null）として持つ。系統の部品・合流の機器の区別は無い
      const allNull = q.items.every((it) =>
        it.cells.every((c) => {
          const e = eqOfEntity(ents.of(it.file, `${t.star?.columns?.equipment}${rowOf(c)}`));
          return e ? ents.eq.get(e)?.furnace === null : false;
        }),
      );
      return allNull ? "facility" : null;
    }
    case "unitSpelling": {
      // 同じ数の書き方の行が、同じ号炉の機器を指しているか
      const ok = q.items.every((it) =>
        it.cells.every((c) => {
          const line = dailyLine(c);
          const n = Number(/\d+/.exec((it.note ?? "").replace("{n}", "1"))?.[0] ?? NaN);
          void n;
          return !!line && line.equipment_ids.every((id: string) => ents.eq.get(id)?.furnace !== undefined);
        }),
      );
      return ok ? "yes" : "no";
    }
    case "hoursPerManDay":
      // 1 人・日の時間は世界の決まり（日報も報告書も同じ）
      return t.world?.man_day_hours ? String(t.world.man_day_hours) : t.daily ? String(t.daily.hours_per_man_day) : null;
    case "assetLink": {
      const ok = q.items.every((it) => {
        const a = ents.of(it.file, it.cells[0] ?? "");
        const b = targetEntity(it);
        return a !== null && a === b;
      });
      return ok ? "yes" : "split";
    }
    case "assetLinkOne": {
      const it = q.items[0];
      if (!it) return null;
      const a = ents.of(it.file, it.cells[0] ?? "");
      if (a === null) return null;
      // 候補がいくつか：items の i 番目が選択肢 c{i} の候補（この行と、候補の出どころのセル）
      if (q.options.some((o) => o.id === "c1")) {
        const i = q.items.findIndex((x) => targetEntity(x) === a);
        return i >= 0 && q.options.some((o) => o.id === `c${i}`) ? `c${i}` : "none";
      }
      if (it.target?.length) return a === targetEntity(it) ? "c0" : "none";
      return null;
    }
    case "assetUnmatched": {
      // 先の資料に同じものが正解でも無いなら、この資料だけの機器
      return "yes";
    }
    case "eventAsset": {
      const ok = q.items.every((it) => {
        const line = ev(it.file, it.cells[0] ?? "");
        const e = eqOfEntity(targetEntity(it));
        return !!line && !!e && line.equipment_ids.includes(e);
      });
      return ok ? "yes" : "split";
    }
    case "eventAssetOne": {
      const it = q.items[0];
      if (!it) return null;
      if (q.options.some((o) => o.id === "c0") && q.options.length === 2) {
        const line = ev(it.file, it.cells[0] ?? "");
        // 正解の行が分からない資料の行には答えない（外すと決めつけない。開いたままにする）
        if (!line) return null;
        const e = eqOfEntity(targetEntity(it));
        return e && line.equipment_ids.includes(e) ? "c0" : "exclude";
      }
      return null;
    }
    case "workJoin": {
      // まとめた問い（はい／1 件ずつ／いいえ）・1 件の問い（はい／いいえ）・相手を選ぶ問い（c0…／どれとも別）
      if (q.options.some((o) => o.id === "c0")) {
        const i = q.items.findIndex((it) => it.target?.[0] && sameWork(it, it.target[0]));
        return i >= 0 ? `c${i}` : "none";
      }
      const ok = q.items.every((it) => (it.target ?? []).length > 0 && (it.target ?? []).every((tg) => sameWork(it, tg)));
      if (q.options.some((o) => o.id === "split")) return ok ? "yes" : "split";
      return ok ? "yes" : "no";
    }
    case "workLink": {
      const isNoMark = q.options.some((o) => o.id === "exclude");
      const ok = q.items.every((it) => {
        const lines = it.cells.map((c) => ev(it.file, c)).filter(Boolean) as J[];
        if (isNoMark) return lines.every((l) => (l.work_ids as string[]).every((w) => !starRefOf(t, w)));
        const mk = it.target?.[0]?.cells[0];
        const cellWorks: string[] = mk ? (t.star?.cells?.[mk]?.work_ids ?? []) : [];
        return lines.length > 0 && lines.every((l) => (l.work_ids as string[]).some((w) => cellWorks.includes(w)));
      });
      return ok ? (isNoMark ? "yes" : "yes") : isNoMark ? null : "split";
    }
    case "workLinkOne": {
      const it = q.items[0];
      if (!it) return null;
      const lines = it.cells.map((c) => ev(it.file, c)).filter(Boolean) as J[];
      const marks = it.target ?? [];
      for (let i = 0; i < marks.length; i++) {
        const mk = marks[i]?.cells[0];
        const cellWorks: string[] = mk ? (t.star?.cells?.[mk]?.work_ids ?? []) : [];
        if (lines.length && lines.every((l) => (l.work_ids as string[]).some((w) => cellWorks.includes(w)))) {
          return q.options.some((o) => o.id === `m${i}`) ? `m${i}` : "m0";
        }
      }
      return "eventOnly";
    }
    default:
      // stray（行き先の決まらないセル）・subtotalMismatch・formulaNoCache などは、正解から答えられない。開いたままにする
      return null;
  }
}

function starRefOf(t: Truth, workId: string): string | null {
  for (const [ref, c] of Object.entries((t.star?.cells ?? {}) as Record<string, J>)) if ((c.work_ids as string[]).includes(workId)) return ref;
  return null;
}

export interface Script {
  rounds: number;
  answered: Decision[];
  asked: number;
  openAtEnd: QuestionState[];
}

/** 質問がなくなるまで、台本で答える（答えられない質問は開いたまま） */
export function runScript(session: { analyze(): Analysis; settle(ds: Decision[]): unknown }, t: Truth): Script {
  const ents = new Entities(t);
  const answered = new Map<string, Decision>();
  let rounds = 0;
  let an = session.analyze();
  const reps = t.reports ? new ReportRows(t, an.sources) : null;
  for (; rounds < 30; rounds++) {
    const ds: Decision[] = [];
    for (const q of an.open) {
      if (answered.has(q.questionId)) continue;
      const a = answer(q, t, ents, reps);
      if (a !== null) ds.push({ questionId: q.questionId, answer: a, author: "human", reason: AUTHOR_REASON });
    }
    if (!ds.length) break;
    for (const d of ds) answered.set(d.questionId, d);
    session.settle(ds);
    an = session.analyze();
  }
  const asked = new Set([...answered.keys(), ...an.open.map((q) => q.questionId)]).size;
  return { rounds, answered: [...answered.values()], asked, openAtEnd: an.open };
}

// ─── 物差し ① 原本の漏れ ─────────────────────────────────────────

export function measureFacts(src: SourceFile, facts: J): { diffs: number; detail: string[] } {
  if (facts.schema === "moyai.factory.facts.csv/0") return measureCsvFacts(src, facts);
  const detail: string[] = [];
  for (const fs of facts.sheets as J[]) {
    const g = src.sheets.find((s) => s.name === fs.title);
    if (!g) {
      detail.push(`シート「${fs.title}」が無い`);
      continue;
    }
    const mine = new Map(g.cells.map((c) => [c.ref, c]));
    const seen = new Set<string>();
    for (const fc of fs.cells as J[]) {
      seen.add(fc.coord);
      const c = mine.get(fc.coord);
      if (!c) {
        detail.push(`${fc.coord} が無い`);
        continue;
      }
      const v = fc.value;
      const same = typeof v === "number" ? typeof c.value === "number" && Math.abs(c.value - v) < 1e-9 : typeof v === "boolean" ? c.value === v : c.value === v;
      if (!same) detail.push(`${fc.coord} の値が違う`);
      if ((fc.number_format ?? "General") !== c.numFmt) detail.push(`${fc.coord} の表示形式が違う（${fc.number_format} / ${c.numFmt}）`);
    }
    for (const c of g.cells) if (!seen.has(c.ref) && c.value !== null) detail.push(`${c.ref} が余分`);
    const fm = new Set(fs.merged as string[]);
    const mm = new Set(g.merges.map((m) => m.ref));
    for (const m of fm) if (!mm.has(m)) detail.push(`結合 ${m} が無い`);
    for (const m of mm) if (!fm.has(m)) detail.push(`結合 ${m} が余分`);
    const hr = new Set<number>(fs.hidden_rows);
    const hc = new Set<string>(fs.hidden_cols);
    for (const [r, p] of Object.entries(g.rows)) if (p.hidden && !hr.has(Number(r))) detail.push(`隠した行 ${r} が余分`);
    for (const r of hr) if (!g.rows[r]?.hidden) detail.push(`隠した行 ${r} が無い`);
    const hcMine = Object.entries(g.cols).filter(([, p]) => p.hidden).map(([c]) => Number(c));
    if (hcMine.length !== hc.size) detail.push(`隠した列の数が違う`);
    if ((fs.state ?? "visible") !== g.state) detail.push(`シートの表示の状態が違う`);
  }
  return { diffs: detail.length, detail };
}

/**
 * CSV の ①：別の読み手（Python の csv。書き手が宣言した文字コードで読む）が取った記録と、MOYAI の格子を比べる。
 * 記録の始まりの物理の行の番号と、欄の位置ごとの文字が同じか。空の欄はセルにしないので、空でない欄だけを比べる。
 * 同じと見なす書き方の違いは無い（文字コードと区切りを MOYAI が自分で決めた結果も、ここで比べることになる）。
 */
export function measureCsvFacts(src: SourceFile, facts: J): { diffs: number; detail: string[] } {
  const detail: string[] = [];
  const g = src.sheets[0];
  if (!g) return { diffs: 1, detail: ["格子が無い"] };
  const mine = new Map(g.cells.map((c) => [`${c.r}:${c.c}`, c]));
  const seen = new Set<string>();
  for (const rec of facts.records as { line: number; fields: string[] }[]) {
    rec.fields.forEach((f, i) => {
      if (f === "") return;
      const k = `${rec.line}:${i + 1}`;
      seen.add(k);
      const c = mine.get(k);
      if (!c) detail.push(`${rec.line} 行 ${i + 1} 欄が無い`);
      else if (c.text !== f) detail.push(`${rec.line} 行 ${i + 1} 欄の文字が違う`);
    });
  }
  for (const k of mine.keys()) if (!seen.has(k)) detail.push(`${k.replace(":", " 行 ")} 欄が余分`);
  return { diffs: detail.length, detail };
}

// ─── 物差し ③ 読み取りの正しさ ────────────────────────────────────

export interface Accuracy {
  total: number;
  correct: number;
  extra: number;
  misses: string[];
}

function nodesBySource(plan: Plan) {
  const m = new Map<string, Plan["assets"][number]>();
  for (const a of plan.assets) for (const s of a.sources) m.set(`${s.file}|${s.cell}`, a);
  return m;
}

export function measureLedger(plan: Plan, t: Truth, ents: Entities): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const L = t.ledger;
  if (!L) return acc;
  const by = nodesBySource(plan);
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const rows: J[] = L.rows;
  for (const r of rows) {
    acc.total++;
    const a = by.get(`${L.file}|A${r.row}`);
    const why: string[] = [];
    if (!a) why.push("節が無い");
    else {
      if (a.level !== r.level) why.push(`段 ${a.level}≠${r.level}`);
      const parentRow = [...rows].reverse().find((x) => x.row < r.row && x.level === r.level - 1);
      const p = a.parentKey ? byKey.get(a.parentKey) : null;
      if (parentRow) {
        if (!p || !p.sources.some((s) => s.file === L.file && s.cell === `A${parentRow.row}`)) why.push("親が違う");
      } else if (p) why.push("親が余分");
      const text = nf(r.name_text);
      if (a.tag) {
        // 番号は名前のあとの括弧の中にある。名前にも同じ字が入ること（「ITV 設備（ITV）」）があるので、最後に出てくるものを外す
        const at = text.lastIndexOf(nf(a.tag));
        const rest = at < 0 ? text : text.slice(0, at) + text.slice(at + nf(a.tag).length);
        if (at < 0 || nf(rest.replace(/[()（）]/g, "")) !== nf(a.name)) why.push("名前と番号の分け方");
      } else if (nf(a.name) !== text) why.push("名前が違う");
      if (r.kind === "equipment") {
        const w = ents.eq.get(r.equipment_id);
        if (a.installedOn !== String(w?.install_year)) why.push(`設置年 ${a.installedOn}`);
      }
      if (r.spec_text && !a.specs.some((s) => s.value === r.spec_text)) why.push("仕様が無い");
      if (r.remark_text && !a.specs.some((s) => s.value === r.remark_text)) why.push("備考が無い");
    }
    if (why.length) acc.misses.push(`台帳 ${r.row}：${why.join("・")}`);
    else acc.correct++;
  }
  return acc;
}

export function measureStar(plan: Plan, t: Truth): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const S = t.star;
  if (!S) return acc;
  const by = nodesBySource(plan);
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const ledgerRowOf = new Map<string, number>(Object.entries((t.ledger?.equipment_rows ?? {}) as Record<string, number>));
  const yearOf = new Map<string, { fy: number; kind: "actual" | "planned" }>();
  for (const y of S.year_columns as J[]) {
    yearOf.set(y.actual_col, { fy: y.fiscal_year, kind: "actual" });
    yearOf.set(y.planned_col, { fy: y.fiscal_year, kind: "planned" });
  }
  const precision = new Set<string>(t.crossdoc?.precision_work_ids ?? []);
  const precisionLabel = (t.world.works as J[]).find((w) => precision.has(w.id))?.label ?? null;
  // 行 → 機器の節（台帳の行と同じ節になっているか）
  for (const r of S.rows as J[]) {
    acc.total++;
    const a = by.get(`${S.file}|${S.columns.equipment}${r.row}`);
    const why: string[] = [];
    if (!a) why.push("節が無い");
    else {
      if (nf(a.name) !== nf(S.equipment_names[r.equipment_id])) why.push("名前が違う");
      const lr = ledgerRowOf.get(r.equipment_id);
      if (t.ledger && lr && !a.sources.some((s) => s.file === t.ledger?.file && s.cell === `A${lr}`)) why.push("台帳の機器と結んでいない");
      const p = a.parentKey ? byKey.get(a.parentKey) : null;
      if (!p) why.push("親が無い");
    }
    if (why.length) acc.misses.push(`星取表の行 ${r.row}：${why.join("・")}`);
    else acc.correct++;
  }
  // 印のセル → 明細
  const detailsByCell = new Map<string, Plan["details"]>();
  for (const d of plan.details) for (const s of d.sources) if (s.file === S.file && s.cell) detailsByCell.set(s.cell, [...(detailsByCell.get(s.cell) ?? []), d]);
  for (const [ref, c] of Object.entries(S.cells as Record<string, J>)) {
    acc.total++;
    const ds = detailsByCell.get(ref) ?? [];
    const y = yearOf.get(colOf(ref));
    const why: string[] = [];
    if (!ds.length) why.push("明細が無い");
    else {
      const want = c.kind === "planned" ? "plan" : "actual";
      if (ds.some((d) => d.planOrActual !== want)) why.push("予定と実績");
      if (ds.some((d) => d.fiscalYear !== y?.fy)) why.push("年度");
      const leaf = by.get(`${S.file}|${S.columns.equipment}${rowOf(ref)}`);
      if (ds.some((d) => !workOf.get(d.workKey)?.targets.includes(leaf?.nodeKey ?? "?"))) why.push("対象の機器");
      const wantPrecision = (c.work_ids as string[]).some((w) => precision.has(w));
      const hasPrecision = ds.some((d) => nf(workOf.get(d.workKey)?.kind ?? "") === nf(precisionLabel ?? "\u0000"));
      if (wantPrecision !== hasPrecision) why.push("精密機能検査の印");
    }
    if (why.length) acc.misses.push(`星取表 ${ref}：${why.join("・")}`);
    else acc.correct++;
  }
  for (const ref of detailsByCell.keys()) if (!(ref in S.cells)) acc.extra++;
  return acc;
}

/** 印 1 つが指す作業の数まで合うか（◎ が精密機能検査と定期整備の両方を指すなど。星取表だけでは決まらないものも数える） */
export function measureStarWorkCount(plan: Plan, t: Truth): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const S = t.star;
  if (!S) return acc;
  const n = new Map<string, number>();
  for (const d of plan.details) for (const s of d.sources) if (s.file === S.file && s.cell) n.set(s.cell, (n.get(s.cell) ?? 0) + 1);
  for (const [ref, c] of Object.entries(S.cells as Record<string, J>)) {
    acc.total++;
    const want = (c.work_ids as string[]).length;
    const got = n.get(ref) ?? 0;
    if (want === got) acc.correct++;
    else acc.misses.push(`星取表 ${ref}：作業 ${got}≠${want}`);
  }
  return acc;
}

export function measureDaily(plan: Plan, t: Truth, ents: Entities): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const D = t.daily;
  if (!D) return acc;
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const ledgerRowOf = new Map<string, number>(Object.entries((t.ledger?.equipment_rows ?? {}) as Record<string, number>));
  const detailsByLine = new Map<number, Plan["details"]>();
  for (const d of plan.details) for (const s of d.sources) if (s.file === D.file && s.cell?.startsWith("A")) detailsByLine.set(rowOf(s.cell), [...(detailsByLine.get(rowOf(s.cell)) ?? []), d]);
  const eqOfNode = (k: string) => {
    const a = byKey.get(k);
    for (const [eq, row] of ledgerRowOf) if (a?.sources.some((s) => s.file === t.ledger?.file && s.cell === `A${row}`)) return eq;
    return null;
  };
  // 明細ごとの工数：正解の行の工数の和と比べる（まとめ工事は親の明細）
  const sumTruth = new Map<string, number>();
  for (const r of D.rows as J[]) for (const d of detailsByLine.get(r.line) ?? []) sumTruth.set(d.detailKey, (sumTruth.get(d.detailKey) ?? 0) + r.man_days);
  for (const r of D.rows as J[]) {
    acc.total++;
    const ds = detailsByLine.get(r.line) ?? [];
    const why: string[] = [];
    if (!ds.length) why.push("明細が無い");
    else {
      const targets = new Set<string>();
      for (const d of ds) {
        const w = workOf.get(d.workKey);
        if (!w || w.parentWorkKey === null && w.targets.length > 1) continue;
        for (const k of w.targets) {
          const eq = eqOfNode(k);
          if (eq) targets.add(eq);
        }
      }
      const want = new Set<string>(r.equipment_ids);
      if (targets.size !== want.size || [...want].some((x) => !targets.has(x))) why.push(`機器 ${[...targets].join(",")}≠${[...want].join(",")}`);
      if (ds.some((d) => !d.startDate || !d.endDate || d.startDate > r.date || d.endDate < r.date)) why.push("日付の範囲");
      // 日報の行の工数を持つ明細：一式の行はまとめ工事の明細、そうでない行は機器の明細。
      // 一式の行の機器ごとの明細は、ほかの資料（報告書）の工数を持ってよい（同じ工数を 2 度数えない）
      const isBundleDetail = (d: Plan["details"][number]) => (workOf.get(d.workKey)?.targets.length ?? 0) > 1;
      const withEffort = ds.filter((d) => d.manDays !== null && isBundleDetail(d) === !!r.bundle);
      if (withEffort.length !== 1) why.push(`工数の明細が ${withEffort.length}`);
      else if (Math.abs((withEffort[0]?.manDays ?? -1) - (sumTruth.get(withEffort[0]?.detailKey ?? "") ?? -2)) > 1e-6) why.push("工数の和");
    }
    if (why.length) acc.misses.push(`日報 ${r.line}：${why.join("・")}`);
    else acc.correct++;
  }
  void ents;
  return acc;
}

/** 資料をまたいで同じ作業：正解で 2 つ以上の資料（星取表・日報）に出る作業が、1 つの明細の出どころにそろっているか */
export function measureCrossdoc(plan: Plan, t: Truth): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const C = t.crossdoc;
  if (!C || !t.daily) return acc;
  for (const w of C.works as J[]) {
    const star = (w.refs as J[]).find((r) => r.doc === t.star?.file);
    const lines = (w.refs as J[]).filter((r) => r.doc === t.daily?.file).map((r) => r.line as number);
    if (!star || !lines.length) continue;
    acc.total++;
    const ok = plan.details.some(
      (d) => d.sources.some((s) => s.file === t.star?.file && s.cell === star.cell) && lines.every((l) => d.sources.some((s) => s.file === t.daily?.file && s.cell === `A${l}`)),
    );
    if (ok) acc.correct++;
    else acc.misses.push(`作業 ${w.work_id}（${star.cell}）`);
  }
  return acc;
}

export const pct = (a: Accuracy) => (a.total ? Math.round((a.correct / a.total) * 10000) / 100 : null);

// ─── 報告書の PDF：① 原本の漏れ（元の xlsx と比べる） ─────────────────────────
// 工場は報告書の PDF の事実（別の読み手が取ったもの）を持たない。PDF は工場が xlsx を LibreOffice で書き出したものなので、
// 元の xlsx を MOYAI の Excel の読み手で読んだ表示の文字と比べる。中身のある行を上から順に組にし、行ごとの文字の集まりが
// 同じかを見る（列の位置は数えない：結合して中央に寄せた文字は、PDF では別の列の罫線の間に描かれるため。参考に数だけ出す）。
// 同じと見なす書き方の違い：前後の空白と、空白の連なり（セルの中の文字の並びの間）だけ。

export function measurePdfAgainstXlsx(pdf: SourceFile, xlsx: SourceFile): { diffs: number; columnShifts: number; detail: string[] } {
  const detail: string[] = [];
  const sp = (s: string) => s.replace(/\s+/g, " ").trim();
  const rowsOf = (src: SourceFile) => {
    const g = src.sheets[0];
    const m = new Map<number, { c: number; t: string }[]>();
    for (const c of g?.cells ?? []) if (sp(c.text) !== "") m.set(c.r, [...(m.get(c.r) ?? []), { c: c.c, t: sp(c.text) }]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => ({ r, cs: cs.sort((a, b) => a.c - b.c) }));
  };
  const a = rowsOf(xlsx);
  const b = rowsOf(pdf);
  if (a.length !== b.length) detail.push(`中身のある行の数が違う（xlsx ${a.length}・PDF ${b.length}）`);
  let shifts = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) {
      detail.push(`${x ? `xlsx の ${x.r} 行` : `PDF の ${y?.r} 行`}に組む相手が無い`);
      continue;
    }
    const left = [...y.cs.map((c) => c.t)];
    for (const c of x.cs) {
      const k = left.indexOf(c.t);
      if (k < 0) detail.push(`xlsx の ${x.r} 行の「${c.t}」が PDF の ${y.r} 行に無い`);
      else left.splice(k, 1);
    }
    for (const t of left) detail.push(`PDF の ${y.r} 行の「${t}」が xlsx の ${x.r} 行に無い`);
    for (const c of x.cs) {
      const d = y.cs.find((z) => z.t === c.t);
      if (d && d.c !== c.c) shifts++;
    }
  }
  return { diffs: detail.length, columnShifts: shifts, detail };
}

// ─── 報告書の PDF：③ 読み取りの正しさ ─────────────────────────────────────
// 正解の行ごとに：その行のセルを出どころに持つ実績の明細があり、機器・年度・工期・工数・日数が合うか。
// まとめ工事（一式）の行は、機器ごとの明細（年度・工期・日数）と、まとめ工事の明細（工数と機器の組）を見る。

function eqOfNodeFn(plan: Plan, t: Truth) {
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const ledgerRowOf = new Map<string, number>(Object.entries((t.ledger?.equipment_rows ?? {}) as Record<string, number>));
  return (k: string): string | null => {
    const a = byKey.get(k);
    for (const [eq, row] of ledgerRowOf) if (a?.sources.some((s) => s.file === t.ledger?.file && s.cell === `A${row}`)) return eq;
    return null;
  };
}

export function measureReport(plan: Plan, t: Truth, reps: ReportRows, file: string, sources: SourceFile[]): Accuracy {
  const acc: Accuracy = { total: 0, correct: 0, extra: 0, misses: [] };
  const rep = reps.report(file);
  if (!rep) return acc;
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const eqOf = eqOfNodeFn(plan, t);
  const grid = sources.find((s) => s.file === file)?.sheets[0];
  const refsOfRow = (r: number) => new Set((grid?.cells ?? []).filter((c) => c.r === r).map((c) => c.ref));
  const targetsOf = (d: Plan["details"][number]) => (workOf.get(d.workKey)?.targets ?? []).map(eqOf);
  const seen = new Set<string>();
  for (const x of rep.rows as J[]) {
    acc.total++;
    const why: string[] = [];
    const gr = reps.gridRow(file, x.no);
    if (gr === null) {
      acc.misses.push(`${file} No.${x.no}：格子に行が無い`);
      continue;
    }
    const refs = refsOfRow(gr);
    const ds = plan.details.filter((d) => d.sources.some((s) => s.file === file && s.cell !== null && refs.has(s.cell)));
    for (const d of ds) seen.add(d.detailKey);
    const eqs: string[] = x.equipment_ids;
    const perAsset = ds.filter((d) => targetsOf(d).length === 1);
    if (!ds.length) why.push("明細が無い");
    else {
      for (const eq of eqs) {
        const d = perAsset.find((z) => targetsOf(z)[0] === eq);
        if (!d) {
          why.push(`機器 ${eq} の明細が無い`);
          continue;
        }
        if (d.planOrActual !== "actual") why.push("実績でない");
        if (d.fiscalYear !== rep.fiscal_year) why.push(`年度 ${d.fiscalYear}`);
        if (!d.startDate || !d.endDate || d.startDate > x.start || d.endDate < x.end) why.push(`工期 ${d.startDate}〜${d.endDate}`);
        if (d.days !== x.duration_days) why.push(`日数 ${d.days}≠${x.duration_days}`);
        if (!x.bundle && d.manDays !== x.man_days) why.push(`工数 ${d.manDays}≠${x.man_days}`);
      }
      if (x.bundle) {
        const b = ds.find((d) => (workOf.get(d.workKey)?.targets.length ?? 0) > 1);
        if (!b) why.push("まとめ工事の明細が無い");
        else {
          const tg = new Set(targetsOf(b));
          if (eqs.some((e) => !tg.has(e)) || tg.size !== eqs.length) why.push(`まとめ工事の機器 ${[...tg].join(",")}≠${eqs.join(",")}`);
          if (b.manDays !== x.man_days) why.push(`まとめ工事の工数 ${b.manDays}≠${x.man_days}`);
          if (b.days !== x.duration_days) why.push(`まとめ工事の日数 ${b.days}≠${x.duration_days}`);
        }
      }
    }
    if (why.length) acc.misses.push(`${file} No.${x.no}：${why.join("・")}`);
    else acc.correct++;
  }
  // 正解の行のどれでもないセルを出どころに持つ明細（頭書き・合計の行などを記録にしていないか）
  const rowCells = new Set<string>();
  for (const x of rep.rows as J[]) {
    const gr = reps.gridRow(file, x.no);
    if (gr !== null) for (const r of refsOfRow(gr)) rowCells.add(r);
  }
  for (const d of plan.details) if (!seen.has(d.detailKey) && d.sources.some((s) => s.file === file && s.cell !== null && !rowCells.has(s.cell))) acc.extra++;
  return acc;
}

// ─── ⑥ 取り戻せた割合 ─────────────────────────────────────────────────
// 分母：正解の世界の実績の作業のうち、この回に読んだ資料のどれかに書いてあるもの。読んでいない資料（写真）だけに書いてあるもの・
// どの資料にも書いていないものは分母に入れず、理由ごとに数える。
// 戻せた：その作業の、読んだ資料の出どころ（星取表の印・日報の行・報告書の行）を 1 つの実績の明細がすべて持つ。
// 工数：作業ごとの工数が書いてある（報告書の一式でない行・日報の一式でない行）作業のうち、その明細の工数が正解と同じ。
// 日数：報告書の行に日数がある作業のうち、その明細の日数が正解と同じ。参考：星取表だけで戻せる割合（実績の印がある作業）。

export interface Recovery {
  denominator: number;
  together: number;
  inPlan: number;
  manDays: { correct: number; total: number };
  days: { correct: number; total: number };
  starOnly: number;
  notCounted: Record<string, number>;
  misses: string[];
}

export function measureRecovery(plan: Plan, t: Truth, read: Set<string>, reps: ReportRows | null, sources: SourceFile[]): Recovery {
  const out: Recovery = { denominator: 0, together: 0, inPlan: 0, manDays: { correct: 0, total: 0 }, days: { correct: 0, total: 0 }, starOnly: 0, notCounted: {}, misses: [] };
  const C = t.crossdoc;
  if (!C) return out;
  const status = new Map<string, string>(((t.world.works ?? []) as J[]).map((w) => [w.id, w.status]));
  const refsByWork = new Map<string, J[]>(((C.works ?? []) as J[]).map((w) => [w.work_id, w.refs]));
  const gridRefs = (file: string, r: number) => new Set((sources.find((s) => s.file === file)?.sheets[0]?.cells ?? []).filter((c) => c.r === r).map((c) => c.ref));
  const daily = new Map<number, J>(((t.daily?.rows ?? []) as J[]).map((x) => [x.line, x]));
  const actualDetails = plan.details.filter((d) => d.planOrActual === "actual");
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  for (const w of (t.world.works ?? []) as J[]) {
    if (status.get(w.id) !== "actual") continue;
    const refs = refsByWork.get(w.id) ?? [];
    const readRefs = refs.filter((r) => read.has(r.doc));
    if (!refs.length) {
      out.notCounted["どの資料にも書いていない"] = (out.notCounted["どの資料にも書いていない"] ?? 0) + 1;
      continue;
    }
    if (!readRefs.length) {
      const why = `読んでいない資料だけに書いてある（${[...new Set(refs.map((r) => r.doc))].join("・")}）`;
      out.notCounted[why] = (out.notCounted[why] ?? 0) + 1;
      continue;
    }
    out.denominator++;
    // 出どころごとに「明細がそれを持つか」の判定
    const hits: ((d: Plan["details"][number]) => boolean)[] = readRefs.map((r) => {
      if (r.doc === t.star?.file) return (d) => d.sources.some((s) => s.file === r.doc && s.cell === r.cell);
      if (r.doc === t.daily?.file) return (d) => d.sources.some((s) => s.file === r.doc && s.cell === `A${r.line}`);
      const gr = reps?.gridRow(r.doc, r.table_row_no) ?? null;
      const cells = gr === null ? new Set<string>() : gridRefs(r.doc, gr);
      return (d) => d.sources.some((s) => s.file === r.doc && s.cell !== null && cells.has(s.cell));
    });
    const anyHit = actualDetails.filter((d) => hits.some((h) => h(d)));
    const all = actualDetails.filter((d) => hits.every((h) => h(d)));
    if (anyHit.length) out.inPlan++;
    // 1 つの機器の明細（まとめ工事の親の明細でない）を先に選ぶ
    const single = (d: Plan["details"][number]) => (workOf.get(d.workKey)?.targets.length ?? 0) === 1;
    const one = all.find((d) => single(d) && d.fiscalYear === w.fiscal_year) ?? all.find(single) ?? all[0];
    if (one) out.together++;
    else out.misses.push(`作業 ${w.id}（${[...new Set(readRefs.map((r) => r.doc))].join("・")}）：1 つの明細にそろっていない（出どころを持つ明細 ${anyHit.length}）`);
    if (readRefs.some((r) => r.doc === t.star?.file && t.star?.cells?.[r.cell]?.kind === "actual")) out.starOnly++;
    // 工数・日数が作業ごとに書いてあるか
    const repRef = readRefs.find((r) => r.doc !== t.star?.file && r.doc !== t.daily?.file);
    const repRow = repRef ? (((t.reports?.reports ?? []) as J[]).find((x) => x.file_pdf === repRef.doc)?.rows as J[] | undefined)?.find((x) => x.no === repRef.table_row_no) : null;
    const dLines = readRefs.filter((r) => r.doc === t.daily?.file).map((r) => daily.get(r.line)).filter(Boolean) as J[];
    const mdWritten = (repRow && !repRow.bundle) || (dLines.length > 0 && dLines.every((l) => (l.equipment_ids as string[]).length === 1));
    if (mdWritten) {
      out.manDays.total++;
      if (one && one.manDays === w.man_days) out.manDays.correct++;
      else out.misses.push(`作業 ${w.id}：工数 ${one?.manDays ?? "なし"}≠${w.man_days}`);
    }
    if (repRow) {
      out.days.total++;
      if (one && one.days === w.duration_days) out.days.correct++;
      else out.misses.push(`作業 ${w.id}：日数 ${one?.days ?? "なし"}≠${w.duration_days}`);
    }
  }
  return out;
}
