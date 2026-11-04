// 評価の問題の生成器（docs/plan.md §2.10）。工場の正解の世界を使い回し、規則 10 × 10 問を決まった種から作る。
// 学習用と試験用は期間（作業の年度）で分ける。年度を持たない問い（出典・凡例）は問いの番号で分ける。
// 業種の語はコードに置かない。機器・作業・印・出典は、世界とパックのデータから取る。
import { ANSWER_FORMAT, PREAMBLE, bodyHash, countEvalProperNouns, sha256, userText } from "./prompt";
import { CASE_SCHEMA, SUITE_SCHEMA, type Check, type EvalCase, type GraderId, type RuleInfo, type Split, type Suite } from "./types";
import { fiscalYearOf, properNounTerms, type PackCheck, type PackData, type WorldData, type WorldEquipment, type WorldWork } from "./world";

export const GENERATOR_VERSION = 1;
export const DEFAULT_SEED = 20261105;
export const CASES_PER_RULE = 10;

export const RULES: RuleInfo[] = [
  { id: "R01", name: "周期の欄が空なら推測しない", graders: ["json", "no_guess", "not_in_record"] },
  { id: "R02", name: "番号の違う機器を名前でまとめない", graders: ["json", "identity"] },
  { id: "R03", name: "出典はパックの一覧の中から", graders: ["json", "source", "not_in_record"] },
  { id: "R04", name: "年度の始まりはパックどおり", graders: ["json", "fiscal_year"] },
  { id: "R05", name: "記録に無いことは「記録に無い」と言う", graders: ["json", "no_guess", "not_in_record"] },
  { id: "R06", name: "和暦の年度", graders: ["json", "fiscal_year"] },
  { id: "R07", name: "範囲のタグ（系列の範囲）を機器ごとに分ける", graders: ["json", "identity"] },
  { id: "R08", name: "凡例に無い記号の意味を推測しない", graders: ["json", "no_guess", "not_in_record"] },
  { id: "R09", name: "合計の行を作業にしない", graders: ["json", "identity", "no_guess"] },
  { id: "R10", name: "単位の違う工数", graders: ["json", "no_guess", "not_in_record"] },
];

// ---- 決まった乱数（mulberry32） ----
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (...parts: (string | number)[]): number => parseInt(sha256(parts.join("|")).slice(0, 8), 16);
const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
function shuffle<T>(rng: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

interface Ctx {
  world: WorldData;
  pack: PackData;
  /** すべてのパックの検査（名前で 1 つに）。このパックに無い検査は「パックに無い」が正解になる。 */
  allChecks: PackCheck[];
  splitFy: number;
  eq: Map<string, WorldEquipment>;
}

interface Draft {
  record: string;
  question: string;
  keys: string[];
  checks: Check[];
  anchorFy: number | null;
}

type Gen = (ctx: Ctx, split: Split, rng: () => number, i: number) => Draft | null;

const inSplit = (ctx: Ctx, split: Split, fy: number): boolean => (split === "train" ? fy < ctx.splitFy : fy >= ctx.splitFy);
const actualIn = (ctx: Ctx, split: Split): WorldWork[] => ctx.world.works.filter((w) => w.status === "actual" && inSplit(ctx, split, w.fiscal_year));
const num = (ctx: Ctx, id: string): string => ctx.world.numbers.get(id) ?? id;
const eqName = (ctx: Ctx, id: string): string => ctx.eq.get(id)?.base_name ?? id;
const table = (head: string[], rows: (string | number)[][]): string =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const ck = (grader: GraderId, key?: string, expect?: unknown): Check => (key === undefined ? { grader } : { grader, key, expect });

// R01 周期の欄が空なら推測しない
const genCycle: Gen = (ctx, split, rng) => {
  const by = new Map<string, number[]>();
  for (const w of actualIn(ctx, split)) {
    const k = `${w.equipment_id}|${w.label}`;
    by.set(k, uniq([...(by.get(k) ?? []), w.fiscal_year]).sort((a, b) => a - b));
  }
  const cands = [...by.entries()].filter(([, ys]) => {
    if (ys.length < 2) return false;
    const d = (ys[1] as number) - (ys[0] as number);
    return ys.every((y, j) => j === 0 || y - (ys[j - 1] as number) === d);
  });
  if (cands.length < 4) return null;
  const chosen = shuffle(rng, cands).slice(0, 4);
  const blanks = new Set(shuffle(rng, [0, 1, 2, 3]).slice(0, rng() < 0.5 ? 1 : 2));
  const keys = chosen.map((_, j) => `k${j + 1}`);
  const rows: (string | number)[][] = [];
  const checks: Check[] = [ck("json")];
  chosen.forEach(([k, ys], j) => {
    const [id, label] = k.split("|") as [string, string];
    const d = (ys[1] as number) - (ys[0] as number);
    const blank = blanks.has(j);
    rows.push([keys[j] as string, num(ctx, id), eqName(ctx, id), label, blank ? "" : d, ys.join(", ")]);
    checks.push(ck("no_guess", keys[j], blank ? null : d), ck("not_in_record", keys[j], blank));
  });
  return {
    record: table(["キー", "台帳の番号", "機器", "作業", "周期（年）", "実績の年度"], rows),
    question: "各キーの作業の周期（年）を、数（整数）で答えてください。",
    keys,
    checks,
    anchorFy: Math.max(...chosen.flatMap(([, ys]) => ys)),
  };
};

/** 同じ名前で系列の違う機器の組（それぞれ作業の実績がある）。 */
function sameNameGroups(ctx: Ctx, works: WorldWork[]): WorldEquipment[][] {
  const withWork = new Set(works.map((w) => w.equipment_id));
  const by = new Map<string, WorldEquipment[]>();
  for (const e of ctx.world.equipment) if (withWork.has(e.id)) by.set(e.base_name, [...(by.get(e.base_name) ?? []), e]);
  return [...by.values()].filter((g) => new Set(g.map((e) => e.furnace_label)).size === g.length && g.length >= 2);
}

// R02 番号の違う機器を名前でまとめない
const genSameName: Gen = (ctx, split, rng) => {
  const works = actualIn(ctx, split);
  const groups = sameNameGroups(ctx, works);
  if (groups.length < 2) return null;
  const g = pick(rng, groups);
  const members = shuffle(rng, g).slice(0, Math.min(g.length, rng() < 0.5 ? 2 : 3));
  const other = pick(rng, groups.filter((x) => x[0]?.base_name !== g[0]?.base_name));
  const eqs = [...members, pick(rng, other)];
  const rows: { fy: number; e: WorldEquipment; label: string }[] = [];
  const counts: Record<string, number> = {};
  for (const e of eqs) {
    const ws = shuffle(rng, works.filter((w) => w.equipment_id === e.id)).slice(0, 1 + Math.floor(rng() * 3));
    for (const w of ws) rows.push({ fy: w.fiscal_year, e, label: w.label });
    counts[num(ctx, e.id)] = ws.length;
  }
  const ledger = table(
    ["台帳の番号", "名称", "系列"],
    shuffle(rng, eqs).map((e) => [num(ctx, e.id), e.base_name, e.furnace_label]),
  );
  const recs = table(
    ["行", "年度", "機器", "系列", "作業"],
    shuffle(rng, rows).map((r, j) => [j + 1, r.fy, r.e.base_name, r.e.furnace_label, r.label]),
  );
  return {
    record: `### 台帳（抜き書き）\n${ledger}\n\n### 作業の記録\n${recs}`,
    question: "台帳の機器ごとに、作業の記録の行数を答えてください。キー counts の値は、台帳の番号をキー、行数（整数）を値にしたオブジェクトです。",
    keys: ["counts"],
    checks: [ck("json"), ck("identity", "counts", counts)],
    anchorFy: Math.max(...rows.map((r) => r.fy)),
  };
};

// R03 出典はパックの一覧の中から（年度を持たないので問いの番号で分ける）
function sourceItems(ctx: Ctx): { label: string; url: string | null }[] {
  const urlOf = (id: string | null): string | null => (id ? (ctx.pack.sources.find((s) => s.id === id)?.url ?? null) : null);
  const items = [{ label: "共通の設備項目（1 段目の設備と、その下の機器）の表", url: urlOf(ctx.pack.commonSourceId) }];
  for (const c of ctx.allChecks) {
    const own = ctx.pack.checks.find((x) => x.name === c.name);
    items.push({ label: `検査「${c.name}」の基準`, url: own ? urlOf(own.sourceId) : null });
  }
  return items;
}
function sourcePairs(ctx: Ctx): [number, number][] {
  const n = sourceItems(ctx).length;
  const pairs: [number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push([a, b]);
  return shuffle(rngOf(seedOf("R03-pairs", ctx.pack.id)), pairs);
}
const genSource: Gen = (ctx, _split, _rng, i) => {
  const items = sourceItems(ctx);
  const pair = sourcePairs(ctx)[i];
  if (!pair) return null;
  const keys = ["s1", "s2"];
  const checks: Check[] = [ck("json"), ck("source")];
  const lines: string[] = [];
  pair.forEach((ix, j) => {
    const it = items[ix] as { label: string; url: string | null };
    lines.push(`- ${keys[j]}：${it.label}`);
    checks.push(ck("source", keys[j], it.url), ck("not_in_record", keys[j], it.url === null));
  });
  return {
    record: "施設A の計画を、パックの基準で確かめています（この問いは、施設の記録の行を使いません）。",
    question: `次のキーごとに、その根拠の出典の URL を 1 つ、文字で答えてください。\n${lines.join("\n")}`,
    keys,
    checks,
    anchorFy: null,
  };
};

// R04 年度の始まりはパックどおり（年度の始まりより前の月の日付を、少なくとも 1 つ入れる）
const genFyStart: Gen = (ctx, split, rng) => {
  const start = ctx.pack.fiscalYearStartMonth;
  const pool = ctx.world.works
    .filter((w) => inSplit(ctx, split, w.fiscal_year))
    .flatMap((w) => [
      { w, date: w.start, kind: "着手日" },
      ...(w.end ? [{ w, date: w.end, kind: "完了日" }] : []),
    ]);
  const isEarly = (d: string): boolean => Number(d.slice(5, 7)) < start;
  const early = pool.filter((x) => isEarly(x.date));
  const late = pool.filter((x) => !isEarly(x.date));
  if (early.length < 1 || late.length < 3) return null;
  const nEarly = Math.min(3, early.length);
  const chosen = shuffle(rng, [...shuffle(rng, early).slice(0, nEarly), ...shuffle(rng, late).slice(0, 6 - nEarly)]);
  const keys = chosen.map((_, j) => `k${j + 1}`);
  return {
    record: table(
      ["キー", "台帳の番号", "機器", "作業", "日付の種類", "日付"],
      chosen.map((x, j) => [keys[j] as string, num(ctx, x.w.equipment_id), eqName(ctx, x.w.equipment_id), x.w.label, x.kind, x.date]),
    ),
    question: "各キーの日付が属する年度を、西暦の年度（整数）で答えてください。",
    keys,
    checks: [ck("json"), ...chosen.map((x, j) => ck("fiscal_year", keys[j], fiscalYearOf(x.date, start)))],
    anchorFy: Math.max(...chosen.map((x) => x.w.fiscal_year)),
  };
};

/** 年度を和暦などで書く。令和は 2019 年度から（2019 年度は「令和元年度」とも「平成31年度」とも書く）。 */
export function yearLabel(fy: number, style: "reiwa" | "r" | "heisei" | "seireki"): string {
  const r = fy - 2018;
  if (style === "reiwa") return `令和${r === 1 ? "元" : r}年度`;
  if (style === "r") return `R${r}`;
  if (style === "heisei") return `平成${fy - 1988}年度`;
  return `${fy}年度`;
}

// R06 和暦の年度
const genWareki: Gen = (ctx, split, rng) => {
  const works = actualIn(ctx, split);
  const years = uniq(works.map((w) => w.fiscal_year)).sort((a, b) => a - b);
  if (years.length < 2) return null;
  const chosen: WorldWork[] = [];
  for (let j = 0; j < 6; j++) {
    const y = years[j % years.length] as number;
    const c = works.filter((w) => w.fiscal_year === y && !chosen.includes(w));
    if (c.length) chosen.push(pick(rng, c));
  }
  const styles = ["reiwa", "r", "seireki", "reiwa", "r", "heisei"] as const;
  const rows = shuffle(rng, chosen).map((w, j) => {
    let s: (typeof styles)[number] = styles[j % styles.length] as (typeof styles)[number];
    if (s === "heisei" && w.fiscal_year > 2019) s = "reiwa";
    if (w.fiscal_year < 2019 && (s === "reiwa" || s === "r")) s = "heisei";
    return { w, label: yearLabel(w.fiscal_year, s) };
  });
  const keys = rows.map((_, j) => `k${j + 1}`);
  return {
    record: table(
      ["キー", "年度", "台帳の番号", "機器", "作業"],
      rows.map((r, j) => [keys[j] as string, r.label, num(ctx, r.w.equipment_id), eqName(ctx, r.w.equipment_id), r.w.label]),
    ),
    question: "各キーの作業の年度を、西暦の年度（整数）で答えてください。",
    keys,
    checks: [ck("json"), ...rows.map((r, j) => ck("fiscal_year", keys[j], r.w.fiscal_year))],
    anchorFy: Math.max(...rows.map((r) => r.w.fiscal_year)),
  };
};

// R05 記録に無いことは「記録に無い」と言う
const genNotInRecord: Gen = (ctx, split, rng) => {
  const works = actualIn(ctx, split);
  const years = uniq(works.map((w) => w.fiscal_year)).sort((a, b) => a - b);
  const byEq = new Map<string, WorldWork[]>();
  for (const w of works) byEq.set(w.equipment_id, [...(byEq.get(w.equipment_id) ?? []), w]);
  const small = [...byEq.entries()].filter(([, ws]) => ws.length >= 1 && ws.length <= 3 && uniq(ws.map((w) => w.fiscal_year)).length < years.length);
  if (small.length < 3) return null;
  const eqs = shuffle(rng, small).slice(0, 3);
  const shown = eqs.flatMap(([, ws]) => ws);
  const present = shuffle(rng, shown).slice(0, 2);
  const absent: { id: string; fy: number; label: string }[] = [];
  for (const [id, ws] of shuffle(rng, eqs)) {
    if (absent.length >= 2) break;
    const has = new Set(ws.map((w) => w.fiscal_year));
    const fy = pick(rng, years.filter((y) => !has.has(y)));
    absent.push({ id, fy, label: (ws[0] as WorldWork).label });
  }
  if (absent.length < 2) return null;
  const qs = shuffle(rng, [
    ...present.map((w) => ({ id: w.equipment_id, fy: w.fiscal_year, label: w.label, expect: w.man_days as number | null })),
    ...absent.map((a) => ({ ...a, expect: null as number | null })),
  ]);
  const keys = qs.map((_, j) => `q${j + 1}`);
  const rows = shuffle(rng, shown)
    .sort((a, b) => a.fiscal_year - b.fiscal_year)
    .map((w) => [w.fiscal_year, num(ctx, w.equipment_id), eqName(ctx, w.equipment_id), w.label, w.man_days]);
  return {
    record: `記録の期間：${years[0]} 年度から ${years[years.length - 1]} 年度（この期間の、次の機器の実績の全部）\n\n${table(["年度", "台帳の番号", "機器", "作業", "工数（人・日）"], rows)}`,
    question: `次のキーごとに、作業の工数（人・日、数）を答えてください。\n${qs.map((q, j) => `- ${keys[j]}：台帳の番号 ${num(ctx, q.id)} の ${q.fy} 年度の「${q.label}」の工数`).join("\n")}`,
    keys,
    checks: [ck("json"), ...qs.flatMap((q, j) => [ck("no_guess", keys[j], q.expect), ck("not_in_record", keys[j], q.expect === null)])],
    anchorFy: years[years.length - 1] ?? null,
  };
};

/** 系列の名前の範囲（「1号炉」と「2号炉」→「1～2号炉」）。形が合わなければ両方を「～」で結ぶ。 */
export function rangeLabel(a: string, b: string): string {
  const ma = /^(\D*)(\d+)(.*)$/.exec(a);
  const mb = /^(\D*)(\d+)(.*)$/.exec(b);
  if (ma && mb && ma[1] === mb[1] && ma[3] === mb[3]) return `${ma[1]}${ma[2]}～${mb[2]}${ma[3]}`;
  return `${a}～${b}`;
}

// R07 範囲のタグを機器ごとに分ける
const genRange: Gen = (ctx, split, rng) => {
  const works = actualIn(ctx, split);
  const groups = sameNameGroups(ctx, works).filter((g) => g.every((e) => e.furnace !== null));
  // 同じ年度・同じ作業が、組の 2 つの機器の両方にあるもの
  const pairs: { e1: WorldEquipment; e2: WorldEquipment; fy: number; label: string }[] = [];
  for (const g of groups) {
    const s = [...g].sort((x, y) => (x.furnace as number) - (y.furnace as number));
    for (let j = 0; j + 1 < s.length; j++) {
      const e1 = s[j] as WorldEquipment;
      const e2 = s[j + 1] as WorldEquipment;
      for (const w of works.filter((x) => x.equipment_id === e1.id)) {
        if (works.some((x) => x.equipment_id === e2.id && x.fiscal_year === w.fiscal_year && x.label === w.label)) pairs.push({ e1, e2, fy: w.fiscal_year, label: w.label });
      }
    }
  }
  if (pairs.length < 2) return null;
  const ranges = shuffle(rng, pairs).slice(0, 2);
  const singles = shuffle(rng, works.filter((w) => ctx.eq.get(w.equipment_id)?.furnace !== null)).slice(0, 2);
  const rows = shuffle(rng, [
    ...ranges.map((p) => ({ fy: p.fy, name: p.e1.base_name, series: rangeLabel(p.e1.furnace_label, p.e2.furnace_label), label: p.label, ids: [p.e1.id, p.e2.id] })),
    ...singles.map((w) => ({ fy: w.fiscal_year, name: eqName(ctx, w.equipment_id), series: ctx.eq.get(w.equipment_id)?.furnace_label ?? "", label: w.label, ids: [w.equipment_id] })),
  ]);
  const eqIds = uniq(rows.flatMap((r) => r.ids));
  // 台帳には、同じ名前の機器を全部出す（範囲が台帳の何を指すかを決められるように）
  const ledgerEq = uniq([...eqIds, ...ctx.world.equipment.filter((e) => rows.some((r) => r.name === e.base_name) && e.furnace !== null).map((e) => e.id)]);
  const keys = rows.map((_, j) => `r${j + 1}`);
  return {
    record: `### 台帳（抜き書き）\n${table(
      ["台帳の番号", "名称", "系列"],
      ledgerEq.map((id) => [num(ctx, id), eqName(ctx, id), ctx.eq.get(id)?.furnace_label ?? ""]),
    )}\n\n### 作業の記録\n${table(
      ["キー", "年度", "機器", "系列", "作業"],
      rows.map((r, j) => [keys[j] as string, r.fy, r.name, r.series, r.label]),
    )}`,
    question: "各キーの作業の対象の機器を、台帳の番号の配列で答えてください。",
    keys,
    checks: [ck("json"), ...rows.map((r, j) => ck("identity", keys[j], r.ids.map((id) => num(ctx, id))))],
    anchorFy: Math.max(...rows.map((r) => r.fy)),
  };
};

// R08 凡例に無い記号の意味を推測しない（予定は先の年度にしか無いので、問いの番号で分ける）
const genLegend: Gen = (ctx, _split, rng) => {
  const sym = ctx.world.unknownSymbol;
  if (!sym) return null;
  const actual = ctx.world.works.filter((w) => w.status === "actual");
  const planned = ctx.world.works.filter((w) => w.status === "planned");
  if (actual.length < 2 || planned.length < 3) return null;
  const cells = shuffle(rng, [
    ...shuffle(rng, actual).slice(0, 2).map((w) => ({ w, mark: "●", expect: "実績" as string | null })),
    ...shuffle(rng, planned).slice(0, 2).map((w) => ({ w, mark: "○", expect: "計画" as string | null })),
    ...shuffle(rng, planned).slice(2, 3).map((w) => ({ w, mark: sym, expect: null as string | null })),
  ]);
  const keys = cells.map((_, j) => `c${j + 1}`);
  return {
    record: `凡例：○ 計画　● 実績\n\n${table(
      ["キー", "台帳の番号", "機器", "年度", "印"],
      cells.map((c, j) => [keys[j] as string, num(ctx, c.w.equipment_id), eqName(ctx, c.w.equipment_id), c.w.fiscal_year, c.mark]),
    )}`,
    question: "各キーの印は、計画と実績のどちらですか。「計画」か「実績」の文字で答えてください。",
    keys,
    checks: [ck("json"), ...cells.flatMap((c, j) => [ck("no_guess", keys[j], c.expect), ck("not_in_record", keys[j], c.expect === null)])],
    anchorFy: null,
  };
};

// R09 合計の行を作業にしない
const genTotal: Gen = (ctx, split, rng) => {
  const works = actualIn(ctx, split);
  const years = uniq(works.map((w) => w.fiscal_year));
  const fy = pick(rng, years);
  const ws = shuffle(rng, works.filter((w) => w.fiscal_year === fy)).slice(0, 4 + Math.floor(rng() * 3));
  if (ws.length < 4) return null;
  const sub = rng() < 0.5 ? Math.floor(ws.length / 2) : 0;
  const rows: (string | number)[][] = [];
  const workRows: string[] = [];
  let line = 0;
  ws.forEach((w, j) => {
    line++;
    rows.push([line, j + 1, eqName(ctx, w.equipment_id), w.label, `${w.man_days}人・日`]);
    workRows.push(String(line));
    if (sub && j + 1 === sub) {
      line++;
      rows.push([line, "", "", "小計", `${ws.slice(0, sub).reduce((a, x) => a + x.man_days, 0)}人・日`]);
    }
  });
  line++;
  rows.push([line, "", "", "合計", `${ws.reduce((a, x) => a + x.man_days, 0)}人・日`]);
  return {
    record: `${fy} 年度の作業の報告書の表\n\n${table(["行", "No.", "機器", "作業", "工数"], rows)}`,
    question: "作業の行を、表の「行」の番号の配列で答えてください（キー rows）。作業の件数も数（整数）で答えてください（キー count）。",
    keys: ["rows", "count"],
    checks: [ck("json"), ck("identity", "rows", workRows), ck("no_guess", "count", ws.length)],
    anchorFy: fy,
  };
};

/** 工数の書き方。延べ人数と人工は人・日の数のまま、時間は施設の 1 人・日の時間で割る。 */
export function effortText(manDays: number, style: "ninku" | "ninnichi" | "nobe" | "hours", hoursPerDay: number): string {
  if (style === "ninku") return `${manDays}人工`;
  if (style === "ninnichi") return `${manDays}人・日`;
  if (style === "nobe") return `延べ${manDays}人`;
  return `${manDays * hoursPerDay}時間`;
}

// R10 単位の違う工数（時間の工数は、1 人・日の時間が記録にあるときだけ数にできる）
const genEffort: Gen = (ctx, split, rng, i) => {
  const ws = shuffle(rng, actualIn(ctx, split)).slice(0, 5);
  if (ws.length < 5) return null;
  const withRate = i % 2 === 0;
  const H = ctx.world.manDayHours;
  // 1 人・日の時間が世界に無ければ、時間の工数の文字を作れないので、この規則の問いを作らない（作れなかった問いに数える）
  if (H === null) return null;
  const styles = shuffle(rng, ["hours", "hours", "ninku", "ninnichi", "nobe"] as const);
  const keys = ws.map((_, j) => `k${j + 1}`);
  const checks: Check[] = [ck("json")];
  const rows = ws.map((w, j) => {
    const s = styles[j] as (typeof styles)[number];
    const known = s !== "hours" || withRate;
    checks.push(ck("no_guess", keys[j], known ? w.man_days : null), ck("not_in_record", keys[j], !known));
    return [keys[j] as string, num(ctx, w.equipment_id), eqName(ctx, w.equipment_id), w.label, effortText(w.man_days, s, H)];
  });
  const note = withRate ? `この施設の決まり：1 人・日は ${H} 時間として数える。\n\n` : "";
  return {
    record: `${note}${table(["キー", "台帳の番号", "機器", "作業", "工数"], rows)}`,
    question: "各キーの工数を、人・日の数で答えてください。",
    keys,
    checks,
    anchorFy: Math.max(...ws.map((w) => w.fiscal_year)),
  };
};

const GENS: Record<string, { gen: Gen; splitBy: "period" | "index" }> = {
  R01: { gen: genCycle, splitBy: "period" },
  R02: { gen: genSameName, splitBy: "period" },
  R03: { gen: genSource, splitBy: "index" },
  R04: { gen: genFyStart, splitBy: "period" },
  R05: { gen: genNotInRecord, splitBy: "period" },
  R06: { gen: genWareki, splitBy: "period" },
  R07: { gen: genRange, splitBy: "period" },
  R08: { gen: genLegend, splitBy: "index" },
  R09: { gen: genTotal, splitBy: "period" },
  R10: { gen: genEffort, splitBy: "period" },
};

/** 期間で分ける境の年度：実績のある年度の真ん中。これより前が学習用、これ以後が試験用。 */
export function splitFyOf(world: WorldData): number {
  const ys = uniq(world.works.filter((w) => w.status === "actual").map((w) => w.fiscal_year)).sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)] ?? 0;
}

export interface GenInput {
  name: string;
  worldDir: string;
  world: WorldData;
  pack: PackData;
  allPacks: PackData[];
  seed?: number;
}

export interface GenOutput {
  suite: Suite;
  train: EvalCase[];
  test: EvalCase[];
  /** 作れなかった問い（規則と番号と理由）。黙って捨てない。 */
  missing: { rule: string; index: number; reason: string }[];
}

export function generateSuite(input: GenInput): GenOutput {
  const seed = input.seed ?? DEFAULT_SEED;
  const allChecks: PackCheck[] = [];
  for (const p of input.allPacks) for (const c of p.checks) if (!allChecks.some((x) => x.name === c.name)) allChecks.push(c);
  const ctx: Ctx = {
    world: input.world,
    pack: input.pack,
    allChecks,
    splitFy: splitFyOf(input.world),
    eq: new Map(input.world.equipment.map((e) => [e.id, e])),
  };
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  const out: EvalCase[] = [];
  const missing: GenOutput["missing"] = [];
  for (const rule of RULES) {
    const { gen, splitBy } = GENS[rule.id] as (typeof GENS)[string];
    for (let i = 0; i < CASES_PER_RULE; i++) {
      const split: Split = i < CASES_PER_RULE / 2 ? "train" : "test";
      let made: EvalCase | null = null;
      for (let attempt = 0; attempt < 30 && !made; attempt++) {
        const d = gen(ctx, split, rngOf(seedOf(seed, input.pack.id, rule.id, i, attempt)), i);
        if (!d) continue;
        const hash = bodyHash(d);
        if (seen.has(hash)) {
          duplicatesRemoved++;
          continue;
        }
        seen.add(hash);
        made = { schema: CASE_SCHEMA, id: `${rule.id}-${String(i + 1).padStart(2, "0")}`, rule: rule.id, split, splitBy, ...d, hash };
      }
      if (made) out.push(made);
      else missing.push({ rule: rule.id, index: i + 1, reason: "正解の世界のデータに、この規則の問いを作る材料が足りない（30 回試した）" });
    }
  }
  const terms = properNounTerms(input.world);
  const hits = out.reduce((a, c) => a + countEvalProperNouns(userText(c), terms).hits, 0);
  const train = out.filter((c) => c.split === "train");
  const test = out.filter((c) => c.split === "test");
  const suite: Suite = {
    schema: SUITE_SCHEMA,
    name: input.name,
    pack: input.pack.id,
    world: input.worldDir.replace(/\\/g, "/"),
    fiscalYearStartMonth: input.pack.fiscalYearStartMonth,
    packSourceUrls: input.pack.sources.map((s) => s.url),
    rules: RULES,
    counts: { train: train.length, test: test.length, duplicatesRemoved },
    missing,
    splitNote: `期間で分ける規則は、作業の年度が ${ctx.splitFy} 年度より前を学習用、${ctx.splitFy} 年度以後を試験用にした。年度を持たない規則（R03・R08）は、問いの番号 1〜5 を学習用、6〜10 を試験用にした`,
    testHashes: test.map((c) => c.hash),
    preambleHash: sha256(PREAMBLE),
    answerFormatHash: sha256(ANSWER_FORMAT),
    properNounHits: hits,
    generator: { seed, version: GENERATOR_VERSION },
  };
  return { suite, train, test, missing };
}

