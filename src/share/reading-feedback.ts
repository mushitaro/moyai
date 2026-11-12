// 読み方のフィードバックの書き出し（柱 C・S-C3。運営者の判断 #23 の 1、2026-11-12：道 A）。
// 会話で作った 3 段目の読み方（施設・担当・会社の rules.json）から、ルールの形と数だけを、人が押したときだけファイルにする。
// 入れるもの：規則の種類と、形の欄（列の見出しの字・役目・記号・日付の形・問いの種類と答え など）と、規則ごとの効いたセルの数。
// 入れないもの：ルールの文（text）・理由（reason）・決めた人の呼び名（by）・資料の名前の型（when.file）・規則の id・範囲・版・行の値。
// 出す前に固有名詞の網 2（その PC の語：施設名・表示名・業者・実施者）で照らし、1 つでも当たれば作らない（当たった語は返さない）。
// 網 3（原本のセルの文字）は使わない：見出しの字は、もともと原本のセルの字なので、網 3 では形の欄がどれも当たる。
// 行の値らしきもの（金額・日付・番号など）は、Issue に貼られたあと scripts/skill-loop/feedback.mjs がもう一度数える。
// 送るのは人（Issue に貼る・メールに添える）。この関数は通信しない。
import type { LoadedReading, ReadingRule } from "../import/reading";
import { countProperNouns } from "./recount";

export const READING_FEEDBACK_SCHEMA = "moyai.reading-feedback/0";

/** 規則の形の欄（種類ごと）。ここに無い欄は書き出さない */
const SHAPE_KEYS: Record<ReadingRule["kind"], readonly string[]> = {
  headerRow: ["row"],
  columnRole: ["column", "role"],
  dateFormat: ["column", "format"],
  effortUnit: ["column", "unit"],
  rowRole: ["match", "prefix", "role"],
  sameAsset: ["names"],
  markMeaning: ["symbol", "planOrActual", "meaning"],
  answer: ["question", "match", "answer"],
  effortTrade: ["words"],
  planCycle: ["commonItem", "attribute", "years"],
};

export interface ReadingFeedbackRule {
  kind: ReadingRule["kind"];
  [k: string]: unknown;
}

export interface ReadingFeedbackFile {
  schema: typeof READING_FEEDBACK_SCHEMA;
  pack: string;
  rules: ReadingFeedbackRule[];
  /** 規則ごとの効いたセルの数（rules と同じ並び。計画ルールは周期の案の印の数） */
  cells: number[];
}

/** 規則の形だけ（文・理由・人・資料の名前を除く） */
export function shapeOf(rule: ReadingRule): ReadingFeedbackRule {
  const out: ReadingFeedbackRule = { kind: rule.kind };
  const r = rule as unknown as Record<string, unknown>;
  for (const k of SHAPE_KEYS[rule.kind]) if (r[k] !== undefined) out[k] = r[k];
  if (rule.when?.headers?.length) out.when = { headers: [...rule.when.headers] };
  if (rule.replaces) out.replaces = true;
  return out;
}

export type ReadingFeedbackResult =
  | { ok: true; file: ReadingFeedbackFile; text: string }
  | { ok: false; reason: "noRules" }
  | { ok: false; reason: "properNoun"; hits: number };

/**
 * 書き出す中身を作る（人が押したときに呼ぶ。画面はこの text を全文見せてから保存する）。
 * readings：作業画面が当てている 3 段目の読み方。cellsOf：規則の id → 効いたセルの数。localWords：固有名詞の網 2 の語
 */
export function buildReadingFeedback(input: { pack: string; readings: readonly LoadedReading[]; cellsOf: (ruleId: string) => number; localWords: readonly string[] }): ReadingFeedbackResult {
  const seen = new Set<string>();
  const rules: ReadingFeedbackRule[] = [];
  const cells: number[] = [];
  for (const r of input.readings)
    for (const rule of r.skill.rules) {
      const shape = shapeOf(rule);
      const key = JSON.stringify(shape);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(shape);
      cells.push(Math.max(0, Math.trunc(input.cellsOf(rule.id))));
    }
  if (!rules.length) return { ok: false, reason: "noRules" };
  const file: ReadingFeedbackFile = { schema: READING_FEEDBACK_SCHEMA, pack: input.pack, rules, cells };
  const text = JSON.stringify(file, null, 2) + "\n";
  const pn = countProperNouns({ bundleText: text, fileName: "", folderPath: "", localWords: input.localWords, cells: [], publicWords: new Set() });
  if (pn.total > 0) return { ok: false, reason: "properNoun", hits: pn.total };
  return { ok: true, file, text };
}
