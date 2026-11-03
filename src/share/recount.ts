// 数え直し：送る側と受ける側が同じ関数で、ファイル全体（束・仲間のファイル・決まりのファイル）のすべての文字列を数える。
// 引数は、ファイルと文脈（全国の表・公開語彙・決まり・行き先）だけで、緩める切り替えを持たない。下限はコードの定数。
// 数えるもの：形の外れ・自由記述（公開語彙に無い文字列、ASCII 以外を含む文字列）・金額の形・正確な日付（年月日・和暦）・k・署名と鎖。
// 固有名詞は、送る側だけの別の関数（countProperNouns）が数える。値そのものはログに出さない。
import { WORK_ATTRIBUTES } from "../shared/plan";
import {
  CIRCLE_V,
  FIXED_SHAPES,
  LEDGER_V,
  MEMBER_BODY_TYPE,
  MEMBER_V,
  BUNDLE_V,
  RULES_TYPE,
  bundleBodyType,
  checkShape,
  envelopeType,
  publicWords,
  ringIdOf,
  rulesDocBodyType,
  type ShareContext,
} from "./bundle";
import { canonicalize, parseJsonStrict, type Json } from "./jcs";
import { SEND_MIN_K, countPeers, isCountable, kNational, type Group } from "./k";
import { checkRules, type Rules } from "./rules";
import { keyIdOf, sha256Hex, verifyBody } from "./sign";

export type DocKind = "bundle" | "member" | "circle" | "ledger";

export interface RecountResult {
  kind: DocKind | null;
  /** 形の外れ */
  shape: number;
  /** 自由記述 */
  freeText: number;
  /** 金額の形 */
  money: number;
  /** 正確な日付 */
  exactDate: number;
  /** 数えた k（束だけ。読めなければ null） */
  k: number | null;
  /** k が下限に届かない・数えられない分類・送る側の k と違う */
  kShort: number;
  /** 署名と鎖（署名・seq・prev・行き先・決まりのハッシュ） */
  chain: number;
  /** 理由のコード（値は入れない） */
  reasons: string[];
  /** ファイルのバイト列の SHA-256 */
  hash: string;
  /** 読めた body（形の外れがあっても読めたところまで） */
  body: Record<string, unknown> | null;
  /** 途中で切れていた（届きかけ） */
  truncated: boolean;
}

/** 全部 0 か（受け取りの ✓） */
export function isClean(r: RecountResult): boolean {
  return r.kind !== null && r.shape === 0 && r.freeText === 0 && r.money === 0 && r.exactDate === 0 && r.kShort === 0 && r.chain === 0;
}

/** 中身が 0 か（署名の前の確かめ。署名と鎖は見ない） */
export function isContentClean(r: RecountResult): boolean {
  return r.kind !== null && r.shape === 0 && r.freeText === 0 && r.money === 0 && r.exactDate === 0 && r.kShort === 0;
}

// ─── 形の照らし（NFKC にしてから） ─────────────────────────────

const MONEY: readonly RegExp[] = [
  /[¥$€£]\s*\d/,
  /\d\s*(?:円|千円|万円|百万円|億円|ドル|USD|JPY|EUR)/i,
  /(?:USD|JPY|EUR)\s*\d/i,
  /(?<!\d)\d{1,3}(?:,\d{3})+(?!\d)/,
];

const ERA = "(?:明治|大正|昭和|平成|令和)";
const DATE: readonly RegExp[] = [
  // 年月日（西暦）
  /(?<!\d)\d{4}\s*[-/.年]\s*(?:0?[1-9]|1[0-2])\s*[-/.月]\s*(?:0?[1-9]|[12]\d|3[01])(?!\d)/,
  // 月日
  /(?<!\d)(?:0?[1-9]|1[0-2])\s*月\s*(?:0?[1-9]|[12]\d|3[01])\s*日/,
  // 和暦（元号の名前）
  new RegExp(`${ERA}\\s*(?:\\d{1,2}|元)\\s*年?`),
  // 和暦（頭の文字と年。H28・R6.4.1 など）
  /(?<![A-Za-z0-9])[MTSHR]\s?\d{1,2}(?:[.\-/年]\s*\d{1,2}(?:[.\-/月]\s*\d{1,2})?)?(?![0-9A-Za-z])/,
  // 8 桁だけの文字列
  /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/,
];

export function hasMoney(s: string): boolean {
  const n = s.normalize("NFKC");
  return MONEY.some((re) => re.test(n));
}

export function hasExactDate(s: string): boolean {
  const n = s.normalize("NFKC");
  return DATE.some((re) => re.test(n));
}

const NON_ASCII = /[^\x20-\x7e]/;

function kindOfDoc(v: Json): DocKind | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const body = (v as Record<string, Json>).body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const tag = (body as Record<string, Json>).v;
  return tag === BUNDLE_V ? "bundle" : tag === MEMBER_V ? "member" : tag === CIRCLE_V ? "circle" : tag === LEDGER_V ? "ledger" : null;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF8_LOOSE = new TextDecoder("utf-8", { fatal: false });

/**
 * 1 つのファイルを数え直す。送る側（署名の前と後）と受ける側（輪・台帳）が同じこの関数を使う。
 * 文字列で受けたときは、そのまま UTF-8 のバイト列として扱う。
 */
export function recount(file: string | Uint8Array, ctx: ShareContext): RecountResult {
  const res: RecountResult = {
    kind: null,
    shape: 0,
    freeText: 0,
    money: 0,
    exactDate: 0,
    k: null,
    kShort: 0,
    chain: 0,
    reasons: [],
    hash: sha256Hex(file),
    body: null,
    truncated: false,
  };
  const shape = (r: string, n = 1) => {
    res.shape += n;
    res.reasons.push(`shape.${r}`);
  };
  const chain = (r: string) => {
    res.chain++;
    res.reasons.push(`chain.${r}`);
  };
  const kShort = (r: string) => {
    res.kShort++;
    res.reasons.push(`k.${r}`);
  };

  // 文脈の決まりが決まりの形でなければ、何も数えられない（型の言葉が決まらない）
  const ctxIssues: string[] = [];
  checkShape(ctx.rules, RULES_TYPE, "rules", ctxIssues);
  if (ctxIssues.length > 0) {
    shape("contextRules.malformed");
    return res;
  }

  let text: string;
  if (typeof file === "string") text = file;
  else {
    try {
      text = UTF8.decode(file);
    } catch {
      shape("notUtf8");
      text = UTF8_LOOSE.decode(file);
    }
  }

  const p = parseJsonStrict(text);
  // 文字列は、読めたところまで全部を照らす
  const words = publicWords(ctx);
  for (const s of p.strings) {
    const isPublic = !NON_ASCII.test(s.value) && (words.has(s.value) || FIXED_SHAPES.some((re) => re.test(s.value)));
    if (!isPublic) res.freeText++;
    if (hasMoney(s.value)) res.money++;
    if (hasExactDate(s.value)) res.exactDate++;
  }
  if (res.freeText > 0) res.reasons.push("freeText");
  if (res.money > 0) res.reasons.push("money");
  if (res.exactDate > 0) res.reasons.push("exactDate");

  if (!p.ok) {
    res.truncated = p.truncated;
    shape(p.truncated ? "truncated" : "syntax");
    return res;
  }
  if (p.bom) shape("bom");
  if (p.duplicateKeys > 0) shape("duplicateKey", p.duplicateKeys);
  if (p.protoKeys > 0) shape("protoKey", p.protoKeys);
  if (p.loneSurrogates > 0) shape("loneSurrogate", p.loneSurrogates);
  let canonical: string | null = null;
  try {
    canonical = canonicalize(p.value);
  } catch {
    canonical = null;
  }
  if (canonical !== text) shape("notCanonical");

  const kind = kindOfDoc(p.value);
  res.kind = kind;
  if (kind === null) {
    shape("unknownKind");
    return res;
  }
  const env = p.value as Record<string, Json>;
  const body = env.body as Record<string, Json>;
  res.body = body as Record<string, unknown>;
  const sig = env.sig;

  const issues: string[] = [];
  const bodyType =
    kind === "bundle" ? bundleBodyType(ctx) : kind === "member" ? MEMBER_BODY_TYPE : rulesDocBodyType(kind === "circle" ? CIRCLE_V : LEDGER_V);
  checkShape(p.value, envelopeType(bodyType), "", issues);
  if (issues.length > 0) shape("type", issues.length);

  // 決まりが緩くなっていないか（文脈の決まりも、決まりのファイルも）
  const ctxRulesBad = checkRules(ctx.rules);
  if (ctxRulesBad.length > 0) for (const v of ctxRulesBad) shape(`contextRules.${v}`);

  // 署名
  const signer = kind === "circle" || kind === "ledger" ? body.founder : body.pub;
  if (typeof sig !== "string" || typeof signer !== "string" || !verifyBody(body, sig, signer)) chain("badSignature");

  if (kind === "bundle") {
    if (typeof body.pub === "string" && /^[0-9a-f]{64}$/.test(body.pub) && keyIdOf(body.pub) !== body.key) chain("keyMismatch");
    const seq = body.seq;
    const prev = body.prev;
    if (typeof seq !== "number" || !Number.isInteger(seq)) chain("seqMissing");
    if (prev === undefined) chain("prevMissing");
    if (typeof seq === "number" && seq === 1 && prev !== null) chain("prevOnFirst");
    if (typeof seq === "number" && seq > 1 && typeof prev !== "string") chain("prevMissing");
    if (typeof seq === "number" && ctx.lastSeq !== undefined && seq < ctx.lastSeq) chain("seqBelowKnown");
    const to = body.to as Record<string, Json> | undefined;
    if (!to || to.kind !== ctx.to.kind || to.id !== ctx.to.id) chain("otherDestination");
    if (body.rules !== ctx.rulesHash) chain("oldRules");
    if (body.national !== ctx.table.hash || body.national !== ctx.rules.national) chain("nationalMismatch");
    if (body.vocab !== ctx.vocab.hash || body.vocab !== ctx.rules.vocab) chain("vocabMismatch");
    if (body.pack !== ctx.rules.pack || ctx.vocab.pack !== ctx.rules.pack) chain("packMismatch");
    countK(body, ctx, res, kShort);
  } else if (kind === "member") {
    if (typeof body.pub === "string" && /^[0-9a-f]{64}$/.test(body.pub) && keyIdOf(body.pub) !== body.key) chain("keyMismatch");
    if (ctx.to.kind !== "ring" || body.ring !== ctx.to.id) chain("otherDestination");
  } else {
    const b = body as { v?: unknown; founder?: unknown; nonce?: unknown; rules?: unknown };
    if (typeof b.v === "string" && typeof b.founder === "string" && typeof b.nonce === "string") {
      const id = ringIdOf({ v: b.v, founder: b.founder, nonce: b.nonce });
      const wantKind = kind === "circle" ? "ring" : "ledger";
      if (ctx.to.kind !== wantKind || id !== ctx.to.id) chain("otherDestination");
    }
    if (issues.length === 0) for (const v of checkRules(b.rules as Rules)) shape(`rules.${v}`);
  }
  return res;
}

function countK(body: Record<string, Json>, ctx: ShareContext, res: RecountResult, kShort: (r: string) => void): void {
  const profile = body.profile as Record<string, Json> | undefined;
  const chunks = body.chunks;
  if (!profile || typeof profile !== "object" || !Array.isArray(chunks)) {
    kShort("unreadable");
    return;
  }
  const axesRaw = profile.axes;
  const axes: Record<string, string> = {};
  if (axesRaw && typeof axesRaw === "object" && !Array.isArray(axesRaw)) {
    for (const [a, v] of Object.entries(axesRaw)) if (typeof v === "string") axes[a] = v;
  }
  const stage = typeof profile.stage === "number" ? profile.stage : -1;
  if ((stage === 3) !== (Object.keys(axes).length === 0)) kShort("stageMismatch");
  const group = profile.group as Group;
  const classes: string[] = [];
  let upgrade = false;
  for (const c of chunks) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const cl = (c as Record<string, Json>).class;
    if (typeof cl === "string") classes.push(cl);
    if ((c as Record<string, Json>).work === WORK_ATTRIBUTES[3]) upgrade = true;
  }
  const minK = Math.max(SEND_MIN_K, Number.isInteger(ctx.rules.minK) ? ctx.rules.minK : SEND_MIN_K);
  const self = typeof body.key === "string" ? body.key : "";
  let k: number;
  if (group === "NATIONAL") {
    if (classes.some((c) => !isCountable(ctx.vocab, ctx.table, c))) kShort("classNotCountable");
    k = kNational(ctx.table, ctx.vocab, axes, [...new Set(classes)], stage);
  } else if (group === "OUTSIDE") {
    k = countPeers(ctx.table, ctx.peers ?? [], self, group, axes);
  } else {
    kShort("groupUnknown");
    return;
  }
  res.k = k;
  if (k < minK) kShort("belowMin");
  const counts = body.counts as Record<string, Json> | undefined;
  if (!counts || counts.k !== k) kShort("mismatch");
  if (upgrade) {
    // UPGRADE は全国の表で数えられないので、輪の中の確認済みの仲間で数えて下限に届くときだけ
    const ringK = countPeers(ctx.table, ctx.peers ?? [], self, group, axes);
    if (ctx.to.kind !== "ring" || ringK < minK) kShort("upgradeBelowMin");
  }
}

// ─── 固有名詞（送る側だけ） ─────────────────────────────────

export interface ProperNounInput {
  /** 束のバイト列（文字列） */
  bundleText: string;
  fileName: string;
  /** 輪のフォルダのパス */
  folderPath: string;
  /** 網 2：その PC だけの語の一覧（計画と取り込みの施設名・業者・実施者から作り、利用者が足せる） */
  localWords: readonly string[];
  /** 網 3：原本の全セルの文字列（送るたびにメモリで作り、残さない） */
  cells: readonly string[];
  /** 公開語彙（これの部分の語は照らさない） */
  publicWords: ReadonlySet<string>;
}

export interface ProperNounResult {
  net2: number;
  net3: number;
  total: number;
  /** 当たった語の位置（net 2 は localWords、net 3 は cells の番号）。語そのものは返さない */
  hits: { net: 2 | 3; index: number }[];
}

const JA_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]{2,}/gu;
const ALNUM_RUN = /[A-Za-z0-9]{3,}/g;
/** 16 文字以上の 16 進の並び（鍵・ハッシュ・署名）は、乱数なので照らさない */
const HEX_RUN = /[0-9a-f]{16,}/g;

function target(i: ProperNounInput): string {
  return [i.bundleText, i.fileName, i.folderPath]
    .map((s) => s.normalize("NFKC").toLowerCase().replace(HEX_RUN, "#"))
    .join("\n");
}

/**
 * 固有名詞を数える（送る側だけ）。照らす相手は、束のバイト列（NFKC）・ファイル名・輪のフォルダのパス。
 * 網 2 は語の一覧の語をそのまま、網 3 はセルの中の日本語 2 文字以上・英数 3 文字以上の並びを照らす。
 * 数だけの並び、FY・月の形、公開語彙の部分になっている語は除く。大文字と小文字は区別しない。
 */
export function countProperNouns(i: ProperNounInput): ProperNounResult {
  const hay = target(i);
  const pub = [...i.publicWords].join("\n").toLowerCase();
  const skip = (w: string) => w.length === 0 || /^[\d\s.,:/-]+$/.test(w) || /^fy\d{4}$/.test(w) || pub.includes(w);
  const res: ProperNounResult = { net2: 0, net3: 0, total: 0, hits: [] };
  i.localWords.forEach((raw, index) => {
    const w = raw.normalize("NFKC").trim().toLowerCase();
    if (w.length < 2 || skip(w)) return;
    if (hay.includes(w)) {
      res.net2++;
      res.hits.push({ net: 2, index });
    }
  });
  i.cells.forEach((raw, index) => {
    const n = raw.normalize("NFKC");
    const tokens = [...(n.match(JA_RUN) ?? []), ...(n.match(ALNUM_RUN) ?? [])].map((t) => t.toLowerCase());
    if (tokens.some((t) => !skip(t) && hay.includes(t))) {
      res.net3++;
      res.hits.push({ net: 3, index });
    }
  });
  res.total = res.net2 + res.net3;
  return res;
}
