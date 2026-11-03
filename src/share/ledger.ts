// 公開の台帳（場 2。docs/plan.md §2.8）：台帳のリポジトリの ledger/ の下を、輪の受け手と同じ関数（数え直し・鎖）で確かめる。
//   ledger/ledger.json                                   台帳の決まり（管理者が署名。circle.json と同じ形で、厳しくする向きだけ）
//   ledger/TERMS.md                                      利用条件（検証では読まない）
//   ledger/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json     束（足すだけ）
// 読み手（フォルダか git の木か）を問わない形（LedgerFile の並び）で受け、引数で緩める切り替えは持たない。
// 台帳 ID は ledger.json の body の変わらない部分（v・founder・nonce）から決まり、束の行き先（to）と照らす。
// 鍵 ID と出した人の結びつきは、束の署名をその鍵の公開鍵で確かめて決める（GitHub のログイン名には頼らない）。
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLE_FILE_NAME, LEDGER_V, RULES_TYPE, checkShape, ringIdOf, type BundleBody, type ShareContext } from "./bundle";
import { parseJsonStrict } from "./jcs";
import type { NationalTable, Vocab } from "./k";
import { isClean, recount } from "./recount";
import { checkChain } from "./ring";
import type { Rules } from "./rules";
import { HEX16, fingerprint, sha256Hex } from "./sign";

export const LEDGER_DIR = "ledger";
export const LEDGER_FILE = "ledger.json";
export const LEDGER_TERMS = "TERMS.md";
export const LEDGER_BUNDLES = "bundles";
export const LEDGER_JSON_PATH = `${LEDGER_DIR}/${LEDGER_FILE}`;
export const LEDGER_TERMS_PATH = `${LEDGER_DIR}/${LEDGER_TERMS}`;

/** 入力の上限（コードの定数）。束 1 つは塊が上限まであっても数百 KB に収まる */
export const LEDGER_LIMITS = { fileBytes: 1024 * 1024, files: 20_000, jsonDepth: 8 } as const;

/** 束の道：ledger/bundles/<鍵ID 16 桁>/<連番 6 桁>-<ハッシュ先頭 16>.json（ASCII の小文字と数字だけ） */
export const LEDGER_BUNDLE_PATH = /^ledger\/bundles\/([0-9a-f]{16})\/(\d{6}-[0-9a-f]{16}\.json)$/;

/** 台帳のリポジトリの中の 1 つの項目（読み手が作る）。道はリポジトリの根から / 区切り */
export interface LedgerFile {
  path: string;
  /** file：ふつうのファイル。symlink・submodule・other（実行の印・知らない型）は中身を読まない */
  kind: "file" | "symlink" | "submodule" | "other";
  /** file のときだけ。上限を越えたものは null（理由は file.tooLarge） */
  bytes: Uint8Array | null;
}

export interface LedgerBundleLine {
  path: string;
  key: string | null;
  seq: number | null;
  status: "ok" | "ng";
  reasons: string[];
  /** ファイルのバイト列の SHA-256 */
  hash: string | null;
  /** ✓ の束の body（集計に使う） */
  body: BundleBody | null;
}

export interface LedgerRulesInfo {
  status: "ok" | "ng" | "missing";
  reasons: string[];
  /** 台帳 ID（決まりの body から） */
  id: string | null;
  /** ledger.json のバイト列の SHA-256 */
  hash: string | null;
  rules: Rules | null;
  version: number | null;
  month: string | null;
  /** 管理者の鍵の指紋 */
  founder: string | null;
}

export interface LedgerRead {
  ledger: LedgerRulesInfo;
  bundles: LedgerBundleLine[];
  /** 許した形の外の項目（ledger/ の下の、束でも決まりでも利用条件でもないもの） */
  others: { path: string; reasons: string[] }[];
  ok: boolean;
}

/** ledger.json の body の rules だけを読む（パックを選ぶため。確かめるのは verifyLedgerFiles） */
export function ledgerRulesOf(bytes: Uint8Array | string | null): Rules | null {
  if (bytes === null) return null;
  const text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  const p = parseJsonStrict(text);
  if (!p.ok) return null;
  const rules = (p.value as { body?: { rules?: unknown } })?.body?.rules ?? null;
  const issues: string[] = [];
  checkShape(rules, RULES_TYPE, "rules", issues);
  return issues.length === 0 ? (rules as Rules) : null;
}

/** JSON の入れ子の深さ（配列と物の段の数）。文字列の中の括弧は数えない */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") max = Math.max(max, ++depth);
    else if (c === "}" || c === "]") depth--;
  }
  return max;
}

/** 台帳の文脈（数え直しに渡す）。ledger.json が読めなければ null */
export function ledgerContext(ledgerBytes: Uint8Array, pack: { table: NationalTable; vocab: Vocab }): ShareContext | null {
  const rules = ledgerRulesOf(ledgerBytes);
  if (!rules) return null;
  const p = parseJsonStrict(Buffer.from(ledgerBytes).toString("utf8"));
  const body = p.ok ? (p.value as { body?: { v?: unknown; founder?: unknown; nonce?: unknown } }).body : undefined;
  if (!body || body.v !== LEDGER_V || typeof body.founder !== "string" || typeof body.nonce !== "string") return null;
  return {
    table: pack.table,
    vocab: pack.vocab,
    rules,
    rulesHash: sha256Hex(ledgerBytes),
    to: { kind: "ledger", id: ringIdOf({ v: body.v, founder: body.founder, nonce: body.nonce }) },
  };
}

function kindReason(kind: LedgerFile["kind"]): string {
  return kind === "symlink" ? "file.symlink" : kind === "submodule" ? "file.submodule" : "file.notRegular";
}

/**
 * 台帳を確かめる。files はリポジトリの中の項目（ledger/ の外のものは見ない）。
 * 決まり（ledger.json）が ✓ でなければ、どの束も ✗（理由 ledger）。束ごとに ✓ か理由つきの ✗ を出す。
 */
export function verifyLedgerFiles(files: readonly LedgerFile[], pack: { table: NationalTable; vocab: Vocab }): LedgerRead {
  const ledger: LedgerRulesInfo = { status: "missing", reasons: [], id: null, hash: null, rules: null, version: null, month: null, founder: null };
  const out: LedgerRead = { ledger, bundles: [], others: [], ok: false };
  const inLedger = files.filter((f) => f.path === LEDGER_DIR || f.path.startsWith(`${LEDGER_DIR}/`));

  // 決まり
  const lf = inLedger.find((f) => f.path === LEDGER_JSON_PATH);
  let ctx: ShareContext | null = null;
  if (lf) {
    if (lf.kind !== "file" || lf.bytes === null) {
      ledger.status = "ng";
      ledger.reasons.push(lf.kind !== "file" ? kindReason(lf.kind) : "file.tooLarge");
    } else {
      ledger.hash = sha256Hex(lf.bytes);
      ctx = ledgerContext(lf.bytes, pack);
      if (!ctx) {
        ledger.status = "ng";
        ledger.reasons.push("ledger.unreadable");
      } else {
        ledger.id = ctx.to.id;
        ledger.rules = ctx.rules;
        const r = recount(lf.bytes, ctx);
        const reasons = r.kind === "ledger" ? [...r.reasons] : [...r.reasons, "ledger.kind"];
        if (ctx.rules.pack !== pack.vocab.pack) reasons.push("chain.packMismatch");
        if (ctx.rules.vocab !== pack.vocab.hash) reasons.push("chain.vocabMismatch");
        if (ctx.rules.national !== pack.table.hash) reasons.push("chain.nationalMismatch");
        const b = r.body as { version?: unknown; month?: unknown; founder?: unknown } | null;
        if (typeof b?.version === "number") ledger.version = b.version;
        if (typeof b?.month === "string") ledger.month = b.month;
        if (typeof b?.founder === "string" && /^[0-9a-f]{64}$/.test(b.founder)) ledger.founder = fingerprint(b.founder);
        ledger.status = r.kind === "ledger" && isClean(r) && reasons.length === 0 ? "ok" : "ng";
        ledger.reasons = [...new Set(reasons)];
        if (ledger.status !== "ok") ctx = null;
      }
    }
  }

  // 項目を分ける
  const prevOf = new Map<LedgerBundleLine, unknown>();
  const byKey = new Map<string, LedgerBundleLine[]>();
  for (const f of [...inLedger].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (f.path === LEDGER_JSON_PATH) continue;
    if (f.path === LEDGER_TERMS_PATH) {
      if (f.kind !== "file") out.others.push({ path: f.path, reasons: [kindReason(f.kind)] });
      continue;
    }
    const m = LEDGER_BUNDLE_PATH.exec(f.path);
    if (!m) {
      out.others.push({ path: f.path, reasons: [f.path.startsWith(`${LEDGER_DIR}/${LEDGER_BUNDLES}/`) ? "file.notBundleName" : "file.notAllowed"] });
      continue;
    }
    const key = m[1]!;
    const nm = BUNDLE_FILE_NAME.exec(m[2]!)!;
    const line: LedgerBundleLine = { path: f.path, key, seq: null, status: "ng", reasons: [], hash: null, body: null };
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(line);
    if (f.kind !== "file") {
      line.reasons.push(kindReason(f.kind));
      continue;
    }
    if (f.bytes === null) {
      line.reasons.push("file.tooLarge");
      continue;
    }
    line.hash = sha256Hex(f.bytes);
    if (!ctx) {
      line.reasons.push("ledger");
      continue;
    }
    const text = Buffer.from(f.bytes).toString("utf8");
    if (jsonDepth(text) > LEDGER_LIMITS.jsonDepth) {
      line.reasons.push("file.tooDeep");
      continue;
    }
    const r = recount(f.bytes, ctx);
    const body = r.body as (BundleBody & Record<string, unknown>) | null;
    line.seq = typeof body?.seq === "number" ? body.seq : null;
    if (r.kind !== "bundle") line.reasons.push(...r.reasons, "file.notBundle");
    else if (!isClean(r)) line.reasons.push(...r.reasons);
    if (body && body.key !== key) line.reasons.push("file.otherFolder");
    if (line.seq !== null && (Number(nm[1]) !== line.seq || nm[2] !== r.hash.slice(0, 16))) line.reasons.push("file.nameMismatch");
    line.reasons = [...new Set(line.reasons)];
    if (line.reasons.length === 0) {
      line.status = "ok";
      line.body = body as BundleBody;
      prevOf.set(line, body!.prev);
    }
  }
  // 鎖（輪の受け手と同じ関数）
  for (const list of byKey.values()) checkChain(list, prevOf);
  for (const list of byKey.values()) for (const b of list) if (b.status !== "ok") b.body = null;
  out.bundles = [...byKey.values()].flat().sort((a, b) => (a.path < b.path ? -1 : 1));
  out.ok = ledger.status === "ok" && out.others.length === 0 && out.bundles.every((b) => b.status === "ok");
  return out;
}

// ─── フォルダから読む ─────────────────────────────────────────

export type LedgerDirRead = { ok: true; files: LedgerFile[] } | { ok: false; reason: "noLedgerDir" | "ledgerDirSymlink" | "tooManyFiles" };

/**
 * 台帳のリポジトリの根のフォルダから、ledger/ の下の項目を読む。symlink（Windows の junction も）はたどらず、
 * 中身も読まずに symlink として返す。大きすぎるファイルは中身を読まない。
 */
export async function readLedgerDir(root: string): Promise<LedgerDirRead> {
  const base = join(root, LEDGER_DIR);
  let st;
  try {
    st = await lstat(base);
  } catch {
    return { ok: false, reason: "noLedgerDir" };
  }
  if (st.isSymbolicLink()) return { ok: false, reason: "ledgerDirSymlink" };
  if (!st.isDirectory()) return { ok: false, reason: "noLedgerDir" };
  const files: LedgerFile[] = [];
  const walk = async (dir: string, rel: string): Promise<boolean> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (files.length >= LEDGER_LIMITS.files) return false;
      const p = join(dir, e.name);
      const r = `${rel}/${e.name}`;
      const s = await lstat(p);
      if (s.isSymbolicLink()) files.push({ path: r, kind: "symlink", bytes: null });
      else if (s.isDirectory()) {
        if (!(await walk(p, r))) return false;
      } else if (s.isFile()) files.push({ path: r, kind: "file", bytes: s.size > LEDGER_LIMITS.fileBytes ? null : new Uint8Array(await readFile(p)) });
      else files.push({ path: r, kind: "other", bytes: null });
    }
    return true;
  };
  if (!(await walk(base, LEDGER_DIR))) return { ok: false, reason: "tooManyFiles" };
  return { ok: true, files };
}

/** 鍵 ID の形か */
export function isKeyId(s: string): boolean {
  return HEX16.test(s);
}
