#!/usr/bin/env node
// ビルド：印を 1 回だけ作り、画面（vite.config.ts）と CLI（vite.cli.config.ts）の両方に同じ値を埋める。
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { STAMP_ENV, buildStamp } from "./build-stamp.mjs";

const stamp = buildStamp();
const env = { ...process.env, [STAMP_ENV]: JSON.stringify(stamp) };
const vite = join("node_modules", "vite", "bin", "vite.js");
for (const config of ["vite.config.ts", "vite.cli.config.ts"]) {
  const r = spawnSync(process.execPath, [vite, "build", "--config", config], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log(`build: MOYAI · build ${stamp.time} JST · ${stamp.commit}`);
