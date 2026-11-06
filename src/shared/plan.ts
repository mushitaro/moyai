// 計画の書類の型（取り込み・星取表・確定・写し取りの共通の約束）。欄の名前は fields.ts の ENTITIES と同じ。
// 取り込みが作り、当てはめ（src/plan/crosswalk.ts）が案を置いて人が受け、星取表が描き、確定がファイルに残し、写し取りが読む。
// ここを変えるときは、どの側も同じ変更で直す。
import { z } from "zod";
import { AUTHOR_KINDS, WORK_ATTRIBUTES } from "./fields";

export { WORK_ATTRIBUTES } from "./fields";

const code = z.string().min(1);
const author = z.enum(AUTHOR_KINDS);
// 出どころ：どの資料のどこか（写真なら画像の位置）
export const SourceRef = z.object({
  file: z.string().min(1),
  sheet: z.string().nullable(),
  page: z.number().int().nullable(),
  cell: z.string().nullable(), // 例 "C12"。PDF は層 1 の格子の位置（頁を上から積んだ格子。頁と box も持つ）。写真は null
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), // 画像や頁の上の位置（x, y, w, h）
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Facility = z.object({
  facilityKey: code,
  name: z.string(),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  scale: z.number().nullable(),
  scaleUnit: z.string().nullable(),
  legalFlags: z.array(code),
  fictional: z.boolean(),
  inNationalTable: z.boolean().nullable(), // 人が答えるまで null
  // 見え方の答え（全国の表の軸のコード。例 furnace: "STOKER"）。人が施設の設定で答える。無ければ聞く（推測で埋めない）
  profile: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), z.string().regex(/^[A-Za-z0-9_]{1,40}$/)).optional(),
});

export const AssetNode = z.object({
  nodeKey: code,
  tag: z.string().nullable(),
  name: z.string(),
  level: z.number().int().min(1),
  parentKey: z.string().nullable(),
  classCode: z.string().nullable(),
  commonItem: z.string().nullable(), // 共通の設備項目（1 段目のコード）。決まるまで null
  commonItemAuthor: author.nullable(),
  commonItemBasis: z.string().nullable(),
  commonItemAccepted: z.boolean(), // 人が画面で受けたか（写し取りは true だけを写す）
  specs: z.array(z.object({ key: z.string(), value: z.string() })),
  installedOn: z.string().nullable(),
  removedOn: z.string().nullable(),
  replacedOn: z.string().nullable(),
  series: z.string().nullable(),
  sources: z.array(SourceRef),
});

export const Work = z.object({
  workKey: code,
  kind: z.string(), // 資料に書いてあった作業の名前
  attribute: z.enum(WORK_ATTRIBUTES).nullable(), // 作業の属性。決まるまで null
  attributeAuthor: author.nullable(),
  attributeBasis: z.string().nullable(),
  attributeAccepted: z.boolean(), // 人が画面で受けたか（写し取りは true だけを写す。資産の節の commonItemAccepted と同じ）
  strategy: z.enum(["time_based", "condition_based", "corrective"]).nullable(),
  targets: z.array(code).min(1),
  trigger: z.unknown().nullable(), // きっかけ（plan §2.4 の形。計算は src/plan/）
  checkIds: z.array(z.string()),
  contractor: z.string().nullable(),
  parentWorkKey: z.string().nullable(),
  tagRange: z.string().nullable(),
  tagList: z.array(z.string()),
});

export const WorkDetail = z.object({
  detailKey: code,
  workKey: code,
  planOrActual: z.enum(["plan", "actual"]),
  step: z.enum(["inspection", "diagnosis", "action"]).nullable(),
  startDate: z.string().nullable(), // 時刻帯の無い文字（YYYY-MM-DD）。年度だけの印は null
  endDate: z.string().nullable(),
  fiscalYear: z.number().int(),
  cost: z.number().nullable(), // 円の整数。共有しない（写し取りの許可の一覧に無い）。AI にも渡さない
  /** 費用の元のセル（資料・シート・セルと元の字）と税の扱い。費用が無ければ省く（運営者の決定 A 案、Architect の注文） */
  costSource: z
    .object({ file: z.string(), sheet: z.string().nullable(), ref: z.string(), text: z.string(), tax: z.enum(["incl", "excl", "unknown"]) })
    .strict()
    .optional(),
  manDays: z.number().nullable(), // 工数（人・日）
  days: z.number().nullable(), // 日数（工期）
  resultScale: z.string().nullable(),
  resultValue: z.string().nullable(),
  measuredValue: z.string().nullable(),
  previousValue: z.string().nullable(),
  performer: z.string().nullable(), // 共有しない
  sources: z.array(SourceRef).min(1), // 出どころはいくつも持てる（資料をまたぐ同じ作業）
  /**
   * 作業明細（運営者の定義、2026-11-06：作業日報の 1 行。1 日の作業内容・作業量・工数が分かる粒度）。
   * この型（作業の年度ごとの計画・実績）にまとめる前の行を、足し上げずに残す。共有には出さない（写し取りの許可の一覧に無い）。資料に日報が無ければ省く
   */
  lines: z
    .array(
      z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
          content: z.string(),
          quantity: z.string().nullable(),
          manDays: z.number().nullable(),
          days: z.number().nullable(),
          source: SourceRef,
          /** 和が年度の値と合わない理由の印：effortExcluded＝決定で工数を外した行、outOfYear＝日付がその年度の外（日付は null にする） */
          flag: z.enum(["effortExcluded", "outOfYear"]).optional(),
        })
        .strict(),
    )
    .optional(),
  basis: z.string().min(1),
  author: author,
  needsReview: z.boolean(), // 写真から読んだものは、人が画像と並べて確かめるまで true
});

// 読み方の決定：取り込みの質問への答え。年度の読み方や列の役目は、多くの印に一度に効く。
// AI と、AI が会話から写した人の答えは、人が画面で受けるまで確定できない（plan §2.9）
export const ReadingDecision = z.object({
  questionId: code,
  kind: z.string(),
  question: z.string(),
  answer: z.string(), // 選択肢の名前（数の答えは数）
  author: author,
  reason: z.string().min(1),
  rows: z.number().int().min(0), // 同じ形の行の数
  details: z.array(code).optional(), // この答えで作者が決まった明細（決定のシートで、この決定に付いて動く）
  where: z.string().optional(), // 効く所（資料・シート。明細の数で言えない決定のため）
});

export const Plan = z.object({
  schema: z.literal("moyai.plan/0"),
  planId: code,
  displayName: z.string(),
  packId: code,
  version: z.number().int().min(0),
  levelNames: z.array(z.string()), // 段の名前（計画が持つ。パックの段の名前は既定値）
  facility: Facility,
  assets: z.array(AssetNode),
  works: z.array(Work),
  details: z.array(WorkDetail),
  readingDecisions: z.array(ReadingDecision).optional(), // 答えた質問が無ければ置かない
  // 計量値の記録（運転時間・起動回数など。資産の節ごとの日付つきの値）。記録が無ければ置かない。きっかけの計量値の枝が読む（src/plan/next.ts）
  meters: z.array(z.object({ nodeKey: code, meter: z.string().min(1).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number() }).strict()).optional(),
});
export type Plan = z.infer<typeof Plan>;
export type AssetNodeT = z.infer<typeof AssetNode>;
export type WorkT = z.infer<typeof Work>;
export type WorkDetailT = z.infer<typeof WorkDetail>;
