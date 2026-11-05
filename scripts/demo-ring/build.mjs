#!/usr/bin/env node
// デモの輪を作る（docs/plan.md §2.8「デモの輪は 7 拠点」・§2.15 の demo-ring/）。架空の 7 拠点の正解の世界から、本物の写し取りと署名で束を作り、
// 輪のフォルダ（<出す先>/<輪ID>/circle.json・members/・bundles/）と約束のファイル（<出す先>/demo-ring.json）を書く。
// わざと外れた束（費用の欄）を 1 つ入れる。鍵は走らせるたびに作り、秘密鍵は一時の状態のフォルダにだけ書く（場所を最後に出す）。
//
//   node scripts/demo-ring/build.mjs [--out <出す先。既定はリポジトリの demo-ring/>] [--month 2026-11] [--state <状態のフォルダ>]
//
// 出す先にもう輪があれば作らない（作り直すときは、人が demo-ring/<輪ID>/ と demo-ring.json を消してから）。
// 芯（demo-ring-core.ts）は TypeScript なので、Vite の SSR のビルドで状態のフォルダの下に 1 つの JS にしてから読む。
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const say = (m) => process.stderr.write(`${m}\n`);
const USAGE = "使い方：node scripts/demo-ring/build.mjs [--out <出す先>] [--month YYYY-MM] [--state <状態のフォルダ>]";

function parse(argv) {
  const a = { out: join(REPO, "demo-ring"), month: "2026-11", state: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (k === "--out") a.out = resolve(v);
    else if (k === "--month") a.month = v;
    else if (k === "--state") a.state = resolve(v);
    else return null;
  }
  return a;
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (!a) {
    say(USAGE);
    return 2;
  }
  const state = a.state ?? mkdtempSync(join(tmpdir(), "moyai-demo-ring-"));
  mkdirSync(state, { recursive: true });
  const outDir = join(state, "build");
  const { build } = await import("vite");
  await build({
    configFile: false,
    logLevel: "warn",
    root: REPO,
    ssr: { noExternal: true },
    build: {
      ssr: join(HERE, "demo-ring-core.ts"),
      outDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      rolldownOptions: { output: { entryFileNames: "demo-ring-core.js" } },
    },
  });
  const core = await import(pathToFileURL(join(outDir, "demo-ring-core.js")).href);
  const r = await core.buildDemoRing({ repo: REPO, out: a.out, state, month: a.month });
  const ok = r.report.lines.filter((l) => l.status === "ok").length;
  say(`輪 ${r.ringId} を書きました：${a.out}`);
  say(`拠点 ${r.sites.length}（束 ${r.sites.map((s) => `塊 ${s.chunks}`).join("・")}）`);
  say(`受け手と同じ関数で確かめました：✓ ${ok} 行・✗ ${r.report.lines.length - ok} 行（わざと入れた束とその鍵だけ）`);
  for (const e of r.manifest.expectNg) say(`  ✗ ${e.kind} ${e.name}：${e.reasons.join("・")}`);
  say(`状態のフォルダ（秘密鍵と、拠点と世界の対応。リポジトリに入れない）：${state}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    say(`demo-ring：止まりました（${e instanceof Error ? e.message : "誤り"}）`);
    process.exit(1);
  },
);
