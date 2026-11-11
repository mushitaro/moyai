// 入っている MOYAI の更新（mushitaro/moyai#65）：版ごとのフォルダ・別のフォルダで用意・次の起動で切り替え・前の版を 1 つ残す・断る。
// 一時の git のリポジトリを取ってくる先にする（試験だけの sourceForTest。ツールの引数からは変えられない）。git は本物、npm と node は差し替える。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_DIR_ENV,
  LAUNCHER_SOURCE,
  UPDATE_SOURCE,
  appRoot,
  beginPrepare,
  checkUpdate,
  defaultRun,
  installFromClone,
  installedCommitOf,
  isReady,
  lastPrepare,
  prepareUpdate,
  promote,
  readPointer,
  versionDir,
  writeLauncher,
  type Run,
} from "../../src/bridge/app-update";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { TOOLS } from "../../src/shared/tools";

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

/** 取ってくる先（裸）と、それに足す人の clone と、版のフォルダの親。最初の版は入っている（versions/<c1>） */
function world() {
  const d = mkdtempSync(join(tmpdir(), "moyai-app-update-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  const origin = join(d, "origin.git");
  git(d, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const dev = join(d, "dev");
  git(d, "clone", "--quiet", origin, dev);
  git(dev, "checkout", "--quiet", "-B", "main");
  writeFileSync(join(dev, "a.txt"), "1\n");
  git(dev, "add", "a.txt");
  git(dev, "commit", "--quiet", "-m", "最初");
  git(dev, "push", "--quiet", "origin", "main");
  const c1 = git(dev, "rev-parse", "HEAD");
  const root = join(d, "app");
  const push = (text: string, title = text.trim()) => {
    writeFileSync(join(dev, "a.txt"), text);
    git(dev, "commit", "--quiet", "-am", title);
    git(dev, "push", "--quiet", "origin", "main");
    return git(dev, "rev-parse", "HEAD");
  };
  return { d, origin, dev, root, c1, push };
}

/** git は本物、npm は「作った」ことにして dist/cli.js を置き、node は版と指紋を言う。呼んだ順を数える */
function runner(o: { failAt?: string; selftestCommit?: string } = {}) {
  const calls: string[] = [];
  const run: Run = async (cmd, args, cwd) => {
    if (cmd === "git") return defaultRun(cmd, args, cwd);
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(cmd === "node" ? `node ${args.slice(1).join(" ")}` : line);
    if (o.failAt && line.includes(o.failAt)) throw new Error(`${o.failAt} failed`);
    if (cmd === "npm" && args[0] === "run") {
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, "dist", "cli.js"), "// built\n");
    }
    if (cmd === "node") {
      const head = (o.selftestCommit ?? git(cwd, "rev-parse", "HEAD")).slice(0, 7);
      return args.includes("--version") ? `MOYAI · build 2026-11-11 10:00 JST · ${head}\n` : `${"f".repeat(64)}\n`;
    }
    return "";
  };
  return { run, calls };
}

/** 入っている版を置く（setup が入れたのと同じ形：取ってくる先の clone・印・dist/cli.js） */
async function installed(w: ReturnType<typeof world>) {
  const r = await installFromClone({ root: w.root, run: runner().run, sourceForTest: w.origin }, w.dev);
  expect(r).toEqual({ ok: true, commit: w.c1 });
  return { root: w.root, running: w.c1, sourceForTest: w.origin };
}

describe("置き場所と、動いている版の見分け", () => {
  it("Windows は %LOCALAPPDATA%\\MOYAI\\app。試験だけが置き場所を変えられる", () => {
    expect(appRoot({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32")).toBe(join("C:\\Users\\a\\AppData\\Local", "MOYAI", "app"));
    expect(appRoot({ [APP_DIR_ENV]: "/tmp/x" }, "win32")).toBe("/tmp/x");
    expect(UPDATE_SOURCE).toBe("https://github.com/mushitaro/moyai.git");
  });
  it("cli.js が versions/<コミット>/ の中なら、その版。開発の clone・外の道なら null", () => {
    const root = "/home/a/app";
    const c = "0123456789abcdef0123456789abcdef01234567";
    expect(installedCommitOf(root, `${root}/versions/${c}/dist/cli.js`)).toBe(c);
    expect(installedCommitOf(root, "/home/a/moyai/dist/cli.js")).toBeNull();
    expect(installedCommitOf(root, `${root}/versions/../x/dist/cli.js`)).toBeNull();
    expect(installedCommitOf(root, `${root}/versions/not-a-commit/dist/cli.js`)).toBeNull();
  });
});

describe("check：新しい版があるかを読む", () => {
  it("最新・新しい版あり（題と数）・開発の clone・取れない", async () => {
    const w = world();
    const e = await installed(w);
    expect(await checkUpdate({ ...e, run: runner().run })).toEqual({ state: "up_to_date", current: w.c1 });
    w.push("2\n", "二つめ");
    const c3 = w.push("3\n", "三つめ");
    const c = await checkUpdate({ ...e, run: runner().run });
    expect(c).toEqual({ state: "available", current: w.c1, latest: c3, titles: ["三つめ", "二つめ"], commits: 2, ready: false });
    expect(await checkUpdate({ ...e, running: null })).toEqual({ state: "dev_clone" });
    expect(await checkUpdate({ ...e, root: join(w.d, "app2"), sourceForTest: join(w.d, "none.git") })).toEqual({ state: "fetch_failed" });
  });
});

describe("prepare：別のフォルダで用意し、次の起動で切り替える", () => {
  it("取得 → npm ci → build → 自己点検。通れば versions/<新しい版> と next。動いている版は変えない", async () => {
    const w = world();
    const e = await installed(w);
    const c2 = w.push("2\n");
    const r = runner();
    const out = await prepareUpdate({ ...e, run: r.run });
    expect(out).toEqual({ state: "ready", current: w.c1, latest: c2 });
    expect(r.calls).toEqual(["npm ci --no-audit --no-fund", "npm run build", "node --version", "node update --digest"]);
    expect(isReady(w.root, c2)).toBe(true);
    expect(isReady(w.root, w.c1)).toBe(true);
    expect(readPointer(w.root)).toEqual({ current: w.c1, previous: null, next: c2 });
    // 新しい版の origin は、固定の取ってくる先（試験では一時のリポジトリ）
    expect(git(versionDir(w.root, c2), "remote", "get-url", "origin")).toBe(w.origin);
    expect(git(versionDir(w.root, c2), "rev-parse", "HEAD")).toBe(c2);
    expect(readdirSync(w.root).filter((x) => x.startsWith("staging-"))).toEqual([]);
    expect(lastPrepare(w.root)).toMatchObject({ state: "ready", latest: c2 });
    // もう一度は、用意できているので作り直さない
    const again = runner();
    expect(await prepareUpdate({ ...e, run: again.run })).toMatchObject({ state: "ready", latest: c2 });
    expect(again.calls).toEqual([]);
  });

  it("失敗したら捨てて、前の版のまま（versions も next も変えない。staging を残さない）", async () => {
    for (const failAt of ["npm ci", "run build", "--version"]) {
      const w = world();
      const e = await installed(w);
      const c2 = w.push("2\n");
      const out = await prepareUpdate({ ...e, run: runner({ failAt }).run });
      expect(out.state).toBe("failed");
      expect(existsSync(versionDir(w.root, c2))).toBe(false);
      expect(readPointer(w.root)).toEqual({ current: w.c1, previous: null, next: null });
      expect(readdirSync(w.root).filter((x) => x.startsWith("staging-"))).toEqual([]);
      expect(lastPrepare(w.root)).toMatchObject({ state: "failed" });
    }
    // 自己点検で、違う版を名乗るビルドも捨てる
    const w = world();
    const e = await installed(w);
    w.push("2\n");
    expect(await prepareUpdate({ ...e, run: runner({ selftestCommit: "0".repeat(40) }).run })).toEqual({ state: "failed", step: "selftest" });
  });
});

describe("prepare：断る", () => {
  it("今の版のフォルダにローカルの変更があれば断り、何も取らない・作らない", async () => {
    const w = world();
    const e = await installed(w);
    const c2 = w.push("2\n");
    writeFileSync(join(versionDir(w.root, w.c1), "a.txt"), "手元の変更\n");
    const r = runner();
    expect(await prepareUpdate({ ...e, run: r.run })).toEqual({ state: "local_changes" });
    expect(r.calls).toEqual([]);
    expect(existsSync(versionDir(w.root, c2))).toBe(false);
    expect(readPointer(w.root).next).toBeNull();
  });

  it("main が今の版の先にない（fast-forward でない）なら断る", async () => {
    const w = world();
    const e = await installed(w);
    // 取ってくる先の main を、今の版を含まない歴史に置き換える
    git(w.dev, "checkout", "--quiet", "--orphan", "other");
    writeFileSync(join(w.dev, "a.txt"), "別の歴史\n");
    git(w.dev, "add", "a.txt");
    git(w.dev, "commit", "--quiet", "-m", "別");
    git(w.dev, "push", "--quiet", "--force", "origin", "other:main");
    const latest = git(w.dev, "rev-parse", "HEAD");
    const r = runner();
    expect(await prepareUpdate({ ...e, run: r.run })).toEqual({ state: "not_fast_forward", current: w.c1, latest });
    expect(await checkUpdate({ ...e, run: r.run })).toEqual({ state: "not_fast_forward", current: w.c1, latest });
    expect(r.calls).toEqual([]);
    expect(existsSync(versionDir(w.root, latest))).toBe(false);
  });

  it("開発の clone で動いているなら断る。用意が走っているあいだは 2 つ目を断る", async () => {
    const w = world();
    const e = await installed(w);
    expect(await prepareUpdate({ ...e, running: null })).toEqual({ state: "dev_clone" });
    w.push("2\n");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow: Run = async (cmd, args, cwd) => {
      if (cmd === "npm" && args[0] === "ci") await gate;
      return runner().run(cmd, args, cwd);
    };
    const first = await beginPrepare({ ...e, run: slow });
    expect("started" in first).toBe(true);
    expect(await prepareUpdate({ ...e, run: runner().run })).toEqual({ state: "busy" });
    release();
    if ("done" in first) expect((await first.done).state).toBe("ready");
  });

  it("ツールの引数は action だけ（取ってくる先・枝・道は渡せない）", () => {
    const input = TOOLS.moyai_update.input;
    expect(input.safeParse({ action: "check" }).success).toBe(true);
    expect(input.safeParse({ action: "prepare" }).success).toBe(true);
    expect(input.safeParse({ action: "prepare", source: "https://example.invalid/x.git" }).success).toBe(false);
    expect(input.safeParse({ action: "prepare", branch: "dev" }).success).toBe(false);
    expect(input.safeParse({ action: "pull" }).success).toBe(false);
    expect(input.safeParse({}).success).toBe(false);
    expect(BRIDGE_TOOL_RECEIVERS.moyai_update).toBe("bridge");
    expect(MCP_INSTRUCTIONS.split("\n").find((l) => l.startsWith("今動くのは"))).toContain("・moyai_update");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });
});

describe("次の起動で切り替える（起動の台本）", () => {
  const C = (n: number) => String(n).repeat(40).slice(0, 40);
  /** 版のフォルダに、起こされたら引数と版を書く cli.js を置く */
  function fakeVersion(root: string, c: string, out: string) {
    const v = versionDir(root, c);
    mkdirSync(join(v, "dist"), { recursive: true });
    writeFileSync(join(v, "dist", "cli.js"), `require("fs").writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(c)} + " " + process.argv.slice(2).join(" "));\n`);
    writeFileSync(join(v, ".moyai-ready.json"), JSON.stringify({ commit: c }));
  }
  function setPointer(root: string, p: object) {
    writeFileSync(join(root, "current.json"), JSON.stringify(p));
  }

  it("用意できた next を current に、前の current を previous に。ほかの版は消す（前の版を 1 つ残す）", () => {
    const d = mkdtempSync(join(tmpdir(), "moyai-launch-"));
    cleanups.push(() => rmSync(d, { recursive: true, force: true }));
    const out = join(d, "out.txt");
    for (const n of [1, 2, 3]) fakeVersion(d, C(n), out);
    setPointer(d, { current: C(2), previous: C(1), next: C(3) });
    const f = writeLauncher(d);
    expect(readFileSync(f, "utf8")).toBe(LAUNCHER_SOURCE);
    execFileSync(process.execPath, [f, "mcp"], { stdio: "ignore" });
    expect(readFileSync(out, "utf8")).toBe(`${C(3)} mcp`);
    expect(readPointer(d)).toEqual({ current: C(3), previous: C(2), next: null });
    expect(readdirSync(join(d, "versions")).sort()).toEqual([C(2), C(3)]);
    // もう一度起こしても、同じ版
    execFileSync(process.execPath, [f, "mcp"], { stdio: "ignore" });
    expect(readFileSync(out, "utf8")).toBe(`${C(3)} mcp`);
  });

  it("用意できていない next には切り替えない。今の版が壊れていれば前の版で起こす。版が無ければ止まる", () => {
    const d = mkdtempSync(join(tmpdir(), "moyai-launch-"));
    cleanups.push(() => rmSync(d, { recursive: true, force: true }));
    const out = join(d, "out.txt");
    fakeVersion(d, C(1), out);
    fakeVersion(d, C(2), out);
    mkdirSync(versionDir(d, C(3)), { recursive: true }); // 印の無い（作りかけの）版
    setPointer(d, { current: C(2), previous: C(1), next: C(3) });
    const f = writeLauncher(d);
    execFileSync(process.execPath, [f, "mcp"], { stdio: "ignore" });
    expect(readFileSync(out, "utf8")).toBe(`${C(2)} mcp`);
    expect(readPointer(d)).toEqual({ current: C(2), previous: C(1), next: null });
    rmSync(join(versionDir(d, C(2)), ".moyai-ready.json"));
    execFileSync(process.execPath, [f, "mcp"], { stdio: "ignore" });
    expect(readFileSync(out, "utf8")).toBe(`${C(1)} mcp`);
    setPointer(d, {});
    expect(() => execFileSync(process.execPath, [f, "mcp"], { stdio: "ignore" })).toThrow();
  });

  it("promote は起動の台本と同じ決まり", () => {
    const d = mkdtempSync(join(tmpdir(), "moyai-promote-"));
    cleanups.push(() => rmSync(d, { recursive: true, force: true }));
    for (const n of [1, 2, 3]) fakeVersion(d, C(n), join(d, "o"));
    setPointer(d, { current: C(2), previous: C(1), next: C(3) });
    expect(promote(d)).toBe(C(3));
    expect(readPointer(d)).toEqual({ current: C(3), previous: C(2), next: null });
    expect(readdirSync(join(d, "versions")).sort()).toEqual([C(2), C(3)]);
  });
});
