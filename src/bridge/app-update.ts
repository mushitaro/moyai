// 入っている MOYAI の更新（mushitaro/moyai#65。#43 の moyai update の続き）。
// - 入れる場所は開発の clone と分ける：<appRoot>/versions/<コミット>/（版ごとのフォルダ）。Claude Desktop の設定は、
//   版のフォルダの外の小さな起動の台本（<appRoot>/launch.cjs）を指す。開発の clone（setup --dev）には触れない。
// - 新しい版は別のフォルダ（<appRoot>/staging-…）で 取得 → npm ci → npm run build → 自己点検。通ったら「用意できた」の印を置き、
//   次の起動で切り替える（current.json の next）。失敗したら捨てて、前の版のまま。前の版を 1 つ残す。
// - 動いているものは止めない。知らせは状態の帯のビルドの印を朱にするだけ（bridge.welcome の next。説明の文は足さない）。
// - 取ってくる先は mushitaro/moyai の main で固定（引数で変えられない）。ローカルの変更がある・fast-forward でない、は断る。
// - 自動の確かめ（起動のとき・6 時間ごと）はまだ作らない（運営者に聞いている）。確かめる関数（checkUpdate）と用意する関数（prepareUpdate）を分けてある。
// 標準出力は使わない。行の値・鍵は扱わない（扱うのはコミットの印と題だけ）。
import { execFile, type ExecFileOptions } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/** 取ってくる先（固定。ツールの引数・環境で変えない） */
export const UPDATE_SOURCE = "https://github.com/mushitaro/moyai.git";
export const UPDATE_BRANCH = "main";
/** 試験だけが置き場所を変える（取ってくる先は変えられない） */
export const APP_DIR_ENV = "MOYAI_APP_DIR";

const COMMIT = /^[0-9a-f]{40}$/;
const READY = ".moyai-ready.json";
const POINTER = "current.json";
const LOCK = "prepare.lock";
const LAST = "last-prepare.json";
/** 用意の途中で止まったとみなす時間（固まった lock を残さない） */
const LOCK_STALE_MS = 60 * 60_000;

/** 入れる場所（版ごとのフォルダの親） */
export function appRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const fromEnv = env[APP_DIR_ENV];
  if (fromEnv) return fromEnv;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "MOYAI", "app");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "MOYAI", "app");
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "moyai-app");
}

export interface Pointer {
  current: string | null;
  previous: string | null;
  /** 用意できて、次の起動で切り替える版 */
  next: string | null;
}

export function readPointer(root: string): Pointer {
  try {
    const v = JSON.parse(readFileSync(join(root, POINTER), "utf8")) as Partial<Pointer>;
    const ok = (x: unknown) => (typeof x === "string" && COMMIT.test(x) ? x : null);
    return { current: ok(v.current), previous: ok(v.previous), next: ok(v.next) };
  } catch {
    return { current: null, previous: null, next: null };
  }
}

function writePointer(root: string, p: Pointer): void {
  mkdirSync(root, { recursive: true });
  const tmp = join(root, `${POINTER}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`);
  renameSync(tmp, join(root, POINTER));
}

export const versionDir = (root: string, commit: string): string => join(root, "versions", commit);

/** その版が用意できているか（自己点検が通った印がある） */
export function isReady(root: string, commit: string): boolean {
  try {
    const v = JSON.parse(readFileSync(join(versionDir(root, commit), READY), "utf8")) as { commit?: string };
    return v.commit === commit && existsSync(join(versionDir(root, commit), "dist", "cli.js"));
  } catch {
    return false;
  }
}

/** 今動いている cli.js が入っている版のフォルダの中なら、その版のコミット。開発の clone なら null */
export function installedCommitOf(root: string, cliPath: string): string | null {
  const rel = relative(join(resolve(root), "versions"), resolve(cliPath));
  if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") return null;
  const first = rel.split(/[\\/]/)[0] ?? "";
  return COMMIT.test(first) ? first : null;
}

/** 走らせる手（試験は git を本物、npm と node を差し替える）。失敗したら投げる。橋渡しの中で走るので、待つあいだ止めない（非同期） */
export type Run = (cmd: "git" | "npm" | "node", args: readonly string[], cwd: string) => Promise<string>;

export const defaultRun: Run = (cmd, args, cwd) =>
  new Promise((done, fail) => {
    const o: ExecFileOptions = { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000 };
    const [file, extra] =
      cmd === "node" ? [process.execPath, {}] : cmd === "npm" && process.platform === "win32" ? ["npm.cmd", { shell: true }] : [cmd, {}];
    // moyai の人への知らせ（--version など）は標準エラーに出るので、両方を返す
    execFile(file, [...args], { ...o, ...extra }, (err, stdout, stderr) => (err ? fail(err) : done(`${String(stdout)}${String(stderr)}`)));
  });

export interface UpdateEnv {
  root: string;
  /** 今動いている版（入っている版のコミット。開発の clone なら null） */
  running: string | null;
  run?: Run;
  /** 試験だけ：取ってくる先を一時の git のリポジトリにする（ツールの引数からは渡せない） */
  sourceForTest?: string;
  now?: () => number;
}

export type CheckResult =
  | { state: "dev_clone" }
  | { state: "fetch_failed" }
  | { state: "up_to_date"; current: string }
  | { state: "available"; current: string; latest: string; titles: string[]; commits: number; ready: boolean }
  | { state: "not_fast_forward"; current: string; latest: string };

/** 取ってくる先を写した裸の覚え（<root>/cache.git）を最新にする */
async function fetchCache(e: UpdateEnv): Promise<string> {
  const run = e.run ?? defaultRun;
  const src = e.sourceForTest ?? UPDATE_SOURCE;
  const cache = join(e.root, "cache.git");
  mkdirSync(e.root, { recursive: true });
  if (!existsSync(join(cache, "HEAD"))) await run("git", ["clone", "--quiet", "--bare", "--single-branch", "--branch", UPDATE_BRANCH, src, cache], e.root);
  else await run("git", ["fetch", "--quiet", src, `+refs/heads/${UPDATE_BRANCH}:refs/heads/${UPDATE_BRANCH}`], cache);
  return cache;
}

/** 新しい版があるかを読む（入っている MOYAI のときだけ。中身は送らない。読むのはコミットと題だけ） */
export async function checkUpdate(e: UpdateEnv): Promise<CheckResult> {
  if (!e.running) return { state: "dev_clone" };
  const run = e.run ?? defaultRun;
  let cache: string;
  try {
    cache = await fetchCache(e);
  } catch {
    return { state: "fetch_failed" };
  }
  const latest = (await run("git", ["rev-parse", `refs/heads/${UPDATE_BRANCH}`], cache)).trim();
  if (latest === e.running) return { state: "up_to_date", current: e.running };
  try {
    await run("git", ["merge-base", "--is-ancestor", e.running, latest], cache);
  } catch {
    return { state: "not_fast_forward", current: e.running, latest };
  }
  const titles = (await run("git", ["log", "--format=%s", "-n", "10", `${e.running}..${latest}`], cache))
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => ([...s].length > 120 ? `${[...s].slice(0, 119).join("")}…` : s));
  const commits = Number((await run("git", ["rev-list", "--count", `${e.running}..${latest}`], cache)).trim()) || titles.length;
  return { state: "available", current: e.running, latest, titles, commits, ready: isReady(e.root, latest) };
}

export type PrepareResult =
  | { state: "dev_clone" | "fetch_failed" | "local_changes" | "busy" }
  | { state: "up_to_date"; current: string }
  | { state: "not_fast_forward"; current: string; latest: string }
  | { state: "ready"; current: string; latest: string }
  | { state: "failed"; step: string };

/** 動いている版のフォルダに、追跡しているファイルの変更があるか */
async function hasLocalChanges(e: UpdateEnv, commit: string): Promise<boolean> {
  const run = e.run ?? defaultRun;
  try {
    return (await run("git", ["status", "--porcelain", "--untracked-files=no"], versionDir(e.root, commit))).trim() !== "";
  } catch {
    // git の clone でない版のフォルダは、変更を確かめられないので変更ありとみなす（推し量って進めない）
    return true;
  }
}

/** 版のフォルダを作る：取得 → npm ci → npm run build → 自己点検。通れば印を置いて staging を versions/<commit> に移す。失敗したら捨てる */
export async function buildVersion(e: UpdateEnv, from: string, commit: string): Promise<{ ok: true } | { ok: false; step: string }> {
  const run = e.run ?? defaultRun;
  const staging = join(e.root, `staging-${commit.slice(0, 12)}-${process.pid}`);
  mkdirSync(e.root, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  const steps: [string, () => Promise<unknown>][] = [
    ["git clone", () => run("git", ["clone", "--quiet", "--no-checkout", from, staging], e.root)],
    ["git checkout", () => run("git", ["checkout", "--quiet", "--detach", commit], staging)],
    ["git remote", () => run("git", ["remote", "set-url", "origin", e.sourceForTest ?? UPDATE_SOURCE], staging)],
    ["npm ci", () => run("npm", ["ci", "--no-audit", "--no-fund"], staging)],
    ["npm run build", () => run("npm", ["run", "build"], staging)],
    [
      "selftest",
      async () => {
        // 自己点検：新しい版の cli.js が起き、自分の版（コミット）とツールの定義の指紋を言える
        const out = (await run("node", [join(staging, "dist", "cli.js"), "--version"], staging)) + (await run("node", [join(staging, "dist", "cli.js"), "update", "--digest"], staging));
        if (!out.includes(commit.slice(0, 7)) || !/[0-9a-f]{64}/.test(out)) throw new Error("selftest");
      },
    ],
  ];
  let failed: string | null = null;
  for (const [name, f] of steps) {
    try {
      await f();
    } catch {
      failed = name;
      break;
    }
  }
  if (failed) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, step: failed };
  }
  writeFileSync(join(staging, READY), `${JSON.stringify({ commit, builtAt: new Date((e.now ?? Date.now)()).toISOString() })}\n`);
  mkdirSync(join(e.root, "versions"), { recursive: true });
  rmSync(versionDir(e.root, commit), { recursive: true, force: true });
  renameSync(staging, versionDir(e.root, commit));
  return { ok: true };
}

export type BeginPrepare = { result: PrepareResult } | { started: { current: string; latest: string }; done: Promise<PrepareResult> };

/**
 * 新しい版を用意し始める（動いている版は止めない。切り替えは次の起動）。同じ時に 2 つは走らせない。
 * 断る（開発の clone・ローカルの変更・fast-forward でない・取れない・走っている・最新）は result で返し、
 * 作り始めたら started と、作り終わり（done）を返す。done の結果は last-prepare.json にも書く
 */
export async function beginPrepare(e: UpdateEnv): Promise<BeginPrepare> {
  if (!e.running) return { result: { state: "dev_clone" } };
  const running = e.running;
  const now = (e.now ?? Date.now)();
  const lock = join(e.root, LOCK);
  try {
    mkdirSync(e.root, { recursive: true });
    if (existsSync(lock) && now - statSync(lock).mtimeMs < LOCK_STALE_MS) return { result: { state: "busy" } };
    writeFileSync(lock, String(process.pid));
    // lock を持ったので、前に途中で止まった用意の残り（staging-…）を消す
    for (const d of readdirSync(e.root)) if (d.startsWith("staging-")) rmSync(join(e.root, d), { recursive: true, force: true });
  } catch {
    return { result: { state: "busy" } };
  }
  const finish = (r: PrepareResult): PrepareResult => {
    rmSync(lock, { force: true });
    try {
      writeFileSync(join(e.root, LAST), `${JSON.stringify({ ...r, at: new Date((e.now ?? Date.now)()).toISOString() })}\n`);
    } catch {
      /* 書けなくても結果は返す */
    }
    return r;
  };
  try {
    if (await hasLocalChanges(e, running)) return { result: finish({ state: "local_changes" }) };
    const c = await checkUpdate(e);
    if (c.state !== "available") return { result: finish(c.state === "dev_clone" || c.state === "fetch_failed" ? { state: c.state } : c) };
    const latest = c.latest;
    const done = (async (): Promise<PrepareResult> => {
      try {
        if (!isReady(e.root, latest)) {
          const b = await buildVersion(e, join(e.root, "cache.git"), latest);
          if (!b.ok) return finish({ state: "failed", step: b.step });
        }
        const p = readPointer(e.root);
        writePointer(e.root, { ...p, current: p.current ?? running, next: latest });
        return finish({ state: "ready", current: running, latest });
      } catch {
        return finish({ state: "failed", step: "write" });
      }
    })();
    return { started: { current: running, latest }, done };
  } catch {
    return { result: finish({ state: "failed", step: "check" }) };
  }
}

/** 用意して、作り終わるまで待つ（試験と moyai のコマンドから） */
export async function prepareUpdate(e: UpdateEnv): Promise<PrepareResult> {
  const b = await beginPrepare(e);
  return "result" in b ? b.result : b.done;
}

/** 最後の用意の結果（無ければ null） */
export function lastPrepare(root: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(root, LAST), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 用意が走っているか（lock がある・新しい） */
export function preparing(root: string, now = Date.now()): boolean {
  try {
    return now - statSync(join(root, LOCK)).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * 起動のときの切り替え（起動の台本 LAUNCHER_SOURCE と同じ決まり）：用意できた next があれば current に、
 * 前の current を previous に。current と previous のほかの版は消す。起動する版を返す
 */
export function promote(root: string): string | null {
  const p = readPointer(root);
  let next: Pointer = p;
  if (p.next && isReady(root, p.next) && p.next !== p.current) next = { current: p.next, previous: p.current, next: null };
  else if (p.next) next = { ...p, next: null };
  if (next.current && !isReady(root, next.current)) {
    // 今の版が壊れていたら、前の版で起こす（壊れた版に切り替えない）
    if (next.previous && isReady(root, next.previous)) next = { current: next.previous, previous: null, next: null };
  }
  if (JSON.stringify(next) !== JSON.stringify(p)) writePointer(root, next);
  const keep = new Set([next.current, next.previous].filter((x): x is string => !!x));
  const vdir = join(root, "versions");
  if (existsSync(vdir)) for (const d of readdirSync(vdir)) if (!keep.has(d)) rmSync(join(vdir, d), { recursive: true, force: true });
  return next.current;
}

/**
 * 起動の台本（<root>/launch.cjs）の中身。依存を持たない。promote と同じ決まりで版を選び、その版の dist/cli.js を同じ引数で起こす。
 * 標準入出力はそのまま渡す（MCP の中継）。版が無ければ、標準エラーに 1 行を出して止まる
 */
export const LAUNCHER_SOURCE = `// MOYAI の起動の台本（moyai setup が置く。mushitaro/moyai#65）。用意できた版を選び、その版の dist/cli.js を起こす。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const root = __dirname;
const C = /^[0-9a-f]{40}$/;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const ready = (c) => { const v = c && readJson(path.join(root, "versions", c, ${JSON.stringify(READY)})); return !!v && v.commit === c && fs.existsSync(path.join(root, "versions", c, "dist", "cli.js")); };
const p0 = readJson(path.join(root, ${JSON.stringify(POINTER)})) || {};
const ok = (x) => (typeof x === "string" && C.test(x) ? x : null);
let p = { current: ok(p0.current), previous: ok(p0.previous), next: ok(p0.next) };
if (p.next && ready(p.next) && p.next !== p.current) p = { current: p.next, previous: p.current, next: null };
else if (p.next) p = { ...p, next: null };
if (p.current && !ready(p.current) && p.previous && ready(p.previous)) p = { current: p.previous, previous: null, next: null };
if (JSON.stringify(p) !== JSON.stringify({ current: ok(p0.current), previous: ok(p0.previous), next: ok(p0.next) })) {
  const tmp = path.join(root, ${JSON.stringify(POINTER)} + "." + process.pid + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2) + "\\n");
  fs.renameSync(tmp, path.join(root, ${JSON.stringify(POINTER)}));
}
if (!p.current || !ready(p.current)) { process.stderr.write("MOYAI：起動できる版がありません。moyai setup で入れ直してください。\\n"); process.exit(1); }
// 前の版を 1 つ残し、ほかの版を消す（動いている前の版の橋渡しは previous にいるので消さない。消せなければ次の起動で）
try { for (const d of fs.readdirSync(path.join(root, "versions"))) if (d !== p.current && d !== p.previous) fs.rmSync(path.join(root, "versions", d), { recursive: true, force: true }); } catch {}
const child = spawn(process.execPath, [path.join(root, "versions", p.current, "dist", "cli.js"), ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
child.on("exit", (code, signal) => process.exit(code === null ? (signal ? 1 : 0) : code));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
`;

/** 起動の台本を置く（版のフォルダの外） */
export function writeLauncher(root: string): string {
  mkdirSync(root, { recursive: true });
  const f = join(root, "launch.cjs");
  writeFileSync(f, LAUNCHER_SOURCE);
  return f;
}

/** 開発の clone から最初の版を入れる（setup が使う）。clone の HEAD を版にする。手元に変更があれば入れない */
export async function installFromClone(e: Omit<UpdateEnv, "running">, clone: string): Promise<{ ok: true; commit: string } | { ok: false; step: string }> {
  const run = e.run ?? defaultRun;
  let commit: string;
  try {
    commit = (await run("git", ["rev-parse", "HEAD"], clone)).trim();
    if ((await run("git", ["status", "--porcelain", "--untracked-files=no"], clone)).trim() !== "") return { ok: false, step: "local_changes" };
  } catch {
    return { ok: false, step: "not_repo" };
  }
  if (!isReady(e.root, commit)) {
    const b = await buildVersion({ ...e, running: null }, clone, commit);
    if (!b.ok) return b;
  }
  const p = readPointer(e.root);
  writePointer(e.root, { current: commit, previous: p.current && p.current !== commit ? p.current : p.previous, next: null });
  writeLauncher(e.root);
  return { ok: true, commit };
}
