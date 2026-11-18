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

/** 規則の値の組は 20 個まで（docs/plan.md §2.13）。長い一覧は 20 個ずつの規則に分ける */
const by20 = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / 20) }, (_, i) => xs.slice(i * 20, i * 20 + 20));

/** 号機の字（A・B…）を付けた名前。台帳の機器の段に「ボイラ給水ポンプ A」のように並ぶ */
const withUnits = (name: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${name} ${String.fromCharCode(65 + i)}`);

/**
 * fictional-1 の補機（計画 §2.5 の厚さ）。AI は intake_survey の crosswalk と chart_rows の段の道で機器の名前と設備の段を読み、
 * パックの項目に当てる規則を、項目ごとに名前の一覧で書く（どの補機が、どの項目の下の機器かは、設備の段と名前から決める）
 */
export const F1_AUX_NODES: [string[], string][] = [
  [[...withUnits("ごみ投入扉", 6), ...withUnits("ごみクレーン用バケット", 2), "ごみピット脱臭装置"], "WI.RECV.CRANE"],
  [["計量データ処理装置"], "WI.RECV.SCALE"],
  [["切断機搬送コンベヤ"], "WI.RECV.SHREDDER"],
  [["ごみ投入ホッパ", "給じん装置", ...withUnits("火格子駆動油圧装置", 2), "落じんコンベヤ"], "WI.COMB.STK_GRATE"],
  [[...withUnits("助燃バーナ", 2), "灰押出装置", "炉内監視カメラ"], "WI.COMB.STK_FURNACE"],
  [
    [...withUnits("ボイラ給水ポンプ", 2), "過熱器", "節炭器", ...withUnits("スートブロワ", 8), "連続ブロー装置", "ボイラ給水予熱器", "脱気器", ...withUnits("ボイラ水薬注装置", 2), "高圧蒸気だめ", ...withUnits("純水装置", 2), "ボイラ給水タンク"],
    "WI.COOL.BOILER",
  ],
  [["復水タンク", ...withUnits("復水ポンプ", 2), ...withUnits("蒸気復水器ファン", 8)], "WI.COOL.CONDENSER"],
  [["集じん器逆洗装置", ...withUnits("集じん器ダスト排出装置", 2)], "WI.FLUE.DUST"],
  [["消石灰供給装置", "消石灰貯留サイロ", ...withUnits("消石灰輸送ブロワ", 2)], "WI.FLUE.HCL_SOX"],
  [["活性炭供給装置", "活性炭貯留サイロ"], "WI.FLUE.DIOXIN"],
  [[...withUnits("尿素水噴霧ポンプ", 2), "尿素水貯槽"], "WI.FLUE.NOX"],
  [["二次押込送風機", "空気予熱器"], "WI.DRAFT.FDF"],
  [["排ガス循環送風機", ...withUnits("煙道ダンパ", 6), "煙突"], "WI.DRAFT.IDF"],
  [["タービン潤滑油装置", "タービンバイパス弁", "グランド蒸気復水器", ...withUnits("場内給湯熱交換器", 2)], "WI.HEAT.TURBINE"],
  [["主灰搬出コンベヤ", "灰クレーン用バケット"], "WI.ASHOUT.ASH_CRANE"],
  [[...withUnits("飛灰搬送コンベヤ", 2), "飛灰貯留槽", ...withUnits("飛灰混練機", 2), "キレート剤添加装置", "処理物搬出コンベヤ"], "WI.ASHOUT.FLYASH_TREAT"],
  [["特別高圧受電盤", "主変圧器", ...withUnits("高圧配電盤", 6), ...withUnits("低圧動力盤", 12), "直流電源装置", ...withUnits("無停電電源装置", 2)], "WI.ELEC.SUBSTATION"],
  [["非常用発電機", "発電機遮断器", "励磁装置"], "WI.ELEC.GENERATOR"],
  [["中央操作盤", ...withUnits("排ガス分析計", 4), ...withUnits("炉内温度計", 6), ...withUnits("流量計", 6), "炉制御盤", "ITV 設備", ...withUnits("計装用空気圧縮機", 2)], "WI.INST.DCS"],
];

/** 星取表の印に、点検と分解整備・取替が混ざる補機（利用者が答えられないので、名前の無い作業の属性は置かない） */
const MIXED = /^(ボイラ給水ポンプ|スートブロワ|復水ポンプ|蒸気復水器ファン|飛灰混練機|計装用空気圧縮機|無停電電源装置|排ガス分析計) /;
export const F1_MIXED_NAMES = ["押込送風機", "誘引通風機", ...F1_AUX_NODES.flatMap(([names]) => names).filter((n) => MIXED.test(n))];

/** 星取表の印が点検だけの補機 */
const F1_AUX_INSPECT_ONLY = F1_AUX_NODES.flatMap(([names]) => names).filter((n) => !MIXED.test(n));

/** 項目のコードごとの機器の名前（パックの項目と同じ名前の機器が先、補機があと） */
const F1_CODES = new Map<string, string[]>();
for (const [n, c] of F1_NODES) F1_CODES.set(c, [...(F1_CODES.get(c) ?? []), n]);
for (const [ns, c] of F1_AUX_NODES) F1_CODES.set(c, [...(F1_CODES.get(c) ?? []), ...ns]);

export function f1Rules(): { nodes: Rule[]; works: Rule[] } {
  const level2: Rule["when"][number] = { field: "assetNode.level", op: "equals", values: [2] };
  return {
    // 規則は 1 回に 50 個まで（docs/plan.md §2.13）。項目ごとに、パックの項目と同じ名前の機器とその下の補機を 1 つの名前の一覧にする
    nodes: [...F1_CODES].flatMap(([c, ns]) => by20(ns).map((part) => node([namesIn(part), level2], c, `機器の段の名前と設備の段から、この機器は ${c} の項目の機器`))),
    works: [
      ...by20([
              "計量機の定期検査",
              "ごみクレーンの年次点検",
              "切断機の点検",
              "精密機能検査",
              "排ガス処理設備の点検",
              "灰クレーンの年次点検",
              "全休止の電気・計装の点検",
              "燃焼設備の補機の点検",
              "ボイラ補機の点検",
              "ボイラ給水ポンプの点検",
              "排ガス処理補機の点検",
              "通風補機の点検",
              "主灰搬出コンベヤの点検",
              "計装の年次校正",
              "受入供給設備の補機の点検",
              "復水系の点検",
              "薬剤貯留設備の点検",
              "煙突の点検",
              "タービン補機の点検",
              "飛灰処理設備の点検",
              "電気設備の年次点検",
              "計装設備の年次点検",
              "スートブロワの点検",
              "復水ポンプ・復水器ファンの点検",
              "飛灰混練機の点検",
              "計装用空気圧縮機の点検"
      ]).map((part) => attr([{ field: "work.kind", op: "in", values: part }], "INSPECT", "作業の名前が点検・検査・校正")),
      attr(
        [
          {
            field: "work.kind",
            op: "in",
            values: [
              "定期整備（分解）",
              "通風機の分解整備",
              "全休止のタービン系の分解整備",
              "ボイラ給水ポンプの分解整備",
              "スートブロワの分解整備",
              "復水ポンプ・復水器ファンの分解整備",
              "飛灰混練機の分解整備",
              "計装用空気圧縮機の分解整備",
            ],
          },
        ],
        "OVERHAUL",
        "作業の名前が分解整備",
      ),
      attr([{ field: "work.kind", op: "contains", values: ["基幹改良"] }], "UPGRADE", "作業の名前に基幹改良とある"),
      attr([{ field: "work.kind", op: "contains", values: ["取替"] }], "REPLACE", "作業の名前に取替とある"),
      // 星取表の印だけで名前の無い作業：利用者がチャットで、機器ごとに何の印かを答えた（送風機の 2 つは混ざっているので置かない）
      ...by20(["計量機", "ごみクレーン", "可燃性粗大ごみ切断機", "集じん装置", "HCL、SOx 除去設備", "NOx 除去設備", "灰クレーン", "受変電配電設備", "発電機", "DCS", ...F1_AUX_INSPECT_ONLY]).map((part) =>
        attr([unnamed, namesIn(part)], "INSPECT", "利用者がチャットで、この機器の印は点検と答えた"),
      ),
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

/**
 * デモの資料（packs/waste-incineration/demo/、moyai-samples の v4 の f11【架空】さくら坂焼却場）。
 * 計画の機器は「機器名称 › 整備の考え方 台帳No」の段で読まれ、作業は台帳No の付いた段の節に付く。AI は intake_survey の crosswalk（assetNode.tag の多い値）と
 * chart_rows の段の道で台帳No と機器の名前を読み、パックの項目に当てる規則を、項目ごとに台帳No の一覧で書く（号炉の 1・2 と、共通の 0 が頭の数字）
 */
const both = (...ns: string[]): string[] => ns.flatMap((n) => [`1${n}`, `2${n}`]);
export const DEMO_TAGS: [string[], string][] = [
  [["0A-01"], "WI.RECV.SCALE"],
  [[...both("A-02", "A-03", "A-04"), "0A-04", "0A-05", "0A-07", "0A-08"], "WI.RECV.CRANE"],
  [both("B-02", "B-03", "B-04", "B-05", "B-06", "B-08"), "WI.COMB.STK_GRATE"],
  [[...both("B-01", "B-09", "B-10"), "0B-02"], "WI.COMB.STK_FURNACE"],
  [[...both("C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-10"), "0C-02"], "WI.COOL.BOILER"],
  [["0C-08", "0C-09"], "WI.COOL.CONDENSER"],
  [both("C-12", "C-13", "C-14"), "WI.COOL.WATER_SPRAY"],
  [both("D-05", "D-06", "D-07", "D-08", "D-09"), "WI.FLUE.DUST"],
  [[...both("D-01"), "0D-02"], "WI.FLUE.HCL_SOX"],
  [[...both("D-03"), "0D-04"], "WI.FLUE.DIOXIN"],
  [both("F-01", "F-02", "F-03"), "WI.DRAFT.FDF"],
  [both("F-07", "F-08", "F-09", "F-12", "F-14"), "WI.DRAFT.IDF"],
  [[...both("G-01", "G-02", "G-03"), "0G-01", "0G-02", "0G-04"], "WI.ASHOUT.ASH_CRANE"],
  [["0G-06", "0G-07", "0G-08", "0G-10", "0G-12", "0G-13"], "WI.ASHOUT.FLYASH_TREAT"],
  [["0K-06", "0K-07"], "WI.ELEC.SUBSTATION"],
  [["0K-04"], "WI.ELEC.GENERATOR"],
  [["0L-01", "0L-02", "0L-03"], "WI.INST.DCS"],
];

export function demoRules(): { nodes: Rule[]; works: Rule[] } {
  return {
    nodes: [
      ...DEMO_TAGS.flatMap(([tags, c]) => by20(tags).map((part) => node([{ field: "assetNode.tag", op: "in", values: part }], c, `台帳No と機器の名前から、この機器は ${c} の項目の機器`))),
      // 財務会計の CSV の件名だけにある機器（台帳No が無い）：件名の「火格子補修工事」から、火格子（燃焼装置）の機器
      node([{ field: "work.kind", op: "contains", values: ["火格子補修工事"] }], "WI.COMB.STK_GRATE", "CSV の件名が火格子の補修工事なので、この機器は燃焼装置（火格子）"),
    ],
    works: [
      attr([{ field: "work.kind", op: "in", values: ["点検", "法定検査"] }], "INSPECT", "作業の名前が点検・法定検査"),
      attr([{ field: "work.kind", op: "contains", values: ["火格子補修工事"] }], "OVERHAUL", "CSV の件名が火格子の補修工事（摩耗した火格子片の取替を含む整備）"),
      // 灯油移送ポンプ（0B-02、整備の考え方は「個別」）の印は R5 の「◎済」（分解整備）だけ
      attr([unnamed, { field: "assetNode.tag", op: "in", values: ["0B-02"] }], "OVERHAUL", "利用者がチャットで、灯油移送ポンプの印は分解整備と答えた"),
      // 星取表の印だけで名前の無い作業：利用者がチャットで、整備の考え方が「毎年点検」「隔年点検」の機器の印は点検、「分解 1 回」は分解整備と答えた（「個別」は混ざるので置かない）
      attr([unnamed, namesIn(["毎年点検", "隔年点検"])], "INSPECT", "利用者がチャットで、毎年点検・隔年点検の機器の印は点検と答えた"),
      attr([unnamed, namesIn(["分解 1 回"])], "OVERHAUL", "利用者がチャットで、分解 1 回の機器の印は分解整備と答えた"),
    ],
  };
}
