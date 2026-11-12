// 台帳のリポジトリの PR の照らし（docs/plan.md §2.8 台帳の守り方。置き場所は config/ledger.json。下の ledger/ledger/ の例は台帳の根が ledger のときの形。根が空なら台帳だけのリポジトリで、どの変更も台帳の PR として照らす）。純粋な関数：入力は
// `git diff --raw -z --no-renames --no-abbrev <base>...<head>` の出力のバイト列と、base の木の ledger/ledger/ の下の項目、追加の blob を読む関数。
// head を checkout せず、head の側のコードも走らせない（読むのは blob のバイト列だけ）。
// PR の分け方：ledger/ の中だけを変える PR が台帳の PR。ledger/ に触れない PR と、ledger/ledger/ に触れずに ledger/ の外も変える PR は
// 「台帳の PR ではない」として検証しない（✗ にしない）。ledger/ の外も変える PR に ledger/ledger/ の変更が混ざっていれば ✗。
// 台帳の PR で許すのは、状態が追加（A）で mode が 100644 の、ledger/ledger/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json と
// ledger/ledger/bundles/<鍵ID>/retired.json（取り下げの印）だけ。
// 削除・変更・改名・写し・型の変更（D・M・R・C・T）、symlink（120000）、submodule（160000）、実行の印、
// 大文字小文字や Unicode の正規化だけが違う道、.github/ に触れるものは ✗。入力の数・大きさ・深さに上限を置く。
// 束と印の中身は、base の木に PR のファイルを足した台帳を verifyLedgerFiles（輪の受け手と同じ数え直しと鎖）で確かめる。
// 鍵 ID と出した人の結びつきは束の署名で決まり、GitHub のログイン名は使わない（この関数は受け取らない）。
import { LEDGER_PLACE } from "./ledger-place";
import { LEDGER_BUNDLE_PATH, LEDGER_DIR, LEDGER_LIMITS, LEDGER_RETIRED_PATH, LEDGER_ROOT, verifyLedgerFiles, type LedgerFile, type LedgerRulesInfo } from "./ledger";
import type { NationalTable, Vocab } from "./k";
import { sha256Hex } from "./sign";

/** PR の入力の上限（コードの定数） */
export const PR_LIMITS = {
  /** 1 つの PR の変更の数 */
  entries: 64,
  /** diff の出力のバイト数 */
  rawBytes: 256 * 1024,
  /** 道のバイト数 */
  pathBytes: 200,
  /** 道の段の数（<台帳のフォルダ>/bundles/<鍵ID>/<名前>。今の置き場所では 5 段） */
  pathDepth: LEDGER_PLACE.pathDepth,
} as const;

export interface DiffEntry {
  srcMode: string;
  dstMode: string;
  srcSha: string;
  dstSha: string;
  /** 状態の文字（A・M・D・R・C・T・U・X）。R と C の点数は除く */
  status: string;
  /** 道（UTF-8 で読めなければ null） */
  path: string | null;
  /** 道のバイト列の SHA-256（表示できない道の代わりに出す） */
  pathHash: string;
  /** 道のバイト数 */
  pathBytes: number;
}

export type DiffParse = { ok: true; entries: DiffEntry[] } | { ok: false; reason: "diff.malformed" | "diff.tooLarge" | "diff.tooMany" };

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HEAD_RE = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])(\d{0,3})$/;

/** `git diff --raw -z` の出力を読む。形が違えば読まずに止める（推測で区切らない）。 */
export function parseRawDiff(raw: Uint8Array): DiffParse {
  if (raw.length > PR_LIMITS.rawBytes) return { ok: false, reason: "diff.tooLarge" };
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      parts.push(raw.subarray(start, i));
      start = i + 1;
    }
  }
  if (start !== raw.length) return { ok: false, reason: "diff.malformed" };
  const entries: DiffEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const head = Buffer.from(parts[i]!).toString("latin1");
    const m = HEAD_RE.exec(head);
    if (!m) return { ok: false, reason: "diff.malformed" };
    const status = m[5]!;
    // 改名と写しは道が 2 つ（--no-renames でも、来たら読み違えずに ✗ にする）
    const n = status === "R" || status === "C" ? 2 : 1;
    const pathBytes = parts[i + n];
    if (pathBytes === undefined) return { ok: false, reason: "diff.malformed" };
    let path: string | null;
    try {
      path = UTF8.decode(pathBytes);
    } catch {
      path = null;
    }
    entries.push({ srcMode: m[1]!, dstMode: m[2]!, srcSha: m[3]!, dstSha: m[4]!, status, path, pathHash: sha256Hex(pathBytes), pathBytes: pathBytes.length });
    if (entries.length > PR_LIMITS.entries) return { ok: false, reason: "diff.tooMany" };
    i += n + 1;
  }
  return { ok: true, entries };
}

/** 道を比べる形：NFC にして小文字にする（大文字小文字と正規化だけが違う道を見つけるため） */
export function foldPath(p: string): string {
  return p.normalize("NFC").toLowerCase();
}

/** 台帳の PR で足してよい道（束か取り下げの印） */
function allowedPath(p: string): boolean {
  return LEDGER_BUNDLE_PATH.test(p) || LEDGER_RETIRED_PATH.test(p);
}

/** 道が、この頭（ledger/ など）の下か。大文字小文字と Unicode の正規化だけが違う道も下に数える。UTF-8 で読めない道は下に数える（分からないものは厳しく） */
function under(p: string | null, head: string): boolean {
  if (p === null) return true;
  // 頭が空（台帳の根がリポジトリの根そのもの）なら、どの道もその下
  if (head === "") return true;
  return [p, foldPath(p), p.normalize("NFKC").toLowerCase()].some((x) => x.startsWith(`${head}/`));
}

/** 1 つの変更の、道と状態と mode の理由（中身は見ない） */
export function entryIssues(e: DiffEntry): string[] {
  const out: string[] = [];
  const p = e.path;
  if (p === null) out.push("path.notUtf8");
  else {
    const f = foldPath(p);
    const k = p.normalize("NFKC").toLowerCase();
    if ([f, k].some((x) => x === ".github" || x.startsWith(".github/"))) out.push("path.github");
    if (e.pathBytes > PR_LIMITS.pathBytes) out.push("path.tooLong");
    if (p.split("/").length > PR_LIMITS.pathDepth) out.push("path.tooDeep");
    if (!allowedPath(p)) {
      // 正規化と小文字で許す形になるなら、大文字小文字か正規化だけの違い
      if (allowedPath(f) || allowedPath(k)) out.push("path.caseOrNormalization");
      else if (/[^\x21-\x7e]/.test(p)) out.push("path.notAscii");
      else out.push("path.notAllowed");
    }
  }
  if (e.status !== "A") {
    out.push(
      e.status === "D"
        ? "diff.deleted"
        : e.status === "M"
          ? "diff.modified"
          : e.status === "R"
            ? "diff.renamed"
            : e.status === "C"
              ? "diff.copied"
              : e.status === "T"
                ? "diff.typeChanged"
                : "diff.statusUnknown",
    );
  }
  if (e.dstMode !== "100644" && e.status !== "D") {
    out.push(e.dstMode === "120000" ? "diff.symlink" : e.dstMode === "160000" ? "diff.submodule" : e.dstMode === "100755" ? "diff.executable" : "diff.mode");
  }
  return [...new Set(out)];
}

export interface PrFile {
  /** 道（UTF-8 で読めなければ null） */
  path: string | null;
  pathHash: string;
  status: "ok" | "ng";
  reasons: string[];
}

export interface PrResult {
  /** pr：台帳の PR を照らした。all：base と head が同じで全部を照らした。notLedger：台帳の PR ではない（ledger/ の外の変更。検証しない） */
  mode: "pr" | "all" | "notLedger";
  ok: boolean;
  ledger: LedgerRulesInfo;
  files: PrFile[];
  /** 入力そのものが読めない（diff の形・数・大きさ）。このときは files が空で ok は false */
  inputReason: string | null;
}

export interface PrInput {
  /** `git diff --raw -z --no-renames --no-abbrev <base>...<head>` の出力 */
  raw: Uint8Array;
  /** base の木の ledger/ledger/ の下の項目（blob の中身つき） */
  base: readonly LedgerFile[];
  /** base の木のすべての道（大文字小文字と正規化の重なりを見るため） */
  basePaths: readonly string[];
  /** 追加された blob を読む（上限を越えるか読めなければ null） */
  readBlob: (sha: string) => Uint8Array | null;
  pack: { table: NationalTable; vocab: Vocab };
}

/** PR の変更を照らす（純粋な関数。readBlob のほかに外を見ない） */
export function validatePr(i: PrInput): PrResult {
  const parsed = parseRawDiff(i.raw);
  const empty: LedgerRulesInfo = { status: "missing", reasons: [], id: null, hash: null, rules: null, version: null, month: null, founder: null };
  if (!parsed.ok) return { mode: "pr", ok: false, ledger: empty, files: [], inputReason: parsed.reason };

  // 台帳の PR か：ledger/ の中だけを変える PR だけを照らす。ledger/ の外も変える PR（コードの PR）は検証しないが、
  // ledger/ledger/（決まり・利用条件・束・取り下げの印）の変更が混ざっていれば ✗（台帳の守りを、コードの PR で越えさせない）
  if (parsed.entries.length > 0 && !parsed.entries.every((e) => under(e.path, LEDGER_ROOT))) {
    const mixed: PrFile[] = parsed.entries
      .filter((e) => under(e.path, LEDGER_DIR))
      .map((e) => ({ path: e.path, pathHash: e.pathHash, status: "ng", reasons: ["path.ledgerInCodePr"] }));
    if (mixed.length === 0) return { mode: "notLedger", ok: true, ledger: empty, files: [], inputReason: null };
    return { mode: "pr", ok: false, ledger: empty, files: mixed, inputReason: null };
  }

  const files: PrFile[] = [];
  const added: { file: PrFile; lf: LedgerFile }[] = [];
  // 大文字小文字と正規化の重なり：base の道と、PR のほかの道
  const baseFold = new Map<string, string>();
  for (const p of i.basePaths) baseFold.set(foldPath(p), p);
  const prFold = new Map<string, number>();
  for (const e of parsed.entries) if (e.path !== null) prFold.set(foldPath(e.path), (prFold.get(foldPath(e.path)) ?? 0) + 1);

  for (const e of parsed.entries) {
    const f: PrFile = { path: e.path, pathHash: e.pathHash, status: "ng", reasons: entryIssues(e) };
    if (e.path !== null) {
      const fp = foldPath(e.path);
      const b = baseFold.get(fp);
      if ((b !== undefined && b !== e.path) || (prFold.get(fp) ?? 0) > 1) f.reasons.push("path.collides");
      if (b !== undefined && b === e.path && e.status === "A") f.reasons.push("path.exists");
    }
    files.push(f);
    if (f.reasons.length > 0) continue;
    const bytes = i.readBlob(e.dstSha);
    if (bytes === null) {
      f.reasons.push("file.tooLarge");
      continue;
    }
    if (bytes.length > LEDGER_LIMITS.fileBytes) {
      f.reasons.push("file.tooLarge");
      continue;
    }
    added.push({ file: f, lf: { path: e.path!, kind: "file", bytes } });
  }

  // base の木に PR の束を足した台帳を、輪の受け手と同じ関数で確かめる
  const virtual: LedgerFile[] = [...i.base.filter((x) => !added.some((a) => a.lf.path === x.path)), ...added.map((a) => a.lf)];
  const read = verifyLedgerFiles(virtual, i.pack);
  for (const a of added) {
    const line = read.bundles.find((b) => b.path === a.lf.path);
    const retired = read.retired.find((r) => r.path === a.lf.path);
    if (line) {
      if (line.status !== "ok") a.file.reasons.push(...line.reasons);
      // 取り下げた鍵には足さない（✓ でも数えない）
      else if (line.retired) a.file.reasons.push("ledger.keyRetired");
    } else if (retired) {
      if (retired.status !== "ok") a.file.reasons.push(...retired.reasons);
      // 印の最後の連番が、載った束の連番より小さい：載った束を ✗ にする書き方なので断る
      else if (retired.last !== null && retired.last < retired.placedMax) a.file.reasons.push("chain.retiredBelowKnown");
    } else a.file.reasons.push("file.notAllowed");
  }
  for (const f of files) {
    f.reasons = [...new Set(f.reasons)];
    f.status = f.reasons.length === 0 ? "ok" : "ng";
  }
  const ok = files.length > 0 && files.every((f) => f.status === "ok") && read.ledger.status === "ok";
  return { mode: "pr", ok, ledger: read.ledger, files, inputReason: files.length === 0 ? "diff.empty" : null };
}

/** 変更が無いとき（base と head が同じ commit）：head の木の台帳の全部の束を確かめる */
export function validateAll(head: readonly LedgerFile[], pack: { table: NationalTable; vocab: Vocab }): PrResult {
  const read = verifyLedgerFiles(head, pack);
  const files: PrFile[] = [
    ...read.bundles.map((b) => ({ path: b.path, pathHash: sha256Hex(b.path), status: b.status, reasons: b.reasons })),
    ...read.retired.map((r) => ({ path: r.path, pathHash: sha256Hex(r.path), status: r.status, reasons: r.reasons })),
    ...read.others.map((o) => ({ path: o.path, pathHash: sha256Hex(o.path), status: "ng" as const, reasons: o.reasons })),
  ];
  return { mode: "all", ok: read.ok, ledger: read.ledger, files, inputReason: null };
}

/** 表示してよい道か（ASCII の英数と . _ - / だけ、長さの上限の内）。ほかの道は名前を出さず、ハッシュで示す */
export function displayablePath(p: string | null): boolean {
  return p !== null && p.length <= PR_LIMITS.pathBytes && /^[A-Za-z0-9._\/-]+$/.test(p);
}
