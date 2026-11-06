// 紛れる数 k：見え方（profile）と、塊から推せる属性で、全国の表（パックの national/table.json）の施設を数える。
// 段の順はここに 1 本だけ持つ：後ろの軸から外す（外した軸を推せる分類も、同じ段で上の分類へまとめる）
// → 帯の軸を粗くする → 業種だけ（段 3）。最初に k が下限に届いた段で止め、段 3 でも届かなければ送らない。
// 軸の名前・順・層はパックが決める。コードは業種の語を持たない。
import { sha256Hex } from "./sign";

/** 送る側の下限。場の決まりは上げられるが、下げられない。 */
export const SEND_MIN_K = 5;
/** 受ける側の見せる下限（統計の行の n が 3〜4 なら幅の帯と n、0〜2 なら x）。 */
export const RECEIVE_MIN_K = 3;

/** 統計の行の見せ方（n は自分を除いた施設数）。 */
export function statShown(n: number): "x" | "range" | "median" {
  if (n >= SEND_MIN_K) return "median";
  if (n >= RECEIVE_MIN_K) return "range";
  return "x";
}

// ─── 公開語彙（パックの共有の分類） ─────────────────────────────

export interface ShareClass {
  code: string;
  /** 上の分類。無ければ null */
  parent: string | null;
  /** どの施設にもある分類か（出典が無ければ使わない） */
  universal: boolean;
  source: string | null;
  /** この分類があると推せる、全国の表の軸の値（例 { 軸: コード }） */
  implies: Record<string, string>;
}

export interface ShareVocab {
  pack: string;
  classes: ShareClass[];
}

export interface Vocab {
  pack: string;
  byCode: Map<string, ShareClass>;
  hash: string;
}

const CODE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*$/;
const AXIS_KEY = /^[a-z][a-z0-9_]*$/;
const AXIS_CODE = /^[A-Z][A-Z0-9_]*$/;
const PACK_ID = /^[a-z][a-z0-9-]*$/;

/** 公開語彙を読む。形が違う・上の分類が輪になる・知らない上の分類があれば止める。 */
export function loadVocab(text: string): Vocab {
  const v = JSON.parse(text) as ShareVocab;
  if (!v || typeof v.pack !== "string" || !PACK_ID.test(v.pack) || !Array.isArray(v.classes)) throw new Error("公開語彙の形でない");
  const byCode = new Map<string, ShareClass>();
  for (const c of v.classes) {
    if (typeof c.code !== "string" || !CODE.test(c.code)) throw new Error("分類のコードの形でない");
    if (byCode.has(c.code)) throw new Error("分類のコードが重なっている");
    if (c.parent !== null && typeof c.parent !== "string") throw new Error("上の分類の形でない");
    if (typeof c.universal !== "boolean") throw new Error("universal の形でない");
    if (c.source !== null && typeof c.source !== "string") throw new Error("出典の形でない");
    if (!c.implies || typeof c.implies !== "object") throw new Error("implies の形でない");
    for (const [a, val] of Object.entries(c.implies)) {
      if (!AXIS_KEY.test(a) || typeof val !== "string" || !AXIS_CODE.test(val)) throw new Error("implies の形でない");
    }
    byCode.set(c.code, { code: c.code, parent: c.parent, universal: c.universal, source: c.source, implies: { ...c.implies } });
  }
  for (const c of byCode.values()) {
    const seen = new Set<string>();
    let p: string | null = c.code;
    while (p !== null) {
      if (seen.has(p)) throw new Error("上の分類が循環している");
      seen.add(p);
      const cur = byCode.get(p);
      if (!cur) throw new Error("知らない上の分類");
      p = cur.parent;
    }
  }
  return { pack: v.pack, byCode, hash: sha256Hex(text) };
}

// ─── 全国の表 ─────────────────────────────────────────────

export interface NationalAxis {
  key: string;
  codes: string[];
  /** 帯の軸なら、頭の文字と境目と、コードごとの範囲 */
  band: { prefix: string; edges: number[]; ranges: Map<string, [number, number]> } | null;
}

export interface NationalTable {
  pack: string;
  /** table.json のバイト列の SHA-256 */
  hash: string;
  axes: NationalAxis[];
  rows: { values: Record<string, string>; n: number }[];
  /** 稼働の施設の総数（段 3 の数。出典は table.json の source） */
  active: number;
  sourceId: string;
}

/** 帯の軸のコード（全国の表の書き方：最初より下は頭＋LT＋境目、間は頭＋下_上、最後から上は頭＋最後＋P）。 */
export function profileBandCodes(prefix: string, edges: readonly number[]): { code: string; lo: number; hi: number }[] {
  const out = [{ code: `${prefix}LT${edges[0]!}`, lo: -Infinity, hi: edges[0]! }];
  for (let i = 0; i + 1 < edges.length; i++) out.push({ code: `${prefix}${edges[i]!}_${edges[i + 1]!}`, lo: edges[i]!, hi: edges[i + 1]! });
  out.push({ code: `${prefix}${edges[edges.length - 1]!}P`, lo: edges[edges.length - 1]!, hi: Infinity });
  return out;
}

/** 帯の軸を粗くする境目：最後の境目から 1 つおきに外す（例 4 つの境目なら 1 番目と 3 番目を残す）。 */
export function coarsenEdges(edges: readonly number[]): number[] {
  return edges.filter((_, i) => (edges.length - 1 - i) % 2 === 1);
}

/** 全国の表を読む。帯の軸のコードが境目から作ったものと違えば止める。 */
export function loadNational(text: string): NationalTable {
  const t = JSON.parse(text) as {
    pack?: unknown;
    source?: { id?: unknown };
    axes?: { key?: unknown; codes?: { code?: unknown; atLeast?: unknown; below?: unknown }[]; edges?: unknown }[];
    rows?: Record<string, unknown>[];
    population?: { active?: unknown };
  };
  if (typeof t.pack !== "string" || !Array.isArray(t.axes) || !Array.isArray(t.rows)) throw new Error("全国の表の形でない");
  const axes: NationalAxis[] = [];
  for (const a of t.axes) {
    if (typeof a.key !== "string" || !AXIS_KEY.test(a.key) || !Array.isArray(a.codes)) throw new Error("全国の表の軸の形でない");
    const codes = a.codes.map((c) => {
      if (typeof c.code !== "string" || !AXIS_CODE.test(c.code)) throw new Error("全国の表のコードの形でない");
      return c.code;
    });
    let band: NationalAxis["band"] = null;
    if (Array.isArray(a.edges)) {
      const edges = a.edges.map((e) => {
        if (typeof e !== "number" || !Number.isFinite(e)) throw new Error("境目の形でない");
        return e;
      });
      const prefix = codes[0]!.replace(/LT\d+$/, "");
      const made = profileBandCodes(prefix, edges);
      if (made.length !== codes.length || made.some((m, i) => m.code !== codes[i])) throw new Error("帯の軸のコードが境目と合わない");
      band = { prefix, edges, ranges: new Map(made.map((m) => [m.code, [m.lo, m.hi] as [number, number]])) };
    }
    axes.push({ key: a.key, codes, band });
  }
  const rows = t.rows.map((r) => {
    const values: Record<string, string> = {};
    for (const a of axes) {
      const v = r[a.key];
      if (typeof v !== "string" || !a.codes.includes(v)) throw new Error("全国の表の行の値が軸のコードに無い");
      values[a.key] = v;
    }
    if (typeof r.n !== "number" || !Number.isInteger(r.n) || r.n < 0) throw new Error("全国の表の行の数の形でない");
    return { values, n: r.n };
  });
  const sum = rows.reduce((s, r) => s + r.n, 0);
  const active = typeof t.population?.active === "number" ? t.population.active : sum;
  if (active !== sum) throw new Error("全国の表の行の和が稼働の数と合わない");
  return { pack: t.pack, hash: sha256Hex(text), axes, rows, active, sourceId: String(t.source?.id ?? "") };
}

function axisOf(table: NationalTable, key: string): NationalAxis | undefined {
  return table.axes.find((a) => a.key === key);
}

/** 施設の規模の数を、帯の軸のコードにする（[下, 上)。境目ちょうどは上の帯）。帯の軸でなければ null。 */
export function profileBandOf(table: NationalTable, key: string, value: number): string | null {
  const axis = axisOf(table, key);
  if (!axis?.band || !Number.isFinite(value) || value < 0) return null;
  for (const [code, [lo, hi]] of axis.band.ranges) if (value >= lo && value < hi) return code;
  return null;
}

/** 帯の軸の、粗くした帯のコードと範囲 */
export function coarseCodes(axis: NationalAxis): { code: string; lo: number; hi: number }[] {
  if (!axis.band) return [];
  return profileBandCodes(axis.band.prefix, coarsenEdges(axis.band.edges));
}

/** 軸の値（細かいコードか粗いコード）に入る、細かいコードの一覧。知らない値なら空。 */
export function fineCodesOf(table: NationalTable, key: string, code: string): string[] {
  const axis = axisOf(table, key);
  if (!axis) return [];
  if (axis.codes.includes(code)) return [code];
  const c = coarseCodes(axis).find((x) => x.code === code);
  if (!c || !axis.band) return [];
  return axis.codes.filter((f) => {
    const r = axis.band!.ranges.get(f)!;
    return r[0] >= c.lo && r[1] <= c.hi;
  });
}

/** 細かいコードを、粗くした帯のコードにする */
export function coarseOf(table: NationalTable, key: string, fine: string): string | null {
  const axis = axisOf(table, key);
  if (!axis?.band) return null;
  const r = axis.band.ranges.get(fine);
  if (!r) return null;
  return coarseCodes(axis).find((c) => r[0] >= c.lo && r[1] <= c.hi)?.code ?? null;
}

/** 軸の値の候補の組で、全国の表の施設を数える。 */
export function countNational(table: NationalTable, constraints: Record<string, readonly string[]>): number {
  let k = 0;
  for (const r of table.rows) {
    let hit = true;
    for (const [a, allowed] of Object.entries(constraints)) {
      if (!allowed.includes(r.values[a]!)) {
        hit = false;
        break;
      }
    }
    if (hit) k += r.n;
  }
  return k;
}

// ─── 分類を上へまとめる ─────────────────────────────────────

/** 全国の表で数えられる分類か：出典つきの universal か、推せる軸がすべて全国の表にある。 */
export function isCountable(vocab: Vocab, table: NationalTable, code: string): boolean {
  const c = vocab.byCode.get(code);
  if (!c) return false;
  if (c.universal && typeof c.source === "string" && c.source.length > 0) return true;
  const keys = Object.keys(c.implies);
  return keys.length > 0 && keys.every((a) => axisOf(table, a) !== undefined && axisOf(table, a)!.codes.includes(c.implies[a]!));
}

/** 分類を、数えられて外した軸を推さない分類まで上げる。上げ先が無ければ null（出さない）。 */
export function liftClass(vocab: Vocab, table: NationalTable, code: string, dropped: ReadonlySet<string>): string | null {
  let cur: string | null = code;
  while (cur !== null) {
    const c = vocab.byCode.get(cur);
    if (!c) return null;
    const impliesDropped = Object.keys(c.implies).some((a) => dropped.has(a));
    if (!impliesDropped && isCountable(vocab, table, cur)) return cur;
    cur = c.parent;
  }
  return null;
}

/** 分類から推せる軸の値。同じ軸に違う値を推す分類があれば、その軸は空（どの施設にも当たらない）。 */
export function impliedConstraints(vocab: Vocab, table: NationalTable, classes: Iterable<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const code of classes) {
    const c = vocab.byCode.get(code);
    if (!c) continue;
    for (const [a, v] of Object.entries(c.implies)) {
      if (!axisOf(table, a)) continue;
      out[a] = out[a] === undefined ? [v] : out[a]!.filter((x) => x === v);
    }
  }
  return out;
}

function intersect(a: readonly string[] | undefined, b: readonly string[]): string[] {
  return a === undefined ? [...b] : a.filter((x) => b.includes(x));
}

// ─── 見え方と段 ─────────────────────────────────────────────

export type Tier = "primary" | "secondary" | "refine";
export interface ProfileAxis {
  key: string;
  tier: Tier;
}
/** 見え方の軸とその順（パックが決める）。前から主要・次・絞り込みの順に並べる。 */
export interface ProfileSpec {
  axes: ProfileAxis[];
}

export const GROUPS = ["NATIONAL", "OUTSIDE"] as const;
export type Group = (typeof GROUPS)[number];
export const STAGES = [0, 1, 2, 3] as const;

export interface Profile {
  group: Group;
  /** 0：絞り込みの軸まで、1：次の軸まで、2：主要の軸だけ、3：業種だけ */
  stage: number;
  axes: Record<string, string>;
}

export interface Rung {
  stage: number;
  /** 残す軸（順のまま） */
  kept: string[];
  /** 外した軸 */
  dropped: string[];
  /** 帯の軸を粗くしたか */
  coarse: boolean;
}

/**
 * 段の順（1 本だけ）。全国の表にある軸だけを使う。
 * 全部の軸 → 後ろの軸から 1 つずつ外す（主要の軸は外さない）→ 帯の軸を粗くする → 業種だけ（段 3）。
 */
export function ladder(spec: ProfileSpec, table: NationalTable): Rung[] {
  const axes = spec.axes.filter((a) => axisOf(table, a.key) !== undefined);
  const stageOf = (kept: string[]) => {
    const tiers = new Set(kept.map((k) => axes.find((a) => a.key === k)!.tier));
    return tiers.has("refine") ? 0 : tiers.has("secondary") ? 1 : tiers.size > 0 ? 2 : 3;
  };
  const rungs: Rung[] = [];
  const kept = axes.map((a) => a.key);
  const dropped: string[] = [];
  rungs.push({ stage: stageOf(kept), kept: [...kept], dropped: [], coarse: false });
  for (let i = axes.length - 1; i >= 0; i--) {
    if (axes[i]!.tier === "primary") continue;
    kept.splice(kept.indexOf(axes[i]!.key), 1);
    dropped.push(axes[i]!.key);
    rungs.push({ stage: stageOf(kept), kept: [...kept], dropped: [...dropped], coarse: false });
  }
  if (kept.some((k) => axisOf(table, k)!.band !== null)) {
    rungs.push({ stage: stageOf(kept), kept: [...kept], dropped: [...dropped], coarse: true });
  }
  rungs.push({ stage: 3, kept: [], dropped: axes.map((a) => a.key), coarse: false });
  return rungs;
}

/** 輪の仲間の最新の束の見え方（確認済みの仲間だけ、鍵ごとに 1 つ）。 */
export interface PeerProfile {
  key: string;
  profile: Profile;
}

/** 輪の中で見え方の値がそろう仲間の数（自分の鍵は数えない）。仲間の値は細かくても粗くてもよい。 */
export function countPeers(table: NationalTable, peers: readonly PeerProfile[], self: string, group: Group, axes: Record<string, string>): number {
  let k = 0;
  for (const p of peers) {
    if (p.key === self || p.profile.group !== group) continue;
    let hit = true;
    for (const [a, v] of Object.entries(axes)) {
      const mine = fineCodesOf(table, a, v);
      const theirs = p.profile.axes[a];
      const theirFine = theirs === undefined ? [] : fineCodesOf(table, a, theirs);
      if (theirFine.length === 0 || !theirFine.every((f) => mine.includes(f))) {
        hit = false;
        break;
      }
    }
    if (hit) k++;
  }
  return k;
}

export interface KInput {
  table: NationalTable;
  vocab: Vocab;
  spec: ProfileSpec;
  /** 施設の軸の値（全国の表のコード）。人が答えたもの */
  facility: Record<string, string | null>;
  /** 全国の表に載る施設か（人が答える）。null なら決まらない */
  group: Group | null;
  /** 写す候補の分類（当てはめを人が受けたもの） */
  classes: readonly string[];
  /** 場の決まりの下限（SEND_MIN_K より小さければ SEND_MIN_K を使う） */
  minK?: number;
  /** 人が粗くした段の順の位置（これより前の段は使わない） */
  fromRung?: number;
  /** OUTSIDE の集団で数える仲間 */
  peers?: readonly PeerProfile[];
  self?: string;
}

export interface Tried {
  stage: number;
  coarse: boolean;
  k: number;
}

export type KChoice =
  | {
      ok: true;
      profile: Profile;
      k: number;
      rung: number;
      /** 分類 → 写す分類（null は出さない） */
      lift: Map<string, string | null>;
      tried: Tried[];
    }
  | { ok: false; reason: "groupUnknown" | "profileIncomplete" | "kShort"; missing: string[]; tried: Tried[] };

/** 段の順をたどり、最初に k が下限に届いた段を選ぶ。 */
export function chooseProfile(input: KInput): KChoice {
  const { table, vocab, spec, facility, group } = input;
  const minK = Math.max(SEND_MIN_K, input.minK ?? SEND_MIN_K);
  if (group === null) return { ok: false, reason: "groupUnknown", missing: [], tried: [] };
  const rungs = ladder(spec, table);
  const missing = rungs[0]!.kept.filter((a) => {
    const v = facility[a];
    return typeof v !== "string" || !axisOf(table, a)!.codes.includes(v);
  });
  if (missing.length > 0) return { ok: false, reason: "profileIncomplete", missing, tried: [] };
  const tried: Tried[] = [];
  for (let i = Math.max(0, input.fromRung ?? 0); i < rungs.length; i++) {
    const r = rungs[i]!;
    const dropped = new Set(r.dropped);
    const lift = new Map<string, string | null>();
    for (const c of new Set(input.classes)) lift.set(c, liftClass(vocab, table, c, dropped));
    const axes: Record<string, string> = {};
    for (const a of r.kept) {
      const v = facility[a]!;
      axes[a] = r.coarse && axisOf(table, a)!.band ? coarseOf(table, a, v)! : v;
    }
    const kept = [...lift.values()].filter((x): x is string => x !== null);
    const k =
      group === "NATIONAL"
        ? kNational(table, vocab, axes, kept, r.stage)
        : countPeers(table, input.peers ?? [], input.self ?? "", group, axes);
    tried.push({ stage: r.stage, coarse: r.coarse, k });
    if (k >= minK) return { ok: true, profile: { group, stage: r.stage, axes }, k, rung: i, lift, tried };
  }
  return { ok: false, reason: "kShort", missing: [], tried };
}

/** 全国の表での k：見え方の軸の値と、分類から推せる軸の値の両方に当たる施設の数。段 3 は稼働の総数。 */
export function kNational(table: NationalTable, vocab: Vocab, axes: Record<string, string>, classes: readonly string[], stage: number): number {
  const implied = impliedConstraints(vocab, table, classes);
  if (stage === 3 && Object.keys(axes).length === 0 && Object.keys(implied).length === 0) return table.active;
  const cons: Record<string, string[]> = {};
  for (const [a, v] of Object.entries(axes)) cons[a] = fineCodesOf(table, a, v);
  for (const [a, vs] of Object.entries(implied)) cons[a] = intersect(cons[a], vs);
  return countNational(table, cons);
}
