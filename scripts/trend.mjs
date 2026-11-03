#!/usr/bin/env node
// docs/trend.md を試験の実行から作る（docs/plan.md §2.6・§6.5）。手で書かない。
// 使い方：node scripts/trend.mjs
//   1. scripts/run-tests.mjs を走らせ、node:test と vitest の数と、通ったかを取る
//   2. import.dev（tests/unit/import/dev.test.ts）が書いた物差し ①②③⑤ と、資料をまたいで結べた割合を取る
//   3. ops/trend.jsonl に 1 行足し（足すだけ）、日ごとの最後の行から docs/trend.md を作り直す
// 緑でないものを緑と書かない：試験が落ちた回は「落ちた」と書き、測れなかった値は「測っていない」と書く。
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

// ③ は正解に無い余分な記録も出す（余分があれば 100% でも合格ではない）
const pct = (a) =>
  a && a.total ? `${Math.round((a.correct / a.total) * 1000) / 10}%（${a.correct}/${a.total}${a.extra ? `、余分 ${a.extra}` : ""}）` : "測っていない";
const val = (v) => (v === null || v === undefined ? "測っていない" : String(v));

/** 公開した見ていない様式の結果（samples/heldout/<組>/measured/result.json）。1 組 1 回だけ測ったもので、走らせ直さない */
export function readHeldout(root = "samples/heldout") {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "measured", "result.json")))
    .map((e) => JSON.parse(readFileSync(join(root, e.name, "measured", "result.json"), "utf8")))
    .sort((a, b) => (a.set < b.set ? -1 : 1));
}

/** 行の一覧（古い順）から、日ごとの最後の行で表を作る。heldout：見ていない様式の結果（readHeldout） */
export function render(rows, heldout = []) {
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
  L.push("| 日付 | 試験 | 施設 | 資料 | ① 原本の漏れ | ② 未解決のセル | ③ 読み取りの正しさ |");
  L.push("|---|---|---|---|---:|---:|---|");
  for (const d of days)
    for (const f of d.import ?? [])
      for (const x of f.files)
        L.push(`| ${d.date} | ${d.passed ? "通った" : "落ちた"} | ${f.facility} | ${x.file} | ${val(x.leak)} | ${val(x.unresolved)} | ${pct(x.accuracy)} |`);
  L.push("");
  L.push("| 日付 | 施設 | ⑤ 質問 | 計画 | 資料をまたいで 1 つの明細に結べた作業 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |");
  L.push("|---|---|---:|---|---|---|---|---|");
  for (const d of days)
    for (const f of d.import ?? [])
      L.push(
        `| ${d.date} | ${f.facility} | ${f.asked} | ${f.planMade ? "作った" : "作らなかった"} | ${pct(f.cross)} | ${pct(f.recovery ? { correct: f.recovery.together, total: f.recovery.denominator } : null)} | ${pct(f.recovery?.manDays)} | ${pct(f.recovery?.days)} |`,
      );
  L.push("");
  L.push(
    "⑥ の分母は、正解の世界の実績の作業のうち、その回に読んだ資料のどれかに書いてあるもの。戻せた＝読んだ資料の出どころ（星取表の印・日報の行・報告書の行）を 1 つの実績の明細がすべて持つ。工数・日数は、作業ごとに書いてある作業だけを分母にする。",
  );
  L.push(
    "報告書の PDF の ① は、工場に PDF の事実（別の読み手が取ったもの）が無いので、PDF の元の xlsx を MOYAI の Excel の読み手で読んだ表示の文字と、中身のある行ごとに比べた。",
  );
  L.push("この表にまだ載せていないもの：写真の ③ と要確認の数（tests/unit/import/photo-measure.test.ts が測る）、④ 検査の正しさ（tests/unit/review/measure.test.ts が測る）。CSV の ① は、工場の別の読み手（Python の csv。samples/factory/csv_facts.py）が取った記録と比べる。");
  L.push("");
  L.push("## 見ていない様式（import.heldout。凍結した読み手で、組ごとに 1 回だけ測った値）");
  L.push("");
  if (!heldout.length) L.push("まだ測っていない。");
  else {
    L.push("| 組 | 読み手 | 測った時刻（JST） | 資料 | 形式 | ① 原本の漏れ | ② 未解決のセル | ③ 読み取りの正しさ |");
    L.push("|---|---|---|---|---|---:|---:|---|");
    for (const h of heldout) {
      const t = jst(new Date(h.measuredAt));
      for (const f of h.result.files)
        L.push(
          `| ${h.set} | ${h.reader.tag ?? h.reader.commit.slice(0, 7)} | ${t.date} ${t.time} | ${f.file} | ${f.format} | ${f.rejected ? "読んでいない" : val(f.leak)} | ${f.rejected ? "—" : val(f.unresolved)} | ${f.rejected ? "—" : h.result.planMade ? pct(f.accuracy) : "計画なし（測れない）"} |`,
        );
    }
    L.push("");
    L.push("| 組 | ⑤ 質問（台本が答えた・開いたまま） | 計画 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |");
    L.push("|---|---|---|---|---|---|");
    for (const h of heldout) {
      const r = h.result;
      L.push(
        `| ${h.set} | ${r.asked}（${r.answered}・${r.openAtEnd.length}） | ${r.planMade ? "作った" : `作らなかった（${r.blockers.join("・")}）`} | ${pct({ correct: r.recovery.together, total: r.recovery.denominator })} | ${pct(r.recovery.manDays)} | ${pct(r.recovery.days)} |`,
      );
    }
    L.push("");
    L.push("見ていない様式の結果は、測った値のまま出す（直したら、新しい組を新しい凍結の読み手で測る）。手順と正解の形は samples/heldout/README.md。写真は AI が読むので、この台本では読まない。");
  }
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
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "packs", "samples", "scripts"], { encoding: "utf8" }).trim() !== "";
  const at = new Date();
  const row = { at: at.toISOString(), ...jst(at), commit, dirty, passed: r.status === 0 && counts !== null, counts, import: imp };
  appendFileSync(DATA, JSON.stringify(row) + "\n");
  const rows = readFileSync(DATA, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  writeFileSync(OUT, render(rows, readHeldout()));
  console.log(`trend: ${row.passed ? "通った" : "落ちた"}（node:test ${val(counts?.node)}、vitest ${val(counts?.vitest)}、取り込み ${imp.length} 施設）→ ${OUT}`);
  if (!row.passed) process.exit(1);
}

// 直に走らせたときだけ（試験が import したときは走らない）。日本語や空白を含む道でも合うよう URL で比べる
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
