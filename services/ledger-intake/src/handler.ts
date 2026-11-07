// 公開の台帳の受け口（運営者の決定 2026-11-07）：GitHub のアカウントを持たない人の束を受け、運営者の GitHub のアカウントで台帳に PR を出す。
// 道は POST /submit だけ。体は束のファイル 1 つ（JSON、256 KB まで）。確かめの順：
//   1. 道と方法・設定（GITHUB_TOKEN・LEDGER_REPO・KV）
//   2. 濫用の防ぎ：同じ IP から 1 時間に 10 件まで（limit.ts。IP は鍵つきのハッシュにして数え、残さない）
//   3. Content-Type（application/json）と大きさ（256 KB まで）
//   4. JSON の形と深さ（UTF-8・入れ子 8 段まで・厳しい読み・正規形・束の形）と、束の署名（body の公開鍵で）。ここまでは GitHub を呼ばない
//   5. 同じ中身のハッシュの PR（枝 intake/<ハッシュの頭 16 字>）があれば、それを返して新しく出さない
//   6. 台帳の検証：台帳の既定のブランチから ledger.json と同じ鍵の束を読み、束を足した木を verifyLedgerFiles（台帳の Actions と同じ関数）で確かめる
//   7. 枝を作り、束のファイル 1 つを置き、PR を出す
// 断るときは理由のコード（台帳の検証のコードのまま）と、その言葉（台帳の検証が PR に書く言葉と同じ reasonText）を返す。
// トークンと IP は、ログにも答えにも出さない（console に何も書かない）。
import { reasonText } from "../../../src/app/text/reasons";
import { BUNDLE_V, bundleFileName } from "../../../src/share/bundle";
import { canonicalize, parseJsonStrict } from "../../../src/share/jcs";
import type { NationalTable, Vocab } from "../../../src/share/k";
import { LEDGER_DIR, LEDGER_JSON_PATH, LEDGER_LIMITS, checkBundleAdded, jsonDepth, ledgerContext, ledgerRulesOf } from "../../../src/share/ledger";
import { HEX128, HEX16, HEX64, keyIdOf, sha256Hex, verifyBody } from "../../../src/share/sign";
import { findPr, ledgerBase, openPr, readLedgerFiles, repoOf, type FetchLike, type Gh, type PrRef } from "./github";
import { RATE_LIMIT, bucketKey, clientBucket, takeSlot, type KvLike } from "./limit";
import { INTAKE_PR_TEXT } from "./text";

/** 受け口の上限（コードの定数） */
export const INTAKE_LIMITS = {
  /** 束のファイル 1 つの大きさ */
  bodyBytes: 256 * 1024,
  /** 同じ送り手（IP）から 1 時間に受ける件数 */
  perHour: RATE_LIMIT.max,
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
export interface IntakeNg {
  ok: false;
  /** 理由のコード（台帳の検証のコードのまま。受け口だけの理由は intake.*） */
  reasons: string[];
  /** 理由の言葉（台帳の検証が PR に書く言葉と同じ） */
  reasonsText: string[];
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function reply(status: number, body: IntakeOk | IntakeNg, extra: Record<string, string> = {}): Response {
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

/**
 * 台帳を読む前の確かめ：JSON の形・深さと束の署名。理由のコードは台帳の検証（recount・verifyLedgerFiles）と同じものを使う。
 * 中身（k・費用・自由記述・鎖）は、このあと台帳の検証が確かめる。
 */
export function bundleHead(bytes: Uint8Array): { ok: true; head: BundleHead } | { ok: false; reasons: string[] } {
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
  const body = env && env.body && typeof env.body === "object" && !Array.isArray(env.body) ? (env.body as Record<string, unknown>) : null;
  if (!env || !body || Object.keys(env).sort().join(",") !== "body,sig" || body.v !== BUNDLE_V) return { ok: false, reasons: [...reasons, "file.notBundle"] };
  const pub = typeof body.pub === "string" && HEX64.test(body.pub) ? body.pub : null;
  const key = typeof body.key === "string" && HEX16.test(body.key) ? body.key : null;
  if (!pub || !key || keyIdOf(pub) !== key) reasons.push("chain.keyMismatch");
  const seq = typeof body.seq === "number" && Number.isInteger(body.seq) && body.seq >= 1 && body.seq <= SEQ_MAX ? body.seq : null;
  if (seq === null) reasons.push("chain.seqMissing");
  if (!pub || typeof env.sig !== "string" || !HEX128.test(env.sig) || !verifyBody(body, env.sig, pub)) reasons.push("chain.badSignature");
  if (reasons.length > 0 || !pub || !key || seq === null) return { ok: false, reasons };
  return { ok: true, head: { key, pub, seq, hash: sha256Hex(bytes) } };
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

  // 2. 同じ IP から 1 時間に 10 件まで（断った束も数える）
  const bucket = clientBucket(req.headers.get("cf-connecting-ip"));
  if (!bucket) return refuse(400, ["intake.noClient"]);
  let slot;
  try {
    slot = await takeSlot(kv, bucketKey(token, bucket), deps.now());
  } catch {
    return refuse(503, ["intake.unavailable"]);
  }
  if (!slot.ok) return refuse(429, ["intake.rateLimited"], { "retry-after": String(slot.retryAfter) });

  // 3. 形式と大きさ
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct !== "application/json") return refuse(415, ["intake.contentType"]);
  const bytes = await readLimited(req, INTAKE_LIMITS.bodyBytes);
  if (!bytes) return refuse(413, ["file.tooLarge"]);

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
  const path = `${LEDGER_DIR}/bundles/${key}/${bundleFileName(seq, hash)}`;
  const check = checkBundleAdded(files, pack, path, bytes);
  if (!check.ok) {
    // 台帳の決まりそのものが ✓ でないのは、出した人には直せない（受け口の側の止まり）
    return refuse(check.reasons.includes("ledger") ? 503 : 400, check.reasons);
  }

  // 7. 枝・ファイル・PR
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
