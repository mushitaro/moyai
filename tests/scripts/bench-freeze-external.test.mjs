// 新しいサンプルが別のリポジトリ（v4 は mushitaro/moyai-samples）にあるときの、凍結の測り（scripts/bench/freeze.mjs）の通し（mushitaro/moyai#111）。
// 偽の小さなサンプルのリポジトリ（一時の git。旧サンプルの施設を写す）と、このリポジトリの一時の clone で走らせる（本当の eval/bench/ は書き換えない）。
// いつも：check が通る・サンプルの側の commit していない変更・git の外のサンプル・凍結の記録がもうある、を断る。
// MOYAI_FREEZE_FULL=1 のときだけ（CI の pack-bench の仕事）：measure → freeze.json（サンプルの commit・道・鍵を除いた出どころ）→ 2 回目は断る →
// 凍結の記録の照らし（bench-freeze.test.ts）→ 資料の少ない施設の比べ（v4-ci.mjs）。サンプルの commit が替われば、照らしも比べも落ちる。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FREEZE = join(REPO, "scripts", "bench", "freeze.mjs");
const TAG = "reader-freeze-7";
const NAME = "waste-incineration-v4";
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hasTag = (() => {
  try {
    git(REPO, "rev-parse", "--verify", `refs/tags/${TAG}`);
    return true;
  } catch {
    return false;
  }
})();
const commitAll = (cwd, msg) => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", msg);
};
const run = (cwd, args, env = {}) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });

describe("凍結の測り：サンプルが別のリポジトリにあるとき", { skip: hasTag ? false : `タグ ${TAG} が無い（履歴の浅い clone）` }, () => {
  let work = "";
  let clone = "";
  let samples = "";
  let dir = "";
  before(() => {
    work = mkdtempSync(join(tmpdir(), "moyai-freeze-ext-"));
    clone = join(work, "moyai");
    git(work, "clone", "-q", "--shared", REPO, clone);
    symlinkSync(join(REPO, "node_modules"), join(clone, "node_modules"), "junction");
    samples = join(work, "moyai-samples");
    dir = join(samples, NAME);
    mkdirSync(dir, { recursive: true });
    // 小さい 2 施設：パックありの測りに 1 つ、初めて読む測り（年度で分けられる施設）に 1 つ
    for (const f of ["hinatano", "hoshinooka"]) cpSync(join(REPO, "samples", "waste-incineration", f), join(dir, f), { recursive: true });
    git(samples, "init", "-q");
    commitAll(samples, "samples");
    // 出どころの URL に鍵が入っていても、記録には書かない
    git(samples, "remote", "add", "origin", "https://someone:not-a-real-token@github.com/mushitaro/moyai-samples.git");
  });
  after(() => {
    if (work) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  });

  it("check：サンプルのリポジトリが commit 済みなら通り、何も書かない。出どころに鍵を出さない。別の書き方の道でも同じ", () => {
    // 別の書き方の道（symlink 越し。Windows の短い名前〔RUNNER~1〕と長い名前が混ざるのと同じく、git の道と字が違う）
    const via = join(work, "via");
    symlinkSync(samples, via, "junction");
    const r = run(clone, [FREEZE, "check", "--samples", join(via, NAME), "--tag", TAG]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /mushitaro\/moyai-samples\.git@[0-9a-f]{12}:waste-incineration-v4：確かめた/);
    assert.doesNotMatch(r.stderr, /not-a-real-token/);
    assert.equal(existsSync(join(clone, "eval", "bench", NAME)), false);
  });

  it("check：サンプルの側に commit していない変更がある・git の外のサンプル・凍結の記録がもうある、を断る", () => {
    writeFileSync(join(dir, "extra.txt"), "x");
    let r = run(clone, [FREEZE, "check", "--samples", dir, "--tag", TAG]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /commit していない変更/);
    rmSync(join(dir, "extra.txt"));
    const loose = join(work, "loose", NAME);
    mkdirSync(loose, { recursive: true });
    r = run(clone, [FREEZE, "check", "--samples", loose, "--tag", TAG]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /git のリポジトリの中に無い/);
    const frozen = join(clone, "eval", "bench", NAME, "frozen");
    mkdirSync(frozen, { recursive: true });
    writeFileSync(join(frozen, "freeze.json"), "{}");
    r = run(clone, [FREEZE, "check", "--samples", dir, "--tag", TAG]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /1 回だけ/);
    rmSync(join(clone, "eval", "bench", NAME), { recursive: true, force: true });
  });

  it("measure → 記録 → 照らし → 資料の少ない施設の比べ（MOYAI_FREEZE_FULL=1 のときだけ。1〜2 分）", { skip: process.env.MOYAI_FREEZE_FULL === "1" ? false : "MOYAI_FREEZE_FULL=1 のときだけ" }, () => {
    const head = git(samples, "rev-parse", "HEAD");
    let r = run(clone, [FREEZE, "measure", "--samples", dir, "--tag", TAG]);
    assert.equal(r.status, 0, r.stderr.slice(-2000));
    const f = JSON.parse(readFileSync(join(clone, "eval", "bench", NAME, "frozen", "freeze.json"), "utf8"));
    assert.equal(f.samples, NAME);
    assert.deepEqual(f.source, { repo: "https://github.com/mushitaro/moyai-samples.git", commit: head, path: NAME });
    assert.equal(f.tag, TAG);
    assert.equal(f.reader.src, git(REPO, "rev-parse", `${TAG}:src`));
    for (const sub of ["result.json", join("first-read", "result.json")]) assert.ok(existsSync(join(clone, "eval", "bench", NAME, sub)), sub);
    // 2 回目は断る
    r = run(clone, [FREEZE, "measure", "--samples", dir, "--tag", TAG]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /1 回だけ/);
    // 記録をコミットしてから、凍結の記録の照らしと、資料の少ない施設の比べ
    commitAll(clone, "freeze record");
    const vitest = [join(REPO, "node_modules", "vitest", "vitest.mjs"), "run", "tests/heldout/bench-freeze.test.ts"];
    cpSync(join(REPO, "tests", "heldout", "bench-freeze.test.ts"), join(clone, "tests", "heldout", "bench-freeze.test.ts"));
    for (const s of ["v4.mjs", "v4-ci.mjs", "compare.mjs"]) cpSync(join(REPO, "scripts", "bench", s), join(clone, "scripts", "bench", s));
    r = run(clone, vitest, { MOYAI_SAMPLES_ROOT: samples, MOYAI_SAMPLES_REQUIRED: "1" });
    assert.equal(r.status, 0, r.stdout.slice(-2000));
    r = run(clone, [join(clone, "scripts", "bench", "v4-ci.mjs"), "--samples-root", samples, "--count", "1"]);
    assert.equal(r.status, 0, r.stderr.slice(-2000));
    assert.match(r.stderr, /差なし/);
    // サンプルの commit が替われば、照らしも比べも落ちる
    writeFileSync(join(dir, "hinatano", "extra.txt"), "x");
    commitAll(samples, "changed");
    r = run(clone, vitest, { MOYAI_SAMPLES_ROOT: samples, MOYAI_SAMPLES_REQUIRED: "1" });
    assert.notEqual(r.status, 0);
    r = run(clone, [join(clone, "scripts", "bench", "v4-ci.mjs"), "--samples-root", samples]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /記録した commit でない/);
  });
});
