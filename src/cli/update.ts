// moyai update [--yes]（mushitaro/moyai#43。運営者「アプリがデプロイされていないようです」）。
// 利用者の PC の clone を origin/main の版にする。版の見分けは、ビルドの版のコミット（dist に埋めたもの）と clone の先のコミット。
// Skill の本文で見ない（コードだけが変わった版を「もう入っています」と言わない）。
// 1. clone で git fetch origin main。HEAD・origin/main・ビルドの版のコミットを比べる。どれも同じなら「最新です」で終える。
// 2. 手元に変更がある（追跡しているファイルが変わっている）・main の枝でない・早送りで進めない、ときは止めて理由を言う（何も変えない）。
// 3. git pull --ff-only → npm ci → npm run build。
// 4. 動いている橋渡しを止める（uninstall と同じ止める合図）。次のツールの呼び出しで、中継が新しいビルドの橋渡しを起こす。
// 5. ツールの定義（名前・説明・入出力の形・MCP の instructions）が変わったときだけ「Claude Desktop を 1 回開き直す」が要ると言う。
//    比べるのは、動いている中継が起きたときに状態フォルダに書いた指紋（AI クライアントが持っている定義）と、新しいビルドが出す指紋（moyai update --digest）。
//    どちらかが分からなければ（前の版の中継は書かない・新しいビルドが出せない）、要ると言う（分からないものを要らないと言わない）。
// 何をするかを先に出す。--yes が無ければ変えない（Claude が中身を利用者にチャットで見せ、「はい」をもらったら --yes を付けて走らせる）。
// ビルドのあとは dist の中身が替わるので、このファイルは後から読み込む（動的 import）ものを使わない。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う。--digest の 1 行だけは標準出力に出す。中継ではないので）。
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readKeyFile, resolveStateDir, type KeyFile } from "../bridge/state";
import { stopBridgeAt, type StopOutcome } from "./relay";
import { askLine } from "./setup";
import { readRelayDigest, toolsDigest } from "./tools-digest";

export { toolsDigest };

export const UPDATE_TEXT = {
  usage: "使い方：moyai update [--yes]",
  notRepo: (dir: string) => `MOYAI のフォルダ（${dir}）が git の clone ではないので、更新できません。入れ直してください（1 段目の Skill のインストールの手順）。`,
  fetchFailed: "origin から main を取ってこられませんでした（ネットワークか、origin の設定）。何も変えていません。",
  latest: (commit: string) => `最新です（ビルドの版のコミット ${commit} が origin/main と同じ）。何も変えていません。`,
  dirty: (n: number) =>
    `手元に変更があるファイルが ${n} 件あるので、更新しません（git pull が手元の変更を上書きしないように）。何も変えていません。変更を残すか捨てるかを利用者に聞いてください。`,
  notMain: (branch: string) => `clone の枝が main ではなく ${branch} なので、更新しません。何も変えていません。`,
  diverged: "clone の main に origin/main に無いコミットがあり、早送りで進めないので、更新しません。何も変えていません。",
  head: "MOYAI を origin/main の版にします。次のことをします：",
  pull: (from: string, to: string, n: number) => `1. clone で git pull --ff-only（${from} → ${to}、${n} 個のコミット）。`,
  pullNone: (at: string) => `1. clone は origin/main（${at}）と同じなので、git pull はしません（ビルドだけが古い）。`,
  ci: "2. npm ci（依存を入れ直す）。",
  build: "3. npm run build（作業画面と中継と橋渡しを作り直す）。",
  bridge: (port: number) => `4. 動いている橋渡し（127.0.0.1:${port}）を止めます。次に moyai のツールを呼ぶと、新しいビルドの橋渡しが起きます。`,
  bridgeNone: "4. 橋渡しは起きていません。次に moyai のツールを呼ぶと、新しいビルドの橋渡しが起きます。",
  ask: "更新してよければ「はい」と打って Enter：",
  yes: "--yes なので、確かめずに更新します（利用者がチャットで確かめた前提）。",
  notTerminal:
    "--yes が無いので、何も変えていません。上の中身を利用者にチャットで見せ、良ければ --yes を付けて Claude が走らせてください（利用者の端末の操作は要りません）。",
  cancelled: "何も変えていません。",
  stepFailed: (what: string, detail: string) =>
    `${what}で止まりました。ここまでに済んだことは戻していません。そのフォルダで npm ci と npm run build を（利用者に聞いてから）走らせ直し、Claude Desktop の開き直しを頼んでください（npm ci の途中で止まると、このコマンドは走らないことがある）。${detail ? `\n${detail}` : ""}`,
  pulled: (to: string) => `git pull を済ませました（${to}）。`,
  built: "npm ci と npm run build を済ませました。",
  stopped: "橋渡しを止めました。",
  stopSkipped: "橋渡しは起きていませんでした。",
  stopFailed: "橋渡しが止まったかを確かめられませんでした。次のツールの呼び出しで、中継が前の版の橋渡しを替えます。",
  reopen: "ツールの定義が変わりました。Claude Desktop を 1 回閉じて、開き直してください（Claude Code なら /mcp でつなぎ直す）。",
  reopenUnknown: "ツールの定義が変わったかを確かめられませんでした。Claude Desktop を 1 回閉じて、開き直してください（Claude Code なら /mcp でつなぎ直す）。",
  noReopen: "ツールの定義は変わっていないので、Claude Desktop の開き直しは要りません。",
  reload: "開いている作業画面のタブは前の版のままです。moyai のツール（intake_survey を show: true）を呼んで、答えの作業画面を読み込み直してください。",
};

export interface UpdateArgs {
  yes: boolean;
  digest: boolean;
}

export function parseUpdateArgs(argv: readonly string[]): UpdateArgs | null {
  let yes = false;
  let digest = false;
  for (const a of argv) {
    if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--digest") digest = true;
    else return null;
  }
  if (digest && yes) return null;
  return { yes, digest };
}

/** 走らせる手（試験は差し替える）。失敗したら投げる */
export type Run = (cmd: "git" | "npm" | "node", args: readonly string[], cwd: string) => string;

export const defaultRun: Run = (cmd, args, cwd) => {
  // npm と vite の出力が多くても切られないように、受ける量を広げる。止まったままにならないように 15 分で切る
  const o: ExecFileSyncOptions = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 };
  if (cmd === "node") return execFileSync(process.execPath, args, o) as unknown as string;
  // Windows の npm は npm.cmd。.cmd は shell を通さないと走らない（引数は決まった字だけで、利用者の字を入れない）
  if (cmd === "npm" && process.platform === "win32") return execFileSync("npm.cmd", args, { ...o, shell: true }) as unknown as string;
  return execFileSync(cmd, args, o) as unknown as string;
};

export type UpdatePlan =
  | { kind: "not_repo" | "fetch_failed" | "diverged" }
  | { kind: "latest"; commit: string }
  | { kind: "dirty"; files: number }
  | { kind: "not_main"; branch: string }
  | { kind: "update"; head: string; remote: string; commits: number };

/** ビルドの版のコミット（短い形。作業中の変更があれば「+」）が、そのコミットを指すか */
export function stampIs(stamp: string, full: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(stamp) && full.startsWith(stamp);
}

/** clone と origin/main とビルドの版を比べ、することを決める（fetch のほかは何も変えない） */
export function planUpdate(repoDir: string, buildCommit: string, run: Run = defaultRun): UpdatePlan {
  const git = (...args: string[]): string => run("git", args, repoDir).trim();
  try {
    if (git("rev-parse", "--is-inside-work-tree") !== "true") return { kind: "not_repo" };
    // MOYAI のフォルダそのものが clone の根であること（ほかのリポジトリの中に置いたフォルダで、そのリポジトリを pull しない）
    if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(repoDir)) return { kind: "not_repo" };
  } catch {
    return { kind: "not_repo" };
  }
  try {
    git("fetch", "--quiet", "origin", "main");
  } catch {
    return { kind: "fetch_failed" };
  }
  const head = git("rev-parse", "HEAD");
  const remote = git("rev-parse", "origin/main");
  if (head === remote && stampIs(buildCommit, head)) return { kind: "latest", commit: buildCommit };
  const changed = git("status", "--porcelain", "--untracked-files=no").split("\n").filter((l) => l.trim() !== "").length;
  if (changed > 0) return { kind: "dirty", files: changed };
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") return { kind: "not_main", branch };
  try {
    git("merge-base", "--is-ancestor", "HEAD", "origin/main");
  } catch {
    return { kind: "diverged" };
  }
  const commits = Number(git("rev-list", "--count", "HEAD..origin/main")) || 0;
  return { kind: "update", head, remote, commits };
}

const short = (c: string): string => c.slice(0, 7);

/** 止まった道具の標準エラーの終わりの数行（npm と git の知らせ。作業データは通らない） */
function errTail(e: unknown): string {
  const err = (e as { stderr?: unknown }).stderr;
  const text = typeof err === "string" ? err : Buffer.isBuffer(err) ? err.toString("utf8") : "";
  return text.trim().split(/\r?\n/).slice(-5).join("\n");
}

/**
 * update。最新か更新を終えたら 0、止まったら 1、引数の形が違えば 2、端末でなく --yes も無ければ 3（何も変えない）。
 */
export async function updateCli(o: {
  argv?: readonly string[];
  buildCommit: string;
  repoDir?: string;
  stateDir?: string;
  stdin?: { isTTY?: boolean };
  run?: Run;
  stop?: (stateDir: string, key: KeyFile) => Promise<StopOutcome>;
  ask?: (prompt: string) => Promise<string | null>;
  say?: (m: string) => void;
  out?: (m: string) => void;
}): Promise<number> {
  const say = o.say ?? ((m: string) => process.stderr.write(`${m}\n`));
  const a = parseUpdateArgs(o.argv ?? []);
  if (!a) {
    say(UPDATE_TEXT.usage);
    return 2;
  }
  if (a.digest) {
    (o.out ?? ((m: string) => process.stdout.write(`${m}\n`)))(toolsDigest());
    return 0;
  }
  const run = o.run ?? defaultRun;
  const repoDir = o.repoDir ?? resolve(dirname(process.argv[1] ?? "dist/cli.js"), "..");
  const p = planUpdate(repoDir, o.buildCommit, run);
  if (p.kind !== "update") {
    if (p.kind === "latest") say(UPDATE_TEXT.latest(p.commit));
    else if (p.kind === "dirty") say(UPDATE_TEXT.dirty(p.files));
    else if (p.kind === "not_main") say(UPDATE_TEXT.notMain(p.branch));
    else say(p.kind === "not_repo" ? UPDATE_TEXT.notRepo(repoDir) : p.kind === "fetch_failed" ? UPDATE_TEXT.fetchFailed : UPDATE_TEXT.diverged);
    return p.kind === "latest" ? 0 : 1;
  }
  const stateDir = o.stateDir ?? resolveStateDir();
  const key = readKeyFile(stateDir);
  say(UPDATE_TEXT.head);
  say(p.head === p.remote ? UPDATE_TEXT.pullNone(short(p.head)) : UPDATE_TEXT.pull(short(p.head), short(p.remote), p.commits));
  say(UPDATE_TEXT.ci);
  say(UPDATE_TEXT.build);
  say(key ? UPDATE_TEXT.bridge(key.port) : UPDATE_TEXT.bridgeNone);

  if (a.yes) say(UPDATE_TEXT.yes);
  else {
    if ((o.stdin ?? process.stdin).isTTY !== true) {
      say(UPDATE_TEXT.notTerminal);
      return 3;
    }
    const ans = await (o.ask ?? askLine)(UPDATE_TEXT.ask);
    if (ans === null || ans.trim() !== "はい") {
      say(UPDATE_TEXT.cancelled);
      return 0;
    }
  }

  // AI クライアントが持っている定義の指紋は、動いている中継が起きたときに書いたもの
  const before = readRelayDigest(stateDir);
  const step = (what: string, f: () => void): boolean => {
    try {
      f();
      return true;
    } catch (e) {
      say(UPDATE_TEXT.stepFailed(what, errTail(e)));
      return false;
    }
  };
  if (p.head !== p.remote) {
    if (!step("git pull", () => run("git", ["pull", "--ff-only", "--quiet", "origin", "main"], repoDir))) return 1;
    say(UPDATE_TEXT.pulled(short(p.remote)));
  }
  if (!step("npm ci", () => run("npm", ["ci", "--no-audit", "--no-fund"], repoDir))) return 1;
  if (!step("npm run build", () => run("npm", ["run", "build"], repoDir))) return 1;
  say(UPDATE_TEXT.built);

  if (key) {
    const r = await (o.stop ?? stopBridgeAt)(stateDir, key);
    say(r === "stopped" ? UPDATE_TEXT.stopped : r === "not_running" ? UPDATE_TEXT.stopSkipped : UPDATE_TEXT.stopFailed);
  }
  let after: string | null = null;
  try {
    after = run("node", [resolve(repoDir, "dist", "cli.js"), "update", "--digest"], repoDir).trim();
  } catch {
    after = null;
  }
  say(before === null || after === null || !/^[0-9a-f]{64}$/.test(after) ? UPDATE_TEXT.reopenUnknown : after === before ? UPDATE_TEXT.noReopen : UPDATE_TEXT.reopen);
  if (key) say(UPDATE_TEXT.reload);
  return 0;
}
