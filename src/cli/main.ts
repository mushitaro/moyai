// moyai のコマンド。`moyai start`（橋渡し）と `moyai mcp`（中継）、`moyai setup`・`moyai update`・`moyai uninstall`（入れる・最新にする・消す）。
// 標準出力は MCP だけに使う。人への知らせは標準エラーへ出す。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeStartError, DEFAULT_PORT, startBridge } from "../bridge/server";
import { resolveStateDir } from "../bridge/state";
import { errorBody, type ErrorCode } from "../shared/errors";
import { parseStartArgs } from "./args";
import { keysCli, sendCli, verifyDemoRingCli, verifyRingCli } from "./human";
import { ledgerCli, verifyLedgerCli } from "./ledger";
import { openBrowser } from "./open-browser";
import { createRelayServer, type LaunchHandle } from "./relay";
import { writeRelayDigest } from "./tools-digest";

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
  moyai mcp                                 AI クライアントとつなぐ中継（標準入出力の MCP）。橋渡しが起きていなければ moyai start --no-open で起こす。
                                            前の版の橋渡しが動いていれば、止める合図を送って、この版の橋渡しに替える
                                            （MOYAI_NO_BRIDGE_LAUNCH=1 なら起こさず、替えない）
  moyai setup [--target desktop|code] [--name <送信者>] [--yes]
                                            つなぐ支度。desktop（既定）は Claude Desktop の設定に moyai の 1 行だけを足す（.bak を残す）。
                                            code は Claude Code に渡す 1 行（.mcp.json か claude mcp add）を出す。--name は送信者の名前（40 字まで）。
                                            何をどこに書くかを先に出す。--yes が無ければ書かない。Claude は中身を利用者にチャットで見せ、
                                            「はい」をもらったら --yes を付けて走らせる（人が端末から直に走らせたときだけ、その場で「はい」を聞く）
  moyai update [--yes]                      MOYAI を origin/main の版にする。ビルドの版のコミットと clone の先を比べ、古ければ
                                            git pull --ff-only → npm ci → npm run build → 動いている橋渡しを止める（次のツールの呼び出しで新しい橋渡しが起きる）。
                                            手元に変更があれば止めて理由を言う。何をするかを先に出す。--yes が無ければ変えない
  moyai uninstall [--yes] [--keep-root|--remove-root]
                                            消す。橋渡しを止め、Claude Desktop の設定から moyai の行を外し（.bak を残す）、状態フォルダを消す。
                                            保存先（計画の版）は既定で残す。--remove-root のときだけ消す。何を消すかを先に出す
  moyai verify ring <共有フォルダ>           共有フォルダの決まり・メンバー・共有ファイルを、受け手と同じ関数で確かめる（✓／✗ と理由）
  moyai verify demo-ring [<フォルダ>]        リポジトリのデモの共有フォルダ（架空の 7 拠点）を verify ring と同じ関数で確かめる
                                            （全員 ✓、わざと入れた ✗ の共有ファイルは理由つきで ✗ なら終了コード 0）
  moyai verify ledger <台帳のリポジトリの根>  公開の台帳の決まりと共有ファイルを、受け手と同じ関数で確かめる（✓／✗ と理由）
  moyai ledger validate-pr --base <SHA> --head <SHA> [--repo <道>] [--json <道>] [--markdown <道>]
                                            台帳の PR の変更を、checkout せずに git の木から確かめる（Actions の検証）
  moyai ledger site <台帳のリポジトリの根> <出すフォルダ>
                                            共有ファイルを再照合し、類似施設の星取表と統計の行の静的なページを書く
  moyai ledger submit --bundle <共有ファイル> --repo <台帳の clone>
                                            署名済みの共有ファイルを出す PR の支度をし、gh のコマンドを出す（人だけ。端末から）
  moyai ledger init --root <台帳のリポジトリの根> --pack <Skillパック> [--month YYYY-MM]
                                            台帳の決まり（ledger.json）を作り、管理者の鍵で署名する（人だけ。端末から）
  moyai keys create --root <共有フォルダ> --pack <Skillパック>
                                            共有フォルダを作り、その共有フォルダの鍵を状態フォルダに置く（人だけ。端末から）
  moyai keys unwrap                         前の形の鍵（パスワードで包んだもの）を、前のパスワードで 1 度だけ開いて移す（人だけ。端末から）
  moyai send                                共有ファイルを送る（人だけ。検問所の画面から送る。端末からは未実装）
  moyai --version                           ビルドの版を出す`;

async function start(argv: string[]): Promise<void> {
  const args = parseStartArgs(argv);
  if (!args) return fail("bad_args");
  const staticDir = join(dirname(fileURLToPath(import.meta.url)), "app");
  if (!existsSync(join(staticDir, "index.html"))) return fail("app_missing");
  try {
    // 止める合図（moyai uninstall か、古い版を替える中継）でも、SIGINT と同じに止める
    let stopRequested = false;
    // 鍵ファイルに版（ビルドの commit）を書く。新しい版の中継は、これが自分と違えば止める合図を送って替える
    const bridge = await startBridge({
      port: args.port,
      staticDir,
      stateDir: resolveStateDir(),
      log: say,
      onStopRequest: () => void stopNow(),
      build: __MOYAI_BUILD__.commit,
      // 作業画面を開く手（work_screen_open と、作業画面が開いていないときに橋渡しが開く）
      // MOYAI_NO_AUTO_OPEN=1（試験）では開かない。試験の橋渡しが本物のブラウザを開かないように
      ...(process.env.MOYAI_NO_AUTO_OPEN === "1" ? {} : { openUrl: openBrowser }),
    });
    say(`${BUILD}`);
    say(`橋渡しを起こしました：${bridge.url}  （止めるには Ctrl+C）`);
    if (args.open) openBrowser(bridge.url);
    async function stopNow(): Promise<void> {
      if (stopRequested) return;
      stopRequested = true;
      await bridge.close();
      say("橋渡しを止めました");
      process.exit(0);
    }
    const stop = stopNow;
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    if (e instanceof BridgeStartError) return fail(e.code === "port_denied" ? "port_denied" : "port_in_use", { port: e.port });
    throw e;
  }
}

/** 橋渡し（moyai start --no-open）を、切り離した子プロセスで起こす（中継が、橋渡しが起きていないときに使う） */
function launchBridge(): LaunchHandle {
  const cli = process.argv[1] ?? fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [cli, "start", "--no-open"], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  const exited = new Promise<unknown>((res) => {
    child.once("exit", res);
    child.once("error", res);
  });
  child.unref();
  return { exited };
}

/** 中継に橋渡しを起こさせない（試験と、橋渡しを手で起こしたい人のため）。1 なら起こさず、今のとおり「先に moyai start を」と返す */
export const NO_LAUNCH_ENV = "MOYAI_NO_BRIDGE_LAUNCH";

async function mcp(): Promise<void> {
  const launch = process.env[NO_LAUNCH_ENV] === "1" ? undefined : launchBridge;
  // 起こす橋渡しは既定のポート。古い版の橋渡しが動いていれば、中継が止めて替える（版は鍵ファイルの build と比べる）
  const server = createRelayServer({
    stateDir: resolveStateDir(),
    version: __MOYAI_BUILD__.commit,
    ...(launch ? { launch, launchPort: DEFAULT_PORT } : {}),
  });
  await server.connect(new StdioServerTransport());
  // AI クライアントが受けたツールの定義の指紋を残す（moyai update が開き直しの要る・要らないを決める。#43）
  writeRelayDigest(resolveStateDir());
  say("moyai mcp：中継を起こしました（標準入出力）");
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === "start") return start(rest);
  if (cmd === "mcp") {
    if (rest.length) return fail("bad_args");
    return mcp();
  }
  if (cmd === "verify") {
    if (rest[0] === "ledger") return process.exit(await verifyLedgerCli(rest));
    if (rest[0] === "demo-ring") return process.exit(await verifyDemoRingCli(rest));
    return process.exit(await verifyRingCli(rest));
  }
  if (cmd === "setup") return process.exit(await (await import("./setup")).setupCli({ argv: rest }));
  if (cmd === "update") return process.exit(await (await import("./update")).updateCli({ argv: rest, buildCommit: __MOYAI_BUILD__.commit }));
  if (cmd === "uninstall") return process.exit(await (await import("./uninstall")).uninstallCli({ argv: rest }));
  if (cmd === "ledger") return process.exit(await ledgerCli(rest, { build: BUILD }));
  if (cmd === "keys") return process.exit(await keysCli(rest));
  if (cmd === "send") return process.exit(sendCli());
  if (cmd === "eval") return process.exit(await (await import("../eval/cli")).evalCli(rest));
  if (cmd === "--version" || cmd === "-v") return say(BUILD);
  if (cmd === undefined || cmd === "--help" || cmd === "-h") return say(HELP);
  fail("bad_args");
}

main(process.argv.slice(2)).catch((e: unknown) => {
  say(`moyai：止まりました（${e instanceof Error ? e.name : "誤り"}）`);
  process.exit(1);
});
