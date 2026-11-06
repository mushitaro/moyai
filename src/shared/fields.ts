// 芯のデータの形の欄の名前（docs/plan.md §2.4）。どの業種でも同じ。業種で変わるのはパックだけ。
// 欄の名前はここだけに置き、画面・規則・取り込みはここから取る。業種の語はここに置かない。

/** 欄の値の型。規則の比べ方は、この型で選べるものが決まる。 */
export type FieldType = "text" | "code" | "number" | "date" | "fiscalYear" | "enum" | "flag" | "list";

export interface FieldDef {
  /** 画面に出す名前 */
  label: string;
  type: FieldType;
  /** enum のときの値の一覧 */
  values?: readonly string[];
  /** 共有で欄ごと出さないもの（費用・人など） */
  neverShared?: true;
  /** 規則の欄（FIELD_REFS）に入れないもの：中身が組や一覧で、規則の比べ方が効かない欄（Architect の 47） */
  noRule?: true;
}

/**
 * 変更の作者の種類（docs/plan.md §2.9）。画面で人が答えたものだけを「人」とする。
 * 人・AI・AI（チャットでの人の答え）・AI（読み取り）・決まり（コード）。
 */
export const AUTHOR_KINDS = ["human", "ai", "ai_relayed_human", "ai_reading", "rule_code"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

/** 作業の属性のコード（docs/plan.md §2.1）。画面に出す名前はパック（packs/_kinds/work.json）が持つ。 */
export const WORK_ATTRIBUTES = ["INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"] as const;
export type WorkAttribute = (typeof WORK_ATTRIBUTES)[number];

/** 分類コードの形（docs/plan.md §2.1）。頭の文字はパックが決める */
export const CLASS_CODE = /^[A-Z]{2,4}(\.[A-Z0-9_]{2,16}){1,4}$/;

const f = (label: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ label, type, ...extra });

export const ENTITIES = {
  facility: {
    label: "施設",
    fields: {
      facilityKey: f("施設の鍵", "code"),
      name: f("名前", "text"),
      fiscalYearStartMonth: f("年度の始まり（月）", "number"),
      scale: f("規模", "number"),
      scaleUnit: f("規模の単位", "code"),
      legalFlags: f("該当する法令の印", "list"),
      fictional: f("架空の印", "flag"),
      inNationalTable: f("全国の表に載る施設か", "flag"),
      profile: f("見え方の答え（全国の表の軸のコード）", "list"),
    },
  },
  assetNode: {
    label: "資産の節",
    fields: {
      nodeKey: f("同一性の鍵", "code"),
      tag: f("表示の番号", "code"),
      name: f("名前", "text"),
      level: f("階層", "number"),
      parentKey: f("上の節", "code"),
      classCode: f("分類コード", "code"),
      commonItem: f("共通の設備項目", "code"),
      commonItemAuthor: f("当てはめの作者", "enum", { values: AUTHOR_KINDS }),
      commonItemBasis: f("当てはめの根拠", "text"),
      commonItemAccepted: f("当てはめを人が確定したか", "flag"),
      specs: f("仕様", "list"),
      installedOn: f("設置", "date"),
      removedOn: f("撤去", "date"),
      replacedOn: f("取替", "date"),
      series: f("系列", "code"),
      sources: f("元の資料", "list", { noRule: true }),
    },
  },
  work: {
    label: "作業",
    fields: {
      workKey: f("作業の鍵", "code"),
      kind: f("種類", "code"),
      attribute: f("作業の属性", "enum", { values: WORK_ATTRIBUTES }),
      attributeAuthor: f("作業の属性の当てはめの作者", "enum", { values: AUTHOR_KINDS }),
      attributeBasis: f("作業の属性の当てはめの根拠", "text"),
      attributeAccepted: f("作業の属性の当てはめを人が確定したか", "flag"),
      strategy: f("保全方式", "enum", { values: ["time_based", "condition_based", "corrective"] }),
      targets: f("対象の資産", "list"),
      trigger: f("きっかけ", "text"),
      checkIds: f("根拠の検査", "list"),
      contractor: f("外注先", "text"),
      parentWorkKey: f("上位の作業", "code"),
      tagRange: f("範囲のタグ", "text"),
      tagList: f("列挙のタグ", "list"),
    },
  },
  workDetail: {
    label: "作業明細",
    fields: {
      detailKey: f("明細の鍵", "code"),
      workKey: f("作業の鍵", "code"),
      planOrActual: f("計画か実績か", "enum", { values: ["plan", "actual"] }),
      step: f("段取り", "enum", { values: ["inspection", "diagnosis", "action"] }),
      startDate: f("開始日", "date"),
      endDate: f("終了日", "date"),
      fiscalYear: f("年度", "fiscalYear"),
      cost: f("費用", "number", { neverShared: true }),
      costSource: f("費用の元の資料", "text", { neverShared: true, noRule: true }),
      manDays: f("工数（人日）", "number"),
      days: f("日数", "number"),
      resultScale: f("判定の尺度", "code"),
      resultValue: f("判定の値", "text"),
      measuredValue: f("測った値", "text"),
      previousValue: f("前回の値", "text"),
      performer: f("実施者", "text", { neverShared: true }),
      sources: f("元の資料", "list", { noRule: true }),
      lines: f("作業明細", "list", { neverShared: true, noRule: true }),
      basis: f("根拠", "text"),
      author: f("作者", "enum", { values: AUTHOR_KINDS }),
      needsReview: f("要確認", "flag", { noRule: true }),
    },
  },
  meter: {
    label: "稼働",
    fields: {
      nodeKey: f("資産の節", "code"),
      meter: f("稼働の種類", "code"),
      date: f("日付", "date"),
      value: f("値", "number"),
    },
  },
} as const satisfies Record<string, { label: string; fields: Record<string, FieldDef> }>;

export type EntityId = keyof typeof ENTITIES;

/** 「作業.種類」のような欄の参照。規則の欄はこの一覧から選ぶ。 */
export type FieldRef = {
  [E in EntityId]: `${E}.${Extract<keyof (typeof ENTITIES)[E]["fields"], string>}`;
}[EntityId];

export const FIELD_REFS = Object.entries(ENTITIES).flatMap(([e, def]) =>
  Object.entries(def.fields as Record<string, FieldDef>)
    .filter(([, d]) => !d.noRule)
    .map(([k]) => `${e}.${k}`),
) as FieldRef[];

export function fieldDef(ref: FieldRef): FieldDef {
  const [e, k] = ref.split(".") as [EntityId, string];
  const def = (ENTITIES[e].fields as Record<string, FieldDef>)[k];
  if (!def) throw new Error(`欄が無い: ${ref}`);
  return def;
}
