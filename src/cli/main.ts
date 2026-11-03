// moyai のコマンド。`moyai start`（橋渡し）と `moyai mcp`（中継）。
// 標準出力は MCP だけに使う。人への知らせは標準エラーへ出す。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeStartError, startBridge } from "../bridge/server";
import { resolveStateDir } from "../bridge/state";
import { errorBody, type ErrorCode } from "../shared/errors";
import { parseStartArgs } from "./args";
import { keysCli, sendCli, verifyRingCli } from "./human";
import { createRelayServer } from "./relay";

declare const __MOYAI_BUILD__: { time: string; commit: string };

const BUILD = `MOYAI · build ${__MOYAI_BUILD__.time} JST · ${__MOYAI_BUILD__.commit}`;

const say = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};
const fail = (code: ErrorCode, vars: Record<string, string | number> = {}): never => {
  say(errorBody(code, vars).error.message);
  process.exit(code === "bad_args" ? 2 : 1);
};

const HELP = `使い方：
  moyai start [--port 43110] [--no-open]   橋渡しを起こし、作業画面を開く
  moyai mcp                                 AI クライアントとつなぐ中継（標準入出力の MCP）
  moyai verify ring <輪のフォルダ>           輪の決まり・仲間・束を、受け手と同じ関数で確かめる（✓／✗ と理由）
  moyai keys create --root <輪のフォルダ> --pack <パック>
                                            輪を作り、その輪の鍵を合言葉で包む（人だけ。端末から）
  moyai send                                束を送る（人だけ。検問所の画面から送る。端末からは未実装）
  moyai --version                           ビルドの印を出す`;

function openBrowser(url: string): void {
  // 既定のブラウザで開く。開けなくても止めない（URL は端末に出してある）
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 開けなかった */
  }
}

async function start(argv: string[]): Promise<void> {
  const args = parseStartArgs(argv);
  if (!args) return fail("bad_args");
  const staticDir = join(dirname(fileURLToPath(import.meta.url)), "app");
  if (!existsSync(join(staticDir, "index.html"))) return fail("app_missing");
  try {
    const bridge = await startBridge({ port: args.port, staticDir, stateDir: resolveStateDir(), log: say });
    say(`${BUILD}`);
    say(`橋渡しを起こしました：${bridge.url}  （止めるには Ctrl+C）`);
    if (args.open) openBrowser(bridge.url);
    const stop = async () => {
      await bridge.close();
      say("橋渡しを止めました");
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    if (e instanceof BridgeStartError) return fail(e.code === "port_denied" ? "port_denied" : "port_in_use", { port: e.port });
    throw e;
  }
}

async function mcp(): Promise<void> {
  const server = createRelayServer({ stateDir: resolveStateDir(), version: __MOYAI_BUILD__.commit });
  await server.connect(new StdioServerTransport());
  say("moyai mcp：中継を起こしました（標準入出力）");
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === "start") return start(rest);
  if (cmd === "mcp") {
    if (rest.length) return fail("bad_args");
    return mcp();
  }
  if (cmd === "verify") return process.exit(await verifyRingCli(rest));
  if (cmd === "keys") return process.exit(await keysCli(rest));
  if (cmd === "send") return process.exit(sendCli());
  if (cmd === "--version" || cmd === "-v") return say(BUILD);
  if (cmd === undefined || cmd === "--help" || cmd === "-h") return say(HELP);
  fail("bad_args");
}

main(process.argv.slice(2)).catch((e: unknown) => {
  say(`moyai：止まりました（${e instanceof Error ? e.name : "誤り"}）`);
  process.exit(1);
});
