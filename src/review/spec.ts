// 検査の書き方（パックの checks.json）と、出典の一覧（sources.json）の型（docs/plan.md §2.4）。
// 種類はコードの閉じた一覧（shared/tools.ts の CHECK_KINDS）。パックが書くのは、どの種類を、どの項目に、どの値で当てるかだけ。
// 水準が requirement・recommendation の検査は、出典が「原典照合済」のときだけ読み込む（照らしたものだけを要件や推奨にする）。
// 通らないパックは読み込まず、理由を返す（画面がそのまま出す）。業種の語はここに置かない（パックのデータにある）。
import { z } from "zod";
import { WORK_ATTRIBUTES } from "../shared/fields";
import { CHECK_KINDS, VERIFICATION_LEVELS } from "../shared/tools";

export type CheckKind = (typeof CHECK_KINDS)[number];
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** 水準：requirement 法令・補助の要件／recommendation 要領・ガイドラインの例／app アプリの目安 */
export const CHECK_LEVELS = ["requirement", "recommendation", "app"] as const;
export type CheckLevel = (typeof CHECK_LEVELS)[number];
/** 閾値の出どころ：出典／アプリの目安 */
export const THRESHOLD_ORIGINS = ["source", "app"] as const;
export type ThresholdOrigin = (typeof THRESHOLD_ORIGINS)[number];

/** 作業を選ぶ条件（規則の形の条件と同じ、欄 × 比べ方 × 値の組。欄は作業の種類か作業の属性だけ。文字は NFKC でそろえて比べる） */
export const workConditionSchema = z.object({
  field: z.enum(["work.kind", "work.attribute"]),
  op: z.enum(["equals", "in", "contains", "prefix"]),
  values: z.array(z.string().min(1).max(200)).min(1).max(20),
});
export type WorkCondition = z.infer<typeof workConditionSchema>;
const works = z.array(workConditionSchema).max(5);

/** 記録の欄（record_fields が見るもの。計画の型の作業明細にある欄だけ） */
export const RECORD_FIELDS = ["startDate", "endDate", "resultValue", "measuredValue", "previousValue"] as const;
/** 計画表の列（plan_fields が見るもの。計画の型の作業にある欄だけ） */
export const PLAN_FIELDS = ["strategy", "trigger"] as const;

const years = z.number().int().min(1).max(100);
const scaleValues = z.array(z.string().min(1).max(20)).min(1).max(20);

/** 種類ごとの値。種類を足すときは、ここと checks.ts の関数と試験を足す */
const params = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interval_max"),
    /** この作業の対象の機器ごとに、実施の間（年度の差）がこの年数を越えないか */
    works: works.min(1),
    years,
    /** 承認による延長の上限（年数）。null は延長の定めが無い（承認があっても延長しない） */
    extensionCapYears: years.nullable(),
  }),
  z.object({
    kind: z.literal("next_due"),
    /** 次回の期限の出どころ。今は計画の予定の印だけ（きっかけの枝から出す次回は未実装。計画の型のきっかけが空のため） */
    due: z.literal("plan_mark"),
    works,
  }),
  z.object({
    kind: z.literal("coverage"),
    /** 1 段目に当てて人が受けた機器のすべてに、計画の期間（基準日の年度から、計画にある最後の予定の年度まで）の予定が 1 つ以上あるか */
    needs: z.literal("plan_in_horizon"),
  }),
  z.object({
    kind: z.literal("record_fields"),
    of: z.enum(["actual", "plan", "both"]),
    fields: z.array(z.enum(RECORD_FIELDS)).min(1),
    works,
  }),
  z.object({
    kind: z.literal("followup"),
    /** 判定の尺度の名前（作業明細の判定の尺度が空か、この名前のものを見る） */
    scale: z.string().min(1).max(40),
    /** この値の判定のあとに、同じ機器に、どの作業の属性の作業（計画か実績）が要るか */
    rules: z.array(z.object({ values: scaleValues, needs: z.array(z.enum(WORK_ATTRIBUTES)).min(1) })).min(1).max(10),
  }),
  z.object({
    kind: z.literal("plan_fields"),
    /** 1 段目に当てて人が受けた機器（とその下の節）の作業に、これらの列があるか */
    fields: z.array(z.enum(PLAN_FIELDS)).min(1),
  }),
  z.object({
    kind: z.literal("plan_horizon"),
    /** 基準日の年度から、計画にある最後の予定の年度までが、この年数以上あるか */
    years,
  }),
  z.object({
    kind: z.literal("scale_valid"),
    scale: z.string().min(1).max(40),
    values: scaleValues,
  }),
]);

export const checkSpecSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9-]{2,40}$/),
    /** 画面と結果に出す名前と、何を見るかの文（パックの言葉） */
    name: z.string().min(1).max(80),
    what: z.string().min(1).max(400),
    level: z.enum(CHECK_LEVELS),
    thresholdOrigin: z.enum(THRESHOLD_ORIGINS),
    /** 出典（sources.json の id と条項・頁）。アプリの目安で出典が無いものだけ null */
    source: z.object({ id: z.string().min(1), clause: z.string().min(1).max(200), page: z.string().max(100).nullable() }).nullable(),
    /** 出典のうち、計画の型に欄が無いなどで見られない所（無ければ null）。画面に「未実装」として出す */
    unimplemented: z.string().max(400).nullable(),
    /** 閾値の決め方などの補足 */
    note: z.string().max(600).nullable(),
    params,
  })
  .superRefine((c, ctx) => {
    if (c.level !== "app" && c.source === null) ctx.addIssue({ code: "custom", path: ["source"], message: "要件と推奨には出典が要る" });
    if (c.thresholdOrigin === "source" && c.source === null) ctx.addIssue({ code: "custom", path: ["source"], message: "閾値の出どころが出典なら、出典が要る" });
  });
export type CheckSpec = z.infer<typeof checkSpecSchema>;
export type CheckParams = CheckSpec["params"];

export const packChecksSchema = z.object({
  schema: z.literal("moyai.checks/0"),
  pack: z.string().min(1),
  /** 検査を直したら上げる */
  version: z.number().int().min(1),
  checks: z.array(checkSpecSchema).min(1).max(50),
  /** 候補にあったが、このパックで作っていない検査と、その理由 */
  notMade: z.array(z.object({ what: z.string().min(1), why: z.string().min(1) })).max(20),
});
export type PackChecks = z.infer<typeof packChecksSchema>;

/** sources.json のうち、検査が使う欄だけ */
export const packSourcesSchema = z.object({
  schema: z.literal("moyai.sources/0"),
  pack: z.string().min(1),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      url: z.string().url(),
      state: z.enum(VERIFICATION_LEVELS),
    }),
  ),
});
export type PackSources = z.infer<typeof packSourcesSchema>;

export type LoadedChecks = { ok: true; checks: PackChecks; sources: PackSources } | { ok: false; reason: ChecksLoadProblem; detail: string };
export type ChecksLoadProblem = "checksInvalid" | "sourcesInvalid" | "packMismatch" | "sourceMissing" | "sourceNotVerified" | "duplicateId";

/**
 * パックの検査を読む。形が違う・出典が一覧に無い・要件や推奨の出典が原典照合済でない・ID が重なる、のどれかなら読まない。
 * detail は検査の ID か出典の ID（画面に出す）。
 */
export function loadPackChecks(checksJson: unknown, sourcesJson: unknown): LoadedChecks {
  const c = packChecksSchema.safeParse(checksJson);
  if (!c.success) return { ok: false, reason: "checksInvalid", detail: c.error.issues.map((i) => i.path.join(".")).join("、") };
  const s = packSourcesSchema.safeParse(sourcesJson);
  if (!s.success) return { ok: false, reason: "sourcesInvalid", detail: s.error.issues.map((i) => i.path.join(".")).join("、") };
  if (c.data.pack !== s.data.pack) return { ok: false, reason: "packMismatch", detail: `${c.data.pack} / ${s.data.pack}` };
  const ids = new Set<string>();
  for (const k of c.data.checks) {
    if (ids.has(k.id)) return { ok: false, reason: "duplicateId", detail: k.id };
    ids.add(k.id);
    if (k.source === null) continue;
    const src = s.data.sources.find((x) => x.id === k.source!.id);
    if (!src) return { ok: false, reason: "sourceMissing", detail: `${k.id}：${k.source.id}` };
    if (k.level !== "app" && src.state !== "原典照合済") return { ok: false, reason: "sourceNotVerified", detail: `${k.id}：${k.source.id}` };
  }
  return { ok: true, checks: c.data, sources: s.data };
}
