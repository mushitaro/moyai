// moyai setup（docs/plan.md §2.12・§8 の 7）：Claude Desktop の設定（claude_desktop_config.json）に、moyai の 1 行だけを足す。
// - ほかのサーバーは消さない。書く前に、何を変えるか（足す行）を出し、端末で「はい」をもらう（人だけ。端末でなければ断る）。
// - 前の設定は、同じフォルダに .bak を残してから書く。読めない設定（JSON でない）には書かない。
// - 足すのは { command: Node の実行ファイル, args: [この dist/cli.js, "mcp"] }。橋渡し（moyai start）は別に起こす。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requireTerminal } from "./human";

export const SERVER_NAME = "moyai";

export const SETUP_TEXT = {
  head: (path: string) => `Claude Desktop の設定：${path}`,
  none: "設定のファイルがまだありません。新しく作ります。",
  invalid: "設定のファイルを JSON として読めないので、書きませんでした。Claude Desktop の設定を直してから、もう一度走らせてください。",
  same: "moyai の行は、もう同じ中身で入っています。変えません。",
  change: "次の 1 行を足します（ほかのサーバーは変えません）：",
  replace: "moyai の行がもうあるので、次の中身に置き換えます（ほかのサーバーは変えません）：",
  ask: "書いてよければ「はい」と打って Enter：",
  cancelled: "書きませんでした。",
  written: (bak: string | null) => `書きました。${bak ? `前の設定は ${bak} に残しました。` : ""}Claude Desktop を開き直すと、moyai のツールが出ます。作業画面は、端末で moyai start を走らせてから開いてください。`,
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

/** setup：人だけ。端末でなければ断る。書いたら 0、やめた・同じなら 0、読めない設定なら 1 */
export async function setupCli(o: {
  stdin?: { isTTY?: boolean };
  path?: string;
  line?: McpServerLine;
  ask?: (prompt: string) => Promise<string | null>;
  say?: (m: string) => void;
} = {}): Promise<number> {
  const say = o.say ?? ((m: string) => process.stderr.write(`${m}\n`));
  if (!requireTerminal(o.stdin)) return 3;
  const path = o.path ?? claudeConfigPath();
  const line = o.line ?? { command: process.execPath, args: [resolve(process.argv[1] ?? "dist/cli.js"), "mcp"] };
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
  if (!next) {
    say(SETUP_TEXT.same);
    return 0;
  }
  const had = !!(config.mcpServers as Record<string, unknown> | undefined)?.[SERVER_NAME];
  say(had ? SETUP_TEXT.replace : SETUP_TEXT.change);
  say(`  "${SERVER_NAME}": ${JSON.stringify(line)}`);
  const ans = await (o.ask ?? askLine)(SETUP_TEXT.ask);
  if (ans === null || ans.trim() !== "はい") {
    say(SETUP_TEXT.cancelled);
    return 0;
  }
  mkdirSync(dirname(path), { recursive: true });
  let bak: string | null = null;
  if (exists) {
    bak = `${path}.bak`;
    copyFileSync(path, bak);
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  say(SETUP_TEXT.written(bak));
  return 0;
}

/** 1 行を読む（見える字で。Ctrl+C か入力の終わりなら null） */
function askLine(prompt: string): Promise<string | null> {
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
