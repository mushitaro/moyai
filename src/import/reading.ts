// 読み方（3 段目の Skill の規則。docs/plan.md §2.17）。会期中は決まった形の規則だけ（任意のコードは承認する人が読めないので、会期の後）。
// 規則は、利用者と Claude が会話で決めて置くか、利用者が手で書く。読み手（層 2・3）はデータとして当て、規則で決まったものは質問にしない。
// どの資料に効くかは、見出しの文字の並び（様式）と、資料の名前の型で決める。純粋な関数。
import { z } from "zod";
import { CLASS_CODE, WORK_ATTRIBUTES } from "../shared/fields";
import { norm } from "./cues";

export const READING_SCHEMA = "moyai.reading/0";

/** 列は見出しの文字で指す（「作業日」「延工数(h)」）。末尾の括弧は除いて比べる */
const column = z.string().min(1).max(60);

/** ルールで当てられる列の役目：読み手の一覧（roles.ts）と同じ。人の答えの選択肢も同じ一覧を引く（Architect の 46） */
export { COLUMN_ROLES } from "./roles";
import { COLUMN_ROLES } from "./roles";
export const DATE_FORMATS = ["yyyymmdd", "yymmdd", "md"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** 計画ルールの周期（年）。周期の案（src/plan/cycle.ts）と同じ幅 */
export const PLAN_CYCLE_YEARS = { min: 1, max: 30 } as const;

/** 規則の id（英数・_・-、40 字まで） */
export const RULE_ID = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

const base = {
  id: RULE_ID,
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
  // 行の役割：行のどれかのセルの文字（NFKC・空白を除く）が match と同じ行。prefix が true なら、行のいちばん左の字のあるセルが match で始まる行
  // （頁ごとに番号の変わる題「受入供給設備（8 / 43）」、長い注記「注）…」）。prefix はほかの列の字とは比べない（仕入先の名前などに当てない）
  z.object({ ...base, kind: z.literal("rowRole"), match: z.string().min(1).max(200), prefix: z.boolean().optional(), role: z.enum(["total", "subtotal", "note"]) }).strict(),
  // 同じ機器の呼び名の並び（2〜20。どれも最後の名前と同じ機器として読む。比べるのは NFKC にそろえた文字なので、全角と半角だけの違いは書かなくてよい）
  z.object({ ...base, kind: z.literal("sameAsset"), names: z.array(z.string().min(1).max(80)).min(2).max(20) }).strict(),
  z.object({ ...base, kind: z.literal("markMeaning"), symbol: z.string().min(1).max(8), planOrActual: z.enum(["plan", "actual"]), meaning: z.string().max(40).optional() }).strict(),
  z.object({ ...base, kind: z.literal("answer"), question: z.string().min(1).max(40), match: z.string().min(1).max(120), answer: z.string().min(1).max(60) }).strict(),
  // 職種の語（作業日報の人数の欄の「築炉工2 鳶工1」）：標準の職種の語（packs/_cues の effort.trades）に足す。業種の語は Skillパックの読み方に置く
  z.object({ ...base, kind: z.literal("effortTrade"), words: z.array(z.string().min(1).max(12)).min(1).max(40) }).strict(),
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

/** 当てる規則と、その出どころ（scope の pack は Skillパック（2 段目）の読み方。いちばん後に効く） */
export interface ActiveRule {
  rule: ReadingRule;
  from: { name: string; version: string; scope: ReadingScope | "pack"; approved: boolean; draft: boolean };
}

/** Skillパック（2 段目）の読み方の形：packs/<id>/reading.json。規則の形は 3 段目と同じ。範囲は持たない（その Skillパックの施設のどれにも効く） */
export const PackReading = z
  .object({
    schema: z.literal(READING_SCHEMA),
    name: z.string().min(1).max(80),
    rules: z.array(ReadingRule).max(500),
  })
  .strict();
export type PackReading = z.infer<typeof PackReading>;

/** Skillパックの読み方を、当てる規則にする（承認済み：Skillパックはリポジトリの版で決まる） */
export function packRules(pack: PackReading | null, version: string): ActiveRule[] {
  if (!pack) return [];
  return pack.rules.map((rule) => ({ rule, from: { name: pack.name, version, scope: "pack" as const, approved: true, draft: false } }));
}

/** 規則の職種の語（effortTrade）を、効く順に重なりなく */
export function tradeWordsOf(rules: readonly ActiveRule[]): string[] {
  const out: string[] = [];
  for (const a of rules) if (a.rule.kind === "effortTrade") for (const w of a.rule.words) if (!out.includes(w)) out.push(w);
  return out;
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

/** 資料の名前が、規則の資料の名前の型（* を使える）に合うか。道の付いた名前は、最後の名前でも比べる */
export function fileMatches(pattern: string, file: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "u");
  return re.test(file) || re.test(file.split("/").pop() ?? file);
}

/** 規則がその資料（シート）に効くか：資料の名前の型と、見出しの文字がどれもシートにあること */
export function ruleApplies(rule: ReadingRule, file: string, sheetTexts: ReadonlySet<string>): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.file && !fileMatches(w.file, file)) return false;
  return (w.headers ?? []).every((h) => sheetTexts.has(norm(h)));
}

/**
 * 資料を丸ごと外す答え：reference（参考として計画に使わない。reference.ts）と reject（読めない資料を外す。session.ts の文字コード・区切りの質問）。
 * 決まった答えの規則でこの答えを置くときは、when.file で資料を指したときだけ効く（指さないと、同じ形の質問の出る資料がどれも外れる）
 */
export const WHOLE_FILE_ANSWERS: readonly string[] = ["reference", "reject"];

/** 資料を丸ごと外す決まった答えの規則か */
export function dropsWholeFile(rule: ReadingRule): boolean {
  return rule.kind === "answer" && WHOLE_FILE_ANSWERS.includes(rule.answer);
}

/** 資料を丸ごと外す決まった答えの規則が、資料を指していない（when.file が無い）ので効かないか */
export function wholeFileUnaimed(rule: ReadingRule): boolean {
  return dropsWholeFile(rule) && !rule.when?.file;
}

/**
 * 決まった答えの規則が、その質問の資料に効くか。資料を丸ごと外す答えは、when.file が質問のどの資料にも合うときだけ効く。
 * ほかの答えは資料で絞らない（when は置くときに断る。tab-tools.ts）
 */
export function answerAppliesTo(rule: ReadingRule, files: readonly string[]): boolean {
  if (!dropsWholeFile(rule)) return true;
  const pattern = rule.when?.file;
  return !!pattern && files.length > 0 && files.every((f) => fileMatches(pattern, f));
}

/**
 * 決まった答えの規則の match を比べる形：年度・日付・行や件の数を「#」に伏せる（年をまたいで同じ問いに当たるように。mushitaro/moyai#67）。
 * 伏せるのは、年度（2021・2021 年度・R7 年度・令和 7 年度など）、日付、数え（3 行・12 件・2 冊・444 通り・5 問・7 枚・2 頁・10 セル）だけ。
 * 号・No.・番号などの数は伏せない（伏せると、別の機器の問いに同じ答えが当たる）
 */
export function answerShape(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/(?:19|20)\d{2}[/.-]\d{1,2}[/.-]\d{1,2}/g, "#")
    .replace(/\d{1,2}月\d{1,2}日/g, "#")
    .replace(/(?:令和|平成|[RH])\s?(?:元|\d{1,2})\s?年度/g, "#")
    .replace(/(?<!\d)(?:19|20)\d{2}(?!\d)(?:\s?年度)?/g, "#")
    .replace(/\d[\d,]*\s?(?:行|件|冊|通り|問|枚|頁|セル)/g, "#");
}

const shapeMemo = new Map<string, string>();
/** 決まった答えの規則が、質問の文に当たるか：そのままの字で含むか、年度・日付・数えを伏せた形で含むか */
export function answerMatches(text: string, match: string, shaped: () => string = () => answerShape(text)): boolean {
  if (text.includes(match)) return true;
  let m = shapeMemo.get(match);
  if (m === undefined) {
    m = answerShape(match);
    if (shapeMemo.size > 5000) shapeMemo.clear();
    shapeMemo.set(match, m);
  }
  return m !== "" && shaped().includes(m);
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

/** 規則ごとの、効いたセル（「読み方」のタブの「効いたセル」）と、その行と資料 */
export class RuleHits {
  private readonly cells = new Map<string, Set<string>>();
  /** シートの分かるセルの位置（records.ts の cellKey と同じ形。規則が読めていたセルを外したかを数える） */
  private readonly at = new Map<string, Set<string>>();
  private readonly rowSet = new Map<string, Set<string>>();
  private readonly fileSet = new Map<string, Set<string>>();
  /** sheetIndex はセルのシートの番号（分かるときだけ。分からないセルは、資料と行の番号だけで行を数える） */
  add(rule: ReadingRule, file: string, ref: string, sheetIndex?: number) {
    const k = rule.id;
    put(this.cells, k, `${file}\u0000${ref}`);
    put(this.fileSet, k, file);
    const row = /(\d+)$/.exec(ref)?.[1];
    if (row) put(this.rowSet, k, `${file}\u0000${sheetIndex ?? "?"}\u0000${row}`);
    if (sheetIndex !== undefined) put(this.at, k, `${file}\u0000${sheetIndex}\u0000${ref}`);
  }
  count(id: string): number {
    return this.cells.get(id)?.size ?? 0;
  }
  /** 効いたセルのある行の数 */
  rows(id: string): number {
    return this.rowSet.get(id)?.size ?? 0;
  }
  /** 効いたセルのある資料の数 */
  files(id: string): number {
    return this.fileSet.get(id)?.size ?? 0;
  }
  /** 効いたセルのうち、シートの分かるものの位置（cellKey の形） */
  located(id: string): ReadonlySet<string> {
    return this.at.get(id) ?? EMPTY_SET;
  }
  /** 規則が効いたセルの見本（資料と位置） */
  sample(id: string): { file: string; ref: string } | null {
    const v = this.cells.get(id)?.values().next().value as string | undefined;
    if (!v) return null;
    const [file, ref] = v.split("\u0000") as [string, string];
    return { file, ref };
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function put(m: Map<string, Set<string>>, k: string, v: string): void {
  let s = m.get(k);
  if (!s) m.set(k, (s = new Set()));
  s.add(v);
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
