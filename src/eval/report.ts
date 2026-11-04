// 走らせた記録（results.jsonl）から表（report.json と、その静的な HTML）を作る。自動の見立てもここ（決めるのは人）。
import { GRADER_NAMES, GRADERS, REPORT_SCHEMA, type Excluded, type GraderId, type Manifest, type ResultRow, type RuleInfo } from "./types";

/**
 * 揺れの幅を測る回数。揺れの幅は、前の版をこの回数走らせたときの、回ごとの合格率の最大と最小の差（docs/plan.md §2.10）。
 * 見立ての定数はここだけに置く。
 */
export const BAND_RUNS = 3;

export type Verdict = "退行あり" | "差なし" | "承認待ち" | "比べる版が無い";

export interface CaseSummary {
  id: string;
  rule: string;
  split: string;
  /** 回ごとの合否（集計から外した回は null）。 */
  passes: (boolean | null)[];
  /** 数えた回の過半で落ちた。 */
  failing: boolean;
  failedGraders: GraderId[];
}

export interface Report {
  schema: typeof REPORT_SCHEMA;
  runId: string;
  suite: string;
  split: string;
  skill: Manifest["skill"];
  modelRole: string;
  modelRoleHash: string;
  effort: string;
  repeat: number;
  calls: number;
  counted: number;
  excluded: Record<Excluded, number>;
  perAttempt: { attempt: number; passRate: number | null; counted: number }[];
  passRate: number | null;
  /** 回ごとの合格率の最大と最小の差。 */
  band: number | null;
  byRule: { rule: string; name: string; passRate: number | null; counted: number; failingCases: number }[];
  byGrader: { grader: GraderId; name: string; passRate: number | null; counted: number }[];
  cases: CaseSummary[];
  failingCases: string[];
  cost: { usd: number; perCallUsd: number | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  outbound: Manifest["outbound"];
  comparison: null | {
    base: string;
    verdict: Verdict;
    basePassRate: number | null;
    baseBand: number | null;
    diff: number | null;
    baseFailing: number;
    failing: number;
    newlyFailing: string[];
    fixed: string[];
    reason: string;
  };
}

const rate = (pass: number, n: number): number | null => (n === 0 ? null : pass / n);

export function buildReport(manifest: Manifest, rows: ResultRow[], rules: RuleInfo[]): Omit<Report, "comparison"> {
  const excluded: Record<Excluded, number> = { switched: 0, refusal: 0, max_tokens: 0, error: 0 };
  for (const r of rows) if (r.excluded) excluded[r.excluded]++;
  const counted = rows.filter((r) => !r.excluded && r.grade);
  const attempts = [...new Set(rows.map((r) => r.attempt))].sort((a, b) => a - b);
  const perAttempt = attempts.map((a) => {
    const xs = counted.filter((r) => r.attempt === a);
    return { attempt: a, passRate: rate(xs.filter((r) => r.grade?.pass).length, xs.length), counted: xs.length };
  });
  const rates = perAttempt.map((p) => p.passRate).filter((x): x is number => x !== null);
  const band = rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : null;

  const caseIds = [...new Set(rows.map((r) => r.caseId))].sort();
  const cases: CaseSummary[] = caseIds.map((id) => {
    const xs = rows.filter((r) => r.caseId === id);
    const passes = attempts.map((a) => {
      const r = xs.find((x) => x.attempt === a);
      return r && !r.excluded && r.grade ? r.grade.pass : null;
    });
    const n = passes.filter((p) => p !== null).length;
    const fails = passes.filter((p) => p === false).length;
    const failedGraders = [...new Set(xs.flatMap((r) => (r.excluded ? [] : (r.grade?.checks ?? []).filter((c) => !c.pass).map((c) => c.grader))))];
    const first = xs[0] as ResultRow;
    return { id, rule: first.rule, split: first.split, passes, failing: n > 0 && fails * 2 > n, failedGraders };
  });

  const byRule = rules.map((ru) => {
    const xs = counted.filter((r) => r.rule === ru.id);
    return {
      rule: ru.id,
      name: ru.name,
      passRate: rate(xs.filter((r) => r.grade?.pass).length, xs.length),
      counted: xs.length,
      failingCases: cases.filter((c) => c.rule === ru.id && c.failing).length,
    };
  });
  const byGrader = GRADERS.map((g) => {
    const cs = counted.flatMap((r) => (r.grade?.checks ?? []).filter((c) => c.grader === g));
    return { grader: g, name: GRADER_NAMES[g], passRate: rate(cs.filter((c) => c.pass).length, cs.length), counted: cs.length };
  });
  const sum = (f: (r: ResultRow) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const usd = sum((r) => r.costUsd);
  const paid = rows.filter((r) => r.costUsd > 0).length;
  return {
    schema: REPORT_SCHEMA,
    runId: manifest.runId,
    suite: manifest.suite,
    split: manifest.split,
    skill: manifest.skill,
    modelRole: manifest.modelRole,
    modelRoleHash: manifest.modelRoleHash,
    effort: manifest.effort,
    repeat: manifest.repeat,
    calls: rows.length,
    counted: counted.length,
    excluded,
    perAttempt,
    passRate: rate(counted.filter((r) => r.grade?.pass).length, counted.length),
    band,
    byRule,
    byGrader,
    cases,
    failingCases: cases.filter((c) => c.failing).map((c) => c.id),
    cost: {
      usd,
      perCallUsd: paid ? usd / paid : null,
      inputTokens: sum((r) => r.usage.input_tokens),
      outputTokens: sum((r) => r.usage.output_tokens),
      cacheReadTokens: sum((r) => r.usage.cache_read_input_tokens),
      cacheWriteTokens: sum((r) => r.usage.cache_creation_input_tokens),
    },
    outbound: manifest.outbound,
  };
}

/**
 * 自動の見立て（決めるのは人）。落ちる問題が増えた → 退行あり。合格率の差が前の版の揺れの幅に収まる → 差なし。ほか → 承認待ち。
 * 小さな差を「改善」と書かない。比べるのは、両方で数えた問題だけ。
 */
export function compareReports(base: Omit<Report, "comparison">, cand: Omit<Report, "comparison">): NonNullable<Report["comparison"]> {
  const common = new Set(base.cases.map((c) => c.id).filter((id) => cand.cases.some((c) => c.id === id)));
  const bf = new Set(base.cases.filter((c) => common.has(c.id) && c.failing).map((c) => c.id));
  const cf = new Set(cand.cases.filter((c) => common.has(c.id) && c.failing).map((c) => c.id));
  const newlyFailing = [...cf].filter((id) => !bf.has(id)).sort();
  const fixed = [...bf].filter((id) => !cf.has(id)).sort();
  const diff = base.passRate !== null && cand.passRate !== null ? cand.passRate - base.passRate : null;
  const enoughRuns = base.perAttempt.filter((p) => p.passRate !== null).length >= BAND_RUNS;
  let verdict: Verdict;
  let reason: string;
  if (cf.size > bf.size) {
    verdict = "退行あり";
    reason = `過半の回で落ちる問題が ${bf.size} から ${cf.size} に増えた`;
  } else if (diff !== null && base.band !== null && enoughRuns && Math.abs(diff) <= base.band + 1e-9) {
    verdict = "差なし";
    reason = `合格率の差 ${pct(diff)} が、前の版の揺れの幅 ${pct(base.band)}（${BAND_RUNS} 回の最大と最小の差）に収まる`;
  } else {
    verdict = "承認待ち";
    reason =
      diff === null || base.band === null || !enoughRuns
        ? `前の版の揺れの幅を ${BAND_RUNS} 回で測れていないので、差を見立てられない。人が問題ごとの前後を見る`
        : `合格率の差 ${pct(diff)} が、前の版の揺れの幅 ${pct(base.band)} を越える。人が問題ごとの前後を見る`;
  }
  return {
    base: base.runId,
    verdict,
    basePassRate: base.passRate,
    baseBand: base.band,
    diff,
    baseFailing: bf.size,
    failing: cf.size,
    newlyFailing,
    fixed,
    reason,
  };
}

export const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** report.json から静的な表（HTML）を作る。値は report.json のものだけを使う。 */
export function renderHtml(r: Report): string {
  const row = (cells: (string | number)[]): string => `<tr>${cells.map((c) => `<td>${esc(String(c))}</td>`).join("")}</tr>`;
  const head = (cells: string[]): string => `<tr>${cells.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const ex = Object.entries(r.excluded)
    .map(([k, v]) => `${k} ${v}`)
    .join("・");
  const cmp = r.comparison
    ? `<h2>前の版との比べ（自動の見立て。決めるのは人）</h2><table>${head(["前の版の回", "見立て", "理由", "前の合格率", "前の揺れの幅", "差", "新しく落ちた問題", "直った問題"])}${row([
        r.comparison.base,
        r.comparison.verdict,
        r.comparison.reason,
        pct(r.comparison.basePassRate),
        pct(r.comparison.baseBand),
        pct(r.comparison.diff),
        r.comparison.newlyFailing.join(" ") || "なし",
        r.comparison.fixed.join(" ") || "なし",
      ])}</table>`
    : "<p>前の版との比べ：比べる版が無い（ベースライン）</p>";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Skill の採点 ${esc(r.suite)}</title>
<style>
:root{--ink:#1b1b1b;--sub:#5b5b5b;--line:#d9d6cf;--bg:#fbfaf7;--bad:#9b2d20}
@media (prefers-color-scheme: dark){:root{--ink:#ecebe7;--sub:#a9a6a0;--line:#3b3a37;--bg:#161615;--bad:#e2806f}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--ink);font:14px/1.6 system-ui,"IBM Plex Sans JP",sans-serif}
main{max-width:1080px;margin:0 auto}h1{font-size:20px;font-weight:500}h2{font-size:15px;font-weight:500;margin-top:28px}
table{border-collapse:collapse;width:100%;margin:8px 0;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
th{font-weight:500;color:var(--sub)}.bad{color:var(--bad)}p{color:var(--sub)}
</style></head><body><main>
<h1>Skill の採点 — ${esc(r.suite)}（${esc(r.split)}）</h1>
<p>回 ${esc(r.runId)}。Skill の版 ${esc(r.skill.sha256.slice(0, 8))}（${esc(r.skill.path)}${r.skill.author ? `、作者 ${esc(r.skill.author)}` : ""}）。モデルは config/models.json の「${esc(r.modelRole)}」（ハッシュ ${esc(r.modelRoleHash.slice(0, 12))}）、effort ${esc(r.effort)}、1 問 ${r.repeat} 回。表は report.json から作った。</p>
<table>${head(["合格率", "揺れの幅", "回ごとの合格率", "数えた回", "外した回", "費用（米ドル）", "1 回あたり", "外へ出た文字", "固有名詞の当たり"])}${row([
    pct(r.passRate),
    pct(r.band),
    r.perAttempt.map((p) => `${p.attempt}: ${pct(p.passRate)}`).join(" / "),
    `${r.counted} / ${r.calls}`,
    ex,
    `$${r.cost.usd.toFixed(4)}`,
    r.cost.perCallUsd === null ? "—" : `$${r.cost.perCallUsd.toFixed(4)}`,
    r.outbound.chars,
    r.outbound.properNounHits,
  ])}</table>
${cmp}
<h2>規則ごと</h2><table>${head(["規則", "名前", "合格率", "数えた回", "過半で落ちた問題"])}${r.byRule.map((b) => row([b.rule, b.name, pct(b.passRate), b.counted, b.failingCases])).join("")}</table>
<h2>採点ごと（確かめ 1 つずつ）</h2><table>${head(["採点", "見ること", "合格率", "確かめの数"])}${r.byGrader.map((g) => row([g.grader, g.name, pct(g.passRate), g.counted])).join("")}</table>
<h2>問題ごと</h2><table>${head(["問題", "規則", "分け", "回ごとの合否", "落ちた採点"])}${r.cases
    .map((c) =>
      row([c.id + (c.failing ? "（過半で落ちた）" : ""), c.rule, c.split, c.passes.map((p) => (p === null ? "—" : p ? "○" : "×")).join(" "), c.failedGraders.join(" ") || ""]),
    )
    .join("")}</table>
<p>トークン：入力 ${r.cost.inputTokens}・キャッシュ読み ${r.cost.cacheReadTokens}・キャッシュ書き ${r.cost.cacheWriteTokens}・出力 ${r.cost.outputTokens}。</p>
</main></body></html>
`;
}
