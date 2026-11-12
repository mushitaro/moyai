// 読み方のフィードバックの書き出し（柱 C・S-C3。運営者の判断 #23 の 1、2026-11-12：道 A。絵は Wire Frame の「ReadingOut」）。
// 会話で作った 3 段目の読み方（施設・担当・会社の rules.json）から、ルールの形と数だけを、人が押したときだけファイルにする。
// 入れるもの：規則の種類と、形の欄（列の見出しの字・役目・記号・日付の形・問いの種類と答え など）と、規則ごとの効いたセルの数（cells）。
// 入れないもの：ルールの文（text）・理由（reason）・決めた人の呼び名（by）・資料の名前の型（when.file）・規則の id・範囲・版・行の値。
// 出す前に固有名詞の網 2（その PC の語：施設名・表示名・業者・実施者）で照らし、1 つでも当たれば作らない（当たった語は返さない）。
//   画面は localHits（この下。数え方は src/share/recount.ts の countProperNouns の網 2 と同じ）で理由の 1 行を出し、
//   保存の経路（人だけ。src/bridge/human.ts の reading_feedback_save）は countProperNouns でもう一度照らし、形を parseReadingFeedback で確かめる。
// 網 3（原本のセルの文字）は使わない：見出しの字は、もともと原本のセルの字なので、網 3 では形の欄がどれも当たる。
// 行の値らしきもの（金額・日付・番号など）は、Issue に貼られたあと scripts/skill-loop/feedback.mjs がもう一度数える。
// 送るのは人（Issue に貼る・メールに添える）。ここは通信しない。画面でも読むので node: のものを使わない。
import { z } from "zod";
import { ReadingRule, type LoadedReading } from "../import/reading";

export const READING_FEEDBACK_SCHEMA = "moyai.reading-feedback/0";
/** 書き出しの上限（規則の数）。3 段目の読み方の上限と同じ */
const MAX_RULES = 500;

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
  /** 効いたセルの数（計画ルールは周期の案の印の数） */
  cells: number;
  [k: string]: unknown;
}

export interface ReadingFeedbackFile {
  schema: typeof READING_FEEDBACK_SCHEMA;
  pack: string;
  rules: ReadingFeedbackRule[];
}

/** 規則の形だけ（文・理由・人・資料の名前を除く） */
export function shapeOf(rule: ReadingRule): { kind: ReadingRule["kind"]; [k: string]: unknown } {
  const out: { kind: ReadingRule["kind"]; [k: string]: unknown } = { kind: rule.kind };
  const r = rule as unknown as Record<string, unknown>;
  for (const k of SHAPE_KEYS[rule.kind]) if (r[k] !== undefined) out[k] = r[k];
  if (rule.when?.headers?.length) out.when = { headers: [...rule.when.headers] };
  if (rule.replaces) out.replaces = true;
  return out;
}

export type ReadingFeedbackResult = { ok: true; file: ReadingFeedbackFile; text: string } | { ok: false; reason: "noRules" } | { ok: false; reason: "properNoun"; hits: number };

/**
 * 固有名詞の網 2 で、その PC の語が書き出す字に何回当たるか（語そのものは返さない）。
 * 数え方は countProperNouns の網 2 と同じ：NFKC・小文字にそろえ、2 文字未満・数だけの語は照らさない。
 */
export function localHits(text: string, words: readonly string[]): number {
  const hay = text.normalize("NFKC").toLowerCase();
  let n = 0;
  for (const raw of words) {
    const w = raw.normalize("NFKC").trim().toLowerCase();
    if (w.length < 2 || /^[\d\s.,:/-]+$/.test(w)) continue;
    if (hay.includes(w)) n++;
  }
  return n;
}

/** 固有名詞の網 2 の語：計画の施設名・表示名・業者・実施者（src/share/checkpoint.ts の properNounSources と同じ語） */
export function localWordsOf(plan: { facility: { name: string }; displayName: string; works: readonly { contractor?: string | null }[]; details: readonly { performer?: string | null }[] } | null): string[] {
  if (!plan) return [];
  const s = new Set<string>([plan.facility.name, plan.displayName]);
  for (const w of plan.works) if (w.contractor) s.add(w.contractor);
  for (const d of plan.details) if (d.performer) s.add(d.performer);
  return [...s].filter((w) => w.trim().length > 0);
}

/**
 * 書き出す中身を作る（画面はこの text を全文見せてから、人が「保存する」を押したときだけ保存の経路に渡す）。
 * readings：作業画面が当てている 3 段目の読み方。cellsOf：規則の id → 効いたセルの数。localWords：固有名詞の網 2 の語
 */
export function buildReadingFeedback(input: { pack: string; readings: readonly LoadedReading[]; cellsOf: (ruleId: string) => number; localWords: readonly string[] }): ReadingFeedbackResult {
  const seen = new Set<string>();
  const rules: ReadingFeedbackRule[] = [];
  for (const r of input.readings)
    for (const rule of r.skill.rules) {
      const shape = shapeOf(rule);
      const key = JSON.stringify(shape);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ ...shape, cells: Math.max(0, Math.trunc(input.cellsOf(rule.id) || 0)) });
    }
  if (!rules.length) return { ok: false, reason: "noRules" };
  const file: ReadingFeedbackFile = { schema: READING_FEEDBACK_SCHEMA, pack: input.pack, rules: rules.slice(0, MAX_RULES) };
  const text = JSON.stringify(file, null, 2) + "\n";
  const hits = localHits(text, input.localWords);
  if (hits > 0) return { ok: false, reason: "properNoun", hits };
  return { ok: true, file, text };
}

const FileShape = z.object({ schema: z.literal(READING_FEEDBACK_SCHEMA), pack: z.string().regex(/^[a-z0-9-]{1,60}$/), rules: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_RULES) }).strict();

/**
 * 保存の経路が受けた字を確かめる：moyai.reading-feedback/0 の形で、どの規則も形の欄と cells だけを持ち、
 * 形の欄が moyai.reading/0 の規則として読めること。文・理由・人・資料の名前・id の欄が 1 つでもあれば受けない
 */
export function parseReadingFeedback(text: string): ReadingFeedbackFile | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const f = FileShape.safeParse(v);
  if (!f.success) return null;
  const rules: ReadingFeedbackRule[] = [];
  for (const r of f.data.rules) {
    const kind = r.kind as ReadingRule["kind"];
    const keys = SHAPE_KEYS[kind];
    if (!keys) return null;
    const allowed = new Set(["kind", "cells", "when", "replaces", ...keys]);
    if (Object.keys(r).some((k) => !allowed.has(k))) return null;
    if (typeof r.cells !== "number" || !Number.isInteger(r.cells) || r.cells < 0) return null;
    if (r.when !== undefined && (typeof r.when !== "object" || r.when === null || Object.keys(r.when).some((k) => k !== "headers"))) return null;
    const { cells: _cells, ...shape } = r;
    if (!ReadingRule.safeParse({ ...shape, id: "x", text: "x", author: "ai", reason: "x" }).success) return null;
    rules.push(r as ReadingFeedbackRule);
  }
  return { schema: READING_FEEDBACK_SCHEMA, pack: f.data.pack, rules };
}

/** 保存するファイルの名前：日付（東京）と中身のハッシュの頭。施設の名前は入れない */
export function feedbackFileName(ymd: string, sha256: string): string {
  return `ルール_${ymd}_${sha256.slice(0, 8)}.json`;
}
