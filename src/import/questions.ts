// 層 3：質問の候補と決定。不確かな所だけを、同じ書き方の行をまとめ、既定の答えをつけて聞く。
// 決定は同じ種類の行すべてに効き、取り消せる（決定を外して読み直す。同じ入力と決定からはいつも同じ出力）。
// 決定の作者は src/shared/fields.ts の AUTHOR_KINDS。推測で埋めない：答えが無ければ、そのセルは未解決。
import { AUTHOR_KINDS, type AuthorKind } from "../shared/fields";
import { ruleReason, type ActiveRule, type RuleHits } from "./reading";

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

export class Asker {
  readonly asked = new Map<string, QuestionState>();
  constructor(
    private readonly decisions: ReadonlyMap<string, Decision>,
    /** 読み方の規則の決まった答え（人の決定が先。規則は、人がまだ答えていない質問にだけ効く） */
    private readonly answerRules: readonly ActiveRule[] = [],
    private readonly hits: RuleHits | null = null,
  ) {}

  /**
   * 質問を置き、決定があれば答えを返す（無い・当てはまらないときは null）。
   * 同じ鍵の質問を 2 回置いたら、件数と見本を足す。
   */
  ask(key: string, q: Omit<Question, "questionId">): string | null {
    const questionId = questionIdOf(key);
    const prev = this.asked.get(questionId);
    if (prev) {
      prev.sameShapeRows += q.sameShapeRows;
      prev.items.push(...q.items);
      return prev.invalid ? null : (prev.decision?.answer ?? null);
    }
    let d = this.decisions.get(questionId) ?? null;
    if (!d) {
      const a = this.answerRules.find((x) => x.rule.kind === "answer" && x.rule.question === q.kind && q.text.includes(x.rule.match) && (q.valueKind === "number" || q.options.some((o) => o.id === (x.rule as { answer: string }).answer)));
      if (a && a.rule.kind === "answer") {
        d = { questionId, answer: a.rule.answer, author: "rule_code", reason: ruleReason(a) };
        for (const it of q.items) for (const c of it.cells) this.hits?.add(a.rule, it.file, c);
      }
    }
    let invalid: string | null = null;
    if (d) {
      if (!AUTHOR_KINDS.includes(d.author)) invalid = "作者の種類が違う";
      else if (!d.reason || d.reason.length < 1) invalid = "理由が無い";
      else if (q.valueKind === "number") {
        const n = Number(d.answer);
        if (!Number.isFinite(n) || n <= 0) invalid = "数の答えが要る";
      } else if (!q.options.some((o) => o.id === d.answer)) invalid = `答え「${d.answer}」は選択肢に無い`;
    }
    this.asked.set(questionId, { ...q, questionId, items: [...q.items], decision: d, invalid });
    return d && !invalid ? d.answer : null;
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
    return [...this.decisions.values()].filter((d) => !this.asked.has(d.questionId));
  }
}

export const YES_SPLIT: QuestionOption[] = [
  { id: "yes", label: "はい（まとめて当てる）" },
  { id: "split", label: "いいえ（1 件ずつ聞く）" },
];
export const YES_NO: QuestionOption[] = [
  { id: "yes", label: "はい" },
  { id: "no", label: "いいえ" },
];
