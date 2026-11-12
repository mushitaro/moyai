#!/usr/bin/env node
// Skillパックの物差しを走らせる：samples/<パック>/ の工場 v2 の施設をすべて測り、eval/bench/<パック>/ に result.json と README.md を書く。
// 使い方：node scripts/bench/pack-bench.mjs [パック] [--samples サンプルのフォルダ] [--only 施設,施設] [--out フォルダ] [--rules ルールの案.json] [--first-read]
// --samples：測るサンプルの置き場所（既定 samples/<パック>）。指せば、記録の既定の置き場所は eval/bench/<フォルダの名前>/（例 --samples samples/waste-incineration-v3 → eval/bench/waste-incineration-v3/。mushitaro/moyai#111）
// --first-read：初めて読む測り（パックなしで 1 年目だけを読み、答えを規則にして、残りの年度を足して読み直す。mushitaro/moyai#67）。既定の置き場所は eval/bench/<パック>/first-read/
// --only で絞った回・--out を指した回・--rules で案を当てた回は、既定の置き場所（eval/bench/<パック>/）を書き換えない（絞った値・案の値を、今の Skillパックの値として残さない）。
// AI も API も使わない。測るのは tests/heldout/pack-bench.test.ts。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

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
const rules = take("--rules");
const samplesArg = take("--samples");
const fr = args.indexOf("--first-read");
const firstRead = fr >= 0;
if (firstRead) args.splice(fr, 1);
if (firstRead && rules) {
  console.error("pack-bench: --first-read と --rules は一緒に使えない");
  process.exit(2);
}
const pack = args[0] ?? "waste-incineration";
if (!/^[a-z0-9-]+$/.test(pack)) {
  console.error("pack-bench: パックの名前は英小文字・数字・ハイフンだけ");
  process.exit(2);
}
const samples = samplesArg ? resolve(samplesArg) : null;
if (samples && !existsSync(samples)) {
  console.error(`pack-bench: サンプルの置き場所が無い：${samplesArg}`);
  process.exit(2);
}
const record = samples ? basename(samples) : pack;
if (!/^[a-z0-9-]+$/.test(record)) {
  console.error("pack-bench: サンプルのフォルダの名前は英小文字・数字・ハイフンだけ");
  process.exit(2);
}
const out = outArg ? resolve(outArg) : only || rules ? mkdtempSync(join(tmpdir(), "moyai-bench-")) : firstRead ? resolve("eval", "bench", record, "first-read") : resolve("eval", "bench", record);
const r = spawnSync(process.execPath, [join("node_modules", "vitest", "vitest.mjs"), "run", "tests/heldout/pack-bench.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, MOYAI_BENCH_OUT: out, MOYAI_BENCH_PACK: pack, ...(samples ? { MOYAI_BENCH_SAMPLES: samples } : {}), ...(only ? { MOYAI_BENCH_ONLY: only } : {}), ...(rules ? { MOYAI_BENCH_RULES: resolve(rules) } : {}), ...(firstRead ? { MOYAI_BENCH_FIRST_READ: "1" } : {}) },
});
console.error(`pack-bench: ${out}`);
process.exit(r.status ?? 1);
