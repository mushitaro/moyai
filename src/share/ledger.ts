// 公開の台帳（場 2。docs/plan.md §2.8）：台帳のリポジトリの、台帳の根の下を、輪の受け手と同じ関数（数え直し・鎖）で確かめる。
// 台帳の置き場所（リポジトリの名前と、その中の台帳の根）は config/ledger.json の 1 か所（src/share/ledger-place.ts。mushitaro/moyai#20）。
// 下の <dir> は、台帳の根の下の ledger/（2026-11-12 から台帳だけのリポジトリ mushitaro/moyai-ledger の ledger/。config/ledger.json）。
//   <dir>/ledger.json                                   台帳の決まり（管理者が署名。circle.json と同じ形で、厳しくする向きだけ）
//   <dir>/TERMS.md                                      利用条件（検証では読まない）
//   <dir>/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json     束（足すだけ）
//   <dir>/bundles/<鍵ID>/retired.json                   取り下げの印（moyai.retired/0。その鍵自身の署名。Architect の 72）
// 読み手（フォルダか git の木か）を問わない形（LedgerFile の並び）で受け、引数で緩める切り替えは持たない。道はどれも台帳のリポジトリの根から。
// 台帳 ID は ledger.json の body の変わらない部分（v・founder・nonce）から決まり、束の行き先（to）と照らす。
// 鍵 ID と出した人の結びつきは、束の署名をその鍵の公開鍵で確かめて決める（GitHub のログイン名には頼らない）。
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLE_FILE_NAME, LEDGER_V, RULES_TYPE, checkShape, ringIdOf, type BundleBody, type ShareContext } from "./bundle";
import { parseJsonStrict } from "./jcs";
import type { NationalTable, Vocab } from "./k";
import { isClean, recount } from "./recount";
import { LEDGER_PLACE } from "./ledger-place";
import { checkChain } from "./ring";
import { baseRules, rulesHaveRemovedField, type Rules } from "./rules";
import { HEX16, fingerprint, sha256Hex } from "./sign";

/** 台帳を持つリポジトリ（owner/name。config/ledger.json） */
export const LEDGER_REPO = LEDGER_PLACE.repo;
/** 台帳のリポジトリの中の、台帳の根（README・.gitattributes を置く）。リポジトリの根そのものなら "" */
export const LEDGER_ROOT = LEDGER_PLACE.root;
/** 台帳の根の下の、決まり・利用条件・束を置くフォルダ（リポジトリの根から） */
export const LEDGER_DIR = LEDGER_PLACE.dir;
export const LEDGER_FILE = "ledger.json";
export const LEDGER_TERMS = "TERMS.md";
export const LEDGER_BUNDLES = "bundles";
export const LEDGER_JSON_PATH = `${LEDGER_DIR}/${LEDGER_FILE}`;
export const LEDGER_TERMS_PATH = `${LEDGER_DIR}/${LEDGER_TERMS}`;
/** 束を置くフォルダ（この下に <鍵ID>/） */
export const LEDGER_BUNDLES_PATH = `${LEDGER_DIR}/${LEDGER_BUNDLES}`;
/** 取り下げの印のファイルの名前（鍵のフォルダに 1 つ） */
export const LEDGER_RETIRED_FILE = "retired.json";

/** 入力の上限（コードの定数）。束 1 つは塊が上限まであっても数百 KB に収まる */
export const LEDGER_LIMITS = { fileBytes: 1024 * 1024, files: 20_000, jsonDepth: 8 } as const;

/** 束の道：<dir>/bundles/<鍵ID 16 桁>/<連番 6 桁>-<ハッシュ先頭 16>.json（ASCII の小文字と数字だけ） */
export const LEDGER_BUNDLE_PATH = LEDGER_PLACE.bundlePath;
/** 取り下げの印の道：<dir>/bundles/<鍵ID 16 桁>/retired.json */
export const LEDGER_RETIRED_PATH = LEDGER_PLACE.retiredPath;

/** 鍵のフォルダの道（<dir>/bundles/<鍵ID>） */
export function ledgerKeyFolder(key: string): string {
  return `${LEDGER_BUNDLES_PATH}/${key}`;
}

/** 取り下げの印の道（ledger/ledger/bundles/<鍵ID>/retired.json） */
export function ledgerRetiredPath(key: string): string {
  return `${ledgerKeyFolder(key)}/${LEDGER_RETIRED_FILE}`;
}

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
  /** ✓ の束の body（集計に使う）。取り下げた鍵の束は ✓ でも null（k にも集計にも数えない） */
  body: BundleBody | null;
  /** その鍵自身の署名の取り下げの印がある鍵の束（✓ のまま残し、数えない） */
  retired?: true;
}

/** 取り下げの印（ledger/ledger/bundles/<鍵ID>/retired.json）の 1 行 */
export interface LedgerRetiredLine {
  path: string;
  key: string;
  status: "ok" | "ng";
  reasons: string[];
  /** ファイルのバイト列の SHA-256 */
  hash: string | null;
  /** 印に書いた最後の連番（✓ のときだけ） */
  last: number | null;
  /** 印を当てる前に、その鍵で鎖が ✓ だった最大の連番（無ければ 0）。足すときに last がこれより小さければ断る */
  placedMax: number;
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
  /** 取り下げの印（✓ の印の鍵は、k にも集計にも数えない） */
  retired: LedgerRetiredLine[];
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

/**
 * ledger.json を決まりとして読めないときに、理由だけを出す：コードの決まりで数え直す（輪の受け手の readRing と同じ考え。この台帳の束は数えない）。
 * 台帳 ID は、body の変わらない部分（v・founder・nonce）が読めればそこから決める（読めなければ、数え直しは行き先を照らさない）。
 */
export function ledgerRulesReasons(ledgerBytes: Uint8Array, pack: { table: NationalTable; vocab: Vocab }): string[] {
  const p = parseJsonStrict(Buffer.from(ledgerBytes).toString("utf8"));
  const body = p.ok ? (p.value as { body?: { v?: unknown; founder?: unknown; nonce?: unknown } }).body : undefined;
  const id =
    body && typeof body.v === "string" && typeof body.founder === "string" && typeof body.nonce === "string"
      ? ringIdOf({ v: body.v, founder: body.founder, nonce: body.nonce })
      : "0".repeat(16);
  const safe: ShareContext = {
    table: pack.table,
    vocab: pack.vocab,
    rules: baseRules(pack.vocab.pack, pack.vocab.hash, pack.table.hash),
    rulesHash: sha256Hex(ledgerBytes),
    to: { kind: "ledger", id },
  };
  return recount(ledgerBytes, safe).reasons;
}

/** ledger.json の決まりが、どこにも出さない欄（経過年）を許しているか（パックが無くても言える。CLI がパックを選ぶ前に使う） */
export function ledgerRulesHaveRemovedField(bytes: Uint8Array | string | null): boolean {
  if (bytes === null) return false;
  const p = parseJsonStrict(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8"));
  return p.ok && rulesHaveRemovedField((p.value as { body?: { rules?: unknown } })?.body?.rules);
}

function kindReason(kind: LedgerFile["kind"]): string {
  return kind === "symlink" ? "file.symlink" : kind === "submodule" ? "file.submodule" : "file.notRegular";
}

/**
 * 台帳を確かめる。files はリポジトリの中の項目（ledger/ledger/ の外のものは見ない）。
 * 決まり（ledger.json）が ✓ でなければ、どの束も ✗（理由 ledger）。束と取り下げの印ごとに ✓ か理由つきの ✗ を出す。
 */
export function verifyLedgerFiles(files: readonly LedgerFile[], pack: { table: NationalTable; vocab: Vocab }): LedgerRead {
  const ledger: LedgerRulesInfo = { status: "missing", reasons: [], id: null, hash: null, rules: null, version: null, month: null, founder: null };
  const out: LedgerRead = { ledger, bundles: [], retired: [], others: [], ok: false };
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
        // 読めない理由も出す（どこにも出さない欄を許す決まりなど）。この台帳の束は数えない
        ledger.reasons = [...new Set(["ledger.unreadable", ...ledgerRulesReasons(lf.bytes, pack)])];
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
    const rm = LEDGER_RETIRED_PATH.exec(f.path);
    if (rm) {
      out.retired.push(retiredLine(f, rm[1]!, ctx));
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
  // 取り下げの印（readRing と同じ考え。Architect の 72）：その鍵自身の署名の印だけを受ける。
  // 印の最後の連番より大きい束は ✗（盗んだ人が取り下げのあとに古い鍵で出し続ける道を止める）。印のある鍵の束は、✓ のまま残して数えない
  for (const r of out.retired) {
    const list = byKey.get(r.key) ?? [];
    r.placedMax = Math.max(0, ...list.filter((b) => b.status === "ok" && b.seq !== null).map((b) => b.seq!));
    if (r.status !== "ok" || r.last === null) continue;
    for (const b of list) {
      if (b.status !== "ok") continue;
      if (b.seq !== null && b.seq > r.last) {
        b.reasons.push("chain.afterRetired");
        b.status = "ng";
      } else b.retired = true;
    }
  }
  for (const list of byKey.values()) for (const b of list) if (b.status !== "ok" || b.retired) b.body = null;
  out.bundles = [...byKey.values()].flat().sort((a, b) => (a.path < b.path ? -1 : 1));
  out.retired.sort((a, b) => (a.path < b.path ? -1 : 1));
  out.ok = ledger.status === "ok" && out.others.length === 0 && out.bundles.every((b) => b.status === "ok") && out.retired.every((r) => r.status === "ok");
  return out;
}

/**
 * 取り下げの印を 1 つ確かめる。数え直し（recount）が、型（ring の代わりに ledger を持つ moyai.retired/0）・body.pub での署名・
 * pub から作った鍵 ID と body.key・行き先（台帳 ID）を確かめる。道の鍵 ID と body の key が同じときだけ ✓（readRing と同じ 3 つの一致）
 */
function retiredLine(f: LedgerFile, key: string, ctx: ShareContext | null): LedgerRetiredLine {
  const line: LedgerRetiredLine = { path: f.path, key, status: "ng", reasons: [], hash: null, last: null, placedMax: 0 };
  if (f.kind !== "file") {
    line.reasons.push(kindReason(f.kind));
    return line;
  }
  if (f.bytes === null) {
    line.reasons.push("file.tooLarge");
    return line;
  }
  line.hash = sha256Hex(f.bytes);
  if (!ctx) {
    line.reasons.push("ledger");
    return line;
  }
  if (jsonDepth(Buffer.from(f.bytes).toString("utf8")) > LEDGER_LIMITS.jsonDepth) {
    line.reasons.push("file.tooDeep");
    return line;
  }
  const r = recount(f.bytes, ctx);
  const body = r.body as { key?: unknown; last?: unknown } | null;
  if (r.kind !== "retired") line.reasons.push(...r.reasons, "file.notRetired");
  else if (!isClean(r)) line.reasons.push(...r.reasons);
  if (body && body.key !== key) line.reasons.push("file.otherFolder");
  line.reasons = [...new Set(line.reasons)];
  if (line.reasons.length === 0 && typeof body?.last === "number") {
    line.status = "ok";
    line.last = body.last;
  } else if (line.reasons.length === 0) line.reasons.push("file.notRetired");
  return line;
}

/**
 * 束 1 つを台帳の木に足したときに、受け手と同じ関数（verifyLedgerFiles）で ✓ になるか。✗ なら理由。
 * 出す側（アプリの ledger-send）と公開の台帳の受け口（services/ledger-intake）が、同じこの関数を使う。
 * files は台帳の木の ledger/ledger/ の下の項目（少なくとも ledger.json と、その束の鍵のフォルダ）。決まりが ✓ でなければ理由は ledger
 */
export function checkBundleAdded(
  files: readonly LedgerFile[],
  pack: { table: NationalTable; vocab: Vocab },
  path: string,
  bytes: Uint8Array,
): { ok: true } | { ok: false; reasons: string[] } {
  if (files.some((f) => f.path === path)) return { ok: false, reasons: ["ledger.exists"] };
  const read = verifyLedgerFiles([...files, { path, kind: "file", bytes }], pack);
  const line = read.bundles.find((b) => b.path === path);
  // 取り下げた鍵には、もう足さない（✓ でも数えないので、載せる意味が無い）
  if (line && line.status === "ok" && line.retired) return { ok: false, reasons: ["ledger.keyRetired"] };
  if (line && line.status === "ok" && read.ledger.status === "ok") return { ok: true };
  return { ok: false, reasons: line?.reasons.length ? line.reasons : read.ledger.reasons.length ? read.ledger.reasons : ["ledger"] };
}

/**
 * 取り下げの印 1 つを台帳の木に足したときに ✓ になるか。✗ なら理由。束と同じく、出す側（CLI の ledger submit）・台帳の PR の検証・
 * 受け口が同じこの関数を使う。印の最後の連番が、台帳に載った（鎖が ✓ の）その鍵の束の連番より小さければ断る
 * （載った束を、印のあとの束にして ✗ にする書き方なので。輪の chain.retiredBelowKnown と同じ考え）
 */
export function checkRetiredAdded(
  files: readonly LedgerFile[],
  pack: { table: NationalTable; vocab: Vocab },
  path: string,
  bytes: Uint8Array,
): { ok: true; key: string; last: number } | { ok: false; reasons: string[] } {
  if (files.some((f) => f.path === path)) return { ok: false, reasons: ["ledger.retiredExists"] };
  const read = verifyLedgerFiles([...files, { path, kind: "file", bytes }], pack);
  const line = read.retired.find((r) => r.path === path);
  if (!line) return { ok: false, reasons: ["path.notAllowed"] };
  if (line.status !== "ok" || read.ledger.status !== "ok" || line.last === null) {
    return { ok: false, reasons: line.reasons.length ? line.reasons : read.ledger.reasons.length ? read.ledger.reasons : ["ledger"] };
  }
  if (line.last < line.placedMax) return { ok: false, reasons: ["chain.retiredBelowKnown"] };
  return { ok: true, key: line.key, last: line.last };
}

// ─── フォルダから読む ─────────────────────────────────────────

export type LedgerDirRead = { ok: true; files: LedgerFile[] } | { ok: false; reason: "noLedgerDir" | "ledgerDirSymlink" | "tooManyFiles" };

/**
 * MOYAI のリポジトリ（の clone）の根のフォルダから、ledger/ledger/ の下の項目を読む。symlink（Windows の junction も）はたどらず、
 * 中身も読まずに symlink として返す。大きすぎるファイルは中身を読まない。
 */
export async function readLedgerDir(root: string): Promise<LedgerDirRead> {
  // 台帳の根と、その下の ledger/ の、どちらかが symlink ならたどらない（台帳の根がリポジトリの根そのものなら、下の ledger/ だけ）
  for (const rel of LEDGER_ROOT ? [LEDGER_ROOT, LEDGER_DIR] : [LEDGER_DIR]) {
    let st;
    try {
      st = await lstat(join(root, ...rel.split("/")));
    } catch {
      return { ok: false, reason: "noLedgerDir" };
    }
    if (st.isSymbolicLink()) return { ok: false, reason: "ledgerDirSymlink" };
    if (!st.isDirectory()) return { ok: false, reason: "noLedgerDir" };
  }
  const base = join(root, ...LEDGER_DIR.split("/"));
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
