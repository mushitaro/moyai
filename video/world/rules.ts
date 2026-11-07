// ほたる川の世界の当てはめの規則（crosswalk_propose の引数。AI の代わりに撮影の台本が書く）。
// 機器の段と作業の名前は、今の fictional-1 の試験用の規則（tests/fixtures/crosswalk/rules.ts）と同じ型で、
// この世界で呼び名を替えた 4 つの機器（火格子・バグフィルタ・誘引送風機・蒸気タービン）だけを置き換える。
// 規則を新しく書き写さない：元の規則を読み、名前の文字だけを替える（作り手の世界の決まり rules-hotarugawa.json の名前と同じ）。
import type { Rule } from "../../src/shared/tools";
import { f1Rules } from "../../tests/fixtures/crosswalk/rules";

/** fictional-1 の呼び名 → ほたる川の呼び名 */
export const RENAMED: Readonly<Record<string, string>> = {
  ストーカ: "火格子",
  集じん装置: "バグフィルタ",
  誘引通風機: "誘引送風機",
  蒸気タービン発電設備: "蒸気タービン",
  誘引通風機の取替: "誘引送風機の取替",
};

const swap = (rule: Rule): Rule => ({
  ...rule,
  when: rule.when.map((c) => ({ ...c, values: c.values.map((v) => (typeof v === "string" ? (RENAMED[v] ?? v) : v)) })) as Rule["when"],
});

export function hotaruRules(): { nodes: Rule[]; works: Rule[] } {
  const { nodes, works } = f1Rules();
  return { nodes: nodes.map(swap), works: works.map(swap) };
}
