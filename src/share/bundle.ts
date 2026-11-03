// 束の形：ファイルは {body, sig} の RFC 8785 の正規形そのもの（BOM・空白・改行なし）。sig は正規化した body の SHA-256 への Ed25519 の署名。
// body には行き先（輪か台帳の ID）・鍵・鎖（seq と prev）・決まりのハッシュ・見え方・塊の並び・送る側で数えた値を入れる。
// 型は閉じている：列挙・上下限つきの整数・決まった形のハッシュだけで、知らないキーは形の外れ。
// 同じ型の言葉で、輪の仲間のファイル（members/<鍵ID>.json）と決まりのファイル（circle.json）も書く。
import { WORK_ATTRIBUTES } from "../shared/plan";
import { BANDS_VERSION, BAND_DEFS, OBSERVED_CODES, ageCodes, bandCodes, type StatField } from "./bands";
import { OPTIONAL_CHUNK_FIELDS, FY_MAX, FY_MIN, type Chunk, type Destination } from "./copyout";
import { canonicalize } from "./jcs";
import { GROUPS, coarseCodes, type NationalTable, type PeerProfile, type Profile, type Vocab } from "./k";
import type { Rules } from "./rules";
import { HEX128, HEX16, HEX64, sha256Hex } from "./sign";

export const BUNDLE_V = "moyai.bundle/0";
export const MEMBER_V = "moyai.member/0";
export const CIRCLE_V = "moyai.circle/0";
export const LEDGER_V = "moyai.ledger/0";
export const DESTINATION_KINDS = ["ring", "ledger"] as const;
export const MEMBER_STATES = ["active", "retired"] as const;

export const HEX32 = /^[0-9a-f]{32}$/;
export const MONTH = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
export const FY = /^FY\d{4}$/;
/** 決まった形の文字列（公開語彙の外でも自由記述に数えない形）。数え直しが使う */
export const FIXED_SHAPES: readonly RegExp[] = [HEX16, HEX32, HEX64, HEX128, MONTH, FY];

/** 上下限 */
export const LIMITS = { seq: 1_000_000, k: 1_000_000, chunks: 5000, years: FY_MAX - FY_MIN + 1, version: 1_000_000, edges: 100_000, axes: 32 } as const;

/** 送る側で数えた値。署名するのは、k のほかがすべて 0 のときだけなので、型でも 0 に固定する */
export const SENDER_ZERO_COUNTS = ["shape", "properNoun", "money", "freeText", "exactDate"] as const;

// ─── 型の言葉 ───────────────────────────────────────────────

export type T =
  | { t: "lit"; v: string }
  | { t: "enum"; vs: readonly string[] }
  | { t: "re"; re: RegExp; extra?: (s: string) => boolean }
  | { t: "int"; min: number; max: number }
  | { t: "null" }
  | { t: "or"; of: T[] }
  | { t: "arr"; of: T; min: number; max: number; increasing?: (a: unknown, b: unknown) => boolean }
  | { t: "obj"; req: Record<string, T>; opt?: Record<string, T> }
  | { t: "dict"; keys: readonly string[]; val: (key: string) => T; max: number };

function kindOf(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

/** 値が型に合うか。外れを "path: 理由" の形で out に足す。 */
export function checkShape(v: unknown, t: T, path: string, out: string[]): void {
  const at = path === "" ? "(根)" : path;
  switch (t.t) {
    case "lit":
      if (v !== t.v) out.push(`${at}: 決まった値でない`);
      return;
    case "enum":
      if (typeof v !== "string" || !t.vs.includes(v)) out.push(`${at}: 一覧に無い値`);
      return;
    case "re":
      if (typeof v !== "string" || !t.re.test(v) || (t.extra && !t.extra(v))) out.push(`${at}: 形が違う`);
      return;
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v) || v < t.min || v > t.max) out.push(`${at}: 上下限の外の整数か、整数でない`);
      return;
    case "null":
      if (v !== null) out.push(`${at}: null でない`);
      return;
    case "or": {
      for (const o of t.of) {
        const tmp: string[] = [];
        checkShape(v, o, path, tmp);
        if (tmp.length === 0) return;
      }
      out.push(`${at}: どの型にも合わない`);
      return;
    }
    case "arr": {
      if (!Array.isArray(v)) {
        out.push(`${at}: 配列でない（${kindOf(v)}）`);
        return;
      }
      if (v.length < t.min || v.length > t.max) out.push(`${at}: 配列の長さが上下限の外`);
      v.forEach((x, i) => checkShape(x, t.of, `${path}.${i}`, out));
      if (t.increasing) for (let i = 1; i < v.length; i++) if (!t.increasing(v[i - 1], v[i])) out.push(`${at}: 順が違うか重なっている`);
      return;
    }
    case "obj": {
      if (kindOf(v) !== "object") {
        out.push(`${at}: 物でない（${kindOf(v)}）`);
        return;
      }
      const o = v as Record<string, unknown>;
      for (const [k, kt] of Object.entries(t.req)) {
        if (!Object.hasOwn(o, k)) out.push(`${at}.${k}: 欠けている`);
        else checkShape(o[k], kt, path === "" ? k : `${path}.${k}`, out);
      }
      for (const k of Object.keys(o)) {
        if (Object.hasOwn(t.req, k)) continue;
        if (t.opt && Object.hasOwn(t.opt, k)) checkShape(o[k], t.opt[k]!, path === "" ? k : `${path}.${k}`, out);
        else out.push(`${at}: 知らないキー`);
      }
      return;
    }
    case "dict": {
      if (kindOf(v) !== "object") {
        out.push(`${at}: 物でない（${kindOf(v)}）`);
        return;
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length > t.max) out.push(`${at}: キーが多すぎる`);
      for (const k of keys) {
        if (!t.keys.includes(k)) out.push(`${at}: 知らないキー`);
        else checkShape(o[k], t.val(k), `${path}.${k}`, out);
      }
      return;
    }
  }
}

/** 型に出てくる語（キー・決まった値・列挙）。公開語彙の一部になる。 */
export function schemaWords(t: T, out = new Set<string>()): Set<string> {
  switch (t.t) {
    case "lit":
      out.add(t.v);
      break;
    case "enum":
      for (const v of t.vs) out.add(v);
      break;
    case "or":
      for (const o of t.of) schemaWords(o, out);
      break;
    case "arr":
      schemaWords(t.of, out);
      break;
    case "obj":
      for (const [k, v] of Object.entries(t.req)) {
        out.add(k);
        schemaWords(v, out);
      }
      for (const [k, v] of Object.entries(t.opt ?? {})) {
        out.add(k);
        schemaWords(v, out);
      }
      break;
    case "dict":
      for (const k of t.keys) {
        out.add(k);
        schemaWords(t.val(k), out);
      }
      break;
    default:
      break;
  }
  return out;
}

// ─── 文脈と型 ───────────────────────────────────────────────

/** 送る側と受ける側が同じものを渡す文脈。緩める切り替えは持たない。 */
export interface ShareContext {
  table: NationalTable;
  vocab: Vocab;
  /** 場の決まり（circle.json か ledger.json の rules） */
  rules: Rules;
  /** 決まりのファイルのバイト列の SHA-256 */
  rulesHash: string;
  /** 自分の行き先（送る側は送り先、受ける側は自分の輪か台帳） */
  to: Destination;
  /** その鍵で覚えた最大の seq（送る側は前に送った seq、受ける側は前に見た最大） */
  lastSeq?: number;
  /** OUTSIDE の集団と輪の UPGRADE を数える仲間（確認済みの最新の束、鍵ごとに 1 つ） */
  peers?: readonly PeerProfile[];
}

const hex = (re: RegExp): T => ({ t: "re", re });
const fyRange = (s: string) => {
  const y = Number(s.slice(2));
  return y >= FY_MIN && y <= FY_MAX;
};

function axisCodes(table: NationalTable, key: string): string[] {
  const a = table.axes.find((x) => x.key === key);
  if (!a) return [];
  return [...a.codes, ...coarseCodes(a).map((c) => c.code).filter((c) => !a.codes.includes(c))];
}

function chunkOrder(a: unknown, b: unknown): boolean {
  const x = a as { class?: unknown; work?: unknown };
  const y = b as { class?: unknown; work?: unknown };
  if (typeof x.class !== "string" || typeof y.class !== "string") return true; // 型の外れは別に数える
  if (x.class !== y.class) return x.class < y.class;
  return WORK_ATTRIBUTES.indexOf(x.work as never) < WORK_ATTRIBUTES.indexOf(y.work as never);
}

function bandEnum(field: StatField, rules: Rules): T {
  return { t: "enum", vs: bandCodes(BAND_DEFS[field], rules.bands[field]) };
}

/** 束の body の型（文脈で、分類・軸・帯・欄・行き先の種類が決まる） */
export function bundleBodyType(ctx: ShareContext): T {
  const { table, vocab, rules } = ctx;
  const ledger = ctx.to.kind === "ledger";
  const opt: Record<string, T> = {};
  const all: Record<(typeof OPTIONAL_CHUNK_FIELDS)[number], T> = {
    interval: bandEnum("interval", rules),
    manDays: bandEnum("manDays", rules),
    days: bandEnum("days", rules),
    ageAtWork: { t: "enum", vs: ageCodes() },
  };
  for (const f of rules.fields) if (Object.hasOwn(all, f)) opt[f] = all[f];
  const chunk: T = {
    t: "obj",
    req: {
      class: { t: "enum", vs: [...vocab.byCode.keys()] },
      work: { t: "enum", vs: ledger ? WORK_ATTRIBUTES.filter((w) => w !== "UPGRADE") : WORK_ATTRIBUTES },
      years: {
        t: "arr",
        of: { t: "re", re: FY, extra: fyRange },
        min: 1,
        max: LIMITS.years,
        increasing: (a, b) => typeof a === "string" && typeof b === "string" && a < b,
      },
      observed: { t: "enum", vs: OBSERVED_CODES },
    },
    opt,
  };
  const counts: Record<string, T> = { k: { t: "int", min: 0, max: LIMITS.k } };
  for (const c of SENDER_ZERO_COUNTS) counts[c] = { t: "int", min: 0, max: 0 };
  return {
    t: "obj",
    req: {
      v: { t: "lit", v: BUNDLE_V },
      to: { t: "obj", req: { kind: { t: "enum", vs: DESTINATION_KINDS }, id: hex(HEX16) } },
      key: hex(HEX16),
      pub: hex(HEX64),
      seq: { t: "int", min: 1, max: LIMITS.seq },
      prev: { t: "or", of: [hex(HEX64), { t: "null" }] },
      month: hex(MONTH),
      pack: { t: "lit", v: vocab.pack },
      bands: { t: "lit", v: BANDS_VERSION },
      national: hex(HEX64),
      vocab: hex(HEX64),
      rules: hex(HEX64),
      profile: {
        t: "obj",
        req: {
          group: { t: "enum", vs: ledger ? ["NATIONAL"] : GROUPS },
          stage: { t: "int", min: 0, max: 3 },
          axes: { t: "dict", keys: table.axes.map((a) => a.key), val: (k) => ({ t: "enum", vs: axisCodes(table, k) }), max: LIMITS.axes },
        },
      },
      counts: { t: "obj", req: counts },
      chunks: { t: "arr", of: chunk, min: 1, max: LIMITS.chunks, increasing: chunkOrder },
    },
  };
}

export const MEMBER_BODY_TYPE: T = {
  t: "obj",
  req: {
    v: { t: "lit", v: MEMBER_V },
    ring: hex(HEX16),
    key: hex(HEX16),
    pub: hex(HEX64),
    state: { t: "enum", vs: MEMBER_STATES },
    month: hex(MONTH),
  },
};

const edgesType: T = { t: "arr", of: { t: "int", min: 0, max: LIMITS.edges }, min: 2, max: 64 };

export const RULES_TYPE: T = {
  t: "obj",
  req: {
    minK: { t: "int", min: 0, max: LIMITS.k },
    fields: { t: "arr", of: { t: "enum", vs: OPTIONAL_CHUNK_FIELDS }, min: 0, max: OPTIONAL_CHUNK_FIELDS.length },
    bands: { t: "obj", req: { interval: edgesType, manDays: edgesType, days: edgesType } },
    pack: { t: "re", re: /^[a-z][a-z0-9-]*$/ },
    vocab: hex(HEX64),
    national: hex(HEX64),
  },
};

export function rulesDocBodyType(v: typeof CIRCLE_V | typeof LEDGER_V): T {
  return {
    t: "obj",
    req: {
      v: { t: "lit", v },
      founder: hex(HEX64),
      nonce: hex(HEX32),
      version: { t: "int", min: 1, max: LIMITS.version },
      month: hex(MONTH),
      rules: RULES_TYPE,
    },
  };
}

/** {body, sig} の外側の型 */
export function envelopeType(body: T): T {
  return { t: "obj", req: { body, sig: hex(HEX128) } };
}

/** 公開語彙：型に出てくる語と、パックの分類・軸・帯のコード。これに無い文字列は自由記述に数える。 */
export function publicWords(ctx: ShareContext): Set<string> {
  const s = new Set<string>();
  schemaWords(envelopeType(bundleBodyType({ ...ctx, to: { kind: "ring", id: ctx.to.id } })), s);
  schemaWords(envelopeType(MEMBER_BODY_TYPE), s);
  schemaWords(envelopeType(rulesDocBodyType(CIRCLE_V)), s);
  schemaWords(envelopeType(rulesDocBodyType(LEDGER_V)), s);
  return s;
}

// ─── 作る ──────────────────────────────────────────────────

export interface BundleBody {
  v: typeof BUNDLE_V;
  to: Destination;
  key: string;
  pub: string;
  seq: number;
  prev: string | null;
  month: string;
  pack: string;
  bands: typeof BANDS_VERSION;
  national: string;
  vocab: string;
  rules: string;
  profile: Profile;
  counts: { k: number; shape: 0; properNoun: 0; money: 0; freeText: 0; exactDate: 0 };
  chunks: Chunk[];
}

export interface BundleBodyInput {
  ctx: ShareContext;
  key: string;
  pub: string;
  seq: number;
  prev: string | null;
  month: string;
  profile: Profile;
  k: number;
  chunks: Chunk[];
}

/** body を作る（並びも欄もここで決まる）。値の確かめは数え直しがする。 */
export function makeBundleBody(i: BundleBodyInput): BundleBody {
  return {
    v: BUNDLE_V,
    to: { kind: i.ctx.to.kind, id: i.ctx.to.id },
    key: i.key,
    pub: i.pub,
    seq: i.seq,
    prev: i.prev,
    month: i.month,
    pack: i.ctx.vocab.pack,
    bands: BANDS_VERSION,
    national: i.ctx.table.hash,
    vocab: i.ctx.vocab.hash,
    rules: i.ctx.rulesHash,
    profile: { group: i.profile.group, stage: i.profile.stage, axes: { ...i.profile.axes } },
    counts: { k: i.k, shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 },
    chunks: i.chunks,
  };
}

/** ファイルの中身（{body, sig} の正規形） */
export function envelopeText(body: unknown, sig: string): string {
  return canonicalize({ body, sig });
}

/** ファイルのハッシュ（バイト列の SHA-256）。鎖の prev とファイル名に使う */
export function fileHash(text: string | Uint8Array): string {
  return sha256Hex(text);
}

/** 束のファイル名：<連番 6 桁>-<ハッシュ先頭16>.json */
export function bundleFileName(seq: number, hash: string): string {
  return `${String(seq).padStart(6, "0")}-${hash.slice(0, 16)}.json`;
}

export const BUNDLE_FILE_NAME = /^(\d{6})-([0-9a-f]{16})\.json$/;

/** 輪 ID：circle.json の body のうち、変わらない部分（v・founder・nonce）の正規形の SHA-256 の先頭 16 文字。 */
export function ringIdOf(body: { v: string; founder: string; nonce: string }): string {
  return sha256Hex(canonicalize({ v: body.v, founder: body.founder, nonce: body.nonce })).slice(0, 16);
}

/** 決まりのファイルの body（輪を作った人が署名する） */
export function makeRulesDocBody(v: typeof CIRCLE_V | typeof LEDGER_V, founder: string, nonce: string, version: number, month: string, rules: Rules) {
  return { v, founder, nonce, version, month, rules };
}

export function makeMemberBody(ring: string, key: string, pub: string, month: string, state: (typeof MEMBER_STATES)[number] = "active") {
  return { v: MEMBER_V, ring, key, pub, state, month };
}
