// セルの文字の書き方を読む小さな決まり（一般の性質だけ）：号・系列、工数、番号 1 / 1-1、名前の中の機器番号。
// 決まらないものは null を返し、呼ぶ側が質問にする。
import { nfkc } from "./era";
import { CUES, cue, escapeRe, norm } from "./cues";

// ─── 号・系列 ──────────────────────────────────────────────────

export type UnitValue =
  | { kind: "number"; n: number; spelling: string }
  | { kind: "common" }
  | { kind: "ditto" };

const UNIT_PREFIX = CUES.unit.numberPrefix.map((p) => escapeRe(nfkc(p))).join("|");
const UNIT_MARK = CUES.unit.numberMark.map((p) => escapeRe(nfkc(p))).join("|");
const RE_UNIT_PREFIX = new RegExp(`^(?:${UNIT_PREFIX})\\s*(\\d{1,3})\\s*(\\p{Script=Han}{0,2})$`, "u");
const RE_UNIT_MARK = new RegExp(`^(\\d{1,3})\\s*(?:${UNIT_MARK})\\s*(\\p{Script=Han}{0,2})$`, "u");
const UNIT_ORDINAL = CUES.unit.ordinalPrefix.map((p) => escapeRe(nfkc(p))).join("|");
// 「{数}{字}」（字は 2 つまで。「1系」「1系列」）。頭に順の字があってもよい（「第1系列」）
const RE_UNIT_HAN = new RegExp(`^(${UNIT_ORDINAL})?(\\d{1,3})(\\p{Script=Han}{1,2})$`, "u");

/** 号・系列の書き方を読む：「{数}号{字}」「No.{数}{字}」「{数}{字}」「第{数}{字}」・共通・〃（数は全角でもよい）。数の書き方の形（spelling）も返す */
export function parseUnit(text: string): UnitValue | null {
  const s = nfkc(text).replace(/\s+/g, "");
  if (!s) return null;
  if (cue.isDitto(s)) return { kind: "ditto" };
  if (cue.isCommon(s)) return { kind: "common" };
  let m = RE_UNIT_PREFIX.exec(s);
  if (m) return { kind: "number", n: Number(m[1]), spelling: `No.{n}${m[2] ?? ""}` };
  m = RE_UNIT_MARK.exec(s);
  if (m) return { kind: "number", n: Number(m[1]), spelling: `{n}号${m[2] ?? ""}` };
  m = RE_UNIT_HAN.exec(s);
  if (m) return { kind: "number", n: Number(m[2]), spelling: `${m[1] ?? ""}{n}${m[3] ?? ""}` };
  return null;
}

/** 文字の中の号・系列（名前の後ろの括弧など）。「名前（{数}号）」→ 数。見つからなければ null */
export function unitInText(text: string): number | null {
  const s = nfkc(text);
  const re = new RegExp(`(?:${UNIT_PREFIX})\\s*(\\d{1,3})|(\\d{1,3})\\s*(?:${UNIT_MARK})`, "gu");
  const found = new Set<number>();
  for (const m of s.matchAll(re)) found.add(Number(m[1] ?? m[2]));
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

// ─── 工数 ────────────────────────────────────────────────────

export type EffortValue = { amount: number; unit: "manDays" | "hours" | "persons" | "bare"; style: string };

const W = (xs: readonly string[]) => xs.map((x) => escapeRe(nfkc(x))).sort((a, b) => b.length - a.length).join("|");
const NUM = "(\\d+(?:\\.\\d+)?)";
const RE_MD = new RegExp(`^(?:${W(CUES.effort.totalPrefix)})?${NUM}(?:${W(CUES.effort.manDays)})$`, "i");
const RE_TOTAL_PERSONS = new RegExp(`^(?:${W(CUES.effort.totalPrefix)})${NUM}(?:${W(CUES.effort.persons)})$`, "i");
const RE_PERSONS = new RegExp(`^${NUM}(?:${W(CUES.effort.persons)})$`, "i");
const RE_HOURS = new RegExp(`^${NUM}(?:${W(CUES.effort.hours)})$`, "i");
const RE_BARE = new RegExp(`^${NUM}$`);

/**
 * 工数の書き方を読む。人・日／人工／延べ N 人は人・日の数（延べ人数は人・日を数えたもの）。
 * 時間は、1 人・日の時間が決まるまで人・日に直さない（呼ぶ側が質問にする）。
 * 「N 人」（延べが無い）は人数で、人・日ではない。数だけは単位が分からない。
 */
export function parseEffort(v: string | number): EffortValue | null {
  if (typeof v === "number") return Number.isFinite(v) ? { amount: v, unit: "bare", style: "数だけ" } : null;
  const s = nfkc(v).replace(/[\s　]+/g, "");
  let m = RE_MD.exec(s);
  if (m) return { amount: Number(m[1]), unit: "manDays", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_TOTAL_PERSONS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "manDays", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_HOURS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "hours", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_PERSONS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "persons", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_BARE.exec(s.replace(/,/g, ""));
  if (m) return { amount: Number(m[1]), unit: "bare", style: "数だけ" };
  // 時間と分（「192:00」「7:30」）：時間
  m = /^(\d{1,5}):([0-5]\d)$/.exec(s);
  if (m) return { amount: Number(m[1]) + Number(m[2]) / 60, unit: "hours", style: "{h}:{mm}" };
  return null;
}

// ─── 番号 1 / 1-1 / 1-1-1 ─────────────────────────────────────

/** 段の番号の深さ。「1」→1、「1-1」→2、「1.2.3」→3。番号でなければ null */
export function numberDepth(v: string | number): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? 1 : null;
  const s = nfkc(v).replace(/\s+/g, "");
  if (!/^\d{1,3}(?:[-.]\d{1,3})*$/.test(s)) return null;
  return s.split(/[-.]/).length;
}

// ─── 名前の中の機器番号 ───────────────────────────────────────

export interface TagSplit {
  name: string;
  tag: string;
  /** 書き方の形（質問をまとめる鍵）："末尾の括弧" か "頭の符号" */
  pattern: "trailingParen" | "leadingCode";
}

const RE_TAG_PAREN = /^(.+?)\s*[（(〔［[]\s*([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,6})*)\s*[)）〕］\]]$/;
const RE_TAG_LEAD = /^([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,6})*)\s+(\S.*)$/;

/** 名前の中の英大文字の符号（機器番号）の候補。決めるのは呼ぶ側（質問にする） */
export function splitTag(text: string): TagSplit | null {
  const s = nfkc(text).replace(/\s*\n\s*/g, " ").trim();
  let m = RE_TAG_PAREN.exec(s);
  if (m && m[1] && m[2]) return { name: m[1].trim(), tag: m[2], pattern: "trailingParen" };
  m = RE_TAG_LEAD.exec(s);
  if (m && m[1] && m[2] && /[^\x00-\x7f]/.test(m[2])) return { name: m[2].trim(), tag: m[1], pattern: "leadingCode" };
  return null;
}

/** 機器番号の末尾の数（「ABC-1」「AB1」→ 1）。無ければ null */
export function tagTrailingNumber(tag: string): number | null {
  const m = /-(\d{1,3})$/.exec(tag) ?? /[A-Z](\d{1,3})$/.exec(tag);
  return m ? Number(m[1]) : null;
}

/** 名前を比べるための形（NFKC・空白なし・括弧の全角半角をそろえる） */
export function nameKey(s: string): string {
  return norm(s).replace(/[（]/g, "(").replace(/[）]/g, ")");
}

/** 記号らしい短い文字か（凡例・印のセル） */
export function isSymbolLike(s: string): boolean {
  const t = nfkc(s).trim();
  if (!t || t.length > 3) return false;
  return !/[0-9A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t);
}

export { norm };
