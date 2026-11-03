#!/usr/bin/env node
// 試験を走らせる：tests/ の下の *.test.mjs を node --test で、*.test.ts(x) を vitest で。
// どちらかで見つかった試験・走った試験が 0 件なら失敗にする。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function* walk(dir, re) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, re);
    else if (e.isFile() && re.test(e.name)) yield p;
  }
}

let failed = false;

// 1. node:test
const files = [...walk("tests", /\.test\.mjs$/)].sort();
if (files.length === 0) {
  console.error("run-tests: node:test の試験のファイルが 0 件。失敗にする");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { encoding: "utf8" });
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
const m = /ℹ tests (\d+)/.exec(r.stdout ?? "");
const nodeCount = m ? Number(m[1]) : 0;
if (nodeCount === 0) {
  console.error("run-tests: node:test で走った試験が 0 件。失敗にする");
  process.exit(1);
}
if (r.status !== 0) failed = true;

// 2. vitest（結果の数は JSON の報告から読む）
const vfiles = [...walk("tests", /\.test\.tsx?$/)];
if (vfiles.length === 0) {
  console.error("run-tests: vitest の試験のファイルが 0 件。失敗にする");
  process.exit(1);
}
// 報告は一時のフォルダに書き、読んだら消す
const reportDir = mkdtempSync(join(tmpdir(), "moyai-vitest-"));
const report = join(reportDir, "report.json");
const v = spawnSync(
  process.execPath,
  [join("node_modules", "vitest", "vitest.mjs"), "run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`],
  { stdio: "inherit" },
);
let vitestCount = 0;
try {
  const j = JSON.parse(readFileSync(report, "utf8"));
  vitestCount = Number(j.numTotalTests ?? 0) - Number(j.numPendingTests ?? 0) - Number(j.numTodoTests ?? 0);
} catch {
  console.error("run-tests: vitest の報告を読めない");
  failed = true;
}
rmSync(reportDir, { recursive: true, force: true });
if (vitestCount === 0) {
  console.error("run-tests: vitest で走った試験が 0 件。失敗にする");
  process.exit(1);
}
if (v.status !== 0) failed = true;

console.log(`run-tests: node:test ${nodeCount} 件、vitest ${vitestCount} 件`);
process.exit(failed ? 1 : 0);
