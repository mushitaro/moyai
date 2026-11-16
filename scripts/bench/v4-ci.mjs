#!/usr/bin/env node
// CI の物差し（v4、mushitaro/moyai#111）：2,565 ファイルの全部は CI の 20 分に収まらないので、記録した commit で取ったサンプルのリポジトリから、
// 資料の少ない数施設だけを今のコードで測り、今の記録（eval/bench/waste-incineration-v4/）の同じ施設の行と --strict で比べる。
// 全部の測りは手元（クラウドのセッションか M-PC3）で走らせ、記録をコミットする（eval/bench/FREEZE.md）。
// 使い方：node scripts/bench/v4-ci.mjs --samples-root <moyai-samples の clone> [--count 3] [--md <要約に足す .md>]
// 凍結の記録の照らし（読み手の木・サンプルの commit とハッシュ）は tests/heldout/bench-freeze.test.ts（MOYAI_SAMPLES_ROOT）がする。
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compare, toMarkdown } from "./compare.mjs";
import { V4_BENCH, benchDir, readFreeze, smallest, subsetOf } from "./v4.mjs";

const args = process.argv.slice(2);
const take = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const fail = (m) => {
  console.error(`v4-ci: ${m}`);
  process.exit(1);
};
const rootArg = take("--samples-root");
const count = Number(take("--count") ?? 3);
const md = take("--md");
if (!rootArg || !Number.isInteger(count) || count < 1) {
  console.error("使い方：node scripts/bench/v4-ci.mjs --samples-root <clone> [--count 3] [--md <.md>]");
  process.exit(2);
}
const f = readFreeze();
if (!f?.source) fail(`凍結の記録（eval/bench/${V4_BENCH}/frozen/freeze.json）に、サンプルのリポジトリの出どころが無い`);
const root = resolve(rootArg);
const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== f.source.commit) fail(`サンプルの clone が記録した commit でない（${head.slice(0, 12)}・記録 ${f.source.commit.slice(0, 12)}）`);
const samples = join(root, f.source.path);
let failed = false;
for (const mode of [
  { label: "Skillパックあり", sub: "", extra: [] },
  { label: "初めて読む", sub: "first-read", extra: ["--first-read"] },
]) {
  const base = JSON.parse(readFileSync(join(benchDir(), mode.sub, "result.json"), "utf8"));
  const names = smallest(base, count);
  if (names.length === 0) {
    // 記録に 1 つも施設が無い（初めて読む測りは、年度で分けられない施設を飛ばす）なら比べるものが無い。施設があるのに測れた施設が無いのは落とす
    if (base.facilities.length === 0) {
      console.error(`v4-ci: ${mode.label}：記録に施設が無い（比べない）`);
      continue;
    }
    fail(`今の記録（${mode.label}）に測れた施設が無い`);
  }
  const out = mkdtempSync(join(tmpdir(), "moyai-v4-ci-"));
  console.error(`v4-ci: ${mode.label}：${names.join("・")} を測る`);
  const p = spawnSync(process.execPath, ["scripts/bench/pack-bench.mjs", f.pack, "--samples", samples, "--only", names.join(","), ...mode.extra, "--out", out], { stdio: "inherit" });
  if (p.status !== 0) {
    failed = true;
    continue;
  }
  const got = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
  const want = subsetOf(base, names);
  const c = compare(want, got);
  const text = `### v4（${mode.label}）：資料の少ない ${names.length} 施設を今の記録の同じ行と比べた\n\n${toMarkdown(want, got, c)}`;
  console.error(text);
  if (md) appendFileSync(md, `${text}\n`, "utf8");
  if (c.changed) failed = true;
}
if (failed) fail("今の記録と数が違う（全部を手元で測り直し、eval/bench/waste-incineration-v4/ を入れ直す。eval/bench/FREEZE.md）");
