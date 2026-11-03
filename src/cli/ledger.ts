// 公開の台帳の CLI（docs/plan.md §2.8 場 2・docs/sharing.md）。
// - `moyai verify ledger <台帳のリポジトリの根>`：輪の受け手と同じ関数で、決まり（ledger.json）と束ごとに ✓ か理由つきの ✗ を出す。
// - `moyai ledger validate-pr --base <SHA> --head <SHA>`：台帳のリポジトリの pull_request_target の検証。head を checkout せず、
//   git の木から blob だけを読む。結果を JSON（機械が読む）と日本語の markdown（PR のコメント）に書く。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。終わりの値：すべて ✓ なら 0、どれかが ✗ なら 1、引数や読めない台帳・道具の誤りは 2。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { reasonText } from "../app/text/reasons";
import { LEDGER_DIR, LEDGER_FILE, LEDGER_JSON_PATH, LEDGER_LIMITS, ledgerRulesOf, readLedgerDir, verifyLedgerFiles, type LedgerFile, type LedgerRead } from "../share/ledger";
import { loadSharePack, resolvePacksDir, type SharePack } from "../share/pack";
import { PR_LIMITS, displayablePath, validateAll, validatePr, type PrResult } from "../share/prdiff";

export const LEDGER_CLI_TEXT = {
  verifyUsage: "使い方：moyai verify ledger <台帳のリポジトリの根>（その下に ledger/ledger.json と ledger/bundles/ がある）",
  noLedger: (p: string) => `台帳が見つかりません：${p}（ledger/ledger.json のあるリポジトリの根を指してください）`,
  dirSymlink: "ledger/ が symlink です。たどらずに止めました。",
  tooMany: "ledger/ の下のファイルが多すぎます（上限を越えたので止めました）。",
  rulesUnreadable: "台帳の決まり（ledger/ledger.json）を読めません。",
  packNotReady: (pack: string, reason: string) => `パック ${pack} の共有の部品を読めません（${reason}）`,
  head: (id: string | null, version: number | null, hash: string | null) =>
    `台帳 ${id ?? "（ID 不明）"}${version !== null ? `（決まり 版 ${version}` : "（決まり"}、SHA-256 ${hash ? hash.slice(0, 16) : "不明"}…）`,
  rules: "決まり（ledger/ledger.json）",
  bundle: (p: string) => `束 ${p}`,
  other: (p: string) => `許した形の外 ${p}`,
  noBundles: "束は 0 件です。",
  summaryOk: (n: number) => `すべて ✓ です（束 ${n} 件）。`,
  summaryNg: (n: number) => `✗ が ${n} 件あります。`,
};

const say = (m: string) => process.stderr.write(`${m}\n`);

/** 指した道から、台帳のリポジトリの根を決める（根か、その下の ledger/ を受ける）。見つからなければ null */
export function ledgerRootOf(folder: string): string | null {
  const abs = resolve(folder);
  if (existsSync(join(abs, LEDGER_DIR, LEDGER_FILE))) return abs;
  if (basename(abs) === LEDGER_DIR && existsSync(join(abs, LEDGER_FILE))) return dirname(abs);
  return null;
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
  if (!rules) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.rulesUnreadable };
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.packNotReady(rules.pack, pack.reason) };
  return { ok: true, files: d.files, pack: pack.pack, read: verifyLedgerFiles(d.files, pack.pack) };
}

const reasonsText = (rs: readonly string[]) => [...new Set(rs.map(reasonText))].join("、");

/** 台帳の確かめの結果を行にする（✓／✗ と理由） */
export function formatLedger(r: LedgerRead): string[] {
  const lines = [LEDGER_CLI_TEXT.head(r.ledger.id, r.ledger.version, r.ledger.hash)];
  lines.push(r.ledger.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.rules}` : `  ✗ ${LEDGER_CLI_TEXT.rules}：${reasonsText(r.ledger.reasons.length ? r.ledger.reasons : ["ledger.unreadable"])}`);
  for (const b of r.bundles) lines.push(b.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.bundle(b.path)}` : `  ✗ ${LEDGER_CLI_TEXT.bundle(b.path)}：${reasonsText(b.reasons)}`);
  for (const o of r.others) lines.push(`  ✗ ${LEDGER_CLI_TEXT.other(o.path)}：${reasonsText(o.reasons)}`);
  if (r.bundles.length === 0) lines.push(`  ${LEDGER_CLI_TEXT.noBundles}`);
  const ng = (r.ledger.status === "ok" ? 0 : 1) + r.bundles.filter((b) => b.status !== "ok").length + r.others.length;
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
  moyai ledger site <台帳のリポジトリの根> <出すフォルダ>
  moyai ledger submit --bundle <束> --repo <台帳の clone>（人だけ。端末から）`;

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

/** 木の ledger/ の下の項目を LedgerFile にする（100644 だけをふつうのファイルとして中身を読む） */
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
  usage: "使い方：moyai ledger validate-pr --base <commit の SHA> --head <commit の SHA> [--repo <台帳の clone>] [--json <道>] [--markdown <道>]",
  title: (ok: boolean) => (ok ? "### MOYAI 台帳の検証：✓ 通りました" : "### MOYAI 台帳の検証：✗ 通りません"),
  titleError: "### MOYAI 台帳の検証：確かめられませんでした",
  scopePr: (n: number, base: string, head: string) => `- 確かめたもの：この PR が足す・変えるファイル ${n} 件（base \`${base.slice(0, 12)}\`・head \`${head.slice(0, 12)}\`）`,
  scopeAll: (n: number, head: string) => `- 変更なし（base と head が同じ commit \`${head.slice(0, 12)}\`）。既定のブランチにある全部の束 ${n} 件を確かめ直しました`,
  ledger: (id: string | null, version: number | null, hash: string | null, ok: boolean) =>
    `- 台帳 \`${id ?? "不明"}\`・決まり 版 ${version ?? "不明"}（SHA-256 \`${hash ? hash.slice(0, 16) : "不明"}\`）${ok ? "" : "：決まりが ✓ でないので、束を確かめられません"}`,
  tableHead: "| 結果 | ファイル | 理由 |\n|---|---|---|",
  hidden: (h: string) => `（名前を表示しない道。道の SHA-256 \`${h.slice(0, 16)}\`）`,
  none: "—",
  input: (r: string) => `- 入力を読めません：${r}`,
  how:
    "確かめ方：既定のブランチにある定義が、PR の head を checkout せず、git の木から blob のバイト列だけを読み、アプリと同じ関数（形・署名・鎖・粒度・禁止語・数え直し・紛れる数 k）で確かめました。鍵 ID と出した人の結びつきは束の署名で決めています（GitHub のアカウント名は使いません）。",
  error: (m: string) => `validate-pr：${m}`,
};

export interface ValidateOutput {
  v: "moyai.ledger-validate/0";
  mode: "pr" | "all" | null;
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
  if (!rules) return done(null, LEDGER_CLI_TEXT.rulesUnreadable);
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

/** ledger の下のコマンド。argv は ledger のあと */
export async function ledgerCli(argv: string[], o: { packsDir?: string } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "validate-pr") return validatePrCli(rest, o);
  say(LEDGER_USAGE);
  return 2;
}
