// 場の決まり（輪の circle.json と台帳の ledger.json の rules）。できるのは厳しくすることだけ：
// 下限は SEND_MIN_K より下げられない、欄はコードの許可リストの中から外すだけ、帯は内側の境目を外す（粗くする）だけ。
// どこにも出さない欄（REMOVED_CHUNK_FIELDS。経過年）を許す決まりは、知らない欄とは分けて fieldRemoved で拒む。
// 公開語彙と全国の表は、ハッシュで固定する。各 PC は人が受け入れた決まりのハッシュを覚え、変わったら送らない。
import { BAND_DEFS, STAT_FIELDS, isCoarserEdges, type StatField } from "./bands";
import { OPTIONAL_CHUNK_FIELDS, REMOVED_CHUNK_FIELDS, type OptionalChunkField } from "./copyout";
import { SEND_MIN_K } from "./k";

/** 下限の上の端（型の上下限） */
export const MAX_MIN_K = 1000;

export interface Rules {
  minK: number;
  fields: OptionalChunkField[];
  bands: Record<StatField, number[]>;
  pack: string;
  /** 公開語彙のハッシュ */
  vocab: string;
  /** 全国の表（national/table.json）のハッシュ */
  national: string;
}

/** コードの決まり（いちばん緩い決まり）。場の決まりはここから厳しくする。 */
export function baseRules(pack: string, vocab: string, national: string): Rules {
  return {
    minK: SEND_MIN_K,
    fields: [...OPTIONAL_CHUNK_FIELDS],
    bands: { interval: [...BAND_DEFS.interval.edges], manDays: [...BAND_DEFS.manDays.edges], days: [...BAND_DEFS.days.edges] },
    pack,
    vocab,
    national,
  };
}

export type RulesViolation = "malformed" | "minKLowered" | "minKTooHigh" | "fieldUnknown" | "fieldRemoved" | "fieldDuplicated" | "bandsFiner";

const isRemoved = (f: unknown) => typeof f === "string" && (REMOVED_CHUNK_FIELDS as readonly string[]).includes(f);

/** 決まり（形を問わない値）の欄に、どこにも出さない欄があるか。形の外れた決まりでも理由を分けて出すために使う */
export function rulesHaveRemovedField(r: unknown): boolean {
  const fields = r && typeof r === "object" && !Array.isArray(r) ? (r as { fields?: unknown }).fields : undefined;
  return Array.isArray(fields) && fields.some(isRemoved);
}

/** 決まりが、コードの決まりより緩くしていないか。緩くしていれば理由を返す（空なら通る）。 */
export function checkRules(r: Rules): RulesViolation[] {
  const out: RulesViolation[] = [];
  if (!r || typeof r !== "object" || !Array.isArray(r.fields) || !r.bands || typeof r.bands !== "object") return ["malformed"];
  if (!Number.isInteger(r.minK) || r.minK < SEND_MIN_K) out.push("minKLowered");
  else if (r.minK > MAX_MIN_K) out.push("minKTooHigh");
  if (r.fields.some(isRemoved)) out.push("fieldRemoved");
  if (r.fields.some((f) => !isRemoved(f) && !(OPTIONAL_CHUNK_FIELDS as readonly string[]).includes(f))) out.push("fieldUnknown");
  if (new Set(r.fields).size !== r.fields.length) out.push("fieldDuplicated");
  for (const f of STAT_FIELDS) {
    const e = r.bands[f];
    if (!Array.isArray(e) || !isCoarserEdges(BAND_DEFS[f], e)) {
      out.push("bandsFiner");
      break;
    }
  }
  return out;
}

export interface RulesDiff {
  /** 緩くなった数 */
  loosened: number;
  /** 厳しくなった数 */
  tightened: number;
  /** 公開語彙・全国の表・パックが変わった数（どちらとも言えないので分けて出す） */
  changed: number;
}

/** 人が受け入れた決まりと、今の決まりの差（「決まりが変わりました：緩くなった n、厳しくなった m」）。 */
export function diffRules(accepted: Rules, current: Rules): RulesDiff {
  const d: RulesDiff = { loosened: 0, tightened: 0, changed: 0 };
  if (current.minK > accepted.minK) d.tightened++;
  if (current.minK < accepted.minK) d.loosened++;
  for (const f of accepted.fields) if (!current.fields.includes(f)) d.tightened++;
  for (const f of current.fields) if (!accepted.fields.includes(f)) d.loosened++;
  for (const f of STAT_FIELDS) {
    for (const e of accepted.bands[f]) if (!current.bands[f].includes(e)) d.tightened++;
    for (const e of current.bands[f]) if (!accepted.bands[f].includes(e)) d.loosened++;
  }
  if (current.pack !== accepted.pack) d.changed++;
  if (current.vocab !== accepted.vocab) d.changed++;
  if (current.national !== accepted.national) d.changed++;
  return d;
}

export type RulesGate =
  | { ok: true }
  /** notAccepted：人がまだ受け入れていない（diff は受け入れた決まりがあるときだけ） */
  | { ok: false; reason: "notAccepted"; diff: RulesDiff | null }
  | { ok: false; reason: "loosened"; violations: RulesViolation[] };

/**
 * 送る前の決まりの確かめ。緩くした決まりは拒む。人が受け入れたハッシュと違えば、厳しくなっただけでも送らない。
 * 受け入れるのは人だけ（画面）。この関数は受け入れない。
 */
export function rulesGate(current: Rules, currentHash: string, acceptedHash: string | null, accepted: Rules | null): RulesGate {
  const v = checkRules(current);
  if (v.length > 0) return { ok: false, reason: "loosened", violations: v };
  if (acceptedHash !== currentHash) return { ok: false, reason: "notAccepted", diff: accepted ? diffRules(accepted, current) : null };
  return { ok: true };
}

/** 写し取りに渡す形（欄と帯） */
export function copyRulesOf(r: Rules): { fields: readonly OptionalChunkField[]; bands: Partial<Record<StatField, readonly number[]>> } {
  return { fields: r.fields, bands: r.bands };
}
