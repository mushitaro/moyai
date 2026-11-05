#!/usr/bin/env node
// API のキーを、子プロセスにだけ渡して走らせる。
// キーはユーザー環境変数 ANTHROPIC_API_KEY にある。Claude Code 自身の環境には入れない（入れると Claude Code が API で課金されるため）。
// このスクリプトは、ユーザー環境変数を読み、渡されたコマンドの環境にだけ足す。値は表示しない・書かない・記録しない。
// 使い方：node scripts/with-api-key.mjs <command> [args...]
//   例：node scripts/with-api-key.mjs node .cache/review/review.mjs
//       node scripts/with-api-key.mjs node dist/cli.js eval run --suite waste-incineration --split test --per-rule 1 --repeat 1 --max-usd 3
// 運営者の決定（2026-11-05）：キーの渡し方はこの形にする。
import { execFileSync, spawnSync } from "node:child_process";

const NAME = "ANTHROPIC_API_KEY";

function readUserEnv(name) {
  if (process.env[name]) return process.env[name];
  if (process.platform === "win32") {
    try {
      const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, "m"));
      if (m) return m[1];
    } catch {
      /* 無い */
    }
  }
  return null;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("使い方：node scripts/with-api-key.mjs <command> [args...]");
  process.exit(2);
}
const key = readUserEnv(NAME);
if (!key) {
  console.error(`${NAME} がユーザー環境変数に無い（値は見ていない）。運営者に入れてもらう`);
  process.exit(2);
}
// シェルは通さない（引用の崩れを避ける）。Windows の npm・npx は .cmd を足す
const exe = process.platform === "win32" && /^(npm|npx|pnpm|yarn)$/.test(cmd) ? `${cmd}.cmd` : cmd;
const r = spawnSync(exe, args, {
  stdio: "inherit",
  env: { ...process.env, [NAME]: key },
});
if (r.error) {
  console.error(`起こせない：${cmd}（${r.error.code ?? r.error.message}）`);
  process.exit(2);
}
process.exit(r.status ?? 1);
