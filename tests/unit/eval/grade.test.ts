// F3 のコードの採点 6 種と、自動の見立て・走らせる仕組み（docs/plan.md §2.10）。API は呼ばない（呼ぶ所は偽の客で受ける）。
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { gradeCase, parseAnswer } from "../../../src/eval/grade";
import { BAND_RUNS, buildReport, compareReports, renderHtml } from "../../../src/eval/report";
import { callOnce, costUsd, planTasks, runTasks, type CallOutcome } from "../../../src/eval/run";
import { RULES } from "../../../src/eval/gen";
import { CASE_SCHEMA, MANIFEST_SCHEMA, type Check, type EvalCase, type Manifest, type ResultRow } from "../../../src/eval/types";

const URLS = ["https://example.test/a.pdf", "https://example.test/b.html"];

/** 正解どおりの答えを確かめから作る。 */
function ideal(checks: Check[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  const notInRecord: string[] = [];
  for (const c of checks) {
    if (!c.key) continue;
    if (c.grader === "not_in_record") {
      if (c.expect) notInRecord.push(c.key);
    } else answers[c.key] = c.expect;
  }
  return { answers, notInRecord, sources: Object.values(answers).filter((v) => typeof v === "string" && v.startsWith("https://")) };
}

const mkCase = (checks: Check[], id = "R01-01"): EvalCase => ({
  schema: CASE_SCHEMA,
  id,
  rule: id.slice(0, 3),
  split: "test",
  splitBy: "period",
  anchorFy: 2024,
  record: "",
  question: "",
  keys: [],
  checks,
  hash: "",
});

const CHECKS: Check[] = [
  { grader: "json" },
  { grader: "no_guess", key: "k1", expect: null },
  { grader: "not_in_record", key: "k1", expect: true },
  { grader: "no_guess", key: "k2", expect: 2 },
  { grader: "not_in_record", key: "k2", expect: false },
  { grader: "identity", key: "counts", expect: { "4-1": 2, "4-2": 1 } },
  { grader: "identity", key: "r1", expect: ["4-1", "4-2"] },
  { grader: "fiscal_year", key: "y1", expect: 2023 },
  { grader: "source" },
  { grader: "source", key: "s1", expect: URLS[0] },
  { grader: "source", key: "s2", expect: null },
  { grader: "no_guess", key: "c1", expect: "計画" },
];
const C = mkCase(CHECKS);
const grade = (a: unknown) => gradeCase(C, typeof a === "string" ? a : JSON.stringify(a), URLS);
const base = ideal(CHECKS) as { answers: Record<string, unknown>; notInRecord: string[]; sources: string[] };
const withAnswer = (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...base, answers: { ...base.answers, ...patch }, ...extra });
const failed = (a: unknown) =>
  grade(a)
    .checks.filter((c) => !c.pass)
    .map((c) => `${c.grader}:${c.key ?? "*"}`);

describe("コードの採点 6 種", () => {
  test("正解どおりの答えは全部通る。```json の囲み 1 つも読む", () => {
    expect(grade(base).pass).toBe(true);
    expect(grade("```json\n" + JSON.stringify(base) + "\n```").pass).toBe(true);
  });
  test("json：JSON でない・形が違うなら、その問いの確かめは全部落ちる", () => {
    for (const bad of ["答えは 2 年です", "{}", '{"answers": []}', JSON.stringify({ ...base, sources: "x" }), `前置き\n${JSON.stringify(base)}`]) {
      const g = grade(bad);
      expect(g.parsed).toBe(false);
      expect(g.checks.every((c) => !c.pass)).toBe(true);
    }
    expect(parseAnswer(null)).toBeNull();
  });
  test("no_guess：空の周期を推測で埋めると落ちる。記録にある値の違いも落ちる。数の文字は数として読む", () => {
    expect(failed(withAnswer({ k1: 1 }))).toEqual(["no_guess:k1"]);
    expect(failed(withAnswer({ k2: 3 }))).toEqual(["no_guess:k2"]);
    expect(grade(withAnswer({ k2: "2" })).pass).toBe(true);
    expect(failed(withAnswer({ c1: "実績" }))).toEqual(["no_guess:c1"]);
  });
  test("identity：名前でまとめた・足りない・余計な機器は落ちる。順は問わない", () => {
    expect(failed(withAnswer({ counts: { 押込送風機: 3 } }))).toEqual(["identity:counts"]);
    expect(failed(withAnswer({ r1: ["4-1"] }))).toEqual(["identity:r1"]);
    expect(failed(withAnswer({ r1: ["4-1", "4-2", "4-3"] }))).toEqual(["identity:r1"]);
    expect(failed(withAnswer({ r1: ["4-1", "4-1", "4-2"] }))).toEqual(["identity:r1"]);
    expect(grade(withAnswer({ r1: ["４-２", "4-1"] })).pass).toBe(true);
  });
  test("fiscal_year：年度の始まりを 1 月にした（1 年ずれた）答えは落ちる", () => {
    expect(failed(withAnswer({ y1: 2024 }))).toEqual(["fiscal_year:y1"]);
    expect(failed(withAnswer({ y1: 2023.5 }))).toEqual(["fiscal_year:y1"]);
  });
  test("source：パックの一覧に無い出典は落ちる。パックに無い基準に出典を付けると落ちる", () => {
    expect(failed({ ...base, sources: [...base.sources, "https://elsewhere.test/x"] })).toEqual(["source:*"]);
    expect(failed(withAnswer({ s2: URLS[1] }))).toEqual(["source:s2"]);
    expect(failed(withAnswer({ s1: "https://elsewhere.test/x" }))).toEqual(["source:s1"]);
    expect(grade(withAnswer({ s1: `${URLS[0]}/` })).pass).toBe(true);
  });
  test("not_in_record：記録に無いと言わない・あるものを無いと言うと落ちる", () => {
    expect(failed({ ...base, notInRecord: [] })).toEqual(["not_in_record:k1"]);
    expect(failed({ ...base, notInRecord: ["k1", "k2"] })).toEqual(["not_in_record:k2"]);
  });
});

const MANIFEST: Manifest = {
  schema: MANIFEST_SCHEMA,
  runId: "r",
  createdAt: "",
  finishedAt: null,
  status: "done",
  stopNote: null,
  suite: "s",
  suiteHash: "",
  split: "all",
  rules: null,
  perRule: null,
  limit: null,
  repeat: 3,
  cases: 0,
  calls: 0,
  skill: { path: "packs/x/SKILL.md", sha256: "0".repeat(64), label: null, author: null },
  modelRole: "eval",
  modelRoleHash: "h",
  effort: "high",
  maxTokens: 16000,
  systemHash: "",
  answerFormatHash: "",
  outbound: { chars: 0, properNounHits: 0, file: "outbound.txt" },
  estimateUsd: 0,
  maxUsd: 1,
  costUsd: 0,
  base: null,
};
const U0 = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
/** passes[attempt][case] の表から記録を作る。 */
function rowsOf(runId: string, passes: boolean[][], excluded: Record<string, ResultRow["excluded"]> = {}): ResultRow[] {
  return passes.flatMap((byCase, a) =>
    byCase.map((pass, i) => {
      const caseId = `R0${(i % 9) + 1}-${String(i + 1).padStart(2, "0")}`;
      const ex = excluded[`${a + 1}:${caseId}`] ?? null;
      return {
        schema: "moyai.eval.result/0",
        runId,
        caseId,
        rule: caseId.slice(0, 3),
        split: "test",
        attempt: a + 1,
        at: "",
        modelMatched: ex === "switched" ? false : true,
        switched: ex === "switched",
        stopReason: "end_turn",
        excluded: ex,
        error: null,
        usage: U0,
        costUsd: 0.01,
        ms: 1,
        text: "{}",
        grade: { pass, parsed: true, checks: [{ grader: "json", key: null, pass }] },
      } satisfies ResultRow;
    }),
  );
}
const rep = (runId: string, passes: boolean[][], excluded?: Record<string, ResultRow["excluded"]>) => buildReport({ ...MANIFEST, runId }, rowsOf(runId, passes, excluded), RULES);
const T = true;
const F = false;

describe("表と自動の見立て", () => {
  test("揺れの幅は回ごとの合格率の最大と最小の差。外した回は数えず、理由ごとに数を出す", () => {
    const r = rep("b", [
      [T, T, T, F],
      [T, T, F, F],
      [T, T, T, T],
    ], { "3:R04-04": "switched" });
    expect(r.perAttempt.map((p) => p.passRate)).toEqual([0.75, 0.5, 1]);
    expect(r.band).toBe(0.5);
    expect(r.excluded.switched).toBe(1);
    expect(r.counted).toBe(11);
    expect(r.failingCases).toEqual(["R04-04"]);
    expect(renderHtml({ ...r, comparison: null })).toContain("50.0%");
  });
  test("落ちる問題が増えたら退行あり。差が揺れの幅の内なら差なし。ほかは承認待ち", () => {
    const b = rep("b", [
      [T, T, T, F],
      [T, T, F, F],
      [T, T, T, F],
    ]);
    expect(BAND_RUNS).toBe(3);
    const worse = rep("c", [
      [T, F, T, F],
      [T, F, T, F],
      [T, T, T, F],
    ]);
    expect(compareReports(b, worse).verdict).toBe("退行あり");
    expect(compareReports(b, worse).newlyFailing).toEqual(["R02-02"]);
    const same = rep("c", [
      [T, T, T, F],
      [T, T, T, F],
      [T, T, F, F],
    ]);
    expect(compareReports(b, same).verdict).toBe("差なし");
    const steady = rep("b", [
      [T, T, F, F],
      [T, T, F, F],
      [T, T, F, F],
    ]);
    const better = rep("c", [
      [T, T, T, T],
      [T, T, T, T],
      [T, T, T, T],
    ]);
    const v = compareReports(steady, better);
    expect(v.verdict).toBe("承認待ち");
    expect(v.reason).not.toContain("改善");
    expect(v.fixed).toEqual(["R03-03", "R04-04"]);
  });
});

describe("走らせる仕組み", () => {
  const c1 = mkCase([{ grader: "json" }], "R01-01");
  const c2 = mkCase([{ grader: "json" }], "R02-02");
  const ok = (text: string): CallOutcome => ({ text, stopReason: "end_turn", modelMatched: true, usage: { ...U0, input_tokens: 1000, output_tokens: 1000 }, error: null });
  const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

  test("回の順に並べる（1 回目の全部、2 回目の全部…）", () => {
    expect(planTasks([c1, c2], 3).map((t) => `${t.attempt}:${t.c.id}`)).toEqual(["1:R01-01", "1:R02-02", "2:R01-01", "2:R02-02", "3:R01-01", "3:R02-02"]);
  });
  test("切り替え・拒否・max_tokens・誤りは集計から外す。費用は使ったトークンから出す", async () => {
    const outs: CallOutcome[] = [
      ok("{\"answers\":{}}"),
      { ...ok("{}"), modelMatched: false },
      { ...ok(""), stopReason: "refusal" },
      { ...ok("{"), stopReason: "max_tokens" },
      { text: null, stopReason: null, modelMatched: null, usage: U0, error: "http_500" },
      ok("x"),
    ];
    const rows: ResultRow[] = [];
    let i = 0;
    const r = await runTasks({
      runId: "t",
      tasks: planTasks([c1, c2], 3),
      userTextOf: () => "",
      call: async () => outs[i++] as CallOutcome,
      price: PRICE,
      packUrls: URLS,
      concurrency: 1,
      maxUsd: 10,
      perCallEstimateUsd: 0.01,
      onResult: (x) => rows.push(x),
    });
    expect(r.stopped).toBe(false);
    expect(rows.map((x) => x.excluded)).toEqual([null, "switched", "refusal", "max_tokens", "error", null]);
    expect(rows[0]?.costUsd).toBeCloseTo(costUsd({ ...U0, input_tokens: 1000, output_tokens: 1000 }, PRICE));
    expect(rows[0]?.grade?.pass).toBe(true);
    expect(rows[5]?.grade?.pass).toBe(false);
    expect(rows[4]?.grade).toBeNull();
  });
  test("上限を越えそうなら、新しい呼び出しを始めない", async () => {
    let calls = 0;
    const r = await runTasks({
      runId: "t",
      tasks: planTasks([c1, c2], 3),
      userTextOf: () => "",
      call: async () => {
        calls++;
        return ok("{\"answers\":{}}");
      },
      price: PRICE,
      packUrls: URLS,
      concurrency: 1,
      maxUsd: 0.05,
      perCallEstimateUsd: 0.024,
      onResult: () => {},
    });
    expect(r.stopped).toBe(true);
    expect(calls).toBe(2);
  });
  test("頼む条件：effort を明示し、温度・top_p・top_k を渡さない。system はキャッシュする。込み合いは自分で待って送り直す", async () => {
    const seen: Record<string, unknown>[] = [];
    const waits: number[] = [];
    let n = 0;
    const fake = {
      messages: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          seen.push({ ...params, opts });
          if (n++ === 0) throw new Anthropic.RateLimitError(429, undefined, "rate", new Headers());
          return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 } };
        },
      },
    } as unknown as Anthropic;
    const out = await callOnce(fake, { model: "m", effort: "high", maxTokens: 100, system: "S" }, "U", async (ms) => {
      waits.push(ms);
    });
    expect(out.error).toBeNull();
    expect(out.modelMatched).toBe(true);
    expect(out.usage.cache_read_input_tokens).toBe(7);
    expect(waits).toHaveLength(1);
    const p = seen[1] as Record<string, any>;
    expect(p.output_config).toEqual({ effort: "high" });
    for (const k of ["temperature", "top_p", "top_k", "thinking", "fallbacks"]) expect(k in p).toBe(false);
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(p.opts.maxRetries).toBe(0);
  });
  test("送り直さない誤りは、状態の番号だけを残す（本文は書かない）", async () => {
    const fake = {
      messages: {
        create: async () => {
          throw new Anthropic.BadRequestError(400, undefined, "secret detail", new Headers());
        },
      },
    } as unknown as Anthropic;
    const out = await callOnce(fake, { model: "m", effort: "high", maxTokens: 100, system: "S" }, "U", async () => {});
    expect(out.error).toBe("http_400");
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
