// 列の役目の一覧（1 つだけ。Architect の 46）：読み手の列の役目（ColRole）と、そのうち人の答え（列の役目の質問）と
// Claude のルール（reading.ts の columnRole）で当てられるもの。質問の選択肢とルールの役目は、どちらもここから引く。
// 読み手（structure.ts）と読み方（reading.ts）の両方が読むので、どちらにも依らない葉のモジュールに置く。

/** 読み手が列に付ける役目 */
export const COL_ROLES = [
  /** 費用（作業明細の費用の欄。共有にも AI の見本にも出さない） */
  "cost",
  "hier",
  "name",
  "number",
  "unit",
  "mark",
  "date",
  "effort",
  "days",
  "workName",
  "workTitle",
  "assetRef",
  "spec",
  "installed",
  "remark",
  "label",
  /** 機器番号（同一性の鍵）の列 */
  "tag",
  /** 期間の終わりの日付（始まりと別の列に書く書き方：着手・完了） */
  "end",
  /** 行ごとの予定・実績（星取表を予定の段と実績の段に分けて書く書き方） */
  "planActual",
  /** 作業の周期（「周期(年)」：その行の作業の暦のきっかけ） */
  "cycle",
  /** 作業量（「数量」：作業明細の作業量。備考と同じに読み、作業明細の作業量の欄に残す） */
  "quantity",
  "unknown",
] as const;
export type ColRole = (typeof COL_ROLES)[number];

/**
 * 人の答えと Claude のルールで当てられる役目と、質問の選択肢の字（並びは選択肢の並び。既定は備考）。
 * exclude は役目ではなく、理由を残して外すこと
 */
export const COLUMN_ROLE_LABELS = {
  remark: "備考として根拠の文に添える",
  workName: "作業内容（作業の名前）",
  workTitle: "件名（工事の名前）",
  assetRef: "機器の名前",
  tag: "機器番号",
  unit: "号炉・系統",
  number: "行の番号",
  date: "日付（始まり）",
  end: "日付（終わり）",
  days: "日数",
  effort: "工数",
  quantity: "作業量",
  cycle: "周期",
  planActual: "計画・実績（行ごと）",
  // 費用の列（Architect の 46）：見本では字を伏せ、作業の年度の値の費用に読む
  cost: "費用",
  exclude: "外す",
} as const satisfies Partial<Record<ColRole | "exclude", string>>;

export type AssignableRole = keyof typeof COLUMN_ROLE_LABELS;
export const COLUMN_ROLES = Object.keys(COLUMN_ROLE_LABELS) as [AssignableRole, ...AssignableRole[]];
export const COLUMN_ROLE_OPTIONS: { id: AssignableRole; label: string }[] = COLUMN_ROLES.map((id) => ({ id, label: COLUMN_ROLE_LABELS[id] }));
export const isAssignableRole = (x: string | null | undefined): x is AssignableRole => !!x && (COLUMN_ROLES as readonly string[]).includes(x);
