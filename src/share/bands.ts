// 帯：生の数を、閉じた一覧のコードに変える。境目はここだけに置く。
// 境目は 2026-11-03 に、工場の正解の世界と全国の表で測ってから決めた（設計の初めの値のまま。理由と測った数は docs/sharing.md）。
// 境目を変えると束の型と台帳の検証の版が変わるので、BANDS_VERSION も上げ、docs/sharing.md と tests/fixtures/share/bands-decision.json を直す。
// 帯は下の端を含み、上の端を含まない（[下, 上)）。場の決まりは、内側の境目を外す（粗くする）向きにだけ変えられる。
// 経過年の帯は無い（2026-11-03 の運営者の判断で、経過年はどこにも出さない。測った帯は試験の tests/unit/share/bands-measure.ts にだけある）。

/**
 * 帯の境目の版。束の body に入る。受け手は、この版でない束を形の外れ（shape.bandsVersion）で ✗ にする。
 * bands-1：測ってから決めた最初の版（経過年の帯があった）。bands-2：経過年の帯と欄を外した版（2026-11-03）。
 */
export const BANDS_VERSION = "bands-2";

export interface BandDef {
  /** コードの頭の文字 */
  prefix: string;
  /** 境目（小さい順）。帯は [edges[i], edges[i+1]) */
  edges: readonly number[];
  /** 0 を超え最初の境目より小さい値を、最初の帯に入れる */
  lowOpen: boolean;
  /** 最後の境目より大きい値を、最後の帯（…P）に入れる。false なら帯の外 */
  highOpen: boolean;
}

/**
 * 統計に出す 3 つの欄の帯。
 * interval：作業の間隔（年度の差）。I1・I2・I3・I4・I5・I6_7・I8_10・I11_15・I16_30。31 以上は帯の外（出さずに数える）。
 * manDays：1 回ごとの工数（人・日）の中央。W1_9・W10_29・W30_99・W100_299・W300_999・W1000P。1 未満の正の値は W1_9 に入れる。
 * days：1 回ごとの日数の中央。D1_3・D4_7・D8_14・D15_30・D31_60・D61_120・D121P。1 未満の正の値は D1_3 に入れる。
 */
export const BAND_DEFS = {
  interval: { prefix: "I", edges: [1, 2, 3, 4, 5, 6, 8, 11, 16, 31], lowOpen: false, highOpen: false },
  manDays: { prefix: "W", edges: [1, 10, 30, 100, 300, 1000], lowOpen: true, highOpen: true },
  days: { prefix: "D", edges: [1, 4, 8, 15, 31, 61, 121], lowOpen: true, highOpen: true },
} as const satisfies Record<string, BandDef>;
export type StatField = keyof typeof BAND_DEFS;
export const STAT_FIELDS = Object.keys(BAND_DEFS) as StatField[];

/** 回数の帯。生の回数は出さない。 */
export const OBSERVED_CODES = ["N1", "N2", "N3P"] as const;
export type ObservedCode = (typeof OBSERVED_CODES)[number];

/** 境目から、帯のコードの一覧を作る（[lo, hi) が 1 幅なら頭＋lo、ほかは頭＋lo_(hi-1)、上が開いていれば頭＋最後＋P）。 */
export function bandCodes(def: BandDef, edges: readonly number[] = def.edges): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push(codeOf(def.prefix, edges[i]!, edges[i + 1]!));
  if (def.highOpen) out.push(`${def.prefix}${edges[edges.length - 1]!}P`);
  return out;
}

function codeOf(prefix: string, lo: number, hi: number): string {
  return hi - lo === 1 ? `${prefix}${lo}` : `${prefix}${lo}_${hi - 1}`;
}

/** 帯のコード（「I5」「I6_7」「W1000P」）の値の幅（両端を含む。上が開いていれば hi は Infinity）。読めなければ null */
export function bandSpan(code: string): { lo: number; hi: number } | null {
  const m = /^[A-Z]([0-9]+)(?:_([0-9]+)|(P))?$/.exec(code);
  if (!m) return null;
  const lo = Number(m[1]);
  return { lo, hi: m[3] ? Infinity : m[2] ? Number(m[2]) : lo };
}

/** 値の帯のコード。帯の外なら null。 */
export function bandOf(def: BandDef, value: number, edges: readonly number[] = def.edges): string | null {
  if (!Number.isFinite(value)) return null;
  const first = edges[0]!;
  const last = edges[edges.length - 1]!;
  if (value < first) {
    if (def.lowOpen && value > 0 && edges.length >= 2) return codeOf(def.prefix, first, edges[1]!);
    return null;
  }
  if (value >= last) return def.highOpen ? `${def.prefix}${last}P` : null;
  for (let i = 0; i + 1 < edges.length; i++) {
    if (value >= edges[i]! && value < edges[i + 1]!) return codeOf(def.prefix, edges[i]!, edges[i + 1]!);
  }
  return null;
}

/** 場の決まりの境目が、コードの境目を粗くしただけか（コードの境目の部分集合で、最初と最後を残す）。 */
export function isCoarserEdges(def: BandDef, edges: readonly number[]): boolean {
  if (edges.length < 2) return false;
  if (edges[0] !== def.edges[0] || edges[edges.length - 1] !== def.edges[def.edges.length - 1]) return false;
  let prev = -Infinity;
  for (const e of edges) {
    if (!(e > prev) || !def.edges.includes(e)) return false;
    prev = e;
  }
  return true;
}

/** 中央の値（偶数個なら真ん中の 2 つの平均）。空なら null。 */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 回数の帯。作業をした年度の数で数える（同じ年度の系統の数を出さないため）。 */
export function observedBand(yearCount: number): ObservedCode | null {
  if (!Number.isInteger(yearCount) || yearCount < 1) return null;
  return yearCount === 1 ? "N1" : yearCount === 2 ? "N2" : "N3P";
}

export type IntervalOutcome =
  | { band: string; reason: null }
  /** single：N1（年度が 1 つ）。noRepeat：どの系統でも 2 回目が無い。outOfRange：帯の外 */
  | { band: null; reason: "single" | "noRepeat" | "outOfRange" };

/**
 * 間隔の帯。系統ごとに、作業をした年度（重ねない）の差を数え、全部の系統の差を合わせて中央を取る。
 * 2 つの系統が交互に作業しても、系統の中の差を数えるので間隔は半分にならない。N1 の行は出さない。
 */
export function intervalBand(yearsBySeries: readonly (readonly number[])[], edges?: readonly number[]): IntervalOutcome {
  const all = new Set<number>();
  for (const ys of yearsBySeries) for (const y of ys) all.add(y);
  if (all.size <= 1) return { band: null, reason: "single" };
  const gaps: number[] = [];
  for (const ys of yearsBySeries) {
    const s = [...new Set(ys)].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) gaps.push(s[i]! - s[i - 1]!);
  }
  const m = median(gaps);
  if (m === null) return { band: null, reason: "noRepeat" };
  const band = bandOf(BAND_DEFS.interval, m, edges);
  return band === null ? { band: null, reason: "outOfRange" } : { band, reason: null };
}

/** 1 回の作業の工数か日数。bundled は、まとめ工事（ほかの機器と一緒の作業）。 */
export interface Visit {
  value: number | null;
  bundled: boolean;
}

export interface PerVisitOutcome {
  band: string | null;
  /** 中央に使った回数 */
  used: number;
  /** まとめ工事で使わなかった回数 */
  bundled: number;
  /** 値が無いか、正の数でない（人・日や日に直せない）回数 */
  unconvertible: number;
}

/** 1 回ごとの値の中央の帯。まとめ工事と直せない値は使わない（分けない、推測で割らない）。 */
export function perVisitBand(field: "manDays" | "days", visits: readonly Visit[], edges?: readonly number[]): PerVisitOutcome {
  const vals: number[] = [];
  let bundled = 0;
  let unconvertible = 0;
  for (const v of visits) {
    if (v.bundled) bundled++;
    else if (v.value === null || !Number.isFinite(v.value) || v.value <= 0) unconvertible++;
    else vals.push(v.value);
  }
  const m = median(vals);
  return { band: m === null ? null : bandOf(BAND_DEFS[field], m, edges), used: vals.length, bundled, unconvertible };
}
