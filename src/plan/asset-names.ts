// 機器の見せる名前（星取表の階層・Claude が読む行・Excel の書き出し・差分レポート）。計画のデータ（名前・鍵・号機）は変えない。
// - 同じ親の下に同じ名前の機器が並び、号機（tag）で分かれるときだけ、名前の後ろに号機を添える（「ポンプ No.1」）。
// - 号機が無く名前だけが同じときは、名前のまま（推測で番号を振らない）。号機がみな同じなら添えない（号機では分かれない）。
// - 号機は号炉・系統の欄に入れない（号炉・系統は series。号機は別の機器）。
// 署名される字（版の記録の機器の名前・nodeKey）はこの名前に置き換えない。見せ方だけに使う。
import type { AssetNodeT } from "../shared/plan";

/** 号機の字（前後の空白を除く。空なら null） */
const tagOf = (a: Pick<AssetNodeT, "tag">): string | null => {
  const t = a.tag?.trim() ?? "";
  return t === "" ? null : t;
};

/** 号機を比べる形（NFKC。号機の無い機器は null） */
const tagKey = (a: Pick<AssetNodeT, "tag">): string | null => tagOf(a)?.normalize("NFKC") ?? null;

/**
 * 機器の鍵 → 見せる名前。同じ親の下の同じ名前の兄弟が 2 つ以上あり、その号機が 1 つにそろわないとき、号機を持つ機器だけ「名前 号機」にする。
 * ほかは名前のまま
 */
export function assetLabels(assets: readonly Pick<AssetNodeT, "nodeKey" | "parentKey" | "name" | "tag">[]): Map<string, string> {
  const groups = new Map<string, Pick<AssetNodeT, "nodeKey" | "parentKey" | "name" | "tag">[]>();
  for (const a of assets) {
    const k = `${a.parentKey ?? ""}\u0000${a.name}`;
    const g = groups.get(k);
    if (g) g.push(a);
    else groups.set(k, [a]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    // 号機の違い（号機の無い機器も 1 つの違いに数える）。2 つ以上あれば、号機で分かれる
    const tags = new Set(g.map(tagKey));
    const byTag = g.length > 1 && tags.size > 1;
    for (const a of g) {
      const t = tagOf(a);
      out.set(a.nodeKey, byTag && t !== null ? `${a.name} ${t}` : a.name);
    }
  }
  return out;
}

/** 添えた号機（見せる名前に号機を添えた機器だけ。ほかは null）。星取表の機器の行を号機ごとに分けるのに使う */
export function shownTag(a: Pick<AssetNodeT, "nodeKey" | "name" | "tag">, labels: ReadonlyMap<string, string>): string | null {
  const l = labels.get(a.nodeKey);
  return l !== undefined && l !== a.name ? tagOf(a) : null;
}
