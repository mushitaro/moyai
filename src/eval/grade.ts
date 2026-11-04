// コードの採点 6 種（docs/plan.md §2.10）。AI に判定させない。
// 答えの形が崩れていれば、json だけでなく、その問いのほかの確かめもすべて落ちにする。
import type { Answer, Check, CheckResult, EvalCase, Grade } from "./types";

const norm = (s: unknown): string =>
  String(s)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "");

/** 答えの文を JSON として読む。文の全体が JSON か、全体が 1 つの ```json の囲みのときだけ読む。 */
export function parseAnswer(text: string | null): Answer | null {
  if (text === null) return null;
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = (fence[1] as string).trim();
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!o.answers || typeof o.answers !== "object" || Array.isArray(o.answers)) return null;
  const strs = (x: unknown): string[] | null => (Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]) : null);
  const notInRecord = o.notInRecord === undefined ? [] : strs(o.notInRecord);
  const sources = o.sources === undefined ? [] : strs(o.sources);
  if (!notInRecord || !sources) return null;
  return { answers: o.answers as Record<string, unknown>, notInRecord, sources };
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && norm(v) === "");

function sameValue(v: unknown, expect: unknown): boolean {
  if (typeof expect === "number") {
    const n = typeof v === "number" ? v : typeof v === "string" && norm(v) !== "" ? Number(norm(v)) : NaN;
    return Number.isFinite(n) && Math.abs(n - expect) < 1e-6;
  }
  if (typeof expect === "string") return typeof v === "string" && norm(v) === norm(expect);
  return false;
}

/** 集合（配列）か、キーごとの数（オブジェクト）が正解と同じか。キーと要素は NFKC で比べる。 */
function sameIdentity(v: unknown, expect: unknown): boolean {
  if (Array.isArray(expect)) {
    if (!Array.isArray(v)) return false;
    const got = v.map(norm);
    const want = new Set(expect.map(norm));
    return got.length === want.size && new Set(got).size === got.length && got.every((x) => want.has(x));
  }
  if (expect && typeof expect === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const got = new Map(Object.entries(v as Record<string, unknown>).map(([k, x]) => [norm(k), x]));
    const want = Object.entries(expect as Record<string, unknown>);
    return got.size === want.length && want.every(([k, x]) => got.has(norm(k)) && sameValue(got.get(norm(k)), x));
  }
  return false;
}

const urlNorm = (u: unknown): string => norm(u).replace(/\/+$/, "");

export function gradeCheck(answer: Answer | null, check: Check, packUrls: string[]): boolean {
  if (check.grader === "json") return answer !== null;
  if (!answer) return false;
  const key = check.key;
  const v = key === undefined ? undefined : answer.answers[key];
  switch (check.grader) {
    case "no_guess":
      return check.expect === null ? isBlank(v) : sameValue(v, check.expect);
    case "identity":
      return sameIdentity(v, check.expect);
    case "fiscal_year":
      return sameValue(v, check.expect) && Number.isInteger(Number(norm(v)));
    case "not_in_record": {
      const listed = answer.notInRecord.some((k) => norm(k) === norm(key ?? ""));
      return listed === Boolean(check.expect);
    }
    case "source": {
      const allowed = new Set(packUrls.map(urlNorm));
      if (key === undefined) return answer.sources.every((u) => allowed.has(urlNorm(u)));
      if (check.expect === null) return isBlank(v);
      return typeof v === "string" && allowed.has(urlNorm(v)) && urlNorm(v) === urlNorm(check.expect);
    }
  }
}

export function gradeCase(c: Pick<EvalCase, "checks">, text: string | null, packUrls: string[]): Grade {
  const answer = parseAnswer(text);
  const checks: CheckResult[] = c.checks.map((ch) => ({ grader: ch.grader, key: ch.key ?? null, pass: gradeCheck(answer, ch, packUrls) }));
  return { pass: checks.every((x) => x.pass), parsed: answer !== null, checks };
}
