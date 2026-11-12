#!/usr/bin/env node
// 新しいサンプルの最初の測り（mushitaro/moyai#111・docs/scenarios.md の S-A の注）：読み手を凍結したタグの worktree で 1 回だけ測り、記録する。
// 見ていない様式（samples/heldout/README.md・tests/heldout/heldout.test.ts）と同じ形：凍結のタグ → サンプルを入れる → タグの worktree で測る → 記録。
//
// 使い方：
//   node scripts/bench/freeze.mjs check   --samples samples/waste-incineration-v3 --tag reader-freeze-7 [--pack waste-incineration]
//   node scripts/bench/freeze.mjs measure --samples samples/waste-incineration-v3 --tag reader-freeze-7 [--pack waste-incineration]
// check：タグがある・タグの木にサンプルが無い・まだ凍結の測りをしていない、を確かめるだけ（何も書かない）。
// measure：check のあと、タグを一時の worktree に取り出し、その中の pack-bench（Skillパックあり・--first-read）で、今のサンプルを測る。
//   書くのは eval/bench/<サンプルのフォルダの名前>/frozen/（freeze.json・result.json・README.md・first-read/）と、
//   同じ値を今の記録として eval/bench/<名前>/result.json・first-read/result.json（あとで読み手を直したら、こちらだけを測り直す）。
//   frozen/ は 1 回だけ：もうあれば止まる。測った読み手の src/・packs/ がタグと同じ木でなければ止まる。
// サンプルの中身は読まない（ハッシュを取るだけ）。AI も API も使わない。
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { bundleHash } from "../heldout/hash.mjs";

const args = process.argv.slice(2);
const cmd = args.shift();
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const fail = (msg) => {
  console.error(`freeze: ${msg}`);
  process.exit(1);
};
const samplesArg = take("--samples");
const tag = take("--tag");
const pack = take("--pack") ?? "waste-incineration";
if (!["check", "measure"].includes(cmd ?? "") || !samplesArg || !tag) {
  console.error("使い方：node scripts/bench/freeze.mjs check|measure --samples <フォルダ> --tag <reader-freeze-N> [--pack <パック>]");
  process.exit(2);
}
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (...a) => {
  try {
    git(...a);
    return true;
  } catch {
    return false;
  }
};

const repo = git("rev-parse", "--show-toplevel");
const samples = resolve(samplesArg);
const rel = relative(repo, samples).replace(/\\/g, "/");
const name = basename(samples);
const record = join(repo, "eval", "bench", name);
const frozen = join(record, "frozen");

if (!existsSync(samples)) fail(`サンプルの置き場所が無い：${rel}`);
if (!gitOk("rev-parse", "--verify", `refs/tags/${tag}`)) fail(`タグ ${tag} が無い（先に読み手を凍結してタグを打つ）`);
if (git("ls-tree", "-r", "--name-only", tag, "--", rel) !== "") fail(`タグ ${tag} の木にサンプル（${rel}）がある。凍結はサンプルを入れる前に打つ`);
if (!gitOk("cat-file", "-e", `${tag}:scripts/bench/pack-bench.mjs`) || !git("show", `${tag}:scripts/bench/pack-bench.mjs`).includes("--samples"))
  fail(`タグ ${tag} の pack-bench が --samples を持たない（--samples の入った main にタグを打つ）`);
if (existsSync(join(frozen, "freeze.json"))) fail(`凍結の測りはもうある（${relative(repo, frozen)}）。1 回だけ`);
const tree = { src: git("rev-parse", `${tag}:src`), packs: git("rev-parse", `${tag}:packs`) };
console.error(`freeze: タグ ${tag}（src ${tree.src.slice(0, 8)}・packs ${tree.packs.slice(0, 8)}）・サンプル ${rel}：確かめた`);
if (cmd === "check") process.exit(0);

const { bundle, files } = bundleHash(samples);
const wt = mkdtempSync(join(tmpdir(), "moyai-freeze-"));
try {
  git("worktree", "add", "--detach", wt, tag);
  symlinkSync(join(repo, "node_modules"), join(wt, "node_modules"), "junction");
  const out = mkdtempSync(join(tmpdir(), "moyai-freeze-out-"));
  const runs = [
    { label: "Skillパックあり", extra: [], dir: join(out, "pack") },
    { label: "初めて読む", extra: ["--first-read"], dir: join(out, "first-read") },
  ];
  for (const r of runs) {
    console.error(`freeze: 測る（${r.label}）`);
    const p = spawnSync(process.execPath, ["scripts/bench/pack-bench.mjs", pack, "--samples", samples, ...r.extra, "--out", r.dir], { cwd: wt, stdio: "inherit" });
    if (p.status !== 0) fail(`測れなかった（${r.label}）`);
    const res = JSON.parse(readFileSync(join(r.dir, "result.json"), "utf8"));
    if (res.reader?.src !== tree.src || res.reader?.packs !== tree.packs || res.reader?.dirty) fail(`測った読み手がタグと同じ木でない（${r.label}）`);
  }
  mkdirSync(frozen, { recursive: true });
  cpSync(join(out, "pack"), frozen, { recursive: true });
  cpSync(join(out, "first-read"), join(frozen, "first-read"), { recursive: true });
  const measuredAt = new Date().toISOString();
  writeFileSync(
    join(frozen, "freeze.json"),
    `${JSON.stringify({ schema: "moyai.bench.freeze/0", samples: rel, pack, tag, commit: git("rev-parse", `${tag}^{commit}`), reader: tree, bundle, files: files.length, measuredAt }, null, 1)}\n`,
    "utf8",
  );
  // 今の記録の始まりは凍結の値と同じ
  cpSync(join(out, "pack"), record, { recursive: true });
  cpSync(join(out, "first-read"), join(record, "first-read"), { recursive: true });
  rmSync(out, { recursive: true, force: true });
  console.error(`freeze: 書いた ${relative(repo, frozen)}（サンプルのハッシュ ${bundle.slice(0, 12)}・${files.length} ファイル）。frozen/ は書き直さない`);
} finally {
  if (gitOk("worktree", "remove", "--force", wt)) rmSync(wt, { recursive: true, force: true });
}
