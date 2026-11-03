// 試験だけの道具：AI の代わりに書く当てはめの規則（crosswalk_propose の引数）。vitest の crosswalk.* と Playwright の縦の 1 本が使う。
// 規則に使う節の名前と作業の名前は、AI が intake_survey の crosswalk（欄ごとの多い値）と chart_rows の段の道で読めるものだけ。
// 名前の無い作業（星取表の印だけのもの）の属性は、AI が利用者にチャットで聞いて答えてもらった体で置く。正解の世界は読まない。
import type { Rule } from "../../../src/shared/tools";

export const node = (when: Rule["when"], code: string, reason: string): Rule => ({ when, set: { field: "assetNode.commonItem", value: code }, reason });
export const attr = (when: Rule["when"], a: string, reason: string): Rule => ({ when, set: { field: "work.attribute", value: a }, reason });
export const nameIs = (name: string): Rule["when"][number] => ({ field: "assetNode.name", op: "equals", values: [name] });
const namesIn = (names: string[]): Rule["when"][number] => ({ field: "assetNode.name", op: "in", values: names });
const unnamed: Rule["when"][number] = { field: "work.kind", op: "equals", values: [""] };

/** fictional-1（設備 › 機器 › 部位の 3 段）。部位（電動機・軸受・耐火物）と設備の段には当てない */
export const F1_NODES: [string, string][] = [
  ["計量機", "WI.RECV.SCALE"],
  ["ごみクレーン", "WI.RECV.CRANE"],
  ["可燃性粗大ごみ切断機", "WI.RECV.SHREDDER"],
  ["ストーカ", "WI.COMB.STK_GRATE"],
  ["焼却炉本体", "WI.COMB.STK_FURNACE"],
  ["蒸気復水器", "WI.COOL.CONDENSER"],
  ["ボイラ", "WI.COOL.BOILER"],
  ["集じん装置", "WI.FLUE.DUST"],
  ["HCL、SOx 除去設備", "WI.FLUE.HCL_SOX"],
  ["NOx 除去設備", "WI.FLUE.NOX"],
  ["押込送風機", "WI.DRAFT.FDF"],
  ["誘引通風機", "WI.DRAFT.IDF"],
  ["蒸気タービン発電設備", "WI.HEAT.TURBINE"],
  ["灰クレーン", "WI.ASHOUT.ASH_CRANE"],
  ["受変電配電設備", "WI.ELEC.SUBSTATION"],
  ["発電機", "WI.ELEC.GENERATOR"],
  ["DCS", "WI.INST.DCS"],
];

export function f1Rules(): { nodes: Rule[]; works: Rule[] } {
  return {
    nodes: F1_NODES.map(([n, c]) => node([nameIs(n), { field: "assetNode.level", op: "equals", values: [2] }], c, `機器の段の名前「${n}」は、パックの項目の名前と同じもの`)),
    works: [
      attr(
        [{ field: "work.kind", op: "in", values: ["計量機の定期検査", "ごみクレーンの年次点検", "切断機の点検", "精密機能検査", "排ガス処理設備の点検", "灰クレーンの年次点検", "全休止の電気・計装の点検"] }],
        "INSPECT",
        "作業の名前が点検・検査",
      ),
      attr([{ field: "work.kind", op: "in", values: ["定期整備（分解）", "通風機の分解整備", "全休止のタービン系の分解整備"] }], "OVERHAUL", "作業の名前が分解整備"),
      attr([{ field: "work.kind", op: "contains", values: ["基幹改良"] }], "UPGRADE", "作業の名前に基幹改良とある"),
      // 星取表の印だけで名前の無い作業：利用者がチャットで、機器ごとに何の印かを答えた（送風機の 2 つは混ざっているので置かない）
      attr([unnamed, namesIn(["計量機", "ごみクレーン", "可燃性粗大ごみ切断機", "集じん装置", "HCL、SOx 除去設備", "NOx 除去設備", "灰クレーン", "受変電配電設備", "発電機", "DCS"])], "INSPECT", "利用者がチャットで、この機器の印は点検と答えた"),
      attr([unnamed, namesIn(["ストーカ", "焼却炉本体", "蒸気復水器", "ボイラ", "蒸気タービン発電設備"])], "OVERHAUL", "利用者がチャットで、この機器の印は分解整備と答えた"),
    ],
  };
}

/** fictional-2（設備 › 系統 › 機器群 › 機器の 4 段）。呼び名が違う（バグフィルタ・脱塩装置・押込ファン…） */
export const F2_NODES: [string, string][] = [
  ["ごみ投入クレーン", "WI.RECV.CRANE"],
  ["搬入計量装置", "WI.RECV.SCALE"],
  ["ごみ破砕前処理装置", "WI.COMB.FBI_PRETREAT"],
  ["流動床炉本体", "WI.COMB.FBI_FURNACE"],
  ["廃熱ボイラ", "WI.COOL.BOILER"],
  ["ガス減温塔", "WI.COOL.WATER_SPRAY"],
  ["バグフィルタ", "WI.FLUE.DUST"],
  ["脱塩装置", "WI.FLUE.HCL_SOX"],
  ["脱硝装置", "WI.FLUE.NOX"],
  ["押込ファン", "WI.DRAFT.FDF"],
  ["誘引送風機", "WI.DRAFT.IDF"],
  ["蒸気タービン", "WI.HEAT.TURBINE"],
  ["灰ピットクレーン", "WI.ASHOUT.ASH_CRANE"],
  ["高圧受電盤", "WI.ELEC.SUBSTATION"],
  ["非常用発電装置", "WI.ELEC.GENERATOR"],
  ["分散制御装置", "WI.INST.DCS"],
];

export function f2Rules(): { nodes: Rule[]; works: Rule[] } {
  return {
    nodes: F2_NODES.map(([n, c]) => node([{ field: "assetNode.level", op: "range", values: [4, 4] }, nameIs(n)], c, `4 段目の機器「${n}」は、パックの項目と同じ機器`)),
    works: [
      attr([{ field: "work.kind", op: "equals", values: ["精密機能検査"] }], "INSPECT", "凡例の ◎ は精密機能検査"),
      attr([unnamed, namesIn(["ごみ投入クレーン", "搬入計量装置", "ガス減温塔", "バグフィルタ", "脱塩装置", "脱硝装置", "灰ピットクレーン", "高圧受電盤", "非常用発電装置"])], "INSPECT", "利用者がチャットで、この機器の印は点検と答えた"),
      attr([unnamed, namesIn(["ごみ破砕前処理装置", "流動床炉本体", "廃熱ボイラ", "蒸気タービン"])], "OVERHAUL", "利用者がチャットで、この機器の印は分解整備と答えた"),
    ],
  };
}
