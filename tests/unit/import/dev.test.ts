// import.dev（docs/plan.md §5.1）：工場の開発用の資料（Excel・CSV・文字のある PDF）を取り込み、正解と行ごとに比べる。
// 物差し ① 原本の漏れ・② 行き先（未解決）・③ 読み取りの正しさ・⑤ 聞いた数・⑥ 取り戻せた割合を測って出す（目標と測った値を分ける）。
// 質問には、正解の世界から答える決まった台本（truth.ts）が人の代わりに答える。src/ は正解を読まない。
import { describe, expect, test } from "vitest";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { IntakeSession, readSource } from "../../../src/import";
import type { SourceFile } from "../../../src/import/grid";
import { Plan } from "../../../src/shared/plan";
import {
  Entities,
  ReportRows,
  loadTruth,
  measureCrossdoc,
  measureDaily,
  measureFacts,
  measureLedger,
  measurePdfAgainstXlsx,
  measureRecovery,
  measureReport,
  measureStar,
  measureStarWorkCount,
  pct,
  runScript,
  type Accuracy,
  type Recovery,
} from "./truth";

const PACK = "waste-incineration";

interface Case {
  facility: string;
  files: string[];
}

/** 工場が書いた報告書の PDF（正解の一覧の順） */
function reportFiles(facility: string): string[] {
  const p = `samples/truth/${PACK}/${facility}/reports.truth.json`;
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf8")).reports as { file_pdf: string }[]).map((r) => r.file_pdf);
}

const CASES: Case[] = [
  { facility: "fictional-1", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv", ...reportFiles("fictional-1")] },
  { facility: "fictional-2", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"] },
];

async function run(c: Case) {
  const t = loadTruth(PACK, c.facility);
  const s = new IntakeSession({
    planId: `plan-${c.facility}`,
    displayName: t.world.facility.name,
    packId: PACK,
    facility: {
      facilityKey: c.facility,
      name: t.world.facility.name,
      fiscalYearStartMonth: 4,
      scale: null,
      scaleUnit: null,
      legalFlags: [],
      fictional: true,
      inNationalTable: null,
    },
  });
  const dir = `samples/out/${PACK}/${c.facility}/`;
  const rejected = await s.add(c.files.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(dir + n)) })));
  const before = s.analyze();
  const unresolvedBefore = [...before.composition.status.values()].filter((x) => x.s === "unresolved").length;
  const script = runScript(s, t);
  const comp = s.compose();
  const an = s.analyze();
  const ents = new Entities(t);
  const facts = Object.fromEntries(
    an.sources.filter((x) => t.facts[x.file]).map((x) => [x.file, measureFacts(x, t.facts[x.file])]),
  );
  // 報告書の PDF の ①：工場に PDF の事実は無いので、PDF の元の xlsx（MOYAI の Excel の読み手で読んだ表示の文字）と比べる
  const pdfLeak: Record<string, ReturnType<typeof measurePdfAgainstXlsx>> = {};
  for (const r of (t.reports?.reports ?? []) as { file_pdf: string; file_xlsx: string }[]) {
    const pdf = an.sources.find((x) => x.file === r.file_pdf);
    if (!pdf) continue;
    const xr = await readSource({ name: r.file_xlsx, bytes: new Uint8Array(readFileSync(dir + r.file_xlsx)) });
    if (xr.source) pdfLeak[r.file_pdf] = measurePdfAgainstXlsx(pdf, xr.source as SourceFile);
  }
  const reps = t.reports ? new ReportRows(t, an.sources) : null;
  const unresolvedAfter = [...comp.status.values()].filter((x) => x.s === "unresolved").length;
  const plan = comp.plan;
  const read = new Set(c.files);
  return {
    t,
    s,
    an,
    comp,
    plan,
    rejected,
    unresolvedBefore,
    unresolvedAfter,
    script,
    facts,
    pdfLeak,
    reps,
    ledger: plan ? measureLedger(plan, t, ents) : null,
    star: plan ? measureStar(plan, t) : null,
    starWorks: plan ? measureStarWorkCount(plan, t) : null,
    daily: plan ? measureDaily(plan, t, ents) : null,
    cross: plan ? measureCrossdoc(plan, t) : null,
    reports: Object.fromEntries(plan && reps ? reps.files.filter((f) => read.has(f)).map((f) => [f, measureReport(plan, t, reps, f, an.sources)]) : []) as Record<string, Accuracy>,
    recovery: plan ? measureRecovery(plan, t, read, reps, an.sources) : null,
  };
}

type Run = Awaited<ReturnType<typeof run>>;

// 資料 → 正解の種類（名前の頭で推さない。表に無い資料は測っていない）
const TRUTH_KIND: Record<string, "ledger" | "star" | "daily"> = {
  "equipment-ledger.xlsx": "ledger",
  "plan-hoshitori.xlsx": "star",
  "daily-report.csv": "daily",
};
function accuracyOf(f: string, r: Run): Accuracy | null {
  const k = TRUTH_KIND[f];
  if (k) return k === "ledger" ? r.ledger : k === "star" ? r.star : r.daily;
  return r.reports[f] ?? null;
}
function leakOf(f: string, r: Run): { n: number; against: string; detail: string[] } | null {
  if (r.facts[f]) return { n: r.facts[f].diffs, against: "事実", detail: r.facts[f].detail };
  const p = r.pdfLeak[f];
  if (p) return { n: p.diffs, against: `元の xlsx（列の位置のずれ ${p.columnShifts}）`, detail: p.detail };
  return null;
}

/** scripts/trend.mjs が読む 1 施設分の形（tests/scripts/trend.test.mjs が同じ形で render を試す） */
export interface TrendRecord {
  pack: string;
  facility: string;
  files: { file: string; leak: number | null; unresolved: number | null; accuracy: { correct: number; total: number; extra: number } | null }[];
  asked: number;
  planMade: boolean;
  cross: { correct: number; total: number } | null;
  /** ⑥ 取り戻せた割合（分母は、読んだ資料のどれかに書いてある実績の作業） */
  recovery?: { together: number; denominator: number; manDays: { correct: number; total: number }; days: { correct: number; total: number }; starOnly: number } | null;
}

function report(c: Case, r: Run) {
  const lines: string[] = [];
  lines.push(`== ${PACK}/${c.facility}`);
  const pdfs = c.files.filter((f) => f.endsWith(".pdf"));
  const sumAcc = { correct: 0, total: 0, extra: 0 };
  let pdfLeak = 0;
  let pdfUnresolved = 0;
  for (const f of c.files) {
    const fc = r.comp.counts.find((x) => x.file === f);
    const lk = leakOf(f, r);
    const one = lk ? `${lk.n}（${lk.against}と比べた）` : "事実なし（測っていない）";
    const acc = accuracyOf(f, r);
    const two = fc?.unresolvedCells ?? "?";
    const three = acc ? `${pct(acc)}%（${acc.correct}/${acc.total}、余分 ${acc.extra}）` : "計画なし（測れない）";
    if (f.endsWith(".pdf")) {
      if (acc) {
        sumAcc.correct += acc.correct;
        sumAcc.total += acc.total;
        sumAcc.extra += acc.extra;
      }
      pdfLeak += lk?.n ?? 0;
      pdfUnresolved += typeof fc?.unresolvedCells === "number" ? fc.unresolvedCells : 0;
    }
    lines.push(`${f}：① ${one}／② ${two}／③ ${three}`);
    if (fc)
      lines.push(
        `  入れた行 ${fc.inputRows}＝取り込んだ ${fc.importedRows}＋外した ${Object.values(fc.excludedRows).reduce((a, b) => a + b, 0)}（${Object.entries(fc.excludedRows).map(([k, v]) => `${k} ${v}`).join("、")}）＋未解決 ${fc.unresolvedRows}${fc.holds ? "" : " ← 合わない"}`,
      );
    for (const m of acc?.misses.slice(0, 5) ?? []) lines.push(`  ✗ ${m}`);
    for (const d of lk?.detail.slice(0, 5) ?? []) lines.push(`  ① ${d}`);
  }
  if (pdfs.length) {
    const totals = r.comp.checks.filter((x) => pdfs.includes(x.file) && x.kind === "total");
    lines.push(
      `報告書の PDF ${pdfs.length} 冊：① ${pdfLeak}（元の xlsx と比べた）／② ${pdfUnresolved}／③ ${sumAcc.total ? `${pct({ ...sumAcc, misses: [] })}%（${sumAcc.correct}/${sumAcc.total}、余分 ${sumAcc.extra}）` : "計画なし（測れない）"}／合計の行の検算 ${totals.filter((x) => x.mismatches.length === 0).length}/${totals.length} が合った`,
    );
  }
  lines.push(`⑤ 質問 ${r.script.asked}（台本が答えた ${r.script.answered.length}、答えられず開いたまま ${r.script.openAtEnd.length}、${r.script.rounds} 回）`);
  lines.push(`② 未解決のセル：台本の前 ${r.unresolvedBefore} → 後 ${r.unresolvedAfter}`);
  if (r.cross && r.cross.total) lines.push(`資料をまたいで 1 つの明細に結べた作業（星取表と日報）：${pct(r.cross)}%（${r.cross.correct}/${r.cross.total}）`);
  const rc: Recovery | null = r.recovery;
  if (rc && rc.denominator) {
    const p = (a: number, b: number) => (b ? `${Math.round((a / b) * 10000) / 100}%（${a}/${b}）` : "分母 0");
    lines.push(
      `⑥ 取り戻せた割合：${p(rc.together, rc.denominator)}（分母：正解の世界の実績の作業のうち、この回に読んだ資料のどれかに書いてあるもの。戻せた＝読んだ資料の出どころを 1 つの実績の明細がすべて持つ）`,
    );
    lines.push(`  計画に入った（どれかの出どころを持つ明細がある）${p(rc.inPlan, rc.denominator)}・工数 ${p(rc.manDays.correct, rc.manDays.total)}・日数 ${p(rc.days.correct, rc.days.total)}・参考：星取表だけで戻せる（実績の印がある）${p(rc.starOnly, rc.denominator)}`);
    const nc = Object.entries(rc.notCounted);
    lines.push(`  分母に入れなかったもの：${nc.length ? nc.map(([k, v]) => `${k} ${v}`).join("、") : "無し"}`);
    for (const m of rc.misses.slice(0, 5)) lines.push(`  ✗ ${m}`);
  }
  if (r.starWorks)
    lines.push(`参考：星取表の印 1 つが指す作業の数まで合う割合 ${pct(r.starWorks)}%（${r.starWorks.correct}/${r.starWorks.total}。合わないもの：${r.starWorks.misses.slice(0, 4).join("、")}${r.starWorks.misses.length > 4 ? " ほか" : ""}）`);
  lines.push(`計画：${r.plan ? `作った（機器の節 ${r.plan.assets.length}・作業 ${r.plan.works.length}・明細 ${r.plan.details.length}）` : `作らなかった（${r.comp.blockers.join("・")}）`}`);
  for (const q of r.script.openAtEnd.slice(0, 5)) lines.push(`  開いたまま：${q.kind}（${q.sameShapeRows} 行）：${q.text.slice(0, 80)}`);
  if (process.env.MOYAI_IMPORT_VERBOSE)
    for (const q of r.an.questions) lines.push(`  質問 ${q.kind}（${q.sameShapeRows} 行、既定 ${q.defaultAnswer}）→ ${q.decision?.answer ?? "なし"}：${q.text}`);
  console.log(lines.join("\n"));
  // scripts/trend.mjs が読む数（docs/trend.md の物差しの行）。走らせたときだけ書く
  const out = process.env.MOYAI_TREND_OUT;
  if (out) {
    const files: TrendRecord["files"] = c.files.map((f) => {
      const fc = r.comp.counts.find((x) => x.file === f);
      const acc = accuracyOf(f, r);
      return {
        file: f,
        leak: leakOf(f, r)?.n ?? null,
        unresolved: fc?.unresolvedCells ?? null,
        accuracy: acc ? { correct: acc.correct, total: acc.total, extra: acc.extra } : null,
      };
    });
    const cross = r.cross && r.cross.total ? { correct: r.cross.correct, total: r.cross.total } : null;
    const recovery =
      rc && rc.denominator ? { together: rc.together, denominator: rc.denominator, manDays: rc.manDays, days: rc.days, starOnly: rc.starOnly } : null;
    const rec: TrendRecord = { pack: PACK, facility: c.facility, files, asked: r.script.asked, planMade: r.plan !== null, cross, recovery };
    appendFileSync(out, JSON.stringify(rec) + "\n");
  }
}

describe("import.dev：工場の開発用の資料（Excel・CSV・文字のある PDF）", () => {
  for (const c of CASES) {
    test(c.facility, async () => {
      const r = await run(c);
      report(c, r);
      expect(r.rejected).toEqual([]);
      // 行の数え方は、計画を作っても作らなくても合う
      for (const fc of r.comp.counts) expect(fc.holds, `${fc.file} の行の数え方`).toBe(true);
      // 報告書の PDF：どの文字の並びも、セルに入ったか読まなかった物に数えた
      for (const src of r.an.sources.filter((x) => x.format === "pdf")) {
        expect(src.ledger.some((e) => e.what === "pdfRunsUncounted"), `${src.file} の文字の並びの数え漏れ`).toBe(false);
        for (const p of src.pages ?? []) expect(p.placed, `${src.file} ${p.page} 頁`).toBe(p.runs);
      }
      // 計画を作ったら、計画の型を通り、未解決は 0
      if (r.plan) {
        expect(Plan.safeParse(r.plan).success).toBe(true);
        expect(r.unresolvedAfter).toBe(0);
        // 鍵がぶつからない
        expect(new Set(r.plan.assets.map((a) => a.nodeKey)).size).toBe(r.plan.assets.length);
        expect(new Set(r.plan.works.map((w) => w.workKey)).size).toBe(r.plan.works.length);
        expect(new Set(r.plan.details.map((d) => d.detailKey)).size).toBe(r.plan.details.length);
        // PDF の出どころは頁と頁の上の位置を持つ
        const pdfSources = r.plan.details.flatMap((d) => d.sources).filter((s) => s.file.endsWith(".pdf"));
        if (c.files.some((f) => f.endsWith(".pdf"))) expect(pdfSources.length).toBeGreaterThan(0);
        for (const s of pdfSources) {
          expect(s.page, `${s.file} ${s.cell} の頁`).not.toBeNull();
          expect(s.box, `${s.file} ${s.cell} の位置`).not.toBeNull();
        }
      } else expect(r.comp.blockers.length).toBeGreaterThan(0);
    }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
  }
});
