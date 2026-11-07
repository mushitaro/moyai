#!/usr/bin/env node
// 撮影の前に、空の保管先へ、動画の世界（ほたる川クリーンセンター）の版の履歴を作る台本（docs/plan.md §2.19・来歴のツリー C14）。
// 画面の経路は使わない。MOYAI の今の関数を直接呼ぶ（芯は history-core.ts。Vite の SSR で 1 つの JS にしてから読む）。
//
//   node video/world/make-history.mjs --store <空の保管先の絶対の道> [--now 2026-11-08T00:00:00Z] [--mail-out <メールの文を書くファイル>]
//
// 作るもの：ほたる川の令和 6 年度版（第 1 版）・令和 7 年度版（第 2 版）＝署名と承認済み、令和 8 年度版（第 3 版）＝承認待ち。
// しらかば野へ：第 2 版から作った派生の施設（第 1 版）と、3 段目の Skill（会社の読み方）。
// 運営者の本物の保管先には書かない：道に MOYAI のフォルダがある・状態フォルダの設定の保管先と重なる・空でない、のどれかなら断る（video/world/guard.mjs）。断る上書きの旗は無い。
// 署名の鍵は、この台本が作った架空の鍵だけ。秘密鍵は書かない（走りが終われば消える）。
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkStore } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const say = (m) => process.stderr.write(`${m}\n`);
const USAGE = "使い方：node video/world/make-history.mjs --store <空の保管先の絶対の道> [--now <ISO の日時>] [--mail-out <ファイル>]";

function parse(argv) {
  const a = { store: undefined, now: new Date(), mailOut: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (k === "--store") a.store = v;
    else if (k === "--now") {
      a.now = new Date(v);
      if (Number.isNaN(a.now.getTime())) return null;
    } else if (k === "--mail-out") a.mailOut = resolve(v);
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
  const c = checkStore(a.store);
  if (!c.ok) {
    say(`断った：${c.reason}`);
    return 3;
  }
  const work = mkdtempSync(join(tmpdir(), "moyai-video-history-"));
  try {
    const { build } = await import("vite");
    await build({
      configFile: false,
      logLevel: "warn",
      root: REPO,
      ssr: { noExternal: true },
      build: {
        ssr: join(HERE, "history-core.ts"),
        outDir: work,
        emptyOutDir: true,
        target: "node22",
        minify: false,
        rolldownOptions: { output: { entryFileNames: "history-core.js" } },
      },
    });
    mkdirSync(c.path, { recursive: true });
    const core = await import(pathToFileURL(join(work, "history-core.js")).href);
    const r = await core.makeHistory({ repo: REPO, store: c.path, now: a.now, mailOut: a.mailOut });
    say(`作った：${c.path}`);
    for (const v of r.hotaru.versions) say(`  ほたる川 第 ${v.version} 版（令和 ${v.fiscalYear - 2018} 年度版）：${v.state === "approved" ? "署名・承認済み" : "承認待ち"}`);
    say(`  しらかば野 第 ${r.shirakaba.versions[0]} 版：ほたる川の第 ${r.shirakaba.derivedFrom.version} 版から派生。Skill「${r.skill.name}」を使う`);
    if (a.mailOut) say(`  承認待ちのメールの文：${a.mailOut}`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exitCode = await main();
