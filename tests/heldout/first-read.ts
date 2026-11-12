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
 * match は問いの文の、年度と資料の名前によらない所：最初の「名前」と、続く括弧の最初の区切りまで。「」が無ければ、数と資料の名前を除いた最も長い切れ端。
 * 資料を丸ごと外す答え（参考・読めない）は資料を指す規則なので作らない
 */
export function rulesFromAnswers(questions: readonly { questionId: string; kind: string; text: string }[], answered: readonly { questionId: string; answer: string }[], files: readonly string[]): ReadingRule[] {
  const ans = new Map(answered.map((d) => [d.questionId, d.answer] as const));
  const out: ReadingRule[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    const a = ans.get(q.questionId);
    if (a === undefined || WHOLE_FILE_ANSWERS.includes(a) || a.length > 60 || q.kind.length > 40) continue;
    const quoted = /「[^」]{1,80}」(?:（[^、）]{0,30}[、）])?/u.exec(q.text)?.[0];
    let match = quoted;
    if (!match) {
      let t = q.text;
      for (const f of files) t = t.split(f).join("\u0000");
      match = t.split(/[\u0000\d０-９（）()]+/u).sort((x, y) => y.length - x.length)[0]?.trim();
    }
    if (!match || match.length < 4) continue;
    match = [...match].slice(0, 120).join("");
    const k = `${q.kind}|${match}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: `y1-${out.length + 1}`, kind: "answer", question: q.kind, match, answer: a, text: `1 年目の答えと同じに読む（${q.kind}）`, author: "ai", reason: "1 年目の答え（物差しの台本）" });
    if (out.length >= 500) break;
  }
  return out;
}
