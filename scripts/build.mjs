#!/usr/bin/env node
// ビルド：印を 1 回だけ作り、画面（vite.config.ts）と CLI（vite.cli.config.ts）の両方に同じ値を埋める。Claude Desktop 用の 1 段目の Skill の zip も作る。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { join } from "node:path";
import { STAMP_ENV, buildStamp } from "./build-stamp.mjs";

const stamp = buildStamp();
const env = { ...process.env, [STAMP_ENV]: JSON.stringify(stamp) };
const vite = join("node_modules", "vite", "bin", "vite.js");
for (const config of ["vite.config.ts", "vite.cli.config.ts"]) {
  const r = spawnSync(process.execPath, [vite, "build", "--config", config], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
// Claude Desktop では MCP の instructions が効かないので、1 段目の Skill（skills/moyai/SKILL.md）を、利用者がアップロードする zip にする（docs/plan.md §2.18.3）
const zip = new JSZip();
zip.file("moyai/SKILL.md", readFileSync(join("skills", "moyai", "SKILL.md")));
mkdirSync(join("dist", "skills"), { recursive: true });
writeFileSync(join("dist", "skills", "moyai.zip"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`build: MOYAI · build ${stamp.time} JST · ${stamp.commit}`);
