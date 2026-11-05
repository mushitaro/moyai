// F3 Skill の採点の型（docs/plan.md §2.10）。問題・答え・採点・記録の形をここ 1 か所に置く。
// モデルの識別子はどの型にも持たない（config/models.json の項目名とハッシュだけ）。

export const SUITE_SCHEMA = "moyai.eval.suite/0";
export const CASE_SCHEMA = "moyai.eval.case/0";
export const MANIFEST_SCHEMA = "moyai.eval.manifest/0";
export const RESULT_SCHEMA = "moyai.eval.result/0";
export const REPORT_SCHEMA = "moyai.eval.report/0";

/** コードの採点 6 種。 */
export const GRADERS = ["json", "no_guess", "identity", "source", "fiscal_year", "not_in_record"] as const;
export type GraderId = (typeof GRADERS)[number];

export const GRADER_NAMES: Record<GraderId, string> = {
  json: "JSON として読めるか",
  no_guess: "周期や工数などを推測で埋めていないか（記録にある値は合っているか）",
  identity: "番号の違う機器を名前でまとめていないか（対象の集合が正解と同じか）",
  source: "出典がパックの一覧の中にあるか",
  fiscal_year: "年度の始まりがパックどおりか（年度が正解と同じか）",
  not_in_record: "記録に無いことを「記録に無い」と言えたか",
};

export type Split = "train" | "test";

/** 1 つの確かめ。key が無いものは答え全体を見る（json・source の全体）。 */
export interface Check {
  grader: GraderId;
  key?: string;
  expect?: unknown;
}

export interface EvalCase {
  schema: typeof CASE_SCHEMA;
  id: string;
  rule: string;
  split: Split;
  /** 分け方：期間（作業の年度）か、年度を持たない問いの番号か。 */
  splitBy: "period" | "index";
  anchorFy: number | null;
  /** 記録の抜き書き（データ）。 */
  record: string;
  /** 問い（キーと値の型を含む）。 */
  question: string;
  keys: string[];
  checks: Check[];
  /** 正規化した本文（記録＋問い）のハッシュ。 */
  hash: string;
}

export interface RuleInfo {
  id: string;
  name: string;
  graders: GraderId[];
}

export interface Suite {
  schema: typeof SUITE_SCHEMA;
  name: string;
  pack: string;
  /** 正解の世界のフォルダ（リポジトリの根から）。固有名詞を数える語の一覧はここから作る。 */
  world: string;
  fiscalYearStartMonth: number;
  /** パックの出典の URL（source の採点の正解の一覧）。 */
  packSourceUrls: string[];
  rules: RuleInfo[];
  counts: { train: number; test: number; duplicatesRemoved: number };
  /** 世界のデータから作れなかった問い（黙って捨てず、数と理由を残す）。 */
  missing: { rule: string; index: number; reason: string }[];
  splitNote: string;
  /** 試験用の問題の本文のハッシュ。調整する側の入力（Skill の新しい版）に入っていれば走らせない。 */
  testHashes: string[];
  /** 送る文の決まった部分のハッシュ。 */
  preambleHash: string;
  answerFormatHash: string;
  /** 作ったときに数えた固有名詞の当たり（0 でなければ作らない）。 */
  properNounHits: number;
  generator: { seed: number; version: number };
}

/** 答えの形（モデルが返す JSON）。 */
export interface Answer {
  answers: Record<string, unknown>;
  notInRecord: string[];
  sources: string[];
}

export interface CheckResult {
  grader: GraderId;
  key: string | null;
  pass: boolean;
}

export interface Grade {
  pass: boolean;
  parsed: boolean;
  checks: CheckResult[];
  /**
   * 診断（合否には入れない）：形で落ちた答え（JSON の後に説明の文を足したなど）から、最初の JSON だけを取り出して採点したら通ったか。
   * 形で落ちていない答えは null。
   */
  contentPass: boolean | null;
}

/** 集計から外す理由（docs/plan.md §2.10）。 */
export type Excluded = "switched" | "refusal" | "max_tokens" | "error";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ResultRow {
  schema: typeof RESULT_SCHEMA;
  runId: string;
  caseId: string;
  rule: string;
  split: Split;
  attempt: number;
  at: string;
  /** 応答のモデルが頼んだものと同じだったか（識別子の文字は書かない）。 */
  modelMatched: boolean | null;
  switched: boolean;
  stopReason: string | null;
  excluded: Excluded | null;
  /** 誤りのとき：HTTP の状態か誤りの種類だけ（本文は書かない）。 */
  error: string | null;
  usage: Usage;
  costUsd: number;
  ms: number;
  text: string | null;
  grade: Grade | null;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  runId: string;
  createdAt: string;
  finishedAt: string | null;
  status: "dry-run" | "running" | "done" | "stopped";
  stopNote: string | null;
  suite: string;
  suiteHash: string;
  split: Split | "all";
  rules: string[] | null;
  perRule: number | null;
  limit: number | null;
  repeat: number;
  cases: number;
  calls: number;
  skill: { path: string; sha256: string; label: string | null; author: string | null };
  /** config/models.json の項目名とその中身のハッシュ（識別子は書かない）。 */
  modelRole: string;
  modelRoleHash: string;
  effort: string;
  maxTokens: number;
  systemHash: string;
  answerFormatHash: string;
  outbound: { chars: number; properNounHits: number; file: string };
  estimateUsd: number;
  maxUsd: number | null;
  costUsd: number;
  base: string | null;
}
