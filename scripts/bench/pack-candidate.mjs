#!/usr/bin/env node
// Skillパックのルールの案を、入れる前に試す：今の Skillパックで測った値と、案を当てて測った値を比べ、数だけで判定する。
// 使い方：node scripts/bench/pack-candidate.mjs <パック> <ルールの案.json> [--out フォルダ]
//   ルールの案は moyai.reading/0（施設の 3 段目の rules.json、または packs/<パック>/reading.json と同じ形）。
//   書くもの：<out>/base/・<out>/candidate/（物差しの結果）と <out>/compare.md（比べた表と判定）。
//   案は、今の Skillパックの上に下書きとして足して測る。今あるルールを外す・緩める案は、この道具では試せない（reading.json を直した枝で物差しを測る）。
// packs/ には書かない。Skillパックに入れるか（昇格）を決めるのは人。AI も API も使わない。
// 終了コード：退行あり 1・良くなった 0・差なし 0（道具の失敗は 2）
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const outArg = oi >= 0 ? args.splice(oi, 2)[1] : null;
const [pack, rules] = args;
if (!pack || !rules || !/^[a-z0-9-]+$/.test(pack) || !existsSync(rules)) {
  console.error("使い方：node scripts/bench/pack-candidate.mjs <パック> <ルールの案.json> [--out フォルダ]");
  process.exit(2);
}
const out = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), "moyai-candidate-"));
const run = (...a) => spawnSync(process.execPath, a, { stdio: ["ignore", "ignore", "inherit"] }).status ?? 1;
const bench = join("scripts", "bench", "pack-bench.mjs");
if (run(bench, pack, "--out", join(out, "base")) !== 0) process.exit(2);
if (run(bench, pack, "--out", join(out, "candidate"), "--rules", rules) !== 0) process.exit(2);
const c = spawnSync(process.execPath, [join("scripts", "bench", "compare.mjs"), join(out, "base", "result.json"), join(out, "candidate", "result.json"), "--md", join(out, "compare.md")], { stdio: "inherit" });
console.error(`pack-candidate: ${join(out, "compare.md")}`);
process.exit(c.status === 0 ? 0 : c.status === 1 ? 1 : 2);
