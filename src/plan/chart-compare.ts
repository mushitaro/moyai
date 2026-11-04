// 版どうしの差（docs/screens.md 3.2「星取表」、P2 の 1）：今の星取表のセルを、比べる版の星取表の同じ行・同じ期のセルと比べる。
// - 2 つの表は同じ作り方（buildChart に同じ行の切り替え・期・層・畳み方）で作るので、行の鍵と期の鍵がそろう。
// - 変わった：今のセルに印があり、比べる版の印と違う（足した・変えた）。朱で描く。
// - 比べる版の印：比べる版にあった印が、今は無い。「第 n 版の計画」として淡い破線の円で残す。
// 自分の行（節・未当てはめ）だけを比べ、似た施設と統計の行は比べない。
import type { ChartModel, Mark } from "./chart";

export const compareKey = (rowId: string, periodKey: string): string => `${rowId}\u0000${periodKey}`;

/** 比べる版の表の、印のあるセル（行の鍵 × 期の鍵 → 印） */
export function marksOf(m: ChartModel): Map<string, Mark> {
  const out = new Map<string, Mark>();
  for (const r of m.rows) {
    if (r.kind === "peer" || r.kind === "stat") continue;
    for (const [k, c] of Object.entries(r.cells)) if (c.mark !== null) out.set(compareKey(r.id, k), c.mark);
  }
  return out;
}

/** 今のセルの印が、比べる版から変わったか（足した・変えた） */
export function changedFrom(before: ReadonlyMap<string, Mark>, rowId: string, periodKey: string, mark: Mark | null): boolean {
  return mark !== null && before.get(compareKey(rowId, periodKey)) !== mark;
}

/** 比べる版にあった印が、今は無いか（あれば、その印） */
export function oldMark(before: ReadonlyMap<string, Mark>, rowId: string, periodKey: string, mark: Mark | null): Mark | null {
  return mark === null ? (before.get(compareKey(rowId, periodKey)) ?? null) : null;
}

/** 今の表の中で、変わったセルの数と、比べる版にだけある印の数 */
export function compareCounts(before: ReadonlyMap<string, Mark>, now: ChartModel): { changed: number; old: number } {
  let changed = 0;
  const seen = new Set<string>();
  for (const r of now.rows) {
    if (r.kind === "peer" || r.kind === "stat") continue;
    for (const [k, c] of Object.entries(r.cells)) {
      const key = compareKey(r.id, k);
      if (c.mark !== null) seen.add(key);
      if (changedFrom(before, r.id, k, c.mark)) changed++;
    }
  }
  let old = 0;
  for (const key of before.keys()) if (!seen.has(key)) old++;
  return { changed, old };
}
