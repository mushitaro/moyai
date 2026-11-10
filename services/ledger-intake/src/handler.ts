// 公開の台帳の受け口（運営者の決定 2026-11-07）：GitHub のアカウントを持たない人の束を受け、運営者の GitHub のアカウントで台帳に PR を出す。
// 道は POST /submit だけ。体は束のファイル 1 つか、取り下げの印 1 つ（JSON、256 KB まで）。確かめの順：
//   1. 道と方法・設定（GITHUB_TOKEN・LEDGER_REPO・KV）
//   2. 濫用の防ぎ：同じ IP から 1 時間に 10 件まで、まわりの網（/24・/48）から 30 件まで（limit.ts。IP は鍵つきのハッシュにして数え、残さない）
//   3. Content-Type（application/json）と大きさ（256 KB まで）
//   4. JSON の形と深さ（UTF-8・入れ子 8 段まで・厳しい読み・正規形・束か印の形）と、署名（body の公開鍵で）。ここまでは GitHub を呼ばない
//   5. 同じ中身のハッシュの PR（枝 intake/<ハッシュの頭 16 字>）があれば、それを返して新しく出さない
//   6. 台帳の検証：台帳の既定のブランチから ledger.json と同じ鍵の束を読み、束を足した木を verifyLedgerFiles（台帳の Actions と同じ関数）で確かめる
//   7. 開いた受け口の PR を数える（同じ鍵で 1 つ、全部で 20 まで。KV の数は拠点をまたぐとずれるので、GitHub の PR で数える）。
//      枝を作り、束のファイル 1 つを置き、PR を出す
// 取り下げの印（ledger/ledger/bundles/<鍵ID>/retired.json。Architect の 72）は、束と同じ口・同じ IP の上限で受ける：
//   6'. 印を足した木を同じ関数で確かめる（その鍵自身の署名・道の鍵 ID・本文の key・pub から作った鍵 ID がそろうときだけ）
//   7'. その鍵の束の、まだマージされていない PR を「本人が取り下げた」と書いて閉じる。その鍵の束が台帳に載っていれば（マージ済み）、
//       印のファイル 1 つを置く PR を出す。載っていなければ印の PR は出さない
// 受け口の PR はどれも運営者（tsunagi）のアカウントで出るので、「GitHub のアカウントが替わった印」（docs/plan.md §2.19 の 3。未実装）を、
// 受け口の PR には付けない（Architect の 72 の 5）。
// 断るときは理由のコード（台帳の検証のコードのまま）と、その言葉（台帳の検証が PR に書く言葉と同じ reasonText）を返す。
// トークンと IP は、ログにも答えにも出さない（console に何も書かない）。
import { reasonText } from "../../../src/app/text/reasons";
import { BUNDLE_V, RETIRED_V, bundleFileName } from "../../../src/share/bundle";
import { canonicalize, parseJsonStrict } from "../../../src/share/jcs";
import type { NationalTable, Vocab } from "../../../src/share/k";
import {
  LEDGER_BUNDLE_PATH,
  LEDGER_JSON_PATH,
  LEDGER_LIMITS,
  checkBundleAdded,
  checkRetiredAdded,
  jsonDepth,
  ledgerContext,
  ledgerKeyFolder,
  ledgerRetiredPath,
  ledgerRulesOf,
  type LedgerFile,
} from "../../../src/share/ledger";
import { HEX128, HEX16, HEX64, keyIdOf, sha256Hex, verifyBody } from "../../../src/share/sign";
import { closePrWithComment, findPr, ledgerBase, openIntakePrs, openPr, openPrsOfKey, readLedgerFiles, repoOf, type FetchLike, type Gh, type PrRef } from "./github";
import { RATE_LIMIT, bucketKey, clientBucket, networkBucket, takeSlot, type KvLike } from "./limit";
import { INTAKE_PR_TEXT } from "./text";

/** 受け口の上限（コードの定数） */
export const INTAKE_LIMITS = {
  /** 束のファイル 1 つの大きさ */
  bodyBytes: 256 * 1024,
  /** 同じ送り手（IP）から 1 時間に受ける件数 */
  perHour: RATE_LIMIT.max,
  /** まわりの網（IPv4 の /24・IPv6 の /48）から 1 時間に受ける件数 */
  perHourNetwork: RATE_LIMIT.networkMax,
  /** 開いた受け口の PR の数（全部で）。越えたら、運営者が審査するまで新しく出さない */
  openPrs: 20,
  /** 開いた受け口の PR の数（同じ鍵で）。台帳の鎖は載った束の次しか ✓ にしないので、正しい送り手は 1 つずつ出す */
  openPrsPerKey: 1,
} as const;

export const INTAKE_PATH = "/submit";
/** 連番の上限（ファイル名の 6 桁） */
const SEQ_MAX = 999_999;

/** Workers の環境（秘密・変数・KV の束縛） */
export interface IntakeEnv {
  /** 秘密：運営者の GitHub の fine-grained のトークン（台帳のリポジトリだけ、contents と pull requests の書き込み） */
  GITHUB_TOKEN?: string;
  /** 変数：台帳のリポジトリ（owner/name） */
  LEDGER_REPO?: string;
  /** KV：送り手ごとの件数（1 時間で消える） */
  INTAKE_KV?: KvLike;
}

/** 台帳の検証に使うパックの部品（全国の表と公開語彙） */
export interface LedgerPack {
  table: NationalTable;
  vocab: Vocab;
}

export interface IntakeDeps {
  /** GitHub への fetch（試験は差し替える） */
  fetch: FetchLike;
  now: () => number;
  /** 台帳の決まりが名指すパック。無ければ null */
  packOf: (packId: string) => LedgerPack | null;
}

export interface IntakeOk {
  ok: true;
  pr: PrRef;
}
/** 取り下げの印を受けたとき：出した印の PR（その鍵の束が台帳に載っていなければ null）と、閉じた PR */
export interface IntakeRetiredOk {
  ok: true;
  pr: PrRef | null;
  closed: PrRef[];
}
export interface IntakeNg {
  ok: false;
  /** 理由のコード（台帳の検証のコードのまま。受け口だけの理由は intake.*） */
  reasons: string[];
  /** 理由の言葉（台帳の検証が PR に書く言葉と同じ） */
  reasonsText: string[];
  /** 件数の上限のとき、次に受けられるまでの秒（retry-after の見出しと同じ値） */
  retryAfter?: number;
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function reply(status: number, body: IntakeOk | IntakeRetiredOk | IntakeNg, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function refuse(status: number, reasons: readonly string[], extra: Record<string, string> = {}): Response {
  const rs = [...new Set(reasons)];
  return reply(status, { ok: false, reasons: rs, reasonsText: [...new Set(rs.map(reasonText))] }, extra);
}

const accepted = (pr: PrRef): Response => reply(200, { ok: true, pr: { number: pr.number, url: pr.url } });

/** 体を上限まで読む。上限を越えれば null（その先は読まない） */
async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  const len = req.headers.get("content-length");
  if (len !== null && (!/^\d{1,12}$/.test(len) || Number(len) > limit)) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export interface BundleHead {
  key: string;
  pub: string;
  seq: number;
  /** ファイルのバイト列の SHA-256 */
  hash: string;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface RetiredHead {
  key: string;
  pub: string;
  last: number;
  /** ファイルのバイト列の SHA-256 */
  hash: string;
}

type Envelope = { ok: true; env: Record<string, unknown>; body: Record<string, unknown> | null; reasons: string[] } | { ok: false; reasons: string[] };

/** JSON の形と深さ（UTF-8・入れ子・厳しい読み・正規形）。理由のコードは台帳の検証（recount）と同じ */
function envelopeOf(bytes: Uint8Array): Envelope {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return { ok: false, reasons: ["shape.notUtf8"] };
  }
  if (jsonDepth(text) > LEDGER_LIMITS.jsonDepth) return { ok: false, reasons: ["file.tooDeep"] };
  const p = parseJsonStrict(text);
  if (!p.ok) return { ok: false, reasons: [p.truncated ? "shape.truncated" : "shape.syntax"] };
  const reasons: string[] = [];
  if (p.bom) reasons.push("shape.bom");
  if (p.duplicateKeys > 0) reasons.push("shape.duplicateKey");
  if (p.protoKeys > 0) reasons.push("shape.protoKey");
  if (p.loneSurrogates > 0) reasons.push("shape.loneSurrogate");
  let canonical: string | null = null;
  try {
    canonical = canonicalize(p.value);
  } catch {
    canonical = null;
  }
  if (canonical !== text) reasons.push("shape.notCanonical");
  const env = p.value && typeof p.value === "object" && !Array.isArray(p.value) ? (p.value as Record<string, unknown>) : null;
  if (!env || Object.keys(env).sort().join(",") !== "body,sig") return { ok: true, env: env ?? {}, body: null, reasons };
  const body = env.body && typeof env.body === "object" && !Array.isArray(env.body) ? (env.body as Record<string, unknown>) : null;
  return { ok: true, env, body, reasons };
}

/** 鍵 ID・公開鍵・署名（body.pub で）。外れの理由を reasons に足す */
function signerOf(env: Record<string, unknown>, body: Record<string, unknown>, reasons: string[]): { key: string; pub: string } | null {
  const pub = typeof body.pub === "string" && HEX64.test(body.pub) ? body.pub : null;
  const key = typeof body.key === "string" && HEX16.test(body.key) ? body.key : null;
  if (!pub || !key || keyIdOf(pub) !== key) reasons.push("chain.keyMismatch");
  if (!pub || typeof env.sig !== "string" || !HEX128.test(env.sig) || !verifyBody(body, env.sig, pub)) reasons.push("chain.badSignature");
  return pub && key ? { key, pub } : null;
}

/**
 * 台帳を読む前の確かめ：JSON の形・深さと束の署名。理由のコードは台帳の検証（recount・verifyLedgerFiles）と同じものを使う。
 * 中身（k・費用・自由記述・鎖）は、このあと台帳の検証が確かめる。
 */
export function bundleHead(bytes: Uint8Array): { ok: true; head: BundleHead } | { ok: false; reasons: string[] } {
  const e = envelopeOf(bytes);
  if (!e.ok) return e;
  const { env, body } = e;
  const reasons = [...e.reasons];
  if (!body || body.v !== BUNDLE_V) return { ok: false, reasons: [...reasons, "file.notBundle"] };
  const pub = typeof body.pub === "string" && HEX64.test(body.pub) ? body.pub : null;
  const key = typeof body.key === "string" && HEX16.test(body.key) ? body.key : null;
  if (!pub || !key || keyIdOf(pub) !== key) reasons.push("chain.keyMismatch");
  const seq = typeof body.seq === "number" && Number.isInteger(body.seq) && body.seq >= 1 && body.seq <= SEQ_MAX ? body.seq : null;
  if (seq === null) reasons.push("chain.seqMissing");
  if (!pub || typeof env.sig !== "string" || !HEX128.test(env.sig) || !verifyBody(body, env.sig, pub)) reasons.push("chain.badSignature");
  if (reasons.length > 0 || !pub || !key || seq === null) return { ok: false, reasons };
  return { ok: true, head: { key, pub, seq, hash: sha256Hex(bytes) } };
}

/**
 * 取り下げの印の、台帳を読む前の確かめ：JSON の形・深さと、その鍵自身の署名（body.pub で）。
 * 型・行き先（台帳 ID）・道の鍵 ID との一致は、このあと台帳の検証（checkRetiredAdded）が確かめる。
 */
export function retiredHead(bytes: Uint8Array): { ok: true; head: RetiredHead } | { ok: false; reasons: string[] } {
  const e = envelopeOf(bytes);
  if (!e.ok) return e;
  const reasons = [...e.reasons];
  if (!e.body || e.body.v !== RETIRED_V) return { ok: false, reasons: [...reasons, "file.notRetired"] };
  const s = signerOf(e.env, e.body, reasons);
  const last = typeof e.body.last === "number" && Number.isInteger(e.body.last) && e.body.last >= 0 && e.body.last <= SEQ_MAX ? e.body.last : null;
  if (last === null) reasons.push("file.notRetired");
  if (reasons.length > 0 || !s || last === null) return { ok: false, reasons };
  return { ok: true, head: { key: s.key, pub: s.pub, last, hash: sha256Hex(bytes) } };
}

/** 届いたファイルが取り下げの印か（body.v だけを見る。形は retiredHead が確かめる） */
function isRetiredDoc(bytes: Uint8Array): boolean {
  const e = envelopeOf(bytes);
  return e.ok && e.body !== null && e.body.v === RETIRED_V;
}

/** 枝の名前：intake/<ハッシュの頭 16 字>（中身が同じなら同じ枝） */
export function intakeBranch(hash: string): string {
  return `intake/${hash.slice(0, 16)}`;
}

/** fine-grained のトークンの形（中身は見ない。空や改行入りを断るだけ） */
const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/;

/** 受け口の入口。どの道でも、トークンと IP は答えに入れない */
export async function handleRequest(req: Request, env: IntakeEnv, deps: IntakeDeps): Promise<Response> {
  try {
    return await handle(req, env, deps);
  } catch {
    // 中身も理由の文も出さない（ログにも書かない）
    return refuse(500, ["intake.failed"]);
  }
}

async function handle(req: Request, env: IntakeEnv, deps: IntakeDeps): Promise<Response> {
  // 1. 道と方法・設定
  const url = new URL(req.url);
  if (url.pathname !== INTAKE_PATH) return refuse(404, ["intake.notFound"]);
  if (req.method !== "POST") return refuse(405, ["intake.method"], { allow: "POST" });
  const repo = repoOf(env.LEDGER_REPO);
  const token = env.GITHUB_TOKEN ?? "";
  const kv = env.INTAKE_KV;
  if (!repo || !TOKEN_SHAPE.test(token) || !kv) return refuse(503, ["intake.notConfigured"]);

  // 2. 同じ IP から 1 時間に 10 件まで、まわりの網から 30 件まで（断った束も数える）。IP は Cloudflare が付ける cf-connecting-ip だけを見る
  const ip = req.headers.get("cf-connecting-ip");
  const bucket = clientBucket(ip);
  const net = networkBucket(ip);
  if (!bucket || !net) return refuse(400, ["intake.noClient"]);
  let slot;
  try {
    slot = await takeSlot(
      kv,
      [
        { key: bucketKey(token, bucket), max: RATE_LIMIT.max },
        { key: bucketKey(token, `net:${net}`), max: RATE_LIMIT.networkMax },
      ],
      deps.now(),
    );
  } catch {
    return refuse(503, ["intake.unavailable"]);
  }
  if (!slot.ok) {
    return reply(429, { ok: false, reasons: ["intake.rateLimited"], reasonsText: [reasonText("intake.rateLimited")], retryAfter: slot.retryAfter }, { "retry-after": String(slot.retryAfter) });
  }

  // 3. 形式と大きさ
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct !== "application/json") return refuse(415, ["intake.contentType"]);
  const bytes = await readLimited(req, INTAKE_LIMITS.bodyBytes);
  if (!bytes) return refuse(413, ["file.tooLarge"]);

  // 取り下げの印は別の道（束と同じ口・同じ IP の上限）
  if (isRetiredDoc(bytes)) return handleRetired(bytes, token, repo, deps);

  // 4. JSON の形・深さ・束の署名（GitHub を呼ぶ前）
  const h = bundleHead(bytes);
  if (!h.ok) return refuse(400, h.reasons);
  const { key, pub, seq, hash } = h.head;
  const gh: Gh = { fetch: deps.fetch, token, repo };

  // 5. 同じ中身の PR があれば、それを返す
  const branch = intakeBranch(hash);
  const prev = await findPr(gh, branch);
  if (prev === "error") return refuse(502, ["intake.github"]);
  if (prev) return accepted(prev);

  // 6. 台帳の検証（台帳の Actions と同じ関数）
  const base = await ledgerBase(gh);
  if (!base) return refuse(502, ["intake.github"]);
  const files = await readLedgerFiles(gh, base.sha, key);
  if (!files) return refuse(502, ["intake.github"]);
  const lf = files.find((f) => f.path === LEDGER_JSON_PATH);
  const ledgerBytes = lf && lf.kind === "file" ? lf.bytes : null;
  const rules = ledgerRulesOf(ledgerBytes);
  if (!ledgerBytes || !rules) return refuse(503, ["ledger.unreadable"]);
  const pack = deps.packOf(rules.pack);
  if (!pack) return refuse(503, ["intake.packMissing"]);
  const ctx = ledgerContext(ledgerBytes, pack);
  if (!ctx) return refuse(503, ["ledger.unreadable"]);
  const path = `${ledgerKeyFolder(key)}/${bundleFileName(seq, hash)}`;
  const check = checkBundleAdded(files, pack, path, bytes);
  if (!check.ok) {
    // 台帳の決まりそのものが ✓ でないのは、出した人には直せない（受け口の側の止まり）
    return refuse(check.reasons.includes("ledger") ? 503 : 400, check.reasons);
  }

  // 7. 開いた受け口の PR の数（同じ鍵・全部）。それから枝・ファイル・PR
  const cap = await intakeRoom(gh, key);
  if (cap) return cap;
  const r = await openPr(gh, {
    base: base.base,
    baseSha: base.sha,
    branch,
    path,
    bytes,
    title: INTAKE_PR_TEXT.title(key, seq),
    body: INTAKE_PR_TEXT.body({ key, pub, seq, hash, path, ledgerId: ctx.to.id }),
    commitMessage: INTAKE_PR_TEXT.commitMessage(key, seq),
  });
  if (!r.ok) return refuse(502, ["intake.github"]);
  return accepted(r);
}

/**
 * 受け口の PR を新しく出せるか：開いた受け口の PR が全部で openPrs 未満、同じ鍵（key を渡したとき）で openPrsPerKey 未満。
 * 出せれば null、出せなければ断りの答え（PR の洪水を、IP の数え方とは別に GitHub の実際の数で止める）
 */
async function intakeRoom(gh: Gh, key: string | null): Promise<Response | null> {
  const open = await openIntakePrs(gh);
  if (open === "error") return refuse(502, ["intake.github"]);
  if (open === "tooMany" || open.length >= INTAKE_LIMITS.openPrs) return refuse(503, ["intake.busy"]);
  if (key !== null && open.filter((p) => p.title.includes(key)).length >= INTAKE_LIMITS.openPrsPerKey) return refuse(400, ["intake.keyPending"]);
  return null;
}

/** 台帳の決まりとパックを、読んだ木から決める（束と印で同じ） */
function ledgerOf(files: readonly LedgerFile[], deps: IntakeDeps): { ok: true; pack: LedgerPack; ledgerId: string } | { ok: false; res: Response } {
  const lf = files.find((f) => f.path === LEDGER_JSON_PATH);
  const ledgerBytes = lf && lf.kind === "file" ? lf.bytes : null;
  const rules = ledgerRulesOf(ledgerBytes);
  if (!ledgerBytes || !rules) return { ok: false, res: refuse(503, ["ledger.unreadable"]) };
  const pack = deps.packOf(rules.pack);
  if (!pack) return { ok: false, res: refuse(503, ["intake.packMissing"]) };
  const ctx = ledgerContext(ledgerBytes, pack);
  if (!ctx) return { ok: false, res: refuse(503, ["ledger.unreadable"]) };
  return { ok: true, pack, ledgerId: ctx.to.id };
}

/**
 * 取り下げの印（Architect の 72 の 4）：本人の署名を確かめ、その鍵の束のまだマージされていない PR を「本人が取り下げた」と書いて閉じる。
 * その鍵の束が台帳に載っていれば（マージ済み）、印のファイル 1 つを置く PR を出す。載っていなければ、印の PR は出さない
 */
async function handleRetired(bytes: Uint8Array, token: string, repo: NonNullable<ReturnType<typeof repoOf>>, deps: IntakeDeps): Promise<Response> {
  // 4'. JSON の形・深さ・その鍵自身の署名（GitHub を呼ぶ前）
  const h = retiredHead(bytes);
  if (!h.ok) return refuse(400, h.reasons);
  const { key, pub, last, hash } = h.head;
  const gh: Gh = { fetch: deps.fetch, token, repo };

  // 5'. 同じ中身の印の PR があれば、それを返す
  const branch = intakeBranch(hash);
  const prev = await findPr(gh, branch);
  if (prev === "error") return refuse(502, ["intake.github"]);
  if (prev) return reply(200, { ok: true, pr: { number: prev.number, url: prev.url }, closed: [] });

  // 6'. 台帳の検証（台帳の Actions と同じ関数）：印を足した木で、道の鍵 ID・本文の key・pub から作った鍵 ID がそろい、署名が ✓ か
  const base = await ledgerBase(gh);
  if (!base) return refuse(502, ["intake.github"]);
  const files = await readLedgerFiles(gh, base.sha, key);
  if (!files) return refuse(502, ["intake.github"]);
  const L = ledgerOf(files, deps);
  if (!L.ok) return L.res;
  const path = ledgerRetiredPath(key);
  const check = checkRetiredAdded(files, L.pack, path, bytes);
  if (!check.ok) return refuse(check.reasons.includes("ledger") ? 503 : 400, check.reasons);

  // 7'. その鍵の束の、まだマージされていない PR を閉じる（本人が取り下げた）
  const open = await openPrsOfKey(gh, key);
  if (open === "error") return refuse(502, ["intake.github"]);
  const closed: PrRef[] = [];
  for (const pr of open) {
    if (!(await closePrWithComment(gh, pr.number, INTAKE_PR_TEXT.withdrawn(key)))) return refuse(502, ["intake.github"]);
    closed.push({ number: pr.number, url: pr.url });
  }
  // その鍵の束が台帳に載っていなければ、印の PR は出さない（数える束が無いので）
  const folder = `${ledgerKeyFolder(key)}/`;
  const merged = files.some((f) => f.path.startsWith(folder) && LEDGER_BUNDLE_PATH.test(f.path));
  if (!merged) return reply(200, { ok: true, pr: null, closed });
  const cap = await intakeRoom(gh, null);
  if (cap) return cap;
  const r = await openPr(gh, {
    base: base.base,
    baseSha: base.sha,
    branch,
    path,
    bytes,
    title: INTAKE_PR_TEXT.retiredTitle(key),
    body: INTAKE_PR_TEXT.retiredBody({ key, pub, last, hash, path, ledgerId: L.ledgerId, closed: closed.map((c) => c.number) }),
    commitMessage: INTAKE_PR_TEXT.retiredCommitMessage(key),
  });
  if (!r.ok) return refuse(502, ["intake.github"]);
  return reply(200, { ok: true, pr: { number: r.number, url: r.url }, closed });
}
