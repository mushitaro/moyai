// 検査の画面の言葉（docs/plan.md §2.14）。AI のツール（check_results）の結果の文も、ここの言葉で作る（画面と同じ言い方にするため）。
// 業種の言葉（検査の名前・何を見るか・出典の名前・尺度の名前）は置かない。それはSkillパックの checks.json と sources.json から出る。
import type { CheckExample, CheckOutcome, CheckResult, NotApplicableWhy, NumberKey } from "../../review/checks";
import type { CheckKind, CheckLevel, ChecksLoadProblem, ThresholdOrigin } from "../../review/spec";
import { fieldDef, type FieldRef } from "../../shared/fields";

const fy = (n: number) => `${n} 年度`;
const fieldLabel = (ref: string) => {
  try {
    return fieldDef(ref as FieldRef).label;
  } catch {
    return ref;
  }
};

export const REVIEW_TEXT = {
  title: "検査",
  back: "画面へ",
  /** AI のツールの結果（check_results）に添える。画面には出さない（運営者、2026-11-04） */
  notice: "自己点検であって、審査の判断ではない",
  noticeBody: "Skillパックの基準から外れた所を、根拠の数字と出典つきで出します。直すかどうかを決めるのは人です。",
  noPlan: "検査する計画がまだありません。取り込みの画面で資料を入れ、計画を作ってください。",
  toIntake: "取り込みへ",
  noChecks: "この計画のSkillパックには、検査がまだありません（未実装）。",
  invalid: "Skillパックの検査を読めませんでした。Skillパックを直すまで、検査は走りません。",
  loadProblem: {
    checksInvalid: "検査の書き方の形が違う",
    sourcesInvalid: "出典の一覧の形が違う",
    packMismatch: "検査と出典の一覧のSkillパックが違う",
    sourceMissing: "検査の出典が、出典の一覧に無い",
    sourceNotVerified: "要件か推奨の検査の出典が、原典で照らされていない",
    duplicateId: "検査の ID が重なる",
  } satisfies Record<ChecksLoadProblem, string>,
  plan: "計画",
  referenceDate: "基準日",
  referenceDateHelp: "この日で走らせます（AI が読む結果も同じ日）。年度だけの印は、その年度が終わってから「過ぎた」とします",
  referenceDateInvalid: "日付の形（年-月-日）で入れてください",
  referenceFiscalYear: (n: number) => `基準日の年度：${fy(n)}`,
  checksVersion: (n: number) => `Skillパックの検査の版：${n}`,
  // MERGE の検査のシート（Wire、2026-11-05）
  kindSwitch: "検査の結果",
  kinds: { notMet: "外れ", met: "満たす", notApplicable: "当てはまらない" } satisfies Record<CheckOutcome, string>,
  changeDate: "変える",
  cols: ["", "検査", "機器", "この施設", "基準", "出典"],
  withinYears: (n: number) => `${n} 年以内`,
  years: (n: number) => `${n} 年`,
  notMetCount: (n: number) => `外れ ${n}`,
  here: "この施設",
  standard: "基準",
  toChart: "星取表で見る",
  openSource: "出典を開く",
  summary: (met: number, notMet: number, na: number) => `満たす ${met} ／ 外れがある ${notMet} ／ 当てはまらない ${na}`,
  result: { met: "満たす", notMet: "外れがある", notApplicable: "当てはまらない" } satisfies Record<CheckOutcome, string>,
  level: {
    requirement: "要件（法令・補助の要件）",
    recommendation: "推奨（要領・ガイドラインの例）",
    app: "アプリの目安",
  } satisfies Record<CheckLevel, string>,
  levelLabel: "水準",
  thresholdLabel: "閾値の出どころ",
  threshold: { source: "出典", app: "アプリの目安" } satisfies Record<ThresholdOrigin, string>,
  verificationLabel: "確かめた度合い",
  noSource: "出典なし（アプリの目安）",
  sourceLabel: "出典",
  sourceText: (document: string, clause: string, page: string | null) => [document, clause, page].filter((x) => x).join(" · "),
  numbersLabel: "根拠の数字",
  examplesLabel: (shown: number, all: number) => (all > shown ? `例（${all} 件のうち ${shown} 件）` : `例（${all} 件）`),
  noExamples: "外れはありません。",
  exampleCols: { node: "機器（段の道）", years: "年度", what: "中身" },
  wholePlan: "計画の全体",
  notApplicable: {
    noTargets: "見る対象が計画に無い",
    noPastPlans: "過ぎた予定が無い",
    noFuturePlans: "これからの予定が計画に無い（期間が決まらない）",
    noDetails: "記録が無い",
    noValues: "判定の値のある記録が無い",
  } satisfies Record<NotApplicableWhy, string>,
  unimplementedLabel: "未実装",
  noteLabel: "補足",
  whatLabel: "見ること",
  notMadeTitle: "このSkillパックで作っていない検査",
  codeUnimplementedTitle: "検査の仕組みで、まだ無いもの（未実装）",
  codeUnimplemented: [
    "延長の承認の記録の置き場（人だけの画面）。今は、どの延長も承認の記録が無いものとして「外れがある」にします",
    "きっかけ（周期）から次回を出して期限と比べること。取り込んだ計画のきっかけの欄が空なので、次回は予定の印だけで見ます",
  ],
  granularity: "年度だけの印は、年度の差で数えています（年度の粒度）",
  pathSep: " › ",
  aiRead: (n: number, date: string) => `AI が検査の結果を読みました（${n} 件、基準日 ${date}）`,
} as const;

/** 根拠の数字の名前。見た数は種類ごとに、何を数えたかを言う */
export function numberLabel(key: NumberKey, kind: CheckKind): string {
  if (key.startsWith("missing.")) return `${fieldLabel(key.slice("missing.".length))}が空の数`;
  const examined: Record<CheckKind, string> = {
    interval_max: "見た機器の数",
    next_due: "見た過ぎた予定の数（機器ごと）",
    coverage: "見た機器の数",
    record_fields: "見た記録の数",
    followup: "見た悪い判定の数（機器ごと）",
    plan_fields: "見た作業の数",
    plan_horizon: "見た計画の数",
    scale_valid: "見た判定の値の数",
  };
  const labels: Record<Exclude<NumberKey, `missing.${string}`>, string> = {
    referenceFiscalYear: "基準日の年度",
    thresholdYears: "閾値の年数",
    extensionCapYears: "延長の上限の年数",
    examined: examined[kind],
    notMet: "外れの数",
    intervals: "見た間の数",
    longestYears: "いちばん長い間（年度の差）",
    approvedExtensions: "承認のある延長の数",
    fromFiscalYear: "期間の始まりの年度",
    toFiscalYear: "期間の終わりの年度",
    horizonYears: "計画の年数（年度）",
    dateless: "年度だけの印の数",
  };
  return labels[key as Exclude<NumberKey, `missing.${string}`>] ?? key;
}

/** 根拠の数字の値（null は「定め無し」か「無し」） */
export function numberValue(key: NumberKey, v: number | null | undefined): string {
  if (v === null || v === undefined) return key === "extensionCapYears" ? "定め無し（延長しない）" : "無し";
  return String(v);
}

/** 例の中身の文（数と年度だけ。名前は段の道の欄に出す） */
export function exampleText(e: CheckExample, r: Pick<CheckResult, "kind" | "numbers">): string {
  const [a, b] = e.fiscalYears;
  switch (e.why) {
    case "gap":
      return `${fy(a!)} → ${fy(b!)}：間が ${e.years} 年度（閾値 ${r.numbers.thresholdYears} 年）`;
    case "gapToEnd":
      return `${fy(a!)} のあと、${fy(a! + e.years!)} まで ${e.years} 年度、実施も予定も無い（閾値 ${r.numbers.thresholdYears} 年）`;
    case "never":
      return "実施も、これからの予定も無い";
    case "extensionNotApproved":
      return `${e.fiscalYears.map(fy).join(" → ")}：間が ${e.years} 年度。延長の上限の内だが、承認の記録が無い`;
    case "noActual":
      return `${fy(a!)} の予定${e.value ? `（${e.value}）` : ""}に、実績が無い`;
    case "noPlanInHorizon":
      if (r.kind === "plan_horizon") return a === undefined ? "これからの予定が無い（0 年度）" : `${fy(a)}〜${fy(b!)}：${e.years} 年度（閾値 ${r.numbers.thresholdYears} 年度）`;
      return `${fy(a!)}〜${fy(b!)} に予定が無い`;
    case "missingFields":
      return `空の欄：${e.fields.map(fieldLabel).join("・")}${a !== undefined ? `（${fy(a)} からの作業）` : ""}`;
    case "outOfScale":
      return `${fy(a!)} の判定の値「${e.value}」が、尺度の段に無い`;
    case "noFollowup":
      return `${fy(a!)} の判定「${e.value}」のあとに、要る作業（計画か実績）が無い`;
  }
}
