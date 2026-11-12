#!/usr/bin/env node
// 試験だけの代わりの道具（tests/scripts/skill-loop-feedback.test.mjs が、この fixed/ を作業フォルダにして feedback.mjs を走らせる）。
// 本物の物差しは走らせず、固定した前・後の結果（MOYAI_FB_BASE・MOYAI_FB_HEAD）を、本物の pack-candidate.mjs と同じ置き場所に写す。
// 判定は feedback.mjs が本物の compare.mjs でする（この道具は判定しない）。
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const base = process.env.MOYAI_FB_BASE;
const head = process.env.MOYAI_FB_HEAD;
if (!out || !base || !head) process.exit(2);
for (const [dir, src] of [["base", base], ["candidate", head]]) {
  mkdirSync(join(out, dir), { recursive: true });
  copyFileSync(src, join(out, dir, "result.json"));
}
process.exit(0);
