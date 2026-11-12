// 層 3：質問の候補と決定。不確かな所だけを、同じ書き方の行をまとめ、既定の答えをつけて聞く。
// 決定は同じ種類の行すべてに効き、取り消せる（決定を外して読み直す。同じ入力と決定からはいつも同じ出力）。
// 決定の作者は src/shared/fields.ts の AUTHOR_KINDS。推測で埋めない：答えが無ければ、そのセルは未解決。
import { AUTHOR_KINDS, type AuthorKind } from "../shared/fields";
import { answerAppliesTo, ruleReason, tradeWordsOf, type ActiveRule, type ReadingRule, type RuleHits } from "./reading";

export type QuestionKind =
  | "encoding"
  | "delimiter"
  | "formulaNoCache"
  | "levelSplit"
  | "levelJump"
  | "yearKind"
  | "blankSameAsAbove"
  | "hiddenData"
  | "columnRole"
  | "tagSplit"
  | "unknownSymbol"
  | "noLegend"
  | "planActualConflict"
  | "commonMeaning"
  | "unitSpelling"
  | "unitMissing"
  // 費用の列（運営者の決定 A 案）と周期の列の質問は、それぞれの種類にする（Architect の 59。決まった答えのルールが種類で当たるので、号の抜けと分ける）
  | "costKind"
  | "costUnit"
  | "costTax"
  | "costBad"
  | "cycleText"
  | "planActualUnknown"
  | "flatSplit"
  | "hoursPerManDay"
  | "effortUnknown"
  | "dateUnknown"
  | "yearUnknown"
  | "assetList"
  | "assetLink"
  | "assetLinkOne"
  | "assetUnmatched"
  | "eventAsset"
  | "eventAssetOne"
  | "workLink"
  | "workLinkOne"
  | "workJoin"
  | "effortConflict"
  | "photoRoute"
  | "subtotalMismatch"
  | "duplicateAsset"
  | "stray";

export interface QuestionOption {
  id: string;
  label: string;
}

/** 質問がかかる 1 件（同じ形の行のうちの 1 つ）。試験と画面が使う。AI には件数と見本だけを渡す */
export interface QuestionItem {
  file: string;
  sheet: string | null;
  cells: string[];
  /** 既定の答えが当てる先（結ぶ相手など）の出どころ */
  target?: { file: string; sheet: string | null; cells: string[] }[];
  note?: string;
}

export interface Question {
  questionId: string;
  kind: QuestionKind;
  text: string;
  options: QuestionOption[];
  /** "number" は数の答え（例：1 人・日の時間） */
  valueKind: "option" | "number";
  defaultAnswer: string | null;
  sameShapeRows: number;
  items: QuestionItem[];
}

export interface Decision {
  questionId: string;
  answer: string;
  author: AuthorKind;
  reason: string;
}

export interface QuestionState extends Question {
  decision: Decision | null;
  /** 決定が選択肢に当てはまらない（計画を作らない） */
  invalid: string | null;
}

/** 決め方の鍵から、変わらない質問の番号を作る（行の中身を番号に写さない） */
export function questionIdOf(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0x9e3779b9;
  for (let i = key.length - 1; i >= 0; i--) {
    h2 ^= key.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `q-${h.toString(36)}${h2.toString(36)}`;
}

/**
 * 同じ形の質問をまとめる手がかり（ask の 3 つめの引数）。
 * 種類と選択肢（数の答えかどうかも）が同じで、この鍵が同じ質問は、シート・塊・資料をまたいで 1 問にまとめ、答えを全部の行に当てる。
 */
export interface MergeSpec {
  /**
   * まとめる鍵：まとめる前の鍵のうち、表（シート・塊）の所を様式（formGroups の鍵）に、書き方ごとの所を列に置き換えたもの。
   * まとめた質問の ID はこの鍵と種類と選択肢から決まる（聞く順・答え・ほかの決定で変わらない）
   */
  key: string;
  /** まとめたときの文（合わせた行の数から作る）。無ければ最初の質問の文 */
  text?: (rows: number) => string;
  /**
   * 問いが 1 つだけのうちから、まとめた質問として見せる（ID はまとめた質問の ID）。
   * 後の問いが先の問いの答えを待って出てくる（資料をまたいで結ぶ機器）ときに使う：先の問いへの答えが、後から出る同じ形の問いにも当たる
   */
  always?: boolean;
}

/** まとめた質問の見本に、セルの番地を残す問いの数（ほかの問いは資料とシートだけ残す） */
const MERGE_SAMPLES = 3;
/** まとめた質問の文に名前を出す所（資料とシート）の数 */
const MERGE_PLACES = 2;

interface Member {
  id: string;
  rows: number;
  items: QuestionItem[];
}

interface Group {
  id: string;
  /** 最初の問い（文・選択肢・既定の答え） */
  first: Omit<Question, "questionId">;
  text: ((rows: number) => string) | undefined;
  members: Map<string, Member>;
  decision: Decision | null;
  /** 決定が、まとめた質問の ID に置いた決定（読み方の規則の答えでない） */
  stored: boolean;
  rule: ActiveRule | null;
  invalid: string | null;
  always: boolean;
}

export class Asker {
  /** まとめない質問と、自分の決定を持つ問い（まとめる前の ID に置いた決定は、その問いの行にだけ効く） */
  private readonly single = new Map<string, QuestionState>();
  private readonly groups = new Map<string, Group>();
  /** まとめる前の ID → まとまり */
  private readonly memberOf = new Map<string, Group>();
  /** 出てきた順（質問の並びはこの順） */
  private readonly order: (string | Group)[] = [];
  /** まとめない質問のうち、読み方の規則の決まった答えで決まったもの（質問の ID → 規則） */
  private readonly singleRule = new Map<string, ActiveRule>();
  /** 見える質問の一覧（問いを置くたびに作り直す） */
  private view: { asked: Map<string, QuestionState> } | null = null;
  constructor(
    private readonly decisions: ReadonlyMap<string, Decision>,
    /** 読み方の規則の決まった答え（人の決定が先。規則は、人がまだ答えていない質問にだけ効く） */
    private readonly answerRules: readonly ActiveRule[] = [],
    private readonly hits: RuleHits | null = null,
  ) {}

  /** 規則の職種の語（3 段目と Skillパックの effortTrade。標準の職種の語に足す） */
  get tradeWords(): string[] {
    return tradeWordsOf(this.answerRules);
  }

  /** 読み方の規則が効いたセルを数える（印の意味の規則が当たった印など） */
  hit(rule: ReadingRule, file: string, ref: string, sheetIndex?: number): void {
    this.hits?.add(rule, file, ref, sheetIndex);
  }

  /** 見える質問（ID → 質問）。まとめた問いは、まとめた質問 1 つにだけ出る */
  get asked(): ReadonlyMap<string, QuestionState> {
    return this.built().asked;
  }

  /** 見える質問の ID（まとめた問いは、まとめた質問の ID。ほかはそのまま） */
  resolve(questionId: string): string;
  resolve(questionId: string | null): string | null;
  resolve(questionId: string | null): string | null {
    if (questionId === null) return null;
    const g = this.memberOf.get(questionId);
    return g && shownAsGroup(g) ? g.id : questionId;
  }

  /** その問いに効いている質問（まとめる前の ID でも引ける） */
  stateOf(questionId: string): QuestionState | undefined {
    return this.asked.get(this.resolve(questionId));
  }

  /** その問いに効いている決定（当てはまらない決定も返す。一覧を作り直さずに引く） */
  decisionOf(questionId: string): Decision | null {
    const g = this.memberOf.get(questionId) ?? this.groups.get(questionId);
    if (g) return g.decision ? { ...g.decision, questionId: this.resolve(questionId) ?? questionId } : null;
    return this.single.get(questionId)?.decision ?? null;
  }

  /** この鍵の質問に、置いた決定か読み方の規則の答えがあるか（聞かずに確かめる） */
  hasAnswer(key: string, q: Pick<Question, "kind" | "text" | "options" | "valueKind" | "items">): boolean {
    return this.decisions.has(questionIdOf(key)) || this.ruleFor(q) !== null;
  }

  /**
   * 質問を置き、決定があれば答えを返す（無い・当てはまらないときは null）。
   * 同じ鍵の質問を 2 回置いたら、件数と見本を足す。
   * merge があれば、同じ形の質問（種類・選択肢・merge.key が同じ）を 1 問にまとめる。ただし、まとめる前の ID に決定があれば、その問いは自分の決定で読む
   */
  ask(key: string, q: Omit<Question, "questionId">, merge?: MergeSpec): string | null {
    const questionId = questionIdOf(key);
    this.view = null;
    const prev = this.single.get(questionId);
    if (prev) {
      prev.sameShapeRows += q.sameShapeRows;
      prev.items.push(...q.items);
      return prev.invalid ? null : (prev.decision?.answer ?? null);
    }
    const joined = this.memberOf.get(questionId);
    if (joined) return this.join(joined, questionId, q);
    if (merge && !this.decisions.has(questionId)) {
      const gid = questionIdOf(`merge|${merge.key}|${q.kind}|${q.valueKind}|${JSON.stringify(q.options.map((o) => [o.id, o.label]))}`);
      let g = this.groups.get(gid);
      if (!g) {
        const stored = this.decisions.get(gid) ?? null;
        const rule = stored ? null : this.ruleFor(q);
        const decision: Decision | null = stored ?? (rule && rule.rule.kind === "answer" ? { questionId: gid, answer: rule.rule.answer, author: "rule_code", reason: ruleReason(rule) } : null);
        g = { id: gid, first: { ...q, items: [] }, text: merge.text, members: new Map(), decision, stored: !!stored, rule, invalid: decision ? invalidOf(decision, q) : null, always: merge.always === true };
        this.groups.set(gid, g);
        this.order.push(g);
      }
      return this.join(g, questionId, q);
    }
    let d = this.decisions.get(questionId) ?? null;
    if (!d) {
      const a = this.ruleFor(q);
      if (a && a.rule.kind === "answer") {
        d = { questionId, answer: a.rule.answer, author: "rule_code", reason: ruleReason(a) };
        this.singleRule.set(questionId, a);
        for (const it of q.items) for (const c of it.cells) this.hits?.add(a.rule, it.file, c);
      }
    }
    const invalid = d ? invalidOf(d, q) : null;
    this.single.set(questionId, { ...q, questionId, items: [...q.items], decision: d, invalid });
    this.order.push(questionId);
    return d && !invalid ? d.answer : null;
  }

  private join(g: Group, questionId: string, q: Omit<Question, "questionId">): string | null {
    const m = g.members.get(questionId);
    if (m) {
      m.rows += q.sameShapeRows;
      m.items.push(...q.items);
    } else {
      g.members.set(questionId, { id: questionId, rows: q.sameShapeRows, items: [...q.items] });
      this.memberOf.set(questionId, g);
    }
    if (g.rule) for (const it of q.items) for (const c of it.cells) this.hits?.add(g.rule.rule, it.file, c);
    return g.decision && !g.invalid ? g.decision.answer : null;
  }

  /**
   * 質問に当たる決まった答えの規則：種類が同じで、質問の文に match の字を含み、答えが選択肢にあるもの。
   * 資料を丸ごと外す答え（参考として外す・読めない資料を外す）は、when.file が質問の資料を指すときだけ（reading.ts の answerAppliesTo）
   */
  private ruleFor(q: Pick<Question, "kind" | "text" | "options" | "valueKind" | "items">): ActiveRule | null {
    const files = [...new Set(q.items.map((i) => i.file))];
    // 文の比べは、そのままの字だけ（年度・数を伏せて広げると、年度ごとに正解の変わる問いに同じ答えが当たる。違う答えより聞く側に倒す。mushitaro/moyai#67）
    return (
      this.answerRules.find(
        (x) =>
          x.rule.kind === "answer" &&
          x.rule.question === q.kind &&
          q.text.includes(x.rule.match) &&
          (q.valueKind === "number" || q.options.some((o) => o.id === (x.rule as { answer: string }).answer)) &&
          answerAppliesTo(x.rule, files),
      ) ?? null
    );
  }

  /** その問いに効いている決定が読み方の規則の決まった答えなら、その規則の id（人・AI の決定や、答えの無い問いは null）。まとめる前の ID でも引ける */
  ruleIdOf(questionId: string): string | null {
    const g = this.memberOf.get(questionId) ?? this.groups.get(questionId);
    if (g) return !g.stored && g.rule && g.decision ? g.rule.rule.id : null;
    const st = this.single.get(questionId);
    return st?.decision?.author === "rule_code" ? (this.singleRule.get(questionId)?.rule.id ?? null) : null;
  }

  /** 見える質問のうち、読み方の規則の決まった答えで決まったもの（質問の ID → 規則の id） */
  ruleAnswers(): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of this.asked.keys()) {
      const r = this.ruleIdOf(id);
      if (r !== null) out.set(id, r);
    }
    return out;
  }

  private built(): { asked: Map<string, QuestionState> } {
    if (this.view) return this.view;
    const asked = new Map<string, QuestionState>();
    for (const o of this.order) {
      if (typeof o === "string") {
        const st = this.single.get(o);
        if (st) asked.set(o, st);
        continue;
      }
      const ms = [...o.members.values()];
      const rows = ms.reduce((a, m) => a + m.rows, 0);
      const only = ms.length === 1 ? ms[0] : undefined;
      if (only && !shownAsGroup(o)) {
        // 問いが 1 つだけ：まとめる前の質問のまま（ID も文も変えない）
        asked.set(only.id, { ...o.first, questionId: only.id, sameShapeRows: only.rows, items: only.items, decision: o.decision ? { ...o.decision, questionId: only.id } : null, invalid: o.invalid });
        continue;
      }
      asked.set(o.id, {
        ...o.first,
        questionId: o.id,
        text: ms.length > 1 ? mergedText(o, rows, ms) : (o.text?.(rows) ?? o.first.text),
        sameShapeRows: rows,
        items: sampleItems(ms),
        decision: o.decision,
        invalid: o.invalid,
      });
    }
    this.view = { asked };
    return this.view;
  }

  open(): QuestionState[] {
    return [...this.asked.values()].filter((q) => !q.decision || q.invalid);
  }
  answered(): QuestionState[] {
    return [...this.asked.values()].filter((q) => q.decision && !q.invalid);
  }
  invalidDecisions(): QuestionState[] {
    return [...this.asked.values()].filter((q) => q.invalid);
  }
  /** どの質問にも当たらなかった決定（ファイルが変わったなど）。効かないので一覧に出す */
  unusedDecisions(): Decision[] {
    const asked = this.asked;
    return [...this.decisions.values()].filter((d) => !asked.has(d.questionId));
  }
}

/** まとめた質問として見せるか（問いが 2 つ以上か、まとめた質問の ID に決定がある）。問いが 1 つだけなら、まとめる前の質問のまま見せる */
function shownAsGroup(g: Group): boolean {
  return g.members.size > 1 || g.stored || g.always;
}

function invalidOf(d: Decision, q: Pick<Question, "options" | "valueKind">): string | null {
  if (!AUTHOR_KINDS.includes(d.author)) return "作者の種類が違う";
  if (!d.reason || d.reason.length < 1) return "理由が無い";
  if (q.valueKind === "number") {
    const n = Number(d.answer);
    return !Number.isFinite(n) || n <= 0 ? "数の答えが要る" : null;
  }
  return q.options.some((o) => o.id === d.answer) ? null : `答え「${d.answer}」は選択肢に無い`;
}

/** 資料とシートの名前（出てきた順・重なりなし） */
function placesOf(items: readonly QuestionItem[]): string[] {
  return [...new Set(items.map((i) => `${i.file}${i.sheet ? `「${i.sheet}」` : ""}`))];
}

/** まとめた質問の文：合わせた行の数の文と、まとめた問いの数と所 */
function mergedText(g: Group, rows: number, ms: readonly Member[]): string {
  const places = placesOf(ms.flatMap((m) => m.items));
  const shown = places.slice(0, MERGE_PLACES).join("・");
  const more = places.length - MERGE_PLACES;
  return `${g.text ? g.text(rows) : g.first.text}（${ms.length} 問をまとめた：${shown}${more > 0 ? ` ほか ${more} か所` : ""}）`;
}

/** まとめた質問の見本：先の数問はセルの番地まで、ほかは資料とシートだけ（効く所の見出しと、資料の一覧に使う） */
function sampleItems(ms: readonly Member[]): QuestionItem[] {
  const out = ms.slice(0, MERGE_SAMPLES).flatMap((m) => m.items);
  const seen = new Set(placesOf(out));
  for (const m of ms.slice(MERGE_SAMPLES))
    for (const it of m.items) {
      const p = placesOf([it])[0] ?? "";
      if (seen.has(p) && !it.target?.length) continue;
      seen.add(p);
      out.push({ file: it.file, sheet: it.sheet, cells: [], ...(it.target?.length ? { target: it.target } : {}) });
    }
  return out;
}

export const YES_SPLIT: QuestionOption[] = [
  { id: "yes", label: "はい（まとめて当てる）" },
  { id: "split", label: "いいえ（1 件ずつ聞く）" },
];
export const YES_NO: QuestionOption[] = [
  { id: "yes", label: "はい" },
  { id: "no", label: "いいえ" },
];

/** 質問の文の形の長さの上限（字） */
const SHAPE_MAX = 80;

/**
 * 質問の形：同じ書き方の質問をまとめる鍵と、要約に出す文。「」の中・資料の名前・数・列とセルの番地を伏せる
 * （「列 B（見出し「…」・中身の見本 「…」…）の役目が決まらない」と「列 D（…）…」は同じ形）
 */
export function questionShape(text: string): string {
  return text
    .replace(/「[^」]*」/gu, "「…」")
    .replace(/[^\s「」（）()・、。]+\.(?:xlsx|xlsm|csv|tsv|txt|pdf|jpe?g|png)/giu, "（資料）")
    .replace(/[A-Z]{1,3}\d+/gu, "（セル）")
    .replace(/\d+(?:\.\d+)?/gu, "n")
    .replace(/(^|[^A-Za-z])[A-Z]{1,3}(?=$|[^A-Za-z])/gu, "$1X")
    .slice(0, SHAPE_MAX);
}
