// 計画を作った結果の、資料ごとの新しい機器の節（その資料で初めて出た節）の数と、同じ名前の節が多くできた資料。
// 決まった答え（「先の資料に無い機器は入れる」など）で、質問なしに入った切れ端（頁の頭書きなど）を、利用者に見せて確かめるために返す
// （会話の繰り返しの試験 11-08：頁の頭書きが 266 の機器の節として黙って入った）。純粋な関数。
import type { Plan } from "../shared/plan";

/** 資料ごとの新しい機器の節の数を返す資料の数（多い資料から） */
export const NEW_NODES_TOP = 10;
/** 1 つの資料に同じ名前の機器の節がこの数以上できたら、名前と数を知らせる */
export const SAME_NAME_NODES_MIN = 20;
/** 知らせる名前の数の上限 */
const SAME_NAME_MAX = 10;

export interface NewNodes {
  /** 資料ごとの新しい機器の節の数（多い資料から NEW_NODES_TOP まで。0 の資料は入れない） */
  byFile: { fileRef: string; nodes: number }[];
  /** 1 つの資料に SAME_NAME_NODES_MIN 以上できた、同じ名前の機器の節（多いものから） */
  sameName: { fileRef: string; name: string; nodes: number }[];
}

/**
 * 機器の節ごとに、出どころの資料のうち入れた順でいちばん先の資料を「その節ができた資料」とし、資料ごとに数える。
 * fileOrder は資料を入れた順（無い資料は、入れた資料のあとに名前の順で並べる）。出どころの無い節は数えない
 */
export function newNodesOf(plan: Pick<Plan, "assets">, fileOrder: readonly string[]): NewNodes {
  const rank = new Map(fileOrder.map((f, i) => [f, i]));
  const order = (a: string, b: string) => (rank.get(a) ?? fileOrder.length) - (rank.get(b) ?? fileOrder.length) || (a < b ? -1 : a > b ? 1 : 0);
  const count = new Map<string, number>();
  const names = new Map<string, Map<string, number>>();
  for (const a of plan.assets) {
    const files = [...new Set(a.sources.map((s) => s.file))].sort(order);
    const file = files[0];
    if (file === undefined) continue;
    count.set(file, (count.get(file) ?? 0) + 1);
    const byName = names.get(file) ?? new Map<string, number>();
    byName.set(a.name, (byName.get(a.name) ?? 0) + 1);
    names.set(file, byName);
  }
  const byFile = [...count.entries()]
    .sort((x, y) => y[1] - x[1] || order(x[0], y[0]))
    .slice(0, NEW_NODES_TOP)
    .map(([fileRef, nodes]) => ({ fileRef, nodes }));
  const sameName: NewNodes["sameName"] = [];
  for (const [fileRef, byName] of names) for (const [name, nodes] of byName) if (nodes >= SAME_NAME_NODES_MIN) sameName.push({ fileRef, name, nodes });
  sameName.sort((x, y) => y.nodes - x.nodes || order(x.fileRef, y.fileRef) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return { byFile, sameName: sameName.slice(0, SAME_NAME_MAX) };
}

/** 同じ名前の機器の節が多くできた資料を、利用者に見せる 1 文にする（無ければ null） */
export function sameNameNote(sameName: NewNodes["sameName"]): string | null {
  if (!sameName.length) return null;
  const list = sameName.map((x) => `${x.fileRef} の「${x.name}」${x.nodes.toLocaleString("en-US")}`).join("、");
  return `同じ名前の機器の節が ${SAME_NAME_NODES_MIN} 以上できた資料がある：${list}。頁の頭書きや表の題の切れ端が、質問なしに機器として入っていないかを利用者に見せて確かめる（入れたくなければ、行の役割のルールで外す）。`;
}
