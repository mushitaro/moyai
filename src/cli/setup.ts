// moyai setup（docs/plan.md §2.12・§8 の 7。運営者の決定 11-06「チャットだけで入れる」）：AI クライアントにつなぐ支度。
// - --target desktop（既定）：Claude Desktop の設定（claude_desktop_config.json）に、moyai の 1 行だけを足す。ほかのサーバーは消さない。
//   前の設定は、同じフォルダに .bak を残してから書く。読めない設定（JSON でない）には書かない。
// - --target code：Claude Code に渡す 1 行（リポジトリの .mcp.json か、claude mcp add に渡す 1 行）を出す。Claude Code の設定には書かない。
// - --name <送信者>：状態フォルダの settings.json の name（送信者の名前。版の署名と画面に出す）を置く。40 字まで。空は断る。
// - 書く前に、何をどこに書くか（.bak を残すこと）を出す。--yes が無ければ、端末で「はい」をもらう（端末でなければ書かずに終える）。
//   --yes は、利用者がチャットで確かめたあとに Claude が付ける。
// - 足すのは { command: Node の実行ファイル, args: [この dist/cli.js, "mcp"] }。橋渡しは、ツールを呼んだときに中継が起こす。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う。AGENTS.md）。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readJson, writeJson } from "../bridge/places";
import { resolveStateDir } from "../bridge/state";
import { validName } from "../plan/signature";

export const SERVER_NAME = "moyai";
const SETTINGS_FILE = "settings.json";

export const SETUP_TEXT = {
  usage: "使い方：moyai setup [--target desktop|code] [--name <送信者の名前>] [--yes]",
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
  notTerminal: "端末ではなく --yes も無いので、何も書いていません。上の中身を利用者にチャットで確かめてから、--yes を付けて走らせてください。",
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
}

/** setup の引数を読む。形が違えば bad_args、名前が使えなければ bad_name */
export function parseSetupArgs(argv: readonly string[]): SetupArgs | { error: "bad_args" | "bad_name" } {
  const out: SetupArgs = { target: "desktop", yes: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (flag: string): string | undefined => (a === flag ? argv[++i] : a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : undefined);
    if (a === "--yes" || a === "-y") out.yes = true;
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

/** settings.json の中身（ほかの欄はそのまま残す）。無ければ空の設定 */
function rawSettings(stateDir: string): Record<string, unknown> {
  const v = readJson<unknown>(join(stateDir, SETTINGS_FILE));
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { v: 1, root: null, ledger: null };
}

/**
 * setup。書いたら 0、やめた・同じ・書くものが無いなら 0、読めない設定なら 1、引数の形が違えば 2、
 * 端末でなく --yes も無ければ 3（何も書かない）。
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
  } = {},
): Promise<number> {
  const say = o.say ?? ((m: string) => process.stderr.write(`${m}\n`));
  const a = parseSetupArgs(o.argv ?? []);
  if ("error" in a) {
    say(a.error === "bad_name" ? SETUP_TEXT.badName : SETUP_TEXT.usage);
    return 2;
  }
  const line = o.line ?? { command: process.execPath, args: [resolve(process.argv[1] ?? "dist/cli.js"), "mcp"] };
  const writes: (() => string)[] = [];

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

  if (writes.length === 0) return 0;
  if (a.yes) say(SETUP_TEXT.yes);
  else {
    // --yes が無ければ人だけ：端末で「はい」をもらう。端末でなければ書かない（拒む試験は消さない）
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
  for (const w of writes) say(w());
  return 0;
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
