// 読み方（3 段目の Skill の規則。docs/plan.md §2.17）。会期中は決まった形の規則だけ（任意のコードは承認する人が読めないので、会期の後）。
// 規則は、利用者と Claude が会話で決めて置くか、利用者が手で書く。読み手（層 2・3）はデータとして当て、規則で決まったものは質問にしない。
// どの資料に効くかは、見出しの文字の並び（様式）と、資料の名前の型で決める。純粋な関数。
import { z } from "zod";
import { norm } from "./cues";

export const READING_SCHEMA = "moyai.reading/0";

/** 列は見出しの文字で指す（「作業日」「延工数(h)」）。末尾の括弧は除いて比べる */
const column = z.string().min(1).max(60);

export const COLUMN_ROLES = ["date", "end", "tag", "effort", "days", "assetRef", "workName", "unit", "number", "remark", "exclude"] as const;
export const DATE_FORMATS = ["yyyymmdd", "yymmdd", "md"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  /** 人の言葉の 1 文（体言止めか「〜として読む」。名前は「」で囲む） */
  text: z.string().min(1).max(200),
  /** どの資料に効くか。見出しの文字（どれもシートにあること）と、資料の名前の型（* を使える）。省くとどの資料にも */
  when: z
    .object({
      headers: z.array(z.string().min(1).max(60)).max(12).optional(),
      file: z.string().min(1).max(120).optional(),
    })
    .strict()
    .optional(),
  author: z.enum(["ai", "human"]),
  /** 決めた人の呼び名（人のとき） */
  by: z.string().max(40).optional(),
  reason: z.string().min(1).max(500),
  /** 下の段（業界のパック・基本）の同じ種類の決まりを置き換えるときだけ true */
  replaces: z.boolean().optional(),
};

export const ReadingRule = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("headerRow"), row: z.number().int().min(1).max(200) }).strict(),
  z.object({ ...base, kind: z.literal("columnRole"), column, role: z.enum(COLUMN_ROLES) }).strict(),
  z.object({ ...base, kind: z.literal("dateFormat"), column, format: z.enum(DATE_FORMATS) }).strict(),
  z.object({ ...base, kind: z.literal("effortUnit"), column, unit: z.enum(["manDays", "hours"]) }).strict(),
  z.object({ ...base, kind: z.literal("rowRole"), match: z.string().min(1).max(60), role: z.enum(["total", "subtotal", "note"]) }).strict(),
  z.object({ ...base, kind: z.literal("sameAsset"), names: z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]) }).strict(),
  z.object({ ...base, kind: z.literal("markMeaning"), symbol: z.string().min(1).max(8), planOrActual: z.enum(["plan", "actual"]), meaning: z.string().max(40).optional() }).strict(),
  z.object({ ...base, kind: z.literal("answer"), question: z.string().min(1).max(40), match: z.string().min(1).max(120), answer: z.string().min(1).max(60) }).strict(),
]);
export type ReadingRule = z.infer<typeof ReadingRule>;

export const READING_SCOPES = ["facility", "person", "company"] as const;
export type ReadingScope = (typeof READING_SCOPES)[number];

export const ReadingSkill = z
  .object({
    schema: z.literal(READING_SCHEMA),
    name: z.string().min(1).max(80),
    scope: z.enum(READING_SCOPES),
    rules: z.array(ReadingRule).max(500),
  })
  .strict();
export type ReadingSkill = z.infer<typeof ReadingSkill>;

/** セッションに渡す読み方：中身と、どこの何版か、承認済みか、作業中の下書きか */
export interface LoadedReading {
  skill: ReadingSkill;
  /** 版（中身のハッシュ。署名した版はこれを記録する） */
  version: string;
  /** 保管先からの道（作業中の下書きは null） */
  path: string | null;
  approved: boolean;
  /** 作業中の版に置いた下書き（reading_rules_propose） */
  draft: boolean;
}

/** 当てる規則と、その出どころ */
export interface ActiveRule {
  rule: ReadingRule;
  from: { name: string; version: string; scope: ReadingScope; approved: boolean; draft: boolean };
}

const SCOPE_ORDER: Record<ReadingScope, number> = { facility: 0, person: 1, company: 2 };

/** 効く順（施設 → 担当 → 会社）に並べた規則。同じ種類・同じ対象の規則は、先のものが効く */
export function activeRules(readings: readonly LoadedReading[]): ActiveRule[] {
  return [...readings]
    .sort((a, b) => SCOPE_ORDER[a.skill.scope] - SCOPE_ORDER[b.skill.scope] || Number(b.draft) - Number(a.draft))
    .flatMap((r) => r.skill.rules.map((rule) => ({ rule, from: { name: r.skill.name, version: r.version, scope: r.skill.scope, approved: r.approved, draft: r.draft } })));
}

/** 規則の作者の理由（決定の理由に使う）：「読み方「名前」版 xxxx xxxx の規則：1 文」 */
export function ruleReason(a: ActiveRule): string {
  return `読み方「${a.from.name}」版 ${shortVersion(a.from.version)} の規則：${a.rule.text}`;
}

/** 版の見せ方：4 文字 × 2 組（a1b2 c3d4） */
export function shortVersion(v: string): string {
  return v === "" ? "―" : `${v.slice(0, 4)} ${v.slice(4, 8)}`;
}

/** 列の見出しが、規則の列の名前と同じか（末尾の括弧を除き、空白をそろえる） */
export function sameColumn(header: string, ruleColumn: string): boolean {
  const strip = (s: string) => norm(s).replace(/[(（〔［[【][^()（）〔〕［］[\]【】]*[)）〕］\]】]$/u, "");
  const h = header.split(" / ").map(strip);
  const want = strip(ruleColumn);
  return h.includes(want) || strip(header) === want;
}

/** 規則がその資料（シート）に効くか：資料の名前の型と、見出しの文字がどれもシートにあること */
export function ruleApplies(rule: ReadingRule, file: string, sheetTexts: ReadonlySet<string>): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.file) {
    const re = new RegExp(`^${w.file.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "u");
    if (!re.test(file) && !re.test(file.split("/").pop() ?? file)) return false;
  }
  return (w.headers ?? []).every((h) => sheetTexts.has(norm(h)));
}

/** 年月日の書き方で日付を読む（yyyymmdd・yymmdd は数の並び。md は呼ぶ側が年度から年を付ける）。読めなければ null */
export function parseWithFormat(text: string, format: DateFormat): { y: number | null; m: number; d: number } | null {
  const s = norm(text);
  const valid = (y: number | null, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null);
  if (format === "yyyymmdd") {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    return m ? valid(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  if (format === "yymmdd") {
    const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
    return m ? valid(2000 + Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  const m = /^(\d{1,2})[/.月](\d{1,2})日?/.exec(s);
  return m ? valid(null, Number(m[1]), Number(m[2])) : null;
}

/** 規則ごとの、効いたセル（「読み方」のタブの「効いたセル」） */
export class RuleHits {
  private readonly cells = new Map<string, Set<string>>();
  add(rule: ReadingRule, file: string, ref: string) {
    const k = rule.id;
    if (!this.cells.has(k)) this.cells.set(k, new Set());
    this.cells.get(k)!.add(`${file}\u0000${ref}`);
  }
  count(id: string): number {
    return this.cells.get(id)?.size ?? 0;
  }
  /** 規則が効いたセルの見本（資料と位置） */
  sample(id: string): { file: string; ref: string } | null {
    const v = this.cells.get(id)?.values().next().value as string | undefined;
    if (!v) return null;
    const [file, ref] = v.split("\u0000") as [string, string];
    return { file, ref };
  }
}
