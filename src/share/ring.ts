// 輪のフォルダ：<輪のフォルダ>/<輪ID>/ の下に circle.json・members/<鍵ID>.json・bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json。
// 書くとき：正しい形のファイルだけを、一時の名前で書き、更新時刻をその月の 1 日 0 時にそろえてから rename する。足すだけで、消さない・直さない。
// 読むとき：毎回ファイルから数える（DB の代わり）。束ごとに ✓・理由つきの ✗・届きかけ（読めない・途中で切れた）を分ける。
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PeerBundle } from "./aggregate";
import { BUNDLE_FILE_NAME, RULES_TYPE, bundleFileName, checkShape, type BundleBody, type ShareContext } from "./bundle";
import { parseJsonStrict } from "./jcs";
import type { PeerProfile, Profile } from "./k";
import { isClean, recount, type RecountResult } from "./recount";
import { baseRules, type Rules } from "./rules";
import { HEX16, sha256Hex } from "./sign";

export const CIRCLE_FILE = "circle.json";
export const MEMBERS_DIR = "members";
export const BUNDLES_DIR = "bundles";
/** 書きかけの一時の名前の頭と尾（読む側は届きかけに数える） */
export const TEMP_PREFIX = ".moyai-tmp-";
export const TEMP_SUFFIX = ".part";
/** rename が断られたときに置き直す回数 */
export const RENAME_RETRIES = 3;

export function ringDir(root: string, ringId: string): string {
  if (!HEX16.test(ringId)) throw new Error("輪 ID の形でない");
  return join(root, ringId);
}

/** その月の 1 日 0 時（その PC の時刻） */
export function monthStart(month: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error("月の形でない");
  return new Date(Number(m[1]), Number(m[2]) - 1, 1, 0, 0, 0, 0);
}

export type PlaceResult =
  | { ok: true; path: string }
  /** notClean：正しい形でない（数え直しが 0 でない）。exists：同じ名前がある（足すだけ）。unknown：結果不明 */
  | { ok: false; reason: "notClean" | "exists" | "unknown"; recount?: RecountResult };

/** 試験のために rename だけを差し替えられる（Windows の断りを再現する）。 */
export interface PlaceOptions {
  rename?: (from: string, to: string) => Promise<void>;
  retryDelayMs?: number;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 一時の名前 → 更新時刻を月の 1 日 0 時に → rename。断られたら数回だけ置き直し、だめなら結果不明。 */
async function place(dir: string, name: string, text: string, month: string, opts: PlaceOptions): Promise<PlaceResult> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  if (await exists(target)) return { ok: false, reason: "exists" };
  const tmp = join(dir, `${TEMP_PREFIX}${randomBytes(8).toString("hex")}${TEMP_SUFFIX}`);
  await writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
  const t = monthStart(month);
  await utimes(tmp, t, t);
  const doRename = opts.rename ?? rename;
  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    if (await exists(target)) {
      await rm(tmp, { force: true });
      return { ok: false, reason: "exists" };
    }
    try {
      await doRename(tmp, target);
      return { ok: true, path: target };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") break;
      await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 50));
    }
  }
  // 置けたかどうか分からない（一時のファイルは消しておく）
  await rm(tmp, { force: true });
  return { ok: false, reason: "unknown" };
}

/** 束を輪に置く。数え直しが全部 0 の束だけを、body の鍵のフォルダに、中身から決まる名前で置く。 */
export async function writeBundle(root: string, text: string, ctx: ShareContext, opts: PlaceOptions = {}): Promise<PlaceResult> {
  const r = recount(text, ctx);
  if (r.kind !== "bundle" || !isClean(r) || ctx.to.kind !== "ring") return { ok: false, reason: "notClean", recount: r };
  const body = r.body as { key: string; seq: number; month: string };
  const dir = join(ringDir(root, ctx.to.id), BUNDLES_DIR, body.key);
  return place(dir, bundleFileName(body.seq, r.hash), text, body.month, opts);
}

/** 仲間のファイル（公開鍵と状態だけ）を輪に置く。 */
export async function writeMember(root: string, text: string, ctx: ShareContext, opts: PlaceOptions = {}): Promise<PlaceResult> {
  const r = recount(text, ctx);
  if (r.kind !== "member" || !isClean(r)) return { ok: false, reason: "notClean", recount: r };
  const body = r.body as { key: string; month: string };
  return place(join(ringDir(root, ctx.to.id), MEMBERS_DIR), `${body.key}.json`, text, body.month, opts);
}

/** 決まりのファイルを輪に置く（輪を作るとき）。 */
export async function writeCircle(root: string, text: string, ctx: ShareContext, opts: PlaceOptions = {}): Promise<PlaceResult> {
  const r = recount(text, ctx);
  if (r.kind !== "circle" || !isClean(r)) return { ok: false, reason: "notClean", recount: r };
  const body = r.body as { month: string };
  return place(ringDir(root, ctx.to.id), CIRCLE_FILE, text, body.month, opts);
}

// ─── 読む ──────────────────────────────────────────────────

export type FileStatus = "ok" | "ng" | "arriving";

export interface BundleEntry {
  /** フォルダの名前（鍵 ID） */
  folder: string;
  name: string;
  status: FileStatus;
  reasons: string[];
  seq: number | null;
  hash: string;
  profile: Profile | null;
  /** 送った月（束の body の month、YYYY-MM）。読めなければ null */
  month: string | null;
}

export interface MemberStatus {
  key: string;
  status: "ok" | "ng";
  reasons: string[];
  /** 届きかけの束の数（✗ とは分ける） */
  arriving: number;
}

export interface RingRead {
  circle: { status: "ok" | "ng" | "missing"; reasons: string[] };
  bundles: BundleEntry[];
  members: MemberStatus[];
  /** 束の形をしていないファイルの数（名前の形が違う） */
  notBundleFiles: number;
  /** 確認済みの仲間の、✓ の最新の束の見え方（k に数える） */
  latest: PeerProfile[];
  /** latest と同じ束の body（受け手の集計に使う。確認済みで ✓ の仲間だけ） */
  latestBundles: PeerBundle[];
}

export interface ReadOptions {
  table: ShareContext["table"];
  vocab: ShareContext["vocab"];
  /** 電話で指紋を読み合わせた仲間の鍵 ID */
  confirmed: ReadonlySet<string>;
  /** 仲間ごとに前に見た最大の seq */
  knownMaxSeq?: ReadonlyMap<string, number>;
  /** OUTSIDE の集団と UPGRADE を数える仲間 */
  peers?: readonly PeerProfile[];
}

async function listDir(p: string): Promise<{ name: string; dir: boolean }[]> {
  try {
    return (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch {
    return [];
  }
}

function isTempName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX) || name.endsWith(TEMP_SUFFIX);
}

/** 鎖を確かめる束の 1 つ（輪と台帳が同じ形で渡す） */
export interface ChainItem {
  seq: number | null;
  /** ファイルのバイト列の SHA-256（✓ の束には必ずある） */
  hash: string | null;
  status: string;
  reasons: string[];
}

/**
 * 1 つの鍵の束の鎖を確かめる（輪の受け手と台帳の検証が同じこの関数を使う）。✓ の束だけを seq の順に並べ、
 * seq が 1 から抜けなく続き、prev が前の束のファイルのハッシュかを見る。切れたところから後ろは ✗。
 */
export function checkChain<E extends ChainItem>(list: readonly E[], prevOf: ReadonlyMap<E, unknown>): void {
  const ok = list.filter((b) => b.status === "ok").sort((a, b) => a.seq! - b.seq!);
  const seqCount = new Map<number, number>();
  for (const b of ok) seqCount.set(b.seq!, (seqCount.get(b.seq!) ?? 0) + 1);
  let expected = 1;
  let prevHash: string | null = null;
  let broken = false;
  for (const b of ok) {
    if (seqCount.get(b.seq!)! > 1) {
      b.reasons.push("chain.duplicateSeq");
      broken = true;
    } else if (broken) b.reasons.push("chain.afterBreak");
    else if (b.seq !== expected) {
      b.reasons.push("chain.gap");
      broken = true;
    } else if (prevOf.get(b) !== prevHash) {
      b.reasons.push("chain.broken");
      broken = true;
    }
    if (b.reasons.length > 0) b.status = "ng";
    expected = b.seq! + 1;
    prevHash = b.hash;
  }
}

/** 輪のフォルダを読み、束ごと・仲間ごとに ✓ か理由つきの ✗ か届きかけを出す。 */
export async function readRing(root: string, ringId: string, o: ReadOptions): Promise<RingRead> {
  const dir = ringDir(root, ringId);
  const out: RingRead = { circle: { status: "missing", reasons: [] }, bundles: [], members: [], notBundleFiles: 0, latest: [], latestBundles: [] };

  // 決まりのファイル
  let circleBytes: Buffer | null = null;
  try {
    circleBytes = await readFile(join(dir, CIRCLE_FILE));
  } catch {
    circleBytes = null;
  }
  let ctx: ShareContext | null = null;
  if (circleBytes !== null) {
    const p = parseJsonStrict(circleBytes.toString("utf8"));
    const rules = (p.ok ? ((p.value as { body?: { rules?: unknown } })?.body?.rules ?? null) : null) as Rules | null;
    const rulesIssues: string[] = [];
    checkShape(rules, RULES_TYPE, "rules", rulesIssues);
    if (rulesIssues.length === 0 && rules) {
      ctx = {
        table: o.table,
        vocab: o.vocab,
        rules,
        rulesHash: sha256Hex(circleBytes),
        to: { kind: "ring", id: ringId },
        peers: o.peers ?? [],
      };
      const r = recount(circleBytes, ctx);
      out.circle = r.kind === "circle" && isClean(r) ? { status: "ok", reasons: [] } : { status: "ng", reasons: r.reasons.length ? r.reasons : ["circle.kind"] };
    } else {
      // 決まりが決まりの形でなければ、コードの決まりで数え直して理由だけを出す（この輪の束は数えない）
      const safe: ShareContext = {
        table: o.table,
        vocab: o.vocab,
        rules: baseRules(o.vocab.pack, o.vocab.hash, o.table.hash),
        rulesHash: sha256Hex(circleBytes),
        to: { kind: "ring", id: ringId },
      };
      const r = recount(circleBytes, safe);
      out.circle = { status: "ng", reasons: [...new Set(["shape.rules", ...r.reasons])] };
    }
  }
  const circleOk = out.circle.status === "ok" && ctx !== null;

  // 仲間のファイル
  const memberOk = new Map<string, string[]>();
  for (const e of await listDir(join(dir, MEMBERS_DIR))) {
    if (e.dir) continue;
    const m = /^([0-9a-f]{16})\.json$/.exec(e.name);
    if (!m) {
      out.notBundleFiles++;
      continue;
    }
    const key = m[1]!;
    if (!circleOk) {
      memberOk.set(key, ["circle"]);
      continue;
    }
    const r = recount(await readFile(join(dir, MEMBERS_DIR, e.name)), ctx!);
    const reasons = r.kind === "member" && isClean(r) ? [] : r.reasons.length ? [...r.reasons] : ["member.kind"];
    if (r.kind === "member" && (r.body as { key?: unknown }).key !== key) reasons.push("member.otherFolder");
    memberOk.set(key, reasons);
  }

  // 束
  const prevOf = new Map<BundleEntry, unknown>();
  const bodyOf = new Map<BundleEntry, BundleBody>();
  const folders = (await listDir(join(dir, BUNDLES_DIR))).filter((e) => e.dir).map((e) => e.name);
  const byKey = new Map<string, BundleEntry[]>();
  for (const folder of folders.sort()) {
    const list: BundleEntry[] = [];
    byKey.set(folder, list);
    for (const e of (await listDir(join(dir, BUNDLES_DIR, folder))).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.dir) {
        out.notBundleFiles++;
        continue;
      }
      const path = join(dir, BUNDLES_DIR, folder, e.name);
      const bytes = await readFile(path);
      const entry: BundleEntry = { folder, name: e.name, status: "ok", reasons: [], seq: null, hash: sha256Hex(bytes), profile: null, month: null };
      list.push(entry);
      if (isTempName(e.name) || bytes.length === 0) {
        entry.status = "arriving";
        continue;
      }
      const nm = BUNDLE_FILE_NAME.exec(e.name);
      if (!nm) {
        out.notBundleFiles++;
        entry.status = "ng";
        entry.reasons.push("file.notBundleName");
        continue;
      }
      if (!circleOk) {
        entry.status = "ng";
        entry.reasons.push("circle");
        continue;
      }
      const r = recount(bytes, ctx!);
      if (r.truncated) {
        entry.status = "arriving";
        continue;
      }
      const body = r.body as { key?: unknown; seq?: unknown; profile?: Profile; month?: unknown } | null;
      entry.seq = typeof body?.seq === "number" ? body.seq : null;
      entry.month = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
      if (!isClean(r)) entry.reasons.push(...r.reasons);
      if (body && body.key !== folder) entry.reasons.push("file.otherFolder");
      if (entry.seq !== null && (Number(nm[1]) !== entry.seq || nm[2] !== r.hash.slice(0, 16))) entry.reasons.push("file.nameMismatch");
      if (entry.reasons.length > 0) entry.status = "ng";
      else {
        entry.profile = body!.profile ?? null;
        prevOf.set(entry, (body as { prev?: unknown }).prev);
        bodyOf.set(entry, body as unknown as BundleBody);
      }
    }
  }

  // 鎖：鍵ごとに seq を 1 から順に、prev が前の束のファイルのハッシュか
  for (const list of byKey.values()) checkChain(list, prevOf);

  // 仲間ごと
  const keys = [...new Set([...memberOk.keys(), ...byKey.keys()])].sort();
  for (const key of keys) {
    const reasons: string[] = [];
    const mr = memberOk.get(key);
    if (mr === undefined) reasons.push("member.missing");
    else reasons.push(...mr);
    if (!o.confirmed.has(key)) reasons.push("member.unconfirmed");
    const list = byKey.get(key) ?? [];
    for (const b of list) if (b.status === "ng") reasons.push(...b.reasons);
    const okSeqs = list.filter((b) => b.status === "ok").map((b) => b.seq!);
    const maxSeq = okSeqs.length ? Math.max(...okSeqs) : 0;
    const known = o.knownMaxSeq?.get(key);
    if (known !== undefined && maxSeq < known) reasons.push("chain.vanished");
    const uniq = [...new Set(reasons)];
    out.members.push({ key, status: uniq.length === 0 ? "ok" : "ng", reasons: uniq, arriving: list.filter((b) => b.status === "arriving").length });
    if (uniq.length === 0 && maxSeq > 0) {
      const latest = list.find((b) => b.status === "ok" && b.seq === maxSeq)!;
      if (latest.profile) out.latest.push({ key, profile: latest.profile });
      const b = bodyOf.get(latest);
      if (b) out.latestBundles.push({ key, pub: b.pub, body: b });
    }
  }
  out.bundles = [...byKey.values()].flat();
  return out;
}
