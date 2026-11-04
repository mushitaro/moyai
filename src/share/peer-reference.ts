// AI に渡す、似た施設の比べ（peer_reference の中身。docs/plan.md §2.8・§2.18.4）：下限を守った集計と匿名の札だけ。
// 鍵・見え方の値・年度・施設ごとの帯は渡さない。場（公開の台帳・輪）をまたいで混ぜない。
// 作業画面（人が開いた比べ）と橋渡し（公開の台帳だけを、計画の見え方で読む）の両方が、この関数で同じ形にする。
import type { StatCell } from "./aggregate";
import { STAT_FIELDS } from "./bands";
import type { Comparison } from "./receive";

/** 統計の行を、ツールの答えの形（low・high）にする */
export function statOut(c: StatCell): Record<string, unknown> {
  if (c.shown === "x") return { shown: "x" };
  if (c.shown === "range") return { shown: "range", n: c.n, low: c.lo, high: c.hi };
  return { shown: "median", n: c.n, median: c.median, q1: c.q1, q3: c.q3 };
}

export function peerAggregates(c: Comparison, commonItem?: string): { places: Record<string, unknown>[]; aggregates: Record<string, unknown>[]; cards: Record<string, unknown>[] } {
  const aggregates: Record<string, unknown>[] = [];
  const cards: Record<string, unknown>[] = [];
  for (const p of c.places) {
    if (p.status !== "shown") continue;
    for (const r of p.agg.rows) {
      if (commonItem !== undefined && r.class !== commonItem) continue;
      const a: Record<string, unknown> = { place: p.kind, commonItem: r.class, work: r.work };
      for (const f of STAT_FIELDS) a[f] = statOut(r.stats[f]);
      aggregates.push(a);
      for (const peer of r.peers) cards.push({ place: p.kind, card: peer.label, commonItem: r.class, work: r.work });
    }
  }
  const places = c.places.map((p) => ({ place: p.kind, status: p.status, similar: p.status === "shown" ? p.agg.similar.length : p.status === "belowShow" ? p.similar : null }));
  return { places, aggregates, cards };
}
