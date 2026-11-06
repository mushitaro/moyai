// 読み方（3 段目の Skill の規則。docs/plan.md §2.17）。会期中は決まった形の規則だけ（任意のコードは承認する人が読めないので、会期の後）。
// 規則は、利用者と Claude が会話で決めて置くか、利用者が手で書く。読み手（層 2・3）はデータとして当て、規則で決まったものは質問にしない。
// どの資料に効くかは、見出しの文字の並び（様式）と、資料の名前の型で決める。純粋な関数。
import { z } from "zod";
import { CLASS_CODE, WORK_ATTRIBUTES } from "../shared/fields";
import { norm } from "./cues";

export const READING_SCHEMA = "moyai.reading/0";

/** 列は見出しの文字で指す（「作業日」「延工数(h)」）。末尾の括弧は除いて比べる */
const column = z.string().min(1).max(60);

export const COLUMN_ROLES = ["date", "end", "tag", "effort", "days", "assetRef", "workName", "unit", "number", "remark", "exclude"] as const;
export const DATE_FORMATS = ["yyyymmdd", "yymmdd", "md"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** 計画ルールの周期（年）。周期の案（src/plan/cycle.ts）と同じ幅 */
export const PLAN_CYCLE_YEARS = { min: 1, max: 30 } as const;

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
  // 計画ルール（計画を作るルール。案 C、2026-11-06）：共通の設備項目 × 作業の属性 → 周期（年）。資料の読み方には効かず、
  // 当たる作業（項目と属性を人が受けたもの）に周期の案（R）を出すだけ。案は人が確定のシートで受けるまで決まらない。when は使わない
  z
    .object({
      ...base,
      kind: z.literal("planCycle"),
      commonItem: z.string().regex(CLASS_CODE),
      attribute: z.enum(WORK_ATTRIBUTES),
      years: z.number().int().min(PLAN_CYCLE_YEARS.min).max(PLAN_CYCLE_YEARS.max),
    })
    .strict(),
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
  /** 承認した星取表の版の番号（承認済みのときだけ。分からなければ null か無し） */
  approvedIn?: number | null;
  /** 作業中の版に置いた下書き（reading_rules_propose） */
  draft: boolean;
  /** 施設の読み方なら、置き場所の施設の鍵（作業画面は今の施設のものだけを当てる） */
  owner?: string | null;
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

export type PlanCycleRule = Extract<ReadingRule, { kind: "planCycle" }>;
export const isPlanRule = (r: ReadingRule): r is PlanCycleRule => r.kind === "planCycle";

/** 当てる計画ルール：効く順（施設 → 担当 → 会社、下書きが先）で、同じ項目 × 属性は先のものだけ */
export function activePlanRules(readings: readonly LoadedReading[]): (ActiveRule & { rule: PlanCycleRule })[] {
  const seen = new Set<string>();
  const out: (ActiveRule & { rule: PlanCycleRule })[] = [];
  for (const a of activeRules(readings)) {
    if (!isPlanRule(a.rule)) continue;
    const k = `${a.rule.commonItem}|${a.rule.attribute}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a as ActiveRule & { rule: PlanCycleRule });
  }
  return out;
}

/** 計画ルールの周期の案の根拠の頭：「計画ルール「名前」版 xxxx xxxx：1 文」（下書きは版「―」） */
export function planRuleReason(a: ActiveRule): string {
  return `計画ルール「${a.from.name}」版 ${shortVersion(a.from.version)}：${a.rule.text}`;
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

// ─── SKILL.md の文（3 段目。保管先に書く文と、AI に渡す本文で同じもの） ─────────────

const SCOPE_LABEL: Record<ReadingScope, string> = { facility: "施設", person: "担当", company: "会社" };
const HAND = "## 補い";

/** SKILL.md の中の、人が手で書いた「## 補い」の節（無ければ null） */
export function handWritten(md: string): string | null {
  const i = md.indexOf(`\n${HAND}\n`);
  return i < 0 ? null : md.slice(i + 1).trimEnd();
}

/** SKILL.md の文：題・範囲・使い方・規則の一覧（人の言葉の 1 文）と、人が手で書いた補い */
export function skillMarkdown(skill: ReadingSkill, hand: string | null = null): string {
  const L = [
    `# 読み方：${skill.name}`,
    "",
    `範囲：${SCOPE_LABEL[skill.scope]}。MOYAI の取り込みが、資料を読むときに先に当てる決まり（3 段目の Skill。docs/plan.md §2.17）。`,
    `規則は rules.json にある。規則は手で編集してよい。人の言葉の補いは、この文の「${HAND}」の節の下に手で書く（規則から作り直しても残る）。編集すると版が変わり、その版を使った版に人が署名するまで、ほかの人の MOYAI では効かない。`,
    "",
    // 計画ルールのある読み方だけに足す（計画ルールの無い読み方の文は変えない。文が変わると版が変わるため）
    ...(skill.rules.some(isPlanRule) ? ["計画ルール（計画を作るルール）は、共通の設備項目と作業の属性が当たる作業に、周期の案を出す。案は人が確定のシートで受けるまで決まらない。", ""] : []),
    "## 規則",
    "",
    ...skill.rules.map((r) => {
      if (isPlanRule(r)) return `- ${r.text}（計画ルール：${r.commonItem}・${r.attribute}・${r.years} 年）`;
      const where = [r.when?.file ? `資料「${r.when.file}」` : null, r.when?.headers?.length ? `見出しに「${r.when.headers.join("」「")}」` : null].filter(Boolean).join("・");
      return `- ${r.text}${where ? `（効く資料：${where}）` : ""}`;
    }),
    "",
    ...(hand ? [hand, ""] : []),
  ];
  return L.join("\n");
}
