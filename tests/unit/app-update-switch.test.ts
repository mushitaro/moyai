// 自動の更新が、本当に次の起動で新しい版に替わるか（運営者の指摘 2026-11-18：自動の更新が 5 日間切り替わらず、古い版のままだった）。
// 部品ごとの試験（app-update.test.ts）は、用意（next を置く）と起動の台本（next を current にする）を別々に見ている。ここでは、利用者の PC と同じ順に 1 本でつなぐ：
//   setup が版 1 を入れる → 起動の台本で版 1 が起きる → 取ってくる先に版 2 → 自動の確かめが裏で用意する（取得 → npm ci → build → 自己点検）
//   → 次の起動（起動の台本をもう 1 回起こす）で、版 2 の dist/cli.js が起きる → 版 3 で、前の版を 1 つだけ残す → 作れない版 4 では版 3 のまま。
// 取ってくる先は一時の git のリポジトリ（試験だけの sourceForTest）。git と起動の台本と版の cli.js は本物（node で起こす）、npm だけを差し替える
// （npm run build が、その版のコミットを言う小さな cli.js を置く）。本物の npm ci と build は、CI の install の仕事（tests/acceptance）が通す。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoCheckOnce, defaultRun, installFromClone, isReady, lastPrepare, readPointer, versionDir, type Run } from "../../src/bridge/app-update";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** 版の cli.js（CommonJS。版のフォルダに package.json は無い）：--version と update --digest には自己点検の答え、ほかは「版 引数」を out に書く */
const cliSource = (commit: string, out: string) =>
  [
    `const a = process.argv.slice(2);`,
    `if (a[0] === "--version") process.stderr.write("MOYAI · build 2026-11-18 · ${commit.slice(0, 7)}\\n");`,
    `else if (a[0] === "update" && a[1] === "--digest") process.stdout.write("${"a".repeat(64)}\\n");`,
    `else require("fs").writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(commit)} + " " + a.join(" "));`,
  ].join("\n");

/** npm だけを差し替える：npm ci は何もせず、npm run build がその版の cli.js を置く。git と node は本物 */
function runner(out: string, failBuildOf?: () => string | null) {
  const calls: string[] = [];
  const run: Run = async (cmd, args, cwd) => {
    if (cmd !== "npm") return defaultRun(cmd, args, cwd);
    calls.push(`npm ${args.join(" ")}`);
    if (args[0] === "run" && args[1] === "build") {
      const head = git(cwd, "rev-parse", "HEAD");
      if (failBuildOf?.() === head) throw new Error("build failed");
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, "dist", "cli.js"), cliSource(head, out));
    }
    return "";
  };
  return { run, calls };
}

function world() {
  const d = mkdtempSync(join(tmpdir(), "moyai-update-switch-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  const origin = join(d, "origin.git");
  git(d, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const dev = join(d, "dev");
  git(d, "clone", "--quiet", origin, dev);
  git(dev, "checkout", "--quiet", "-B", "main");
  const push = (text: string) => {
    writeFileSync(join(dev, "a.txt"), text);
    git(dev, "add", "a.txt");
    git(dev, "commit", "--quiet", "-m", `版 ${text.trim()}`);
    git(dev, "push", "--quiet", "origin", "main");
    return git(dev, "rev-parse", "HEAD");
  };
  const c1 = push("1\n");
  return { d, origin, dev, root: join(d, "app"), out: join(d, "started.txt"), push, c1 };
}

/** Claude Desktop が中継を起こすのと同じ：node <root>/launch.cjs mcp。起きた版を返す */
function launch(root: string, out: string): string {
  rmSync(out, { force: true });
  execFileSync(process.execPath, [join(root, "launch.cjs"), "mcp"], { stdio: "ignore", timeout: 30_000 });
  const [commit, ...args] = readFileSync(out, "utf8").split(" ");
  expect(args).toEqual(["mcp"]);
  return commit!;
}

/** 自動の確かめを 1 回まわし、用意が終わるのを待つ。知らされた版を返す */
async function autoUpdate(root: string, running: string, run: Run, origin: string): Promise<{ state: string; told: string | null }> {
  let told: string | null = null;
  const before = JSON.stringify(lastPrepare(root));
  const state = await autoCheckOnce({ root, running, run, sourceForTest: origin }, () => true, (latest) => (told = latest));
  // 用意が終わる（last-prepare.json が書き替わる）まで待つ
  if (state === "started") {
    // 混んだ Windows の CI でも待てるように長めに。終わらなければ、その旨で落とす（あとの確かめで紛らわしく落ちない）
    for (let i = 0; i < 3000 && JSON.stringify(lastPrepare(root)) === before; i++) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(lastPrepare(root)), "用意が 60 秒で終わらない").not.toBe(before);
  }
  await new Promise((r) => setTimeout(r, 0));
  return { state, told };
}

describe("自動の更新：用意した版に、次の起動で本当に替わる（1 本の道）", () => {
  it("版 1 を入れる → 版 2 を自動で用意 → 次の起動で版 2 が起きる → 版 3 では前の版を 1 つだけ残す", async () => {
    const w = world();
    const r = runner(w.out);
    // setup が入れる（この clone の今のコミット。clone は変えない）
    expect(await installFromClone({ root: w.root, run: r.run, sourceForTest: w.origin }, w.dev)).toEqual({ ok: true, commit: w.c1 });
    expect(existsSync(join(w.root, "launch.cjs"))).toBe(true);
    expect(launch(w.root, w.out)).toBe(w.c1);

    // 取ってくる先に版 2。動いている版 1 は止めない（用意は別のフォルダ）
    const c2 = w.push("2\n");
    const a = await autoUpdate(w.root, w.c1, r.run, w.origin);
    expect(a).toEqual({ state: "started", told: c2 });
    expect(r.calls.filter((c) => c === "npm ci --no-audit --no-fund")).toHaveLength(2);
    expect(isReady(w.root, c2)).toBe(true);
    expect(readPointer(w.root)).toEqual({ current: w.c1, previous: null, next: c2 });
    // 次の起動で版 2 が起きる
    expect(launch(w.root, w.out)).toBe(c2);
    expect(readPointer(w.root)).toEqual({ current: c2, previous: w.c1, next: null });
    // もう 1 度起こしても版 2（切り替えは 1 回だけ）
    expect(launch(w.root, w.out)).toBe(c2);
    // 版 2 で動いているあいだは「最新」と答え、何も作らない
    expect((await autoUpdate(w.root, c2, r.run, w.origin)).state).toBe("up_to_date");

    // 版 3：前の版（版 2）を 1 つだけ残し、版 1 は消える
    const c3 = w.push("3\n");
    expect(await autoUpdate(w.root, c2, r.run, w.origin)).toEqual({ state: "started", told: c3 });
    expect(launch(w.root, w.out)).toBe(c3);
    expect(readPointer(w.root)).toEqual({ current: c3, previous: c2, next: null });
    expect(readdirSync(join(w.root, "versions")).sort()).toEqual([c2, c3].sort());
    expect(existsSync(versionDir(w.root, w.c1))).toBe(false);
  });

  it("作れない版（build で落ちる）は用意できず、次の起動も今の版のまま。直った次の版には替わる", async () => {
    const w = world();
    let broken: string | null = null;
    const r = runner(w.out, () => broken);
    expect((await installFromClone({ root: w.root, run: r.run, sourceForTest: w.origin }, w.dev)).ok).toBe(true);
    const c2 = w.push("2\n");
    broken = c2;
    const a = await autoUpdate(w.root, w.c1, r.run, w.origin);
    expect(a).toEqual({ state: "started", told: null });
    expect(lastPrepare(w.root)).toMatchObject({ state: "failed", step: "npm run build" });
    expect(readPointer(w.root).next).toBeNull();
    expect(readdirSync(w.root).filter((f) => f.startsWith("staging-"))).toEqual([]);
    expect(launch(w.root, w.out)).toBe(w.c1);
    // 直った版 3 には替わる
    const c3 = w.push("3\n");
    expect(await autoUpdate(w.root, w.c1, r.run, w.origin)).toEqual({ state: "started", told: c3 });
    expect(launch(w.root, w.out)).toBe(c3);
  });

  it("自己点検で版を言えない版（ビルドの中の版が違う）には替えない", async () => {
    const w = world();
    const r = runner(w.out);
    expect((await installFromClone({ root: w.root, run: r.run, sourceForTest: w.origin }, w.dev)).ok).toBe(true);
    const c2 = w.push("2\n");
    // build が、前の版のコミットを言う cli.js を置いてしまう（古いビルドが残ったなど）
    const stale: Run = async (cmd, args, cwd) => {
      if (cmd === "npm" && args[0] === "run") {
        mkdirSync(join(cwd, "dist"), { recursive: true });
        writeFileSync(join(cwd, "dist", "cli.js"), cliSource(w.c1, w.out));
        return "";
      }
      return r.run(cmd, args, cwd);
    };
    expect(await autoUpdate(w.root, w.c1, stale, w.origin)).toEqual({ state: "started", told: null });
    expect(lastPrepare(w.root)).toMatchObject({ state: "failed", step: "selftest" });
    expect(isReady(w.root, c2)).toBe(false);
    expect(launch(w.root, w.out)).toBe(w.c1);
  });
});
