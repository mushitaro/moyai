#!/usr/bin/env node
// docs/trend.md を試験の実行から作る（docs/plan.md §2.6・§6.5）。手で書かない。
// 使い方：node scripts/trend.mjs
//   1. scripts/run-tests.mjs を走らせ、node:test と vitest の数と、通ったかを取る
//   2. import.dev（tests/unit/import/dev.test.ts）が書いた物差し ①②③⑤ と、資料をまたいで結べた割合を取る
//   3. ops/trend.jsonl に 1 行足し（足すだけ）、日ごとの最後の行から docs/trend.md を作り直す
// 緑でないものを緑と書かない：試験が落ちた回は「落ちた」と書き、測れなかった値は「測っていない」と書く。
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const DATA = "ops/trend.jsonl";
const OUT = "docs/trend.md";

export function parseCounts(stdout) {
  const m = /run-tests: node:test (\d+) 件、vitest (\d+) 件/.exec(stdout);
  return m ? { node: Number(m[1]), vitest: Number(m[2]) } : null;
}

/** JST の日付と時刻 */
export function jst(d) {
  const t = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return { date: t.slice(0, 10), time: t.slice(11, 16) };
}

const pct = (a) => (a && a.total ? `${Math.round((a.correct / a.total) * 1000) / 10}%（${a.correct}/${a.total}）` : "測っていない");
const val = (v) => (v === null || v === undefined ? "測っていない" : String(v));

/** 行の一覧（古い順）から、日ごとの最後の行で表を作る */
export function render(rows) {
  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, r);
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const L = [];
  L.push("# 試験と物差しの推移");
  L.push("");
  L.push("`node scripts/trend.mjs` が試験を走らせて作る（手で書かない）。日ごとに、その日の最後の実行の値を出す。元の記録は `ops/trend.jsonl`（足すだけ）。");
  L.push("物差しの目標（docs/plan.md §2.6）：① 原本の漏れ 0、② 未解決 0、③ 読み取りの正しさ 100%（開発用）。⑤ 質問の数は版ごとに比べる。");
  L.push("");
  L.push("## 試験の数");
  L.push("");
  L.push("| 日付 | 時刻（JST） | コミット | node:test | vitest | 結果 |");
  L.push("|---|---|---|---:|---:|---|");
  for (const d of days)
    L.push(`| ${d.date} | ${d.time} | \`${d.commit}\`${d.dirty ? "+" : ""} | ${val(d.counts?.node)} | ${val(d.counts?.vitest)} | ${d.passed ? "通った" : "落ちた"} |`);
  L.push("");
  L.push("## 取り込みの物差し（import.dev、工場の開発用の資料）");
  L.push("");
  L.push("| 日付 | 施設 | 資料 | ① 原本の漏れ | ② 未解決のセル | ③ 読み取りの正しさ |");
  L.push("|---|---|---|---:|---:|---|");
  for (const d of days)
    for (const f of d.import ?? [])
      for (const x of f.files) L.push(`| ${d.date} | ${f.facility} | ${x.file} | ${val(x.leak)} | ${val(x.unresolved)} | ${pct(x.accuracy)} |`);
  L.push("");
  L.push("| 日付 | 施設 | ⑤ 質問 | 計画 | 資料をまたいで 1 つの明細に結べた作業 |");
  L.push("|---|---|---:|---|---|");
  for (const d of days)
    for (const f of d.import ?? []) L.push(`| ${d.date} | ${f.facility} | ${f.asked} | ${f.planMade ? "作った" : "作らなかった"} | ${pct(f.cross)} |`);
  L.push("");
  L.push("④ 検査の正しさ・⑥ 取り戻せた割合・見ていない様式は、まだ測っていない（試験が無い）。");
  return L.join("\n") + "\n";
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), "moyai-trend-"));
  const measures = join(dir, "import.jsonl");
  const r = spawnSync(process.execPath, ["scripts/run-tests.mjs"], {
    encoding: "utf8",
    env: { ...process.env, MOYAI_TREND_OUT: measures },
    maxBuffer: 64 * 1024 * 1024,
  });
  const counts = parseCounts(r.stdout ?? "");
  const imp = existsSync(measures)
    ? readFileSync(measures, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  rmSync(dir, { recursive: true, force: true });
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "packs", "samples"], { encoding: "utf8" }).trim() !== "";
  const at = new Date();
  const row = { at: at.toISOString(), ...jst(at), commit, dirty, passed: r.status === 0 && counts !== null, counts, import: imp };
  appendFileSync(DATA, JSON.stringify(row) + "\n");
  const rows = readFileSync(DATA, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  writeFileSync(OUT, render(rows));
  console.log(`trend: ${row.passed ? "通った" : "落ちた"}（node:test ${val(counts?.node)}、vitest ${val(counts?.vitest)}、取り込み ${imp.length} 施設）→ ${OUT}`);
  if (!row.passed) process.exit(1);
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) main();
