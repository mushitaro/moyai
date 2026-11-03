#!/usr/bin/env node
// tests/ の下の *.test.mjs を node --test で走らせる。見つかった試験が 0 件なら失敗にする。
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".test.mjs")) yield p;
  }
}

const files = [...walk("tests")].sort();
if (files.length === 0) {
  console.error("run-tests: 試験のファイルが 0 件。失敗にする");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { encoding: "utf8" });
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
const m = /ℹ tests (\d+)/.exec(r.stdout ?? "");
const count = m ? Number(m[1]) : 0;
if (count === 0) {
  console.error("run-tests: 走った試験が 0 件。失敗にする");
  process.exit(1);
}
process.exit(r.status ?? 1);
