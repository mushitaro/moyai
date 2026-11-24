// 受け入れ：利用者と同じ入れ方を、一時のフォルダで通す（運営者の指摘 2026-11-18：連携の部品が Windows の PC に入らなかったのに、CI は緑だった）。
// CI のテストは、リポジトリで npm ci --ignore-scripts した node_modules で走る。利用者の PC では、moyai setup が版のフォルダ
// （<appRoot>/versions/<コミット>/）に、取得 → npm ci（スクリプトあり）→ npm run build → 自己点検 をする（src/bridge/app-update.ts・src/cli/setup.ts）。
// ここでは、その道をそのまま通す：
//   1. 取ってくる先は、CI が checkout したコミット（一時の裸の git に写し、main をそのコミットにする。外の main は取らない）。
//      利用者の clone の代わりに、そこから一時の clone を作り、リポジトリのビルド（dist）と node_modules を借りて moyai setup --yes を走らせる。
//   2. 版のフォルダに入り、Claude Desktop の設定（一時のファイル）が起動の台本を指す。連携の部品（本体・/node・/license）が、その版のフォルダから読める。
//   3. 起動の台本から橋渡しを起こし、設定の画面に「連携」の欄が出る（橋渡しの settings の答えの connect.available が true のときだけ出る）。
//      起動の台本からの中継（Claude Desktop が起こすのと同じ）で、MOYAI のツールが出る。
// HOME・USERPROFILE・APPDATA・LOCALAPPDATA・XDG_*・置き場所・状態フォルダ・Claude Desktop の設定は、どれも一時のフォルダ。
// 本物の Claude Desktop の設定・本物の状態フォルダ（%LOCALAPPDATA%\MOYAI など）・~/.config/mxstage は読まない・書かない。
// 127.0.0.1 への HTTP は、今の e2e の道具と同じく、自分で起こした橋渡しの画面を開くことと中継だけ。
// 走らせ方：npm run build のあと npx playwright test -c playwright.acceptance.config.ts（CI の install の仕事）
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const REPO = resolve(".");
const UPDATE_SOURCE = "https://github.com/mushitaro/moyai.git";
const NAME = "【架空】受け入れの試験";

let tmp = "";
let head = "";
let env: Record<string, string> = {};
let app = "";
let claudeConfig = "";
let bridge: ChildProcess | null = null;
let base = "";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** 一時の HOME などを渡した環境（試験の外の設定を読まない）。試験の台の off（連携の部品を読まない）は外す：利用者の橋渡しと同じにする */
function tempEnv(root: string): Record<string, string> {
  const d = (n: string) => {
    const p = join(root, n);
    mkdirSync(p, { recursive: true });
    return p;
  };
  const home = d("home");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && !k.startsWith("MOYAI_") && !k.startsWith("npm_")) out[k] = v;
  return {
    ...out,
    HOME: home,
    USERPROFILE: home,
    APPDATA: d("appdata-roaming"),
    LOCALAPPDATA: d("appdata-local"),
    XDG_CONFIG_HOME: d("xdg-config"),
    XDG_DATA_HOME: d("xdg-data"),
    XDG_STATE_HOME: d("xdg-state"),
    MOYAI_APP_DIR: join(root, "app"),
    MOYAI_STATE_DIR: join(root, "state"),
    MOYAI_CLAUDE_CONFIG: join(root, "claude", "claude_desktop_config.json"),
    MOYAI_LEDGER_INTAKE_URL: "off",
    MOYAI_NO_AUTO_OPEN: "1",
  };
}

function freePort(): Promise<number> {
  return new Promise((ok, ng) => {
    const s = createServer();
    s.once("error", ng);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => ok(port));
    });
  });
}

/** 子のプロセスを走らせ、終わりのコードと標準エラーを返す（setup の知らせは標準エラー） */
function run(cmd: string, args: string[], cwd: string, ms: number): Promise<{ code: number | null; err: string }> {
  return new Promise((done) => {
    const c = spawn(cmd, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    c.stderr?.on("data", (b: Buffer) => (err += b.toString("utf8")));
    const t = setTimeout(() => c.kill(), ms);
    c.on("exit", (code) => {
      clearTimeout(t);
      done({ code, err });
    });
  });
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-accept-install-"));
  env = tempEnv(tmp);
  app = env.MOYAI_APP_DIR!;
  claudeConfig = env.MOYAI_CLAUDE_CONFIG!;
  head = git(REPO, "rev-parse", "HEAD");
});
/** 起動の台本と、その子（版の橋渡し）をまとめて止める。Windows の kill は台本だけを止め、子が残るので taskkill で木ごと止める */
function stopTree(c: ChildProcess | null): void {
  if (!c?.pid || c.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      /* もう止まった */
    }
  } else c.kill();
}

test.afterAll(async () => {
  stopTree(bridge);
  await new Promise((r) => setTimeout(r, 1000));
  try {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    // 止まりきらない子がファイルをつかんでいる（一時のフォルダ。CI の仕事が終われば消える）。試験の合否には入れない
  }
});

test("moyai setup --yes：CI のコミットを版のフォルダに入れ（本物の npm ci と build）、Claude Desktop の設定が起動の台本を指す。連携の部品が読める", async () => {
  expect(existsSync(join(REPO, "dist", "cli.js")), "先に npm run build").toBe(true);
  // 取ってくる先：CI が checkout したコミットを main にした、一時の裸の git
  const origin = join(tmp, "origin.git");
  git(tmp, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  // CI の checkout は浅い（履歴 1 つ）ので、浅いまま受ける
  git(origin, "config", "receive.shallowUpdate", "true");
  git(REPO, "push", "--quiet", origin, `${head}:refs/heads/main`);
  // 利用者の clone の代わり（main を取った clone）。ビルドと依存はリポジトリのものを借りる（版のフォルダには setup が自分で npm ci と build をする）
  const clone = join(tmp, "clone");
  git(tmp, "clone", "--quiet", origin, clone);
  expect(git(clone, "rev-parse", "HEAD")).toBe(head);
  cpSync(join(REPO, "dist"), join(clone, "dist"), { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(clone, "node_modules"), process.platform === "win32" ? "junction" : "dir");

  const r = await run(process.execPath, [join(clone, "dist", "cli.js"), "setup", "--yes", "--name", NAME], clone, 30 * 60_000);
  expect(r.code, r.err).toBe(0);
  expect(r.err).toContain(`版 ${head.slice(0, 7)} を入れました。`);

  // 版のフォルダ（自己点検の印・ビルド）と、次の起動で選ぶ版
  const v = join(app, "versions", head);
  expect(JSON.parse(readFileSync(join(v, ".moyai-ready.json"), "utf8")).commit).toBe(head);
  expect(existsSync(join(v, "dist", "cli.js"))).toBe(true);
  expect(JSON.parse(readFileSync(join(app, "current.json"), "utf8"))).toEqual({ current: head, previous: null, next: null });
  // 版のフォルダの取ってくる先は mushitaro/moyai（自動の更新が取る先。ここでは書き換えただけで、取りに行かない）
  expect(git(v, "remote", "get-url", "origin")).toBe(UPDATE_SOURCE);
  // clone は変えない
  expect(git(clone, "status", "--porcelain", "--untracked-files=no")).toBe("");

  // Claude Desktop の設定（一時のファイル）：moyai の行が、版のフォルダの外の起動の台本を指す
  const cfg = JSON.parse(readFileSync(claudeConfig, "utf8"));
  expect(cfg.mcpServers.moyai).toEqual({ command: process.execPath, args: [join(app, "launch.cjs"), "mcp"] });
  expect(existsSync(join(app, "launch.cjs"))).toBe(true);
  // 送信者の名前（一時の状態フォルダ）
  expect(JSON.parse(readFileSync(join(env.MOYAI_STATE_DIR!, "settings.json"), "utf8")).name).toBe(NAME);

  // 連携の部品：版のフォルダの npm ci で入り、本体・/node・/license が読める（optional の依存は、入らなくても npm が黙って飛ばす。#141）
  expect(existsSync(join(v, "node_modules", "@mxstage", "eam-connectors", "dist")), "連携の部品が版のフォルダに入っていない").toBe(true);
  const probe = await run(
    process.execPath,
    ["--input-type=module", "-e", "await Promise.all([import('@mxstage/eam-connectors'), import('@mxstage/eam-connectors/node'), import('@mxstage/eam-connectors/license'), import('@mxstage/eam-connectors/eam')]);"],
    v,
    60_000,
  );
  expect(probe.code, probe.err).toBe(0);
});

test("起動の台本から起こした橋渡しで、設定の「連携」が出る（部品を読めた）。起動の台本の中継から MOYAI のツールが出る", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  expect(existsSync(join(app, "launch.cjs")), "前の試験で入れた版が要る").toBe(true);
  // 自動の確かめ（起動の 60 秒あと）が本物の mushitaro/moyai を取りに行かないよう、設定の「最新の確かめ」を切る（外の main は取らない）
  const settingsFile = join(env.MOYAI_STATE_DIR!, "settings.json");
  writeFileSync(settingsFile, `${JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, "utf8")), autoUpdate: false }, null, 2)}\n`);
  const port = await freePort();
  // Claude Desktop と同じく node <appRoot>/launch.cjs で起こす（版を選び、その版の dist/cli.js に同じ引数を渡す）
  bridge = spawn(process.execPath, [join(app, "launch.cjs"), "start", "--port", String(port), "--no-open"], { cwd: tmp, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";
  base = await new Promise<string>((ok, ng) => {
    const t = setTimeout(() => ng(new Error(`起動しない: ${out}`)), 60_000);
    bridge!.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const m = /橋渡しを起こしました：(\S+)/.exec(out);
      if (m) {
        clearTimeout(t);
        ok(m[1]!.replace(/\/$/, ""));
      }
    });
    bridge!.once("exit", (c) => ng(new Error(`止まった ${c}: ${out}`)));
  });
  // 入れた版で動いている印（起動の台本が消さない版）
  expect(existsSync(join(app, "running"))).toBe(true);

  await page.goto(`${base}/#/settings`);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  // 「連携」の欄は、橋渡しの settings の答えの connect.available が true のときだけ出る（部品が無ければ出ない。src/app/pages/Settings.tsx）
  await expect(page.getByTestId("connect-choice")).toBeVisible();
  await page.getByTestId("connect-choice").getByText("オン").click();
  // つなぎ先が 0 のあいだ、一覧の表は行が無く高さ 0（見えない扱い）なので、あること・行が 0・「足す」が見えることを見る
  await expect(page.getByTestId("connect-targets")).toHaveCount(1);
  await expect(page.getByTestId("connect-target-row")).toHaveCount(0);
  await expect(page.getByTestId("connect-add-open")).toBeVisible();

  // Claude Desktop の設定の行と同じ起こし方の中継（橋渡しはもう起きているので、新しく起こさない）
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(app, "launch.cjs"), "mcp"], cwd: tmp, env: { ...env, MOYAI_NO_BRIDGE_LAUNCH: "1" }, stderr: "pipe" });
  const client = new Client({ name: "moyai-acceptance", version: "0" });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["intake_survey", "moyai_update"]));
    // 人だけの操作の道具は無い
    expect(names.some((n) => /send|commit|confirm|promote/.test(n))).toBe(false);
  } finally {
    await client.close();
  }
});
