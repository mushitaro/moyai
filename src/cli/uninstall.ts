// moyai uninstall [--yes] [--keep-root|--remove-root]（運営者の決定 11-06「チャットだけで入れる・デモする・消す」）。
// 1. 橋渡しを止める：鍵ファイルの居場所（ポート）に、鍵を添えて止める合図を送る（経路 relayStop）。鍵ファイルが無ければ飛ばす。
// 2. Claude Desktop の設定から mcpServers.moyai だけを外す（ほかのサーバーは変えない。前の設定は .bak に残す。読めない設定には書かない）。
// 3. Claude Code の登録を外す手順（claude mcp remove）を出す（Claude Code の設定には書かない）。
// 4. 状態フォルダを消す（人の鍵・覚えた鍵・GitHub のトークン・設定も消える）。
// 5. 保存先（計画の版）は既定で残す。--remove-root のときだけ消す（Claude が利用者にチャットで聞いてから付ける）。
// 何を消すかを先に出す。--yes が無ければ消さない（Claude が中身を利用者にチャットで見せ、「はい」をもらったら --yes を付けて走らせる）。
// 人が端末から直に走らせたときだけ、その場で「はい」を聞く（標準入力が端末でなければ、何も消さずに終える）。
// リポジトリのフォルダは消さない（このコマンドが動いている場所なので。Claude が最後に消す。1 段目の Skill の手順）。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, parse, resolve } from "node:path";
import { defaultRoot, detectDocuments, normPath, readSettings } from "../bridge/places";
import { readKeyFile, resolveStateDir, type KeyFile } from "../bridge/state";
import { stopBridgeAt, type StopOutcome } from "./relay";
import { SERVER_NAME, askLine, claudeConfigPath } from "./setup";

export const UNINSTALL_TEXT = {
  usage: "使い方：moyai uninstall [--yes] [--keep-root|--remove-root]",
  head: "MOYAI を消します。次のことをします：",
  bridge: (port: number) => `1. 橋渡し（127.0.0.1:${port}）を止めます。`,
  bridgeNone: "1. 橋渡しは起きていません（鍵ファイルがありません）。止める手順は飛ばします。",
  desktop: (path: string) => `2. Claude Desktop の設定（${path}）から moyai の行だけを外します（ほかのサーバーは変えません）。今の設定は ${path}.bak に残します。`,
  desktopNone: (path: string) => `2. Claude Desktop の設定（${path}）に moyai の行はありません。変えません。`,
  desktopMissing: "2. Claude Desktop の設定のファイルはありません。変えません。",
  desktopInvalid: (path: string) => `2. Claude Desktop の設定（${path}）を JSON として読めないので、変えません。moyai の行は手で外してください。`,
  code: "3. Claude Code に claude mcp add で足していたら、次の 1 行で外します（このコマンドは Claude Code の設定に書きません）：",
  codeLine: `  claude mcp remove --scope user ${SERVER_NAME}`,
  codeRepo: "   リポジトリの .mcp.json は、リポジトリのフォルダと一緒に消えます。",
  state: (path: string) => `4. 状態フォルダ（${path}）を消します。人の鍵・覚えた鍵・GitHub のトークン・設定・送信者の名前も消え、戻せません。`,
  stateNone: (path: string) => `4. 状態フォルダ（${path}）はありません。`,
  rootKeep: (path: string) => `5. 保存先（${path}）は残します。計画の版・施設の署名鍵・資料はそのままです（消すのは --remove-root のときだけ）。`,
  rootRemove: (path: string) => `5. 保存先（${path}）を消します。計画の版・施設の署名鍵・資料が消え、戻せません。`,
  rootUnknown: "5. 保存先の場所が分かりません。保存先には触れません。",
  rootNone: (path: string) => `5. 保存先（${path}）はありません。`,
  rootUnsafe: (path: string) => `5. 保存先（${path}）は、ホームのフォルダかドライブの根と重なるので消しません。`,
  repo: (path: string) => `最後に、リポジトリのフォルダ（${path}）を消すと、MOYAI は残りません（このコマンドは消しません）。`,
  ask: "消してよければ「はい」と打って Enter：",
  yes: "--yes なので、確かめずに消します（利用者がチャットで確かめた前提）。",
  notTerminal: "--yes が無いので、何も消していません。上の中身を利用者にチャットで見せ、良ければ --yes を付けて Claude が走らせてください（利用者の端末の操作は要りません）。",
  cancelled: "何も消していません。",
  stopped: "橋渡しを止めました。",
  stopSkipped: "橋渡しは起きていませんでした。",
  stopFailed: "橋渡しが止まったかを確かめられませんでした。ほかの手順は続けます。",
  desktopDone: (bak: string) => `Claude Desktop の設定から moyai の行を外しました（前の設定は ${bak}）。Claude Desktop を開き直すと、moyai のツールが消えます。`,
  stateDone: "状態フォルダを消しました。",
  rootDone: "保存先を消しました。",
  failed: (what: string) => `${what}を消せませんでした（開いているアプリを閉じてから、もう一度走らせてください）。`,
  after: "AI クライアントを開き直すまで、moyai のツールを呼ばないでください（呼ぶと中継が橋渡しを起こし直し、状態フォルダができ直します）。",
};

export interface UninstallArgs {
  yes: boolean;
  removeRoot: boolean;
}

export function parseUninstallArgs(argv: readonly string[]): UninstallArgs | null {
  let yes = false;
  let keep = false;
  let remove = false;
  for (const a of argv) {
    if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--keep-root") keep = true;
    else if (a === "--remove-root") remove = true;
    else return null;
  }
  if (keep && remove) return null;
  return { yes, removeRoot: remove };
}

/** 消してよい保存先か：ドライブの根・ホーム・ホームを含むフォルダは消さない */
export function rootRemovable(root: string, platform: NodeJS.Platform = process.platform, home: string = homedir()): boolean {
  const r = normPath(resolve(root), platform);
  const h = normPath(resolve(home), platform);
  if (r === normPath(parse(resolve(root)).root, platform) || r === "") return false;
  return !(h === r || h.startsWith(`${r}/`));
}

/** 設定から moyai の行を外した中身。無ければ null */
export function withoutMoyai(config: Record<string, unknown>): Record<string, unknown> | null {
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object" || !Object.hasOwn(servers, SERVER_NAME)) return null;
  const { [SERVER_NAME]: _gone, ...rest } = servers as Record<string, unknown>;
  return { ...config, mcpServers: rest };
}

// 止める合図の道は、古い版の橋渡しを替える中継と同じもの（src/cli/relay.ts）
export { stopBridgeAt, type StopOutcome };

type DesktopPlan = { kind: "remove"; path: string; next: Record<string, unknown> } | { kind: "none" | "missing" | "invalid"; path: string };

function desktopPlan(path: string): DesktopPlan {
  if (!existsSync(path)) return { kind: "missing", path };
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { kind: "invalid", path };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { kind: "invalid", path };
  const next = withoutMoyai(v as Record<string, unknown>);
  return next ? { kind: "remove", path, next } : { kind: "none", path };
}

/**
 * uninstall。終えたら 0、どれかを消せなかったら 1、引数の形が違えば 2、端末でなく --yes も無ければ 3（何も消さない）。
 */
export async function uninstallCli(
  o: {
    argv?: readonly string[];
    stdin?: { isTTY?: boolean };
    stateDir?: string;
    configPath?: string;
    /** 保存先の場所（既定：設定の置き場所か、Documents の下の MOYAI/） */
    root?: (stateDir: string) => Promise<string | null>;
    stop?: (stateDir: string, key: KeyFile) => Promise<StopOutcome>;
    repoDir?: string;
    platform?: NodeJS.Platform;
    home?: string;
    ask?: (prompt: string) => Promise<string | null>;
    say?: (m: string) => void;
  } = {},
): Promise<number> {
  const say = o.say ?? ((m: string) => process.stderr.write(`${m}\n`));
  const a = parseUninstallArgs(o.argv ?? []);
  if (!a) {
    say(UNINSTALL_TEXT.usage);
    return 2;
  }
  const stateDir = o.stateDir ?? resolveStateDir();
  const key = readKeyFile(stateDir);
  const desktop = desktopPlan(o.configPath ?? claudeConfigPath());
  const stateExists = existsSync(stateDir);
  // 保存先は、状態フォルダを消す前に読む（設定の置き場所は状態フォルダにある）
  const root = await (o.root ?? (async (sd: string) => readSettings(sd).root ?? defaultRoot(await detectDocuments())))(stateDir).catch(() => null);
  const rootExists = root !== null && existsSync(root);
  const removable = root !== null && rootRemovable(root, o.platform, o.home);
  const repoDir = o.repoDir ?? resolve(dirname(process.argv[1] ?? "dist/cli.js"), "..");

  say(UNINSTALL_TEXT.head);
  say(key ? UNINSTALL_TEXT.bridge(key.port) : UNINSTALL_TEXT.bridgeNone);
  say(
    desktop.kind === "remove"
      ? UNINSTALL_TEXT.desktop(desktop.path)
      : desktop.kind === "none"
        ? UNINSTALL_TEXT.desktopNone(desktop.path)
        : desktop.kind === "invalid"
          ? UNINSTALL_TEXT.desktopInvalid(desktop.path)
          : UNINSTALL_TEXT.desktopMissing,
  );
  say(UNINSTALL_TEXT.code);
  say(UNINSTALL_TEXT.codeLine);
  say(UNINSTALL_TEXT.codeRepo);
  say(stateExists ? UNINSTALL_TEXT.state(stateDir) : UNINSTALL_TEXT.stateNone(stateDir));
  if (root === null) say(UNINSTALL_TEXT.rootUnknown);
  else if (!rootExists) say(UNINSTALL_TEXT.rootNone(root));
  else if (!a.removeRoot) say(UNINSTALL_TEXT.rootKeep(root));
  else say(removable ? UNINSTALL_TEXT.rootRemove(root) : UNINSTALL_TEXT.rootUnsafe(root));
  say(UNINSTALL_TEXT.repo(repoDir));

  if (a.yes) say(UNINSTALL_TEXT.yes);
  else {
    if ((o.stdin ?? process.stdin).isTTY !== true) {
      say(UNINSTALL_TEXT.notTerminal);
      return 3;
    }
    const ans = await (o.ask ?? askLine)(UNINSTALL_TEXT.ask);
    if (ans === null || ans.trim() !== "はい") {
      say(UNINSTALL_TEXT.cancelled);
      return 0;
    }
  }

  let failed = false;
  if (key) {
    const r = await (o.stop ?? stopBridgeAt)(stateDir, key);
    say(r === "stopped" ? UNINSTALL_TEXT.stopped : r === "not_running" ? UNINSTALL_TEXT.stopSkipped : UNINSTALL_TEXT.stopFailed);
  }
  if (desktop.kind === "remove") {
    const bak = `${desktop.path}.bak`;
    copyFileSync(desktop.path, bak);
    writeFileSync(desktop.path, `${JSON.stringify(desktop.next, null, 2)}\n`);
    say(UNINSTALL_TEXT.desktopDone(bak));
  }
  if (stateExists) {
    try {
      rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 });
      say(UNINSTALL_TEXT.stateDone);
    } catch {
      failed = true;
      say(UNINSTALL_TEXT.failed("状態フォルダ"));
    }
  }
  if (a.removeRoot && root !== null && rootExists && removable) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      say(UNINSTALL_TEXT.rootDone);
    } catch {
      failed = true;
      say(UNINSTALL_TEXT.failed("保存先"));
    }
  }
  say(UNINSTALL_TEXT.after);
  return failed ? 1 : 0;
}
