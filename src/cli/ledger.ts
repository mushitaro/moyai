// 公開の台帳の CLI（docs/plan.md §2.8 場 2・docs/sharing.md）。台帳は MOYAI のリポジトリの ledger/（2026-11-07 に mushitaro/moyai-ledger から移した）。
// 台帳の根を指すときは、MOYAI のリポジトリ（の clone）の根を指す（その下の ledger/ と ledger/ledger/ も受ける）。
// - `moyai verify ledger <MOYAI の clone>`：輪の受け手と同じ関数で、決まり（ledger.json）と束ごとに ✓ か理由つきの ✗ を出す。
// - `moyai ledger validate-pr --base <SHA> --head <SHA>`：MOYAI のリポジトリの pull_request_target の検証。head を checkout せず、
//   git の木から blob だけを読む。ledger/ の外を変える PR は「台帳の PR ではない」として検証しない（台帳のファイルが混ざっていれば ✗）。
//   結果を JSON（機械が読む）と日本語の markdown（PR のコメント）に書く。
// - `moyai ledger site <MOYAI の clone> <出すフォルダ>`：確かめ直した束から 1 枚の HTML を書く。
// - `moyai ledger submit --bundle <束か取り下げの印> --repo <clone>`：人だけ（端末でなければ断る）。PR の支度をし、gh のコマンドを出す（走らせない）。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。終わりの値：すべて ✓ なら 0、どれかが ✗ なら 1、引数や読めない台帳・道具の誤りは 2。
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { reasonText } from "../app/text/reasons";
import { RETIRED_V, bundleFileName } from "../share/bundle";
import { fingerprint, sha256Hex } from "../share/sign";
import { requireTerminal } from "./human";
import { createLedger } from "../share/ledger-init";
import { resolveStateDir } from "../bridge/state";
import {
  LEDGER_BUNDLES_PATH,
  LEDGER_DIR,
  LEDGER_FILE,
  LEDGER_JSON_PATH,
  LEDGER_LIMITS,
  LEDGER_ROOT,
  checkRetiredAdded,
  ledgerRetiredPath,
  ledgerRulesHaveRemovedField,
  ledgerRulesOf,
  readLedgerDir,
  verifyLedgerFiles,
  type LedgerFile,
  type LedgerRead,
} from "../share/ledger";
import { loadSharePack, resolvePacksDir, type SharePack } from "../share/pack";
import { PR_LIMITS, displayablePath, validateAll, validatePr, type PrResult } from "../share/prdiff";
import { profileText, renderLedgerSite } from "../share/site";

export const LEDGER_CLI_TEXT = {
  verifyUsage: `使い方：moyai verify ledger <台帳の clone>（その下に ${LEDGER_JSON_PATH} と ${LEDGER_BUNDLES_PATH}/ がある）`,
  noLedger: (p: string) => `台帳が見つかりません：${p}（${LEDGER_JSON_PATH} のある台帳の clone の根を指してください）`,
  dirSymlink: `${LEDGER_ROOT ? `${LEDGER_ROOT}/ か ` : ""}${LEDGER_DIR}/ が symlink です。たどらずに止めました。`,
  tooMany: `${LEDGER_DIR}/ の下のファイルが多すぎます（上限を越えたので止めました）。`,
  rulesUnreadable: `台帳の決まり（${LEDGER_JSON_PATH}）を読めません。`,
  /** 決まりが、どこにも出さない欄（経過年）を許している（前の版の決まり） */
  rulesFieldRemoved: (reason: string) => `台帳の決まり（${LEDGER_JSON_PATH}）を読めません：${reason}。`,
  packNotReady: (pack: string, reason: string) => `Skillパック ${pack} の共有の部品を読めません（${reason}）`,
  head: (id: string | null, version: number | null, hash: string | null) =>
    `台帳 ${id ?? "（ID 不明）"}${version !== null ? `（決まり 版 ${version}` : "（決まり"}、SHA-256 ${hash ? hash.slice(0, 16) : "不明"}…）`,
  rules: `決まり（${LEDGER_JSON_PATH}）`,
  bundle: (p: string) => `共有ファイル ${p}`,
  retired: (p: string) => `失効記録 ${p}`,
  other: (p: string) => `許した形の外 ${p}`,
  noBundles: "共有ファイルは 0 件です。",
  summaryOk: (n: number) => `すべて ✓ です（共有ファイル ${n} 件）。`,
  summaryNg: (n: number) => `✗ が ${n} 件あります。`,
};

const say = (m: string) => process.stderr.write(`${m}\n`);

/** 指した道から、台帳のリポジトリの根を決める（根か、その下の台帳の根か、決まりのあるフォルダを受ける）。見つからなければ null */
export function ledgerRootOf(folder: string): string | null {
  const abs = resolve(folder);
  const inner = LEDGER_DIR.split("/");
  // 指した道が、台帳のフォルダの道の up 段目まで入った所のとき：末尾の up 段の名前が合い、残りの下に決まりがある
  for (let up = 0; up <= inner.length; up++) {
    let base = abs;
    let ok = true;
    for (let k = up - 1; k >= 0 && ok; k--) {
      if (basename(base) !== inner[k]) ok = false;
      else base = dirname(base);
    }
    if (ok && existsSync(join(abs, ...inner.slice(up), LEDGER_FILE))) return base;
  }
  return null;
}

/** 決まりを読めないときの知らせ。どこにも出さない欄を許す決まりなら、その理由を添える */
function rulesUnreadableText(lf: LedgerFile | undefined): string {
  return lf && lf.kind === "file" && ledgerRulesHaveRemovedField(lf.bytes)
    ? LEDGER_CLI_TEXT.rulesFieldRemoved(reasonText("shape.rules.fieldRemoved"))
    : LEDGER_CLI_TEXT.rulesUnreadable;
}

export type LedgerLoad =
  | { ok: true; files: LedgerFile[]; pack: SharePack; read: LedgerRead }
  | { ok: false; code: 2; message: string };

/** 台帳を読み、決まりのパックで確かめる（verify ledger とサイトが同じこの関数を使う） */
export async function loadLedger(root: string, o: { packsDir?: string } = {}): Promise<LedgerLoad> {
  const d = await readLedgerDir(root);
  if (!d.ok) {
    return { ok: false, code: 2, message: d.reason === "ledgerDirSymlink" ? LEDGER_CLI_TEXT.dirSymlink : d.reason === "tooManyFiles" ? LEDGER_CLI_TEXT.tooMany : LEDGER_CLI_TEXT.noLedger(root) };
  }
  const lf = d.files.find((f) => f.path === LEDGER_JSON_PATH);
  if (!lf) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.noLedger(root) };
  const rules = lf.kind === "file" ? ledgerRulesOf(lf.bytes) : null;
  if (!rules) return { ok: false, code: 2, message: rulesUnreadableText(lf) };
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.packNotReady(rules.pack, pack.reason) };
  return { ok: true, files: d.files, pack: pack.pack, read: verifyLedgerFiles(d.files, pack.pack) };
}

const reasonsText = (rs: readonly string[]) => [...new Set(rs.map(reasonText))].join("、");

/** 端末に出す道：制御文字（端末の逃がし列など）を ? にする（ファイル名は台帳に置いた人が決められるため） */
export function terminalSafe(p: string): string {
  return [...p].map((c) => (isControl(c.codePointAt(0)!) ? "?" : c)).join("");
}

/** 制御文字か（C0・DEL・C1・行と段落の区切り） */
function isControl(n: number): boolean {
  return n < 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029;
}

/** 台帳の確かめの結果を行にする（✓／✗ と理由） */
export function formatLedger(r: LedgerRead): string[] {
  const lines = [LEDGER_CLI_TEXT.head(r.ledger.id, r.ledger.version, r.ledger.hash)];
  lines.push(r.ledger.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.rules}` : `  ✗ ${LEDGER_CLI_TEXT.rules}：${reasonsText(r.ledger.reasons.length ? r.ledger.reasons : ["ledger.unreadable"])}`);
  for (const b of r.bundles) lines.push(b.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.bundle(b.path)}${b.retired ? `（${reasonText("ledger.keyRetired")}）` : ""}` : `  ✗ ${LEDGER_CLI_TEXT.bundle(terminalSafe(b.path))}：${reasonsText(b.reasons)}`);
  for (const x of r.retired) lines.push(x.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.retired(x.path)}` : `  ✗ ${LEDGER_CLI_TEXT.retired(terminalSafe(x.path))}：${reasonsText(x.reasons)}`);
  for (const o of r.others) lines.push(`  ✗ ${LEDGER_CLI_TEXT.other(terminalSafe(o.path))}：${reasonsText(o.reasons)}`);
  if (r.bundles.length === 0) lines.push(`  ${LEDGER_CLI_TEXT.noBundles}`);
  const ng = (r.ledger.status === "ok" ? 0 : 1) + r.bundles.filter((b) => b.status !== "ok").length + r.retired.filter((x) => x.status !== "ok").length + r.others.length;
  lines.push(ng === 0 ? LEDGER_CLI_TEXT.summaryOk(r.bundles.length) : LEDGER_CLI_TEXT.summaryNg(ng));
  return lines;
}

/** verify ledger。argv は verify のあと（["ledger", <道>]）。すべて ✓ なら 0、✗ があれば 1、引数や読めない台帳は 2 */
export async function verifyLedgerCli(argv: string[], o: { packsDir?: string } = {}): Promise<number> {
  const [what, folder, ...rest] = argv;
  if (what !== "ledger" || !folder || rest.length > 0) {
    say(LEDGER_CLI_TEXT.verifyUsage);
    return 2;
  }
  const root = ledgerRootOf(folder);
  if (!root) {
    say(LEDGER_CLI_TEXT.noLedger(folder));
    return 2;
  }
  const l = await loadLedger(root, o);
  if (!l.ok) {
    say(l.message);
    return l.code;
  }
  for (const line of formatLedger(l.read)) say(line);
  return l.read.ok ? 0 : 1;
}

export const LEDGER_USAGE = `使い方：
  moyai ledger validate-pr --base <SHA> --head <SHA> [--repo <道>] [--json <道>] [--markdown <道>]
  moyai ledger site <MOYAI の clone> <出すフォルダ>
  moyai ledger submit --bundle <共有ファイルか失効記録> --repo <MOYAI の clone>（人だけ。端末から）
  moyai ledger init --root <MOYAI の clone> --pack <Skillパック> [--month YYYY-MM]（人だけ。端末から。管理者の鍵で台帳の決まりに署名する）`;

/** ledger init の言葉 */
export const INIT_TEXT = {
  usage: "使い方：moyai ledger init --root <MOYAI の clone の根（絶対の道）> --pack <Skillパック> [--month YYYY-MM]（人だけ。端末から）",
  intro: `公開の台帳の決まり（${LEDGER_JSON_PATH}）を作り、管理者の鍵で署名します。管理者の鍵は、この PC の状態フォルダに置きます（台帳には書きません。パスワードでは包みません）。`,
  failed: (r: string) =>
    ({
      exists: `${LEDGER_JSON_PATH} がもうあります（足すだけの台帳なので、上書きしません）。`,
      monthInvalid: "月の形が違います（YYYY-MM）。",
      keyExists: "この台帳の鍵がもう状態フォルダにあります。",
      selfCheck: "作った決まりを、受け手と同じ関数で読めませんでした。何も書いていません。",
    })[r] ?? r,
  done: (id: string, fp: string, path: string) =>
    [
      `台帳の決まりを書きました：${path}`,
      `台帳 ID：${id}`,
      `管理者の鍵番号：${fp}（台帳の README に載せ、電話などで照合すると、なりすましに気づけます）`,
      "次に、このファイルを MOYAI のリポジトリに commit して push してください（このコマンドは git を走らせません）。",
    ].join("\n"),
};

/** ledger init：人だけ。端末でなければ断る（3）。書けたら 0、断ったら 1、引数の誤りは 2 */
export async function initCli(
  argv: string[],
  o: { packsDir?: string; stdin?: { isTTY?: boolean }; now?: Date; stateDir?: string } = {},
): Promise<number> {
  if (!requireTerminal(o.stdin)) return 3;
  let root: string | null = null;
  let packId: string | null = null;
  let month: string | null = null;
  let bad = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i] ?? null;
    else if (argv[i] === "--pack") packId = argv[++i] ?? null;
    else if (argv[i] === "--month") month = argv[++i] ?? null;
    else bad = true;
  }
  if (bad || !root || !packId || !isAbsolute(root)) {
    say(INIT_TEXT.usage);
    return 2;
  }
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), packId);
  if (!pack.ok) {
    say(INIT_TEXT.failed(pack.reason));
    return 2;
  }
  say(INIT_TEXT.intro);
  const now = o.now ?? new Date();
  const m = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const r = createLedger({ root: resolve(root), pack: pack.pack, stateDir: o.stateDir ?? resolveStateDir(), month: m });
  if (!r.ok) {
    say(INIT_TEXT.failed(r.reason));
    return 1;
  }
  say(INIT_TEXT.done(r.ledgerId, r.fingerprint, r.path));
  return 0;
}

// ─── git の木を読む（checkout しない。head の側のコードを走らせない） ─────────────────

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export type GitRun = (args: string[], maxBytes: number) => { ok: true; out: Buffer } | { ok: false; message: string };

/** git を引数の並びで呼ぶ（シェルを通さない）。外の diff・textconv・端末への問いを使わない */
export function gitRunner(repo: string): GitRun {
  return (args, maxBytes) => {
    const r = spawnSync("git", ["-C", repo, "-c", "core.quotepath=off", ...args], {
      encoding: "buffer",
      maxBuffer: maxBytes,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "" },
    });
    if (r.error) return { ok: false, message: r.error.name };
    if (r.status !== 0) return { ok: false, message: `git ${args[0]} の終わりの値 ${r.status}` };
    return { ok: true, out: r.stdout };
  };
}

export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  path: string | null;
}

/** `git ls-tree -r -z --full-tree <commit>` を読む（道は UTF-8 で読めなければ null） */
export function lsTree(git: GitRun, commit: string): { ok: true; entries: TreeEntry[] } | { ok: false; message: string } {
  const r = git(["ls-tree", "-r", "-z", "--full-tree", commit], 64 * 1024 * 1024);
  if (!r.ok) return r;
  const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const entries: TreeEntry[] = [];
  let start = 0;
  for (let i = 0; i < r.out.length; i++) {
    if (r.out[i] !== 0) continue;
    const rec = r.out.subarray(start, i);
    start = i + 1;
    const tab = rec.indexOf(9);
    if (tab < 0) return { ok: false, message: "ls-tree の形が違う" };
    const m = /^([0-7]{6}) (\w+) ([0-9a-f]{40,64})$/.exec(rec.subarray(0, tab).toString("latin1"));
    if (!m) return { ok: false, message: "ls-tree の形が違う" };
    let path: string | null;
    try {
      path = dec.decode(rec.subarray(tab + 1));
    } catch {
      path = null;
    }
    entries.push({ mode: m[1]!, type: m[2]!, sha: m[3]!, path });
  }
  return { ok: true, entries };
}

/** blob を読む。大きさを先に聞き、上限を越えれば読まない */
export function readBlobWith(git: GitRun, sha: string, limit = LEDGER_LIMITS.fileBytes): Uint8Array | null {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return null;
  const s = git(["cat-file", "-s", sha], 64);
  if (!s.ok) return null;
  const size = Number(s.out.toString("latin1").trim());
  if (!Number.isInteger(size) || size < 0 || size > limit) return null;
  const b = git(["cat-file", "blob", sha], size + 1);
  return b.ok ? new Uint8Array(b.out) : null;
}

/** 木の ledger/ledger/ の下の項目を LedgerFile にする（100644 だけをふつうのファイルとして中身を読む） */
export function ledgerFilesOfTree(git: GitRun, entries: readonly TreeEntry[]): LedgerFile[] {
  const out: LedgerFile[] = [];
  for (const e of entries) {
    if (e.path === null || !(e.path === LEDGER_DIR || e.path.startsWith(`${LEDGER_DIR}/`))) continue;
    if (e.mode === "120000") out.push({ path: e.path, kind: "symlink", bytes: null });
    else if (e.mode === "160000") out.push({ path: e.path, kind: "submodule", bytes: null });
    else if (e.mode === "100644" && e.type === "blob") out.push({ path: e.path, kind: "file", bytes: readBlobWith(git, e.sha) });
    else out.push({ path: e.path, kind: "other", bytes: null });
  }
  return out;
}

// ─── validate-pr ─────────────────────────────────────────────

export const PR_TEXT = {
  usage: "使い方：moyai ledger validate-pr --base <commit の SHA> --head <commit の SHA> [--repo <MOYAI の clone>] [--json <道>] [--markdown <道>]",
  title: (ok: boolean) => (ok ? "### MOYAI 台帳の検証：✓ 通りました" : "### MOYAI 台帳の検証：✗ 通りません"),
  titleNotLedger: "### MOYAI 台帳の検証：台帳の PR ではありません",
  notLedger: (base: string, head: string) =>
    `- ${LEDGER_ROOT}/ の外を変える PR で、台帳のファイル（${LEDGER_DIR}/ の下）を変えていません。共有ファイルの検証はしていません（base \`${base.slice(0, 12)}\`・head \`${head.slice(0, 12)}\`）。`,
  titleError: "### MOYAI 台帳の検証：確かめられませんでした",
  scopePr: (n: number, base: string, head: string) => `- 確かめたもの：この PR が足す・変えるファイル ${n} 件（base \`${base.slice(0, 12)}\`・head \`${head.slice(0, 12)}\`）`,
  scopeAll: (n: number, head: string) => `- 変更なし（base と head が同じ commit \`${head.slice(0, 12)}\`）。既定のブランチにある全部の共有ファイル ${n} 件を再照合しました`,
  ledger: (id: string | null, version: number | null, hash: string | null, ok: boolean) =>
    `- 台帳 \`${id ?? "不明"}\`・決まり 版 ${version ?? "不明"}（SHA-256 \`${hash ? hash.slice(0, 16) : "不明"}\`）${ok ? "" : "：決まりが ✓ でないので、共有ファイルを確かめられません"}`,
  tableHead: "| 結果 | ファイル | 理由 |\n|---|---|---|",
  hidden: (h: string) => `（名前を表示しない道。道の SHA-256 \`${h.slice(0, 16)}\`）`,
  none: "—",
  input: (r: string) => `- 入力を読めません：${r}`,
  how:
    "確かめ方：既定のブランチにある定義が、PR の head を checkout せず、git の木から blob のバイト列だけを読み、アプリと同じ関数（形・署名・鎖・粒度・禁止語・数え直し・紛れる数 k）で確かめました。鍵 ID と出した人の結びつきは共有ファイルの署名で決めています（GitHub のアカウント名は使いません）。",
  error: (m: string) => `validate-pr：${m}`,
};

export interface ValidateOutput {
  v: "moyai.ledger-validate/0";
  mode: "pr" | "all" | "notLedger" | null;
  base: string | null;
  head: string | null;
  ok: boolean;
  error: string | null;
  /** tool：道具の誤り（git・決まり・パック・diff の形）。input：PR の側の外れ（数・大きさ・空） */
  errorKind: "tool" | "input" | null;
  ledger: { id: string | null; hash: string | null; version: number | null; status: string; reasons: string[] } | null;
  files: { path: string | null; pathSha256: string; display: boolean; status: "ok" | "ng"; reasons: string[]; reasonsText: string[] }[];
  counts: { files: number; ok: number; ng: number };
}

export function validateOutputOf(r: PrResult | null, base: string | null, head: string | null, error: string | null): ValidateOutput {
  const files = (r?.files ?? []).map((f) => ({
    path: f.path,
    pathSha256: f.pathHash,
    display: displayablePath(f.path),
    status: f.status,
    reasons: f.reasons,
    reasonsText: [...new Set(f.reasons.map(reasonText))],
  }));
  const inputError = error ?? (r && r.inputReason ? reasonText(r.inputReason) : null);
  return {
    v: "moyai.ledger-validate/0",
    mode: r?.mode ?? null,
    base,
    head,
    ok: r !== null && r.ok && inputError === null,
    error: inputError,
    errorKind: error !== null || r === null || r.inputReason === "diff.malformed" ? (inputError === null ? null : "tool") : inputError !== null ? "input" : null,
    ledger: r ? { id: r.ledger.id, hash: r.ledger.hash, version: r.ledger.version, status: r.ledger.status, reasons: r.ledger.reasons } : null,
    files,
    counts: { files: files.length, ok: files.filter((f) => f.status === "ok").length, ng: files.filter((f) => f.status !== "ok").length },
  };
}

/** PR のコメントの本文（日本語の markdown）。ファイル名はコードの枠に入れ、表示できない名前は出さない */
export function validateMarkdown(o: ValidateOutput): string {
  const lines: string[] = [];
  if (o.error !== null && o.files.length === 0) {
    lines.push(o.errorKind === "tool" ? PR_TEXT.titleError : PR_TEXT.title(false), "", PR_TEXT.input(o.error), "", PR_TEXT.how);
    return lines.join("\n") + "\n";
  }
  if (o.mode === "notLedger") {
    lines.push(PR_TEXT.titleNotLedger, "", PR_TEXT.notLedger(o.base ?? "", o.head ?? ""));
    return lines.join("\n") + "\n";
  }
  lines.push(PR_TEXT.title(o.ok), "");
  if (o.mode === "all") lines.push(PR_TEXT.scopeAll(o.counts.files, o.head ?? ""));
  else lines.push(PR_TEXT.scopePr(o.counts.files, o.base ?? "", o.head ?? ""));
  if (o.ledger) lines.push(PR_TEXT.ledger(o.ledger.id, o.ledger.version, o.ledger.hash, o.ledger.status === "ok"));
  if (o.ledger && o.ledger.status !== "ok") lines.push(`  - ${[...new Set(o.ledger.reasons.map(reasonText))].join("、")}`);
  if (o.error !== null) lines.push(PR_TEXT.input(o.error));
  lines.push("", PR_TEXT.tableHead);
  for (const f of o.files) {
    const name = f.display ? `\`${f.path}\`` : PR_TEXT.hidden(f.pathSha256);
    lines.push(`| ${f.status === "ok" ? "✓" : "✗"} | ${name} | ${f.reasonsText.length ? f.reasonsText.join("、") : PR_TEXT.none} |`);
  }
  lines.push("", PR_TEXT.how);
  return lines.join("\n") + "\n";
}

interface PrArgs {
  base: string;
  head: string;
  repo: string;
  json: string | null;
  markdown: string | null;
}

function parsePrArgs(argv: string[]): PrArgs | null {
  const a: Partial<PrArgs> = { repo: ".", json: null, markdown: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (k === "--base") a.base = v;
    else if (k === "--head") a.head = v;
    else if (k === "--repo") a.repo = v;
    else if (k === "--json") a.json = v;
    else if (k === "--markdown") a.markdown = v;
    else return null;
    i++;
  }
  if (!a.base || !a.head || !SHA.test(a.base) || !SHA.test(a.head)) return null;
  return a as PrArgs;
}

function writeOut(path: string | null, text: string): void {
  if (path === null) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** validate-pr。すべて ✓ なら 0、どれかが ✗ なら 1、入力や道具の誤りなら 2 */
export async function validatePrCli(argv: string[], o: { packsDir?: string; git?: GitRun } = {}): Promise<number> {
  const args = parsePrArgs(argv);
  if (!args) {
    say(PR_TEXT.usage);
    return 2;
  }
  const done = (r: PrResult | null, error: string | null): number => {
    const out = validateOutputOf(r, args.base, args.head, error);
    writeOut(args.json, JSON.stringify(out, null, 2) + "\n");
    writeOut(args.markdown, validateMarkdown(out));
    if (error !== null) say(PR_TEXT.error(error));
    else if (out.mode === "notLedger") say(PR_TEXT.notLedger(args.base, args.head).replace(/^- /, "").replace(/`/g, ""));
    else for (const f of out.files) say(`  ${f.status === "ok" ? "✓" : "✗"} ${f.display ? f.path : PR_TEXT.hidden(f.pathSha256)}${f.reasonsText.length ? `：${f.reasonsText.join("、")}` : ""}`);
    if (out.error !== null && error === null) say(PR_TEXT.error(out.error));
    // 道具の誤り（git・決まり・パック）と、diff の出力が読めないときは 2。PR の側の外れ（数・大きさ・空）は ✗ の 1
    if (error !== null || r === null || r.inputReason === "diff.malformed") return 2;
    return out.ok ? 0 : 1;
  };
  const git = o.git ?? gitRunner(args.repo);
  for (const c of [args.base, args.head]) {
    const t = git(["cat-file", "-t", c], 64);
    if (!t.ok || t.out.toString("latin1").trim() !== "commit") return done(null, `commit が見つかりません（${c.slice(0, 12)}）`);
  }
  const baseTree = lsTree(git, args.base);
  if (!baseTree.ok) return done(null, baseTree.message);
  const baseFiles = ledgerFilesOfTree(git, baseTree.entries);
  // 決まりとパックは base（既定のブランチ）の ledger.json から決める（PR は決まりを変えられない）
  const lf = baseFiles.find((f) => f.path === LEDGER_JSON_PATH);
  const rules = lf && lf.kind === "file" ? ledgerRulesOf(lf.bytes) : null;
  if (!rules) return done(null, rulesUnreadableText(lf));
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) return done(null, LEDGER_CLI_TEXT.packNotReady(rules.pack, pack.reason));

  if (args.base === args.head) return done(validateAll(baseFiles, pack.pack), null);
  const diff = git(["diff", "--raw", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-abbrev", `${args.base}...${args.head}`], PR_LIMITS.rawBytes + 1);
  if (!diff.ok) return done(null, `${diff.message}（base と head の共通の祖先が無いか、head の commit が取れていません）`);
  const r = validatePr({
    raw: new Uint8Array(diff.out),
    base: baseFiles,
    basePaths: baseTree.entries.map((e) => e.path).filter((p): p is string => p !== null),
    readBlob: (sha) => readBlobWith(git, sha),
    pack: pack.pack,
  });
  return done(r, null);
}

// ─── site ──────────────────────────────────────────────────

export const SITE_CLI_TEXT = {
  usage: "使い方：moyai ledger site <台帳のリポジトリの根> <出すフォルダ>",
  outSymlink: "出すフォルダか index.html が symlink です。たどらずに止めました。",
  outNotDir: "出す先がフォルダではありません。",
  written: (p: string, ok: number, ng: number) => `書きました：${p}（✓ ${ok} 件・✗ ${ng} 件）`,
  writeFailed: "ページを書けませんでした。",
};

/** 作業の属性の名前（packs/_kinds/work.json）。読めなければコードのまま見せる */
function workNamesOf(packsDir: string): Record<string, string> {
  try {
    const j = JSON.parse(readFileSync(join(packsDir, "_kinds", "work.json"), "utf8")) as { work?: Record<string, { label?: unknown }> };
    return Object.fromEntries(Object.entries(j.work ?? {}).flatMap(([k, v]) => (typeof v?.label === "string" ? [[k, v.label]] : [])));
  } catch {
    return {};
  }
}

/**
 * site：台帳を受け手と同じ関数で確かめ直し、確かめた束から集計した 1 枚の HTML（index.html）だけを書く。生のファイルは写さない。
 * 出すフォルダ・index.html が symlink なら書かない。終わりの値：すべて ✓ なら 0、✗ があれば 1（✗ の束は集計に入れずに書く）、書けなければ 2。
 */
export async function siteCli(argv: string[], o: { packsDir?: string; build?: string } = {}): Promise<number> {
  const [rootArg, outArg, ...rest] = argv;
  if (!rootArg || !outArg || rest.length > 0) {
    say(SITE_CLI_TEXT.usage);
    return 2;
  }
  const root = ledgerRootOf(rootArg);
  if (!root) {
    say(LEDGER_CLI_TEXT.noLedger(rootArg));
    return 2;
  }
  const packsDir = o.packsDir ?? resolvePacksDir();
  const l = await loadLedger(root, { packsDir });
  if (!l.ok) {
    say(l.message);
    return l.code;
  }
  const out = resolve(outArg);
  const st = lstatOrNull(out);
  if (st?.isSymbolicLink()) {
    say(SITE_CLI_TEXT.outSymlink);
    return 2;
  }
  if (st && !st.isDirectory()) {
    say(SITE_CLI_TEXT.outNotDir);
    return 2;
  }
  if (!st) mkdirSync(out, { recursive: true });
  const target = join(out, "index.html");
  const ts = lstatOrNull(target);
  if (ts && (ts.isSymbolicLink() || !ts.isFile())) {
    say(SITE_CLI_TEXT.outSymlink);
    return 2;
  }
  const html = renderLedgerSite({ read: l.read, pack: l.pack, workNames: workNamesOf(packsDir), build: o.build ?? "MOYAI" });
  const tmp = join(out, `.index-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, html, { encoding: "utf8", flag: "wx" });
    renameSync(tmp, target);
  } catch {
    rmSync(tmp, { force: true });
    say(SITE_CLI_TEXT.writeFailed);
    return 2;
  }
  const ok = l.read.bundles.filter((b) => b.status === "ok").length;
  say(SITE_CLI_TEXT.written(target, ok, l.read.bundles.length - ok + l.read.retired.filter((x) => x.status !== "ok").length + l.read.others.length));
  return l.read.ok ? 0 : 1;
}

function lstatOrNull(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// ─── submit（人だけ） ────────────────────────────────────────────

export const SUBMIT_TEXT = {
  usage: "使い方：moyai ledger submit --bundle <署名済みの共有ファイルか失効記録> --repo <MOYAI の clone> [--base main]（人だけ。端末から）",
  account:
    "知らせ：PR を出す GitHub のアカウントは、誰にでも見えます。共有ファイルとそのアカウントが結びつくので、台帳専用のアカウントを使うことを勧めます。",
  noBundle: "共有ファイルを読めません（無いか、大きすぎます）。",
  notGit: "MOYAI のリポジトリの clone として読めません（git の誤り）。",
  noBase: (b: string) => `枝 ${b} がありません。台帳の既定のブランチを取ってから走らせてください。`,
  notBundle: "共有ファイルか失効記録の形として読めません。",
  ng: (reasons: string) => `この共有ファイルは台帳の検証で ✗ になります：${reasons}`,
  exists: (p: string) => `同じ共有ファイルがもう台帳にあります：${p}`,
  branchExists: (b: string) => `枝 ${b} がもうあります。消すか、別の --base から走らせてください。`,
  commitFailed: "枝を作れませんでした（git の名前とメールの設定があるかを確かめてください）。",
  prepared: (b: string, p: string) => `枝 ${b} を作り、共有ファイルを ${p} に置いた commit を 1 つ載せました（作業の木と索引は変えていません）。`,
  preparedRetired: (b: string, p: string) => `枝 ${b} を作り、失効記録を ${p} に置いた commit を 1 つ載せました（作業の木と索引は変えていません）。`,
  retiredTitle: (key: string) => `失効記録を足す：鍵 ${key}`,
  retiredCommitMessage: (key: string) => `失効記録を足す：鍵 ${key}`,
  retiredBody: (o: { key: string; fp: string; last: number; hash: string; path: string; ledgerId: string }) =>
    [
      `台帳 \`${o.ledgerId}\` に、鍵 \`${o.key}\` の失効記録を 1 つ足します。`,
      "",
      `- 失効記録：\`${o.path}\``,
      `- 鍵 ID \`${o.key}\`（鍵番号 \`${o.fp}\`）・最後の連番 ${o.last}・ファイルの SHA-256 \`${o.hash}\``,
      "",
      "失効記録はその鍵自身の署名です。載ると、この鍵の共有ファイルは集計対象外になり、最後の連番より大きい共有ファイルは ✗ になります。載った共有ファイルは消さず、掲載済みの複製は残ります。",
      "この失効記録は、出す前に `moyai ledger submit` が受け手と同じ関数で確かめ、✓ でした。",
      "",
    ].join("\n"),
  next: "次の 2 つを、あなたが確かめてから走らせてください（MOYAI は送りません）：",
  title: (key: string, seq: number) => `共有ファイルを足す：鍵 ${key}・連番 ${seq}`,
  commitMessage: (key: string, seq: number) => `共有ファイルを足す：鍵 ${key}・連番 ${seq}`,
  body: (o: { key: string; fp: string; seq: number; hash: string; path: string; profile: string; chunks: number; ledgerId: string }) =>
    [
      `台帳 \`${o.ledgerId}\` に、共有ファイルを 1 つ足します。`,
      "",
      `- 共有ファイル：\`${o.path}\``,
      `- 鍵 ID \`${o.key}\`（鍵番号 \`${o.fp}\`）・連番 ${o.seq}・ファイルの SHA-256 \`${o.hash}\``,
      `- 見え方：${o.profile}`,
      `- 塊：${o.chunks}`,
      "",
      "この共有ファイルは、出す前に `moyai ledger submit` が受け手と同じ関数（形・署名・鎖・粒度・禁止語・数え直し・紛れる数 k）で確かめ、✓ でした。",
      "鍵 ID と出した人の結びつきは共有ファイルの署名で決まり、この PR を出したアカウントの名前は使いません。",
      "",
    ].join("\n"),
};

function gitEnv(repo: string, args: string[], env: NodeJS.ProcessEnv = {}): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * submit：人だけ。標準入力が端末でなければ断る。検問所で人が署名した束（か、その鍵自身の署名の取り下げの印）を、台帳の既定のブランチの木に足したときに
 * 受け手と同じ関数で ✓ になるかを確かめ、作業の木と索引を変えずに枝と commit を 1 つ作り（一時の索引を使う）、
 * PR の本文を一時のフォルダに書き、push と gh のコマンドを出す（送るのは人。MOYAI は走らせない）。
 * 終わりの値：支度ができたら 0、束が ✗・もうある・git の誤りは 1、引数が違えば 2、端末でなければ 3。
 */
export async function submitCli(argv: string[], o: { packsDir?: string; stdin?: { isTTY?: boolean } } = {}): Promise<number> {
  if (!requireTerminal(o.stdin)) return 3;
  let bundlePath: string | null = null;
  let repoArg: string | null = null;
  let baseRef = "main";
  for (let i = 0; i < argv.length; i += 2) {
    const v = argv[i + 1];
    if (v === undefined) return usage();
    if (argv[i] === "--bundle") bundlePath = v;
    else if (argv[i] === "--repo") repoArg = v;
    else if (argv[i] === "--base") baseRef = v;
    else return usage();
  }
  if (!bundlePath || !repoArg || !/^[A-Za-z0-9._\/-]{1,100}$/.test(baseRef) || baseRef.startsWith("-")) return usage();
  say(SUBMIT_TEXT.account);
  let bytes: Buffer;
  try {
    const st = lstatSync(bundlePath);
    if (!st.isFile() || st.size > LEDGER_LIMITS.fileBytes) throw new Error("size");
    bytes = readFileSync(bundlePath);
  } catch {
    say(SUBMIT_TEXT.noBundle);
    return 1;
  }
  const repo = resolve(repoArg);
  const git = gitRunner(repo);
  const baseSha = gitEnv(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${baseRef}^{commit}`]);
  if (!baseSha.ok || !SHA.test(baseSha.out)) {
    say(SUBMIT_TEXT.noBase(baseRef));
    return 1;
  }
  const tree = lsTree(git, baseSha.out);
  if (!tree.ok) {
    say(SUBMIT_TEXT.notGit);
    return 1;
  }
  const files = ledgerFilesOfTree(git, tree.entries);
  const lf = files.find((f) => f.path === LEDGER_JSON_PATH);
  const rules = lf && lf.kind === "file" ? ledgerRulesOf(lf.bytes) : null;
  if (!rules) {
    say(rulesUnreadableText(lf));
    return 1;
  }
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) {
    say(LEDGER_CLI_TEXT.packNotReady(rules.pack, pack.reason));
    return 1;
  }
  // 束の鍵と連番から、台帳の中の道を決める（名前は中身から決まる）。取り下げの印は、その鍵のフォルダの retired.json
  const parsed = (() => {
    try {
      return JSON.parse(bytes.toString("utf8")) as { body?: { v?: unknown; key?: unknown; seq?: unknown; last?: unknown } };
    } catch {
      return null;
    }
  })();
  const key = parsed?.body?.key;
  const hash = sha256Hex(bytes);
  if (parsed?.body?.v === RETIRED_V) {
    if (typeof key !== "string" || !/^[0-9a-f]{16}$/.test(key)) {
      say(SUBMIT_TEXT.notBundle);
      return 1;
    }
    const path = ledgerRetiredPath(key);
    const check = checkRetiredAdded(files, pack.pack, path, new Uint8Array(bytes));
    if (!check.ok) {
      say(SUBMIT_TEXT.ng(reasonsText(check.reasons)));
      return 1;
    }
    const branch = `moyai/retired-${key}`;
    const made = prepareBranch(repo, baseSha.out, branch, path, bytes, SUBMIT_TEXT.retiredCommitMessage(key));
    if (made !== null) return made;
    const pub = (parsed.body as { pub?: unknown }).pub;
    const bodyFile = join(tmpdir(), `moyai-ledger-pr-${hash.slice(0, 16)}.md`);
    writeFileSync(bodyFile, SUBMIT_TEXT.retiredBody({ key, fp: typeof pub === "string" ? fingerprint(pub) : "", last: check.last, hash, path, ledgerId: rulesId(files, pack.pack) }), "utf8");
    say(SUBMIT_TEXT.preparedRetired(branch, path));
    say(SUBMIT_TEXT.next);
    say(`  git -C "${repo}" push origin ${branch}`);
    say(`  gh pr create --repo <台帳のリポジトリ> --base ${baseRef} --head ${branch} --title "${SUBMIT_TEXT.retiredTitle(key)}" --body-file "${bodyFile}"`);
    return 0;
  }
  const seq = parsed?.body?.seq;
  if (typeof key !== "string" || !/^[0-9a-f]{16}$/.test(key) || typeof seq !== "number" || !Number.isInteger(seq) || seq < 1 || seq > 999_999) {
    say(SUBMIT_TEXT.notBundle);
    return 1;
  }
  const path = `${LEDGER_DIR}/bundles/${key}/${bundleFileName(seq, hash)}`;
  if (files.some((f) => f.path === path)) {
    say(SUBMIT_TEXT.exists(path));
    return 1;
  }
  const read = verifyLedgerFiles([...files, { path, kind: "file", bytes: new Uint8Array(bytes) }], pack.pack);
  const line = read.bundles.find((b) => b.path === path);
  if (!line || line.status !== "ok" || read.ledger.status !== "ok" || line.retired || !line.body) {
    const reasons = line?.status === "ok" && line.retired ? ["ledger.keyRetired"] : line?.reasons.length ? line.reasons : read.ledger.reasons.length ? read.ledger.reasons : ["ledger"];
    say(SUBMIT_TEXT.ng(reasonsText(reasons)));
    return 1;
  }
  // 枝を作る：一時の索引に base の木を読み、束の blob を足して木と commit を作る（作業の木と索引は変えない）
  const branch = `moyai/bundle-${key}-${String(seq).padStart(6, "0")}`;
  const made = prepareBranch(repo, baseSha.out, branch, path, bytes, SUBMIT_TEXT.commitMessage(key, seq));
  if (made !== null) return made;
  const b = line.body;
  const bodyFile = join(tmpdir(), `moyai-ledger-pr-${hash.slice(0, 16)}.md`);
  writeFileSync(
    bodyFile,
    SUBMIT_TEXT.body({ key, fp: fingerprint(b.pub), seq, hash, path, profile: profileText(pack.pack, b.profile), chunks: b.chunks.length, ledgerId: read.ledger.id ?? "" }),
    "utf8",
  );
  say(SUBMIT_TEXT.prepared(branch, path));
  say(SUBMIT_TEXT.next);
  say(`  git -C "${repo}" push origin ${branch}`);
  say(`  gh pr create --repo <台帳のリポジトリ> --base ${baseRef} --head ${branch} --title "${SUBMIT_TEXT.title(key, seq)}" --body-file "${bodyFile}"`);
  return 0;
}

/** 台帳 ID（決まりが ✓ のときだけ。読めなければ空） */
function rulesId(files: readonly LedgerFile[], pack: SharePack): string {
  return verifyLedgerFiles(files.filter((f) => f.path === LEDGER_JSON_PATH), pack).ledger.id ?? "";
}

/**
 * 枝を作る：一時の索引に base の木を読み、ファイルの blob を足して木と commit を作る（作業の木と索引は変えない）。
 * できたら null、できなければ終わりの値（1）
 */
function prepareBranch(repo: string, baseSha: string, branch: string, path: string, bytes: Buffer, message: string): number | null {
  if (gitEnv(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    say(SUBMIT_TEXT.branchExists(branch));
    return 1;
  }
  const work = mkdtempSync(join(tmpdir(), "moyai-ledger-submit-"));
  try {
    const copy = join(work, "file.json");
    writeFileSync(copy, bytes, { flag: "wx" });
    const env = { GIT_INDEX_FILE: join(work, "index") };
    const blob = gitEnv(repo, ["hash-object", "-w", "--", copy]);
    const steps =
      blob.ok &&
      gitEnv(repo, ["read-tree", baseSha], env).ok &&
      gitEnv(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob.out},${path}`], env).ok;
    const treeSha = steps ? gitEnv(repo, ["write-tree"], env) : { ok: false, out: "" };
    const commit = treeSha.ok ? gitEnv(repo, ["commit-tree", treeSha.out, "-p", baseSha, "-m", message]) : { ok: false, out: "" };
    const made = commit.ok && SHA.test(commit.out) && gitEnv(repo, ["branch", branch, commit.out]).ok;
    if (!made) {
      say(SUBMIT_TEXT.commitFailed);
      return 1;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return null;
}

function usage(): number {
  say(SUBMIT_TEXT.usage);
  return 2;
}

/** ledger の下のコマンド。argv は ledger のあと */
export async function ledgerCli(argv: string[], o: { packsDir?: string; build?: string } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "validate-pr") return validatePrCli(rest, o);
  if (sub === "site") return siteCli(rest, o);
  if (sub === "submit") return submitCli(rest, o);
  if (sub === "init") return initCli(rest, o);
  say(LEDGER_USAGE);
  return 2;
}
