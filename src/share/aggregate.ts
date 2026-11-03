// 受け手とサイトの集計（docs/plan.md §2.8 見え方と紛れる数 k・受け取りと 3 つの立場）。純粋な関数。
// 入力は確かめて ✓ になった束（鍵ごとに最新の 1 つ）だけ。集団を混ぜない（受け手の見え方と同じ集団の束だけを数える）。
// 似た施設：受け手の見え方の軸ごとに、相手の値の細かいコードが受け手の値の範囲に入る束（輪の countPeers と同じ考え方）。自分の鍵は数えない。
// 統計の行は塊（分類 × 作業の属性）ごと、間隔・工数・日数のそれぞれで、n（自分を除いた施設の数）が 0〜2 なら x、3〜4 なら幅の帯と n、
// 5 以上なら中央の帯・四分位の帯・n。帯は順の値なので、中央と四分位は最近順位法（並べて ⌈p·n⌉ 番目の帯。いつも実際にある帯）で取る。
// 匿名の札は鍵の指紋から作る（同じ鍵なら、束が増えても台帳が変わっても同じ札）。札には施設を示す語を入れない。
import { BAND_DEFS, STAT_FIELDS, bandCodes, type StatField } from "./bands";
import type { BundleBody } from "./bundle";
import type { Chunk } from "./copyout";
import { RECEIVE_MIN_K, SEND_MIN_K, fineCodesOf, statShown, type NationalTable, type Profile } from "./k";
import { fingerprint } from "./sign";
import { WORK_ATTRIBUTES } from "../shared/plan";

/** 確かめて ✓ になった束（鍵ごとに最新の 1 つ） */
export interface PeerBundle {
  key: string;
  pub: string;
  body: BundleBody;
}

/** ✓ の束の並びから、鍵ごとに seq の最大の 1 つを取る（鍵の順） */
export function latestPerKey(bundles: readonly { key: string | null; body: BundleBody | null }[]): PeerBundle[] {
  const best = new Map<string, BundleBody>();
  for (const b of bundles) {
    if (b.key === null || b.body === null) continue;
    const cur = best.get(b.key);
    if (!cur || b.body.seq > cur.seq) best.set(b.key, b.body);
  }
  return [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, body]) => ({ key, pub: body.pub, body }));
}

/** 相手の見え方が、受け手の見え方に入るか（集団が同じで、受け手の軸ごとに相手の細かいコードが受け手の範囲の中） */
export function isSimilar(table: NationalTable, mine: Profile, theirs: Profile): boolean {
  if (mine.group !== theirs.group) return false;
  for (const [a, v] of Object.entries(mine.axes)) {
    const range = fineCodesOf(table, a, v);
    const t = theirs.axes[a];
    const tf = t === undefined ? [] : fineCodesOf(table, a, t);
    if (range.length === 0 || tf.length === 0 || !tf.every((f) => range.includes(f))) return false;
  }
  return true;
}

export const LABEL_HEAD = "類似施設";

/**
 * 匿名の札：鍵の指紋の頭（4 文字）。同じ頭の鍵があれば、2 組・3 組・4 組と延ばす（4 組は指紋の全部）。
 * 札は鍵だけから決まるので、束が増えても、ほかの施設が増えても変わらない（頭がぶつかったときだけ延びる）。
 */
export function anonymousLabels(pubs: readonly string[]): Map<string, string> {
  const fps = new Map(pubs.map((p) => [p, fingerprint(p)]));
  const out = new Map<string, string>();
  for (const [p, fp] of fps) {
    let len = 4;
    while (len < fp.length && [...fps.entries()].some(([q, g]) => q !== p && g.slice(0, len) === fp.slice(0, len))) len += 5;
    out.set(p, `${LABEL_HEAD} ${fp.slice(0, Math.min(len, fp.length))}`);
  }
  return out;
}

export type StatCell =
  | { shown: "x" }
  | { shown: "range"; n: number; lo: string; hi: string }
  | { shown: "median"; n: number; q1: string; median: string; q3: string };

/** 帯の順（場の決まりの境目のコード）。知らないコードは数えない */
function order(field: StatField, edges?: readonly number[]): string[] {
  return bandCodes(BAND_DEFS[field], edges ?? BAND_DEFS[field].edges);
}

/** 最近順位法の p 分位（1 から数えた ⌈p·n⌉ 番目） */
function rank(sorted: readonly number[], p: number): number {
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1]!;
}

/** 1 つの欄の統計の行。values は相手ごとの帯のコード（自分を除く） */
export function statCell(field: StatField, values: readonly string[], edges?: readonly number[]): StatCell {
  const codes = order(field, edges);
  const idx = values.map((v) => codes.indexOf(v)).filter((i) => i >= 0).sort((a, b) => a - b);
  const n = idx.length;
  const shown = statShown(n);
  if (shown === "x") return { shown: "x" };
  if (shown === "range") return { shown: "range", n, lo: codes[idx[0]!]!, hi: codes[idx[n - 1]!]! };
  return { shown: "median", n, q1: codes[rank(idx, 0.25)]!, median: codes[rank(idx, 0.5)]!, q3: codes[rank(idx, 0.75)]! };
}

export interface StarPeer {
  label: string;
  years: string[];
  observed: string;
  interval?: string;
  manDays?: string;
  days?: string;
}

export interface StarRow {
  class: string;
  work: (typeof WORK_ATTRIBUTES)[number];
  /** この塊のある似た施設（札の順） */
  peers: StarPeer[];
  /** 欄ごとの統計（n は自分を除いた施設の数） */
  stats: Record<StatField, StatCell>;
}

export interface Aggregate {
  profile: Profile;
  /** 似た施設（自分を除く。札の順） */
  similar: { key: string; label: string; profile: Profile }[];
  /** 似た施設が 5 に届かない（「この条件では 5 施設に届かない」） */
  belowFive: boolean;
  /** 似た施設が受ける側の見せる下限（3）に届かない */
  belowShow: boolean;
  /** 年度の列（似た施設の塊の年度を合わせたもの、小さい順） */
  years: string[];
  rows: StarRow[];
}

export interface AggregateInput {
  table: NationalTable;
  /** 受け手の見え方（サイトでは、その節の見え方） */
  profile: Profile;
  /** 受け手の鍵（サイトは null。数えない） */
  self: string | null;
  peers: readonly PeerBundle[];
  /** 場の決まりの帯の境目（無ければコードの境目） */
  bands?: Partial<Record<StatField, readonly number[]>>;
}

/** 似た施設の星取表の行と統計の行を作る */
export function aggregate(i: AggregateInput): Aggregate {
  const sim = i.peers.filter((p) => p.key !== i.self && isSimilar(i.table, i.profile, p.body.profile));
  const labels = anonymousLabels(i.peers.map((p) => p.pub));
  const similar = sim
    .map((p) => ({ key: p.key, label: labels.get(p.pub)!, profile: p.body.profile, chunks: p.body.chunks }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const rowsMap = new Map<string, { class: string; work: StarRow["work"]; peers: (StarPeer & { chunk: Chunk })[] }>();
  const years = new Set<string>();
  for (const s of similar) {
    for (const c of s.chunks) {
      const k = `${c.class}\u0000${c.work}`;
      if (!rowsMap.has(k)) rowsMap.set(k, { class: c.class, work: c.work, peers: [] });
      const peer: StarPeer & { chunk: Chunk } = { label: s.label, years: [...c.years], observed: c.observed, chunk: c };
      for (const f of STAT_FIELDS) if (c[f] !== undefined) peer[f] = c[f];
      rowsMap.get(k)!.peers.push(peer);
      for (const y of c.years) years.add(y);
    }
  }
  const wi = (w: string) => WORK_ATTRIBUTES.indexOf(w as never);
  const rows: StarRow[] = [...rowsMap.values()]
    .sort((a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : wi(a.work) - wi(b.work)))
    .map((r) => {
      const stats = {} as Record<StatField, StatCell>;
      for (const f of STAT_FIELDS) stats[f] = statCell(f, r.peers.map((p) => p.chunk[f]).filter((v): v is string => typeof v === "string"), i.bands?.[f]);
      return { class: r.class, work: r.work, peers: r.peers.map(({ chunk: _c, ...p }) => p), stats };
    });
  return {
    profile: i.profile,
    similar: similar.map(({ chunks: _c, ...s }) => s),
    belowFive: similar.length < SEND_MIN_K,
    belowShow: similar.length < RECEIVE_MIN_K,
    years: [...years].sort(),
    rows,
  };
}

/** サイトの節：✓ の束の見え方ごとに 1 つ（同じ見え方は 1 つにまとめる。集団・段・軸の順で並べる） */
export function sectionsOf(peers: readonly PeerBundle[]): Profile[] {
  const seen = new Map<string, Profile>();
  for (const p of peers) {
    const k = JSON.stringify([p.body.profile.group, p.body.profile.stage, Object.entries(p.body.profile.axes).sort()]);
    if (!seen.has(k)) seen.set(k, p.body.profile);
  }
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}
