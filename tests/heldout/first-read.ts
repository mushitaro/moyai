// 初めて読む物差し（pack-bench の --first-read。mushitaro/moyai#67）の道具：資料を年度に分ける・1 年目の答えを決まった答えの規則にする。
// 純粋な関数。試験は tests/unit/first-read.test.ts
import { WHOLE_FILE_ANSWERS, answerShape, type ReadingRule } from "../../src/import/reading";

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
 * match は問いの文の、資料の名前によらない所（下の keyOf）、120 字まで。年度・日付・数えは、読み手が伏せて比べる（src/import/reading.ts の answerShape）。
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
  // 種類ごとの規則（名前ごとの規則のあとに置く。先に当たったものが効く）：1 年目に、その種類の問いに 5 問以上答え、
  // 候補を指さない同じ答え（外す・新しい機器として入れるなど）が 9 割以上なら、その種類の問いに共通の文で、その答えを置く（人が「台帳に無い機器の作業は外す」と決めるのと同じ形）。
  // 候補を指す答え（c0・m0・v0 など）は、問いごとに候補が違うので広げない
  const byKind = new Map<string, { texts: string[]; answers: Map<string, number>; n: number }>();
  for (const q of questions) {
    const a = ans.get(q.questionId);
    if (a === undefined || WHOLE_FILE_ANSWERS.includes(a)) continue;
    const b = byKind.get(q.kind) ?? { texts: [] as string[], answers: new Map<string, number>(), n: 0 };
    b.n++;
    b.texts.push(answerShape(keyOf(q).match));
    if (!CANDIDATE.test(a)) b.answers.set(a, (b.answers.get(a) ?? 0) + 1);
    byKind.set(q.kind, b);
  }
  for (const [kind, b] of byKind) {
    if (b.n < 5 || kind.length > 40 || out.length >= 500) continue;
    const [top, count] = [...b.answers.entries()].sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    if (!top || top.length > 60 || count < b.n * 0.9) continue;
    const common = commonPiece(b.texts);
    if (!common) continue;
    out.push({ id: `y1-${out.length + 1}`, kind: "answer", question: kind, match: common, answer: top, text: `1 年目にいつも同じに答えた問いは、同じに読む（${kind}）`, author: "ai", reason: `1 年目の答え（物差しの台本。${count}/${b.n} 問が同じ答え）` });
  }
  return out;
}

/** 候補を指す答え（候補の機器・印・値の番号） */
const CANDIDATE = /^[cmv]\d+$/;

/**
 * 文の 9 割以上（share）に入っている、伏せた所（#）を含まない最も長い切れ端（8〜120 字）。無ければ null。
 * 切れ端の元は、はじめの 3 つの文（形の違う文が 1 つ混じっていても、ほかの文から取れるように）
 */
export function commonPiece(texts: readonly string[], share = 0.9): string | null {
  if (!texts.length) return null;
  const need = Math.ceil(texts.length * share);
  let best: string | null = null;
  for (const base of [...new Set(texts)].slice(0, 3)) {
    for (const piece of base.split("#")) {
      const cs = [...piece];
      for (let len = Math.min(cs.length, 120); len >= 8 && (!best || len > [...best].length); len--) {
        let found: string | null = null;
        for (let i = 0; i + len <= cs.length && !found; i++) {
          const sub = cs.slice(i, i + len).join("").trim();
          if ([...sub].length >= 8 && texts.filter((t) => t.includes(sub)).length >= need) found = sub;
        }
        if (found) {
          best = found;
          break;
        }
      }
    }
  }
  return best;
}
