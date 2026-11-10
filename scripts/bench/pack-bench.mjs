#!/usr/bin/env node
// Skillパックの物差しを走らせる：samples/<パック>/ の工場 v2 の施設をすべて測り、eval/bench/<パック>/ に result.json と README.md を書く。
// 使い方：node scripts/bench/pack-bench.mjs [パック] [--only 施設,施設] [--out フォルダ]
// --only で絞った回と --out を指した回は、既定の置き場所（eval/bench/<パック>/）を書き換えない（絞った値を全体の値として残さない）。
// AI も API も使わない。測るのは tests/heldout/pack-bench.test.ts。
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`pack-bench: ${flag} の値が無い`);
    process.exit(2);
  }
  args.splice(i, 2);
  return v;
};
const only = take("--only");
const outArg = take("--out");
const pack = args[0] ?? "waste-incineration";
if (!/^[a-z0-9-]+$/.test(pack)) {
  console.error("pack-bench: パックの名前は英小文字・数字・ハイフンだけ");
  process.exit(2);
}
const out = outArg ? resolve(outArg) : only ? mkdtempSync(join(tmpdir(), "moyai-bench-")) : resolve("eval", "bench", pack);
const r = spawnSync(process.execPath, [join("node_modules", "vitest", "vitest.mjs"), "run", "tests/heldout/pack-bench.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, MOYAI_BENCH_OUT: out, MOYAI_BENCH_PACK: pack, ...(only ? { MOYAI_BENCH_ONLY: only } : {}) },
});
console.error(`pack-bench: ${out}`);
process.exit(r.status ?? 1);
