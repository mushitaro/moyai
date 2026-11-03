// import.dev（docs/plan.md §5.1）：工場の開発用の資料（Excel・CSV）を取り込み、正解と行ごとに比べる。
// 物差し ① 原本の漏れ・② 行き先（未解決）・③ 読み取りの正しさ・⑤ 聞いた数を測って出す（目標と測った値を分ける）。
// 質問には、正解の世界から答える決まった台本（truth.ts）が人の代わりに答える。src/ は正解を読まない。
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { IntakeSession } from "../../../src/import";
import { Plan } from "../../../src/shared/plan";
import { Entities, loadTruth, measureCrossdoc, measureDaily, measureFacts, measureLedger, measureStar, measureStarWorkCount, pct, runScript } from "./truth";

const PACK = "waste-incineration";

interface Case {
  facility: string;
  files: string[];
}
const CASES: Case[] = [
  { facility: "fictional-1", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"] },
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
  const unresolvedAfter = [...comp.status.values()].filter((x) => x.s === "unresolved").length;
  const plan = comp.plan;
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
    ledger: plan ? measureLedger(plan, t, ents) : null,
    star: plan ? measureStar(plan, t) : null,
    starWorks: plan ? measureStarWorkCount(plan, t) : null,
    daily: plan ? measureDaily(plan, t, ents) : null,
    cross: plan ? measureCrossdoc(plan, t) : null,
  };
}

function report(c: Case, r: Awaited<ReturnType<typeof run>>) {
  const lines: string[] = [];
  lines.push(`== ${PACK}/${c.facility}`);
  for (const f of c.files) {
    const fc = r.comp.counts.find((x) => x.file === f);
    const one = r.facts[f] ? String(r.facts[f].diffs) : "事実なし（測っていない）";
    const acc = f.startsWith("equipment") ? r.ledger : f.startsWith("plan") ? r.star : r.daily;
    const two = fc?.unresolvedCells ?? "?";
    const three = acc ? `${pct(acc)}%（${acc.correct}/${acc.total}、余分 ${acc.extra}）` : "計画なし（測れない）";
    lines.push(`${f}：① ${one}／② ${two}／③ ${three}`);
    if (fc)
      lines.push(
        `  入れた行 ${fc.inputRows}＝取り込んだ ${fc.importedRows}＋外した ${Object.values(fc.excludedRows).reduce((a, b) => a + b, 0)}（${Object.entries(fc.excludedRows).map(([k, v]) => `${k} ${v}`).join("、")}）＋未解決 ${fc.unresolvedRows}${fc.holds ? "" : " ← 合わない"}`,
      );
    for (const m of acc?.misses.slice(0, 5) ?? []) lines.push(`  ✗ ${m}`);
    for (const d of r.facts[f]?.detail.slice(0, 5) ?? []) lines.push(`  ① ${d}`);
  }
  lines.push(`⑤ 質問 ${r.script.asked}（台本が答えた ${r.script.answered.length}、答えられず開いたまま ${r.script.openAtEnd.length}、${r.script.rounds} 回）`);
  lines.push(`② 未解決のセル：台本の前 ${r.unresolvedBefore} → 後 ${r.unresolvedAfter}`);
  if (r.cross && r.cross.total) lines.push(`資料をまたいで 1 つの明細に結べた作業：${pct(r.cross)}%（${r.cross.correct}/${r.cross.total}）`);
  if (r.starWorks)
    lines.push(`参考：星取表の印 1 つが指す作業の数まで合う割合 ${pct(r.starWorks)}%（${r.starWorks.correct}/${r.starWorks.total}。合わないもの：${r.starWorks.misses.slice(0, 4).join("、")}${r.starWorks.misses.length > 4 ? " ほか" : ""}）`);
  lines.push(`計画：${r.plan ? `作った（機器の節 ${r.plan.assets.length}・作業 ${r.plan.works.length}・明細 ${r.plan.details.length}）` : `作らなかった（${r.comp.blockers.join("・")}）`}`);
  for (const q of r.script.openAtEnd.slice(0, 5)) lines.push(`  開いたまま：${q.kind}（${q.sameShapeRows} 行）`);
  if (process.env.MOYAI_IMPORT_VERBOSE)
    for (const q of r.an.questions) lines.push(`  質問 ${q.kind}（${q.sameShapeRows} 行、既定 ${q.defaultAnswer}）→ ${q.decision?.answer ?? "なし"}：${q.text}`);
  console.log(lines.join("\n"));
}

describe("import.dev：工場の開発用の資料（Excel・CSV）", () => {
  for (const c of CASES) {
    test(c.facility, async () => {
      const r = await run(c);
      report(c, r);
      expect(r.rejected).toEqual([]);
      // 行の数え方は、計画を作っても作らなくても合う
      for (const fc of r.comp.counts) expect(fc.holds, `${fc.file} の行の数え方`).toBe(true);
      // 計画を作ったら、計画の型を通り、未解決は 0
      if (r.plan) {
        expect(Plan.safeParse(r.plan).success).toBe(true);
        expect(r.unresolvedAfter).toBe(0);
        // 鍵がぶつからない
        expect(new Set(r.plan.assets.map((a) => a.nodeKey)).size).toBe(r.plan.assets.length);
        expect(new Set(r.plan.works.map((w) => w.workKey)).size).toBe(r.plan.works.length);
        expect(new Set(r.plan.details.map((d) => d.detailKey)).size).toBe(r.plan.details.length);
      } else expect(r.comp.blockers.length).toBeGreaterThan(0);
    });
  }
});
