// moyai setup（docs/plan.md §2.12・§8 の 7。運営者の決定 11-06「チャットだけで入れる」）：AI クライアントにつなぐ支度。
// - --target desktop（既定）：Claude Desktop の設定（claude_desktop_config.json）に、moyai の 1 行だけを足す。ほかのサーバーは消さない。
//   前の設定は、同じフォルダに .bak を残してから書く。読めない設定（JSON でない）には書かない。
// - --target code：Claude Code に渡す 1 行（リポジトリの .mcp.json か、claude mcp add に渡す 1 行）を出す。Claude Code の設定には書かない。
// - --name <送信者>：状態フォルダの settings.json の name（送信者の名前。版の署名と画面に出す）を置く。40 字まで。空は断る。
// - 書く前に、何をどこに書くか（.bak を残すこと）を出す。--yes が無ければ書かない。
//   Claude は出た中身を利用者にチャットで見せ、「はい」をもらったら --yes を付けて走らせる（利用者の端末の操作は要らない）。
//   人が端末から直に走らせたときだけ、その場で「はい」を聞く（標準入力が端末でなければ、書かずに終える。拒む試験は残す）。
// - --target desktop の既定は、この clone の今のコミットを版ごとのフォルダ（<appRoot>/versions/<コミット>/）に入れ
//   （取得 → npm ci → build → 自己点検。clone は変えない）、{ command: Node の実行ファイル, args: [<appRoot>/launch.cjs, "mcp"] } を足す。
//   起動の台本は版のフォルダの外にあり、用意できた次の版に次の起動で切り替える（moyai_update。mushitaro/moyai#65）。
// - --dev：開発の clone の dist/cli.js を直に指す（前のとおり。版のフォルダには入れない。moyai_update は dev_clone と答える）。
//   --target code は、いつも clone を指す（Claude Code はこのリポジトリのフォルダで開く）。橋渡しは、ツールを呼んだときに中継が起こす。
// - Claude Desktop は、動いているあいだ自分の覚えている設定で claude_desktop_config.json を書き直すので、開いているときに足した行は消える
//   （2026-11-07、運営者の PC で起きた）。Desktop が動いていれば、書いたあとに見張り（setup --wait-desktop）を切り離して起こし、
//   Desktop が閉じたらもう一度足す。利用者に頼むのは Desktop の開き直しの 1 回だけ。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う。AGENTS.md）。
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readJson, writeJson } from "../bridge/places";
import { resolveStateDir } from "../bridge/state";
import { validName } from "../plan/signature";
import { appRoot, installFromClone, installedCommitOf, writeLauncher } from "../bridge/app-update";

export const SERVER_NAME = "moyai";
const SETTINGS_FILE = "settings.json";

export const SETUP_TEXT = {
  usage: "使い方：moyai setup [--target desktop|code] [--dev] [--name <送信者の名前>] [--yes]",
  installWill: (root: string) =>
    `MOYAI を ${root} の版ごとのフォルダに入れます（この clone の今のコミットを別のフォルダで取得 → npm ci → build → 自己点検。数分かかります。clone は変えません）。Claude Desktop は、版のフォルダの外の起動の台本（launch.cjs）を指します。`,
  installSame: (commit: string) => `版 ${commit.slice(0, 7)} は、もう入っています。`,
  installed: (commit: string) => `版 ${commit.slice(0, 7)} を入れました。`,
  installFailed: (step: string) =>
    step === "not_on_main"
      ? "この clone の今のコミットが main にないので、入れませんでした（入れた版は main から最新にします）。main に戻すか、clone を直に指すなら --dev を付けてください。Claude Desktop の設定は変えていません。"
      : step === "local_changes"
        ? "この clone に手元の変更があるので、入れませんでした。Claude Desktop の設定は変えていません。"
        : `入れられませんでした（${step} で止まりました）。Claude Desktop の設定は変えていません。`,
  desktopOpen:
    "Claude Desktop が開いています。開いているあいだは Desktop が設定を書き直すので、この 1 行は消えます。Desktop が閉じたら、もう一度足します（見張りを後ろで起こしました。1 時間待ちます）。利用者には、Claude Desktop を 1 回閉じて開き直してもらってください。",
  waitGaveUp: "Claude Desktop が 1 時間閉じなかったので、書かずに終えました。",
  badName: "送信者の名前は 1〜40 字です（前後の空白・\\ / : * ? \" < > | と制御の文字・点だけの名前は使えません）。書いていません。",
  head: (path: string) => `Claude Desktop の設定：${path}`,
  none: "設定のファイルがまだありません。新しく作ります。",
  invalid: "設定のファイルを JSON として読めないので、書きませんでした。Claude Desktop の設定を直してから、もう一度走らせてください。",
  same: "moyai の行は、もう同じ中身で入っています。変えません。",
  change: "次の 1 行を足します（ほかのサーバーは変えません）：",
  replace: "moyai の行がもうあるので、次の中身に置き換えます（ほかのサーバーは変えません）：",
  bakWill: (bak: string) => `書く前に、今の設定を ${bak} に残します。`,
  codeHead: "Claude Code：このリポジトリのフォルダで Claude Code を開くと、リポジトリの .mcp.json の moyai がつながります（Claude Code の設定には書きません）。",
  codeLine: "ほかのフォルダの Claude Code からも使うときは、次の 1 行を走らせます（利用者の Claude Code の設定に moyai の 1 行を足す）：",
  codeAfter: "足したあと、Claude Code を開き直すと moyai のツールが出ます。",
  nameHead: (path: string) => `送信者の名前（${path} の name）：`,
  nameChange: (before: string | null, after: string) => (before ? `「${before}」を「${after}」に変えます。` : `「${after}」を置きます。`),
  nameSame: (name: string) => `送信者の名前は、もう「${name}」です。変えません。`,
  ask: "書いてよければ「はい」と打って Enter：",
  yes: "--yes なので、確かめずに書きます（利用者がチャットで確かめた前提）。",
  notTerminal: "--yes が無いので、何も書いていません。上の中身を利用者にチャットで見せ、良ければ --yes を付けて Claude が走らせてください（利用者の端末の操作は要りません）。",
  cancelled: "書きませんでした。",
  written: (bak: string | null) =>
    `書きました。${bak ? `前の設定は ${bak} に残しました。` : ""}Claude Desktop を開き直すと、moyai のツールが出ます。橋渡しは、moyai のツールを呼んだときに中継が起こします（作業画面の URL は、その答えの workScreenUrl）。`,
  nameWritten: (name: string) => `送信者の名前を「${name}」にしました。`,
};

/** Claude Desktop の設定のファイルの場所（OS ごと。MOYAI_CLAUDE_CONFIG があればそれ） */
export function claudeConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.MOYAI_CLAUDE_CONFIG) return resolve(env.MOYAI_CLAUDE_CONFIG);
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude", "claude_desktop_config.json");
}

export interface McpServerLine {
  command: string;
  args: string[];
}

/** 設定の中身に moyai の行を足した中身（ほかの欄とサーバーはそのまま）。同じ中身なら null */
export function withMoyai(config: Record<string, unknown>, line: McpServerLine): Record<string, unknown> | null {
  const servers = (config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {}) as Record<string, unknown>;
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(line)) return null;
  return { ...config, mcpServers: { ...servers, [SERVER_NAME]: line } };
}

/** claude mcp add に渡す 1 行（利用者の Claude Code の設定に足す。道は引用符で囲む） */
export function claudeCodeAddLine(line: McpServerLine): string {
  return `claude mcp add --scope user ${SERVER_NAME} -- ${[line.command, ...line.args].map((a) => (/^[A-Za-z0-9._:/\\-]+$/.test(a) ? a : `"${a}"`)).join(" ")}`;
}

export interface SetupArgs {
  target: "desktop" | "code";
  yes: boolean;
  name: string | null;
  /** 見張り：Claude Desktop が閉じるのを待ってから書く（setup が自分で切り離して起こす） */
  waitDesktop: boolean;
  /** 開発の clone の dist/cli.js を直に指す（版のフォルダに入れない） */
  dev: boolean;
}

/** setup の引数を読む。形が違えば bad_args、名前が使えなければ bad_name */
export function parseSetupArgs(argv: readonly string[]): SetupArgs | { error: "bad_args" | "bad_name" } {
  const out: SetupArgs = { target: "desktop", yes: false, name: null, waitDesktop: false, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (flag: string): string | undefined => (a === flag ? argv[++i] : a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : undefined);
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--wait-desktop") out.waitDesktop = true;
    else if (a === "--dev") out.dev = true;
    else if (a === "--target" || a.startsWith("--target=")) {
      const v = value("--target");
      if (v !== "desktop" && v !== "code") return { error: "bad_args" };
      out.target = v;
    } else if (a === "--name" || a.startsWith("--name=")) {
      const v = value("--name");
      if (v === undefined) return { error: "bad_args" };
      const n = v.trim();
      if (!n || !validName(n)) return { error: "bad_name" };
      out.name = n;
    } else return { error: "bad_args" };
  }
  return out;
}

/** Claude Desktop が動いているか（Windows は claude.exe、macOS は Claude）。分からなければ false */
export function desktopRunning(platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (platform === "win32")
      return execFileSync("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).toLowerCase().includes("claude.exe");
    if (platform === "darwin") {
      execFileSync("pgrep", ["-x", "Claude"], { stdio: "ignore" });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 見張りを切り離して起こす（この setup が終わっても、Desktop が閉じても残る） */
function spawnWatcher(dev: boolean): void {
  const cli = resolve(process.argv[1] ?? "dist/cli.js");
  const child = spawn(process.execPath, [cli, "setup", "--target", "desktop", "--yes", "--wait-desktop", ...(dev ? ["--dev"] : [])], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

/** settings.json の中身（ほかの欄はそのまま残す）。無ければ空の設定 */
function rawSettings(stateDir: string): Record<string, unknown> {
  const v = readJson<unknown>(join(stateDir, SETTINGS_FILE));
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { v: 1, root: null, ledger: null };
}

/**
 * setup。書いたら 0、やめた・同じ・書くものが無いなら 0、読めない設定なら 1、引数の形が違えば 2、
 * --yes が無く標準入力が端末でもなければ 3（何も書かない。Claude が中身をチャットで見せ、--yes を付けて走らせ直す）。
 */
export async function setupCli(
  o: {
    argv?: readonly string[];
    stdin?: { isTTY?: boolean };
    path?: string;
    line?: McpServerLine;
    stateDir?: string;
    ask?: (prompt: string) => Promise<string | null>;
    say?: (m: string) => void;
    /** Claude Desktop が動いているか（試験で差し替える） */
    desktopRunning?: () => boolean;
    /** 見張りを起こす（試験で差し替える） */
    spawnWatcher?: () => void;
    /**
     * 版ごとのフォルダに入れる手（--dev でない desktop。試験で差し替える）。既定は、この clone を <appRoot> に入れて起動の台本を置く。
     * line を渡したとき（試験）は、install も渡さなければ入れない
     */
    install?: { root: string; run: () => Promise<{ ok: true; commit: string; same?: boolean } | { ok: false; step: string }> };
    /** 見張りが待つ間（ミリ秒。試験で差し替える） */
    waitMs?: { poll: number; settle: number; limit: number };
  } = {},
): Promise<number> {
  const say = o.say ?? ((m: string) => process.stderr.write(`${m}\n`));
  const a = parseSetupArgs(o.argv ?? []);
  if ("error" in a) {
    say(a.error === "bad_name" ? SETUP_TEXT.badName : SETUP_TEXT.usage);
    return 2;
  }
  // 設定の場所を指したとき（試験・MOYAI_CLAUDE_CONFIG）は、本物の Desktop の設定ではないので、Desktop を見ない
  const running = o.desktopRunning ?? (o.path !== undefined || process.env.MOYAI_CLAUDE_CONFIG ? () => false : () => desktopRunning());
  if (a.waitDesktop) {
    if (a.target !== "desktop" || !a.yes) {
      say(SETUP_TEXT.usage);
      return 2;
    }
    const w = o.waitMs ?? { poll: 1000, settle: 3000, limit: 60 * 60 * 1000 };
    const t0 = Date.now();
    while (running()) {
      if (Date.now() - t0 > w.limit) {
        say(SETUP_TEXT.waitGaveUp);
        return 1;
      }
      await new Promise((r) => setTimeout(r, w.poll));
    }
    await new Promise((r) => setTimeout(r, w.settle));
  }
  // 版ごとのフォルダに入れる（--dev でない Claude Desktop）。clone の dist/cli.js でなく、版のフォルダの外の起動の台本を指す（#65）
  const cliPath = resolve(process.argv[1] ?? "dist/cli.js");
  const install = a.target === "desktop" && !a.dev ? (o.install ?? (o.line ? undefined : defaultInstall(cliPath))) : undefined;
  const line =
    o.line ?? (install ? { command: process.execPath, args: [join(install.root, "launch.cjs"), "mcp"] } : { command: process.execPath, args: [cliPath, "mcp"] });
  const writes: (() => string)[] = [];

  if (install) say(SETUP_TEXT.installWill(install.root));
  if (a.target === "desktop") {
    const path = o.path ?? claudeConfigPath();
    say(SETUP_TEXT.head(path));
    let config: Record<string, unknown> = {};
    const exists = existsSync(path);
    if (exists) {
      try {
        const v = JSON.parse(readFileSync(path, "utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
        config = v as Record<string, unknown>;
      } catch {
        say(SETUP_TEXT.invalid);
        return 1;
      }
    } else say(SETUP_TEXT.none);
    const next = withMoyai(config, line);
    if (!next) say(SETUP_TEXT.same);
    else {
      const had = !!(config.mcpServers as Record<string, unknown> | undefined)?.[SERVER_NAME];
      say(had ? SETUP_TEXT.replace : SETUP_TEXT.change);
      say(`  "${SERVER_NAME}": ${JSON.stringify(line)}`);
      if (exists) say(SETUP_TEXT.bakWill(`${path}.bak`));
      writes.push(() => {
        mkdirSync(dirname(path), { recursive: true });
        let bak: string | null = null;
        if (exists) {
          bak = `${path}.bak`;
          copyFileSync(path, bak);
        }
        writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
        return SETUP_TEXT.written(bak);
      });
    }
  } else {
    say(SETUP_TEXT.codeHead);
    say(SETUP_TEXT.codeLine);
    say(`  ${claudeCodeAddLine(line)}`);
    say(SETUP_TEXT.codeAfter);
  }

  if (a.name !== null) {
    const stateDir = o.stateDir ?? resolveStateDir();
    const raw = rawSettings(stateDir);
    const before = typeof raw.name === "string" && validName(raw.name) ? raw.name : null;
    const name = a.name;
    if (before === name) say(SETUP_TEXT.nameSame(name));
    else {
      say(`${SETUP_TEXT.nameHead(join(stateDir, SETTINGS_FILE))}${SETUP_TEXT.nameChange(before, name)}`);
      writes.push(() => {
        writeJson(stateDir, SETTINGS_FILE, { ...raw, v: 1, name });
        return SETUP_TEXT.nameWritten(name);
      });
    }
  }

  if (writes.length === 0 && !install) return 0;
  if (a.yes) say(SETUP_TEXT.yes);
  else {
    // --yes が無ければ書かない。人が端末から直に走らせたときだけ、その場で「はい」を聞く（標準入力が端末でなければ書かない。拒む試験は消さない）
    if ((o.stdin ?? process.stdin).isTTY !== true) {
      say(SETUP_TEXT.notTerminal);
      return 3;
    }
    const ans = await (o.ask ?? askLine)(SETUP_TEXT.ask);
    if (ans === null || ans.trim() !== "はい") {
      say(SETUP_TEXT.cancelled);
      return 0;
    }
  }
  if (install) {
    // 入れ終わってから設定を書く（入れられなければ、設定は変えない）
    const r = await install.run();
    if (!r.ok) {
      say(SETUP_TEXT.installFailed(r.step));
      return 1;
    }
    say(r.same ? SETUP_TEXT.installSame(r.commit) : SETUP_TEXT.installed(r.commit));
  }
  for (const w of writes) say(w());
  if (a.target === "desktop" && !a.waitDesktop && running()) {
    (o.spawnWatcher ?? (() => spawnWatcher(a.dev)))();
    say(SETUP_TEXT.desktopOpen);
  }
  return 0;
}

/** 既定の入れ方：入っている版から走らせたら（moyai setup を版のフォルダの cli.js で）起動の台本だけを置き直す。clone からなら、その HEAD を入れる */
function defaultInstall(cliPath: string): NonNullable<Parameters<typeof setupCli>[0]>["install"] {
  const root = appRoot();
  return {
    root,
    run: async () => {
      const inside = installedCommitOf(root, cliPath);
      if (inside) {
        writeLauncher(root);
        return { ok: true, commit: inside, same: true };
      }
      const r = await installFromClone({ root }, resolve(dirname(cliPath), ".."));
      return r;
    },
  };
}

/** 1 行を読む（見える字で。Ctrl+C か入力の終わりなら null） */
export function askLine(prompt: string): Promise<string | null> {
  return new Promise((res) => {
    process.stderr.write(prompt);
    let buf = "";
    const done = (v: string | null) => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
      res(v);
    };
    const onData = (c: string | Buffer) => {
      buf += String(c);
      const i = buf.search(/\r|\n/);
      if (i >= 0) done(buf.slice(0, i));
    };
    const onEnd = () => done(null);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}
