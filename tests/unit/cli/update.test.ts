// moyai update（mushitaro/moyai#43）：版の見分けはビルドの版のコミットと clone の先。一時の git のリポジトリで、
// 更新あり・更新なし・手元に変更あり（と、ビルドだけが古い・枝が main でない）を試す。npm と新しいビルドの指紋は差し替える。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeKeyFile, type KeyFile } from "../../../src/bridge/state";
import { UPDATE_TEXT, defaultRun, parseUpdateArgs, planUpdate, stampIs, toolsDigest, updateCli, type Run } from "../../../src/cli/update";
import { readRelayDigest, writeRelayDigest } from "../../../src/cli/tools-digest";

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

/** origin（裸）と、利用者の clone と、origin に足す人の clone */
function world() {
  const d = mkdtempSync(join(tmpdir(), "moyai-update-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  const origin = join(d, "origin.git");
  git(d, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const dev = join(d, "dev");
  git(d, "clone", "--quiet", origin, dev);
  git(dev, "checkout", "--quiet", "-B", "main");
  writeFileSync(join(dev, "a.txt"), "1\n");
  git(dev, "add", "a.txt");
  git(dev, "commit", "--quiet", "-m", "1");
  git(dev, "push", "--quiet", "origin", "main");
  const user = join(d, "user");
  git(d, "clone", "--quiet", origin, user);
  const stateDir = join(d, "state");
  mkdirSync(stateDir);
  const push = (text: string) => {
    writeFileSync(join(dev, "a.txt"), text);
    git(dev, "commit", "--quiet", "-am", text);
    git(dev, "push", "--quiet", "origin", "main");
  };
  return { d, origin, dev, user, stateDir, push };
}

/** git は本物、npm と node（新しいビルドの指紋）は差し替えて数える */
function runner(o: { digest?: string | null; failNpm?: string } = {}) {
  const calls: string[] = [];
  const run: Run = (cmd, args, cwd) => {
    if (cmd === "git") {
      if (args[0] === "pull") calls.push(`git ${args.join(" ")}`);
      return defaultRun(cmd, args, cwd);
    }
    calls.push(`${cmd} ${args.join(" ")}`);
    if (cmd === "npm" && o.failNpm && args.join(" ") === o.failNpm) throw new Error("npm failed");
    if (cmd === "node") {
      if (o.digest === null) throw new Error("old build");
      return `${o.digest ?? toolsDigest()}\n`;
    }
    return "";
  };
  return { run, calls };
}

const KEY: KeyFile = { version: 1, port: 43999, key: "k".repeat(43), pid: 1, startedAt: "2026-11-11T00:00:00Z" };

async function update(w: ReturnType<typeof world>, buildCommit: string, argv: string[], r: ReturnType<typeof runner>, stops: string[] = []) {
  const said: string[] = [];
  const code = await updateCli({
    argv,
    buildCommit,
    repoDir: w.user,
    stateDir: w.stateDir,
    stdin: { isTTY: false },
    run: r.run,
    stop: async (_sd, key) => {
      stops.push(String(key.port));
      return "stopped";
    },
    say: (m) => said.push(m),
  });
  return { code, said, text: said.join("\n") };
}

describe("moyai update の引数", () => {
  it("--yes と --digest だけを受ける", () => {
    expect(parseUpdateArgs([])).toEqual({ yes: false, digest: false });
    expect(parseUpdateArgs(["--yes"])).toEqual({ yes: true, digest: false });
    expect(parseUpdateArgs(["--digest"])).toEqual({ yes: false, digest: true });
    expect(parseUpdateArgs(["--digest", "--yes"])).toBeNull();
    expect(parseUpdateArgs(["--force"])).toBeNull();
  });
  it("ビルドの版のコミットは、作業中の変更の「+」や unknown なら、そのコミットと言わない", () => {
    expect(stampIs("abc1234", "abc1234def")).toBe(true);
    expect(stampIs("abc1234+", "abc1234def")).toBe(false);
    expect(stampIs("unknown", "abc1234def")).toBe(false);
    expect(stampIs("abc1235", "abc1234def")).toBe(false);
  });
  it("ツールの定義の指紋は 64 字の 16 進で、同じビルドなら同じ", () => {
    expect(toolsDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(toolsDigest()).toBe(toolsDigest());
  });
});

describe("moyai update（一時の git のリポジトリ）", () => {
  it("更新なし：ビルドの版が origin/main と同じなら「最新です」で、pull も npm も走らせない", async () => {
    const w = world();
    const head = git(w.user, "rev-parse", "--short=7", "HEAD");
    const r = runner();
    const out = await update(w, head, ["--yes"], r);
    expect(out.code).toBe(0);
    expect(out.text).toContain(UPDATE_TEXT.latest(head));
    expect(r.calls).toEqual([]);
  });

  it("更新あり：--yes が無ければ中身を出すだけで変えない（終了コード 3）", async () => {
    const w = world();
    const before = git(w.user, "rev-parse", "HEAD");
    w.push("2\n");
    const r = runner();
    const out = await update(w, before.slice(0, 7), [], r);
    expect(out.code).toBe(3);
    expect(out.text).toContain(UPDATE_TEXT.notTerminal);
    expect(out.text).toMatch(/1 個のコミット/);
    expect(r.calls).toEqual([]);
    expect(git(w.user, "rev-parse", "HEAD")).toBe(before);
  });

  it("更新あり：--yes で pull → npm ci → npm run build → 橋渡しを止める。定義が同じなら開き直しは要らないと言う", async () => {
    const w = world();
    const before = git(w.user, "rev-parse", "HEAD");
    w.push("2\n");
    writeKeyFile(w.stateDir, KEY);
    // 動いている中継が起きたときに書いた指紋（AI クライアントが持っている定義）
    writeRelayDigest(w.stateDir);
    expect(readRelayDigest(w.stateDir)).toBe(toolsDigest());
    const r = runner();
    const stops: string[] = [];
    const out = await update(w, before.slice(0, 7), ["--yes"], r, stops);
    expect(out.code).toBe(0);
    expect(git(w.user, "rev-parse", "HEAD")).toBe(git(w.origin, "rev-parse", "main"));
    expect(r.calls).toEqual(["git pull --ff-only --quiet origin main", "npm ci --no-audit --no-fund", "npm run build", expect.stringMatching(/^node .*cli\.js update --digest$/)]);
    expect(stops).toEqual(["43999"]);
    expect(out.text).toContain(UPDATE_TEXT.stopped);
    expect(out.text).toContain(UPDATE_TEXT.noReopen);
    expect(out.text).toContain(UPDATE_TEXT.reload);
  });

  it("ツールの定義が変わった・新しいビルドが指紋を出せない・中継の指紋が無いときは、Claude Desktop の開き直しが要ると言う", async () => {
    const w0 = world();
    const b0 = git(w0.user, "rev-parse", "--short=7", "HEAD");
    w0.push("2\n");
    const noRelay = await update(w0, b0, ["--yes"], runner());
    expect(noRelay.text).toContain(UPDATE_TEXT.reopenUnknown);
    const w = world();
    writeRelayDigest(w.stateDir);
    const before = git(w.user, "rev-parse", "--short=7", "HEAD");
    w.push("2\n");
    const changed = await update(w, before, ["--yes"], runner({ digest: "0".repeat(64) }));
    expect(changed.text).toContain(UPDATE_TEXT.reopen);
    const w2 = world();
    writeRelayDigest(w2.stateDir);
    const b2 = git(w2.user, "rev-parse", "--short=7", "HEAD");
    w2.push("2\n");
    const unknown = await update(w2, b2, ["--yes"], runner({ digest: null }));
    expect(unknown.text).toContain(UPDATE_TEXT.reopenUnknown);
    // 橋渡しが起きていなければ止めず、読み込み直しも言わない
    expect(unknown.text).not.toContain(UPDATE_TEXT.reload);
  });

  it("ビルドだけが古い（clone は origin/main と同じ）：pull はせず、作り直す", async () => {
    const w = world();
    const r = runner();
    const out = await update(w, "0000000", ["--yes"], r);
    expect(out.code).toBe(0);
    expect(r.calls.filter((c) => c.startsWith("git pull"))).toEqual([]);
    expect(r.calls).toContain("npm run build");
  });

  it("手元に変更あり：止めて理由を言い、何も変えない", async () => {
    const w = world();
    const before = git(w.user, "rev-parse", "HEAD");
    w.push("2\n");
    writeFileSync(join(w.user, "a.txt"), "手元の変更\n");
    const r = runner();
    const out = await update(w, before.slice(0, 7), ["--yes"], r);
    expect(out.code).toBe(1);
    expect(out.text).toContain(UPDATE_TEXT.dirty(1));
    expect(r.calls).toEqual([]);
    expect(git(w.user, "rev-parse", "HEAD")).toBe(before);
  });

  it("枝が main でない・早送りで進めないときは止める", async () => {
    const w = world();
    git(w.user, "checkout", "--quiet", "-b", "mine");
    expect(planUpdate(w.user, "0000000").kind).toBe("not_main");
    git(w.user, "checkout", "--quiet", "main");
    writeFileSync(join(w.user, "b.txt"), "x\n");
    git(w.user, "add", "b.txt");
    git(w.user, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "--quiet", "-m", "local");
    w.push("2\n");
    expect(planUpdate(w.user, "0000000").kind).toBe("diverged");
  });

  it("npm が落ちたら、そこで止めて理由を言う（橋渡しは止めない）", async () => {
    const w = world();
    const before = git(w.user, "rev-parse", "--short=7", "HEAD");
    w.push("2\n");
    writeKeyFile(w.stateDir, KEY);
    const stops: string[] = [];
    const out = await update(w, before, ["--yes"], runner({ failNpm: "run build" }), stops);
    expect(out.code).toBe(1);
    expect(out.text).toContain(UPDATE_TEXT.stepFailed("npm run build", ""));
    expect(stops).toEqual([]);
  });

  it("git の clone でなければ止める。ほかのリポジトリの中に置いたフォルダでも、そのリポジトリを pull しない", () => {
    const d = mkdtempSync(join(tmpdir(), "moyai-update-norepo-"));
    cleanups.push(() => rmSync(d, { recursive: true, force: true }));
    expect(planUpdate(d, "0000000").kind).toBe("not_repo");
    const w = world();
    const inner = join(w.user, "moyai");
    mkdirSync(inner);
    expect(planUpdate(inner, "0000000").kind).toBe("not_repo");
  });
});
