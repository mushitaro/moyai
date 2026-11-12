// 初めて読む物差し（pack-bench の --first-read。mushitaro/moyai#67）の道具：資料を年度に分ける・1 年目の答えを決まった答えの規則にする。
// 純粋な関数。試験は tests/unit/first-read.test.ts
import { WHOLE_FILE_ANSWERS, type ReadingRule } from "../../src/import/reading";

/** 資料の名前の年度の印（R7・H28・R元・2022）。範囲（H28-R7・2016-2031）は 2 つ出る */
const YEAR_MARK = /(?:^|[^A-Za-z0-9])((?:R|H)(?:元|\d{1,2})|20\d{2})(?![0-9])/gu;

/**
 * 年度に分ける：名前に年度が 1 つだけある資料を年度ごとにまとめ、2 つ以上の年度があるときだけ分ける。
 * 1 年目は資料のいちばん多い年度（同じ数なら新しい名前の年度）と、年度に分けられない資料（範囲・年度の無い台帳）。残りはほかの年度の資料
 */
export function yearSplit(files: readonly string[]): { year: string; first: string[]; rest: string[]; restYears: number } | null {
  const by = new Map<string, string[]>();
  const shared: string[] = [];
  for (const f of files) {
    const marks = [...f.matchAll(YEAR_MARK)].map((m) => m[1]!);
    if (marks.length === 1) by.set(marks[0]!, [...(by.get(marks[0]!) ?? []), f]);
    else shared.push(f);
  }
  if (by.size < 2) return null;
  const [year, firstFiles] = [...by.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))[0]!;
  return { year, first: [...shared, ...firstFiles], rest: [...by.entries()].filter(([y]) => y !== year).flatMap(([, fs]) => fs), restYears: by.size - 1 };
}

/**
 * 1 年目の答えを、決まった答えの規則（answer）にする：Claude が「答えをルールにして」保管先に置くのと同じ形。
 * match は問いの文の、資料の名前によらない所（下の keyOf）、120 字まで。読み手はそのままの字で当てるので、年度や数を含む問いには、その年度の問いにだけ当たる。
 * 名前ごとの規則だけを作る（種類ごとに広げない。広げると、正解の候補が問いごとに違う問いに同じ答えが当たった。mushitaro/moyai#67 の道 D）。
 * 資料を丸ごと外す答え（参考・読めない）は資料を指す規則なので作らない
 */
export function rulesFromAnswers(questions: readonly { questionId: string; kind: string; text: string }[], answered: readonly { questionId: string; answer: string }[], files: readonly string[]): ReadingRule[] {
  const ans = new Map(answered.map((d) => [d.questionId, d.answer] as const));
  const out: ReadingRule[] = [];
  const seen = new Set<string>();
  // 伏せた形が同じで答えの違う問い（年度や数えだけが違い、答えが分かれた問い）は、どちらの答えも規則にしない（推し量って片方を選ばない）
  const answersOf = new Map<string, Set<string>>();
  // match の切り出し：資料の名前を区切り（\u0000）にして、資料の名前のすぐ後ろでない最初の「名前」（資料の名前の後ろの「」はシートの名前）から、次の資料の名前の前まで。
  // そういう「」が無ければ、文の頭から最初の資料の名前の前まで（8 字に満たなければ、最後の資料の名前の後ろから）
  const keyOf = (q: { kind: string; text: string }) => {
    let t = q.text;
    for (const f of files) t = t.split(f).join("\u0000");
    let at = -1;
    for (let i = t.indexOf("「"); i >= 0; i = t.indexOf("「", i + 1)) {
      if (t[i - 1] !== "\u0000") {
        at = i;
        break;
      }
    }
    const head = t.split("\u0000")[0]?.trim() ?? "";
    const m = (at >= 0 ? t.slice(at).split("\u0000")[0] : [...head].length >= 8 ? head : t.slice(t.lastIndexOf("\u0000") + 1))?.trim() ?? "";
    const match = [...m].slice(0, 120).join("");
    return { match, key: `${q.kind}|${answerShape(match)}` };
  };
  for (const q of questions) {
    const a = ans.get(q.questionId);
    if (a === undefined) continue;
    const { key } = keyOf(q);
    answersOf.set(key, (answersOf.get(key) ?? new Set()).add(a));
  }
  for (const q of questions) {
    const a = ans.get(q.questionId);
    if (a === undefined || WHOLE_FILE_ANSWERS.includes(a) || a.length > 60 || q.kind.length > 40) continue;
    const { match, key: k } = keyOf(q);
    if (match.length < 4 || (answersOf.get(k)?.size ?? 0) > 1) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: `y1-${out.length + 1}`, kind: "answer", question: q.kind, match, answer: a, text: `1 年目の答えと同じに読む（${q.kind}）`, author: "ai", reason: "1 年目の答え（物差しの台本）" });
    if (out.length >= 500) break;
  }
  return out;
}

/**
 * 問いの文の、年度・日付・行や件の数を「#」に伏せた形。ルールを作る前に、年度や数だけが違って答えの分かれた問いを見つけるのに使う（その問いはルールにしない）。読み手は伏せずに、そのままの字で当てる（違う答えより聞く側に倒す。mushitaro/moyai#67）。
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
