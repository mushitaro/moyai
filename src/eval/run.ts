// Messages API で問題を走らせる（docs/plan.md §2.10）。モデル・effort・system・max_tokens・Skill の版を固定し、1 問 3 回。
// 温度・top_p・top_k は渡さない。effort は毎回明示する。別のモデルへの切り替え（fallbacks）は頼まない（条件を固定するため）。
// 待ちと送り直しは SDK の既定を使わず、ここで決める。記録にモデルの識別子を書かない。誤りの本文もログに出さない。
import Anthropic from "@anthropic-ai/sdk";
import { gradeCase } from "./grade";
import { RESULT_SCHEMA, type EvalCase, type Excluded, type ResultRow, type Usage } from "./types";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function costUsd(u: Usage, p: Price): number {
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cacheRead + u.cache_creation_input_tokens * p.cacheWrite) / 1_000_000;
}

/** 送り直す誤り（込み合い・上限・サーバの誤り・つながらない）。 */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
export const RETRY_WAITS_MS = [10_000, 30_000, 60_000, 120_000];
export const CALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface CallConfig {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  system: string;
}

export interface CallOutcome {
  text: string | null;
  stopReason: string | null;
  modelMatched: boolean | null;
  usage: Usage;
  error: string | null;
}

const zeroUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

export async function callOnce(client: Anthropic, cfg: CallConfig, user: string, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<CallOutcome> {
  for (let i = 0; ; i++) {
    try {
      const res = await client.messages.create(
        {
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          output_config: { effort: cfg.effort },
          system: [{ type: "text", text: cfg.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
        },
        { timeout: CALL_TIMEOUT_MS, maxRetries: 0 },
      );
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const u = res.usage;
      return {
        text,
        stopReason: res.stop_reason ?? null,
        modelMatched: res.model === cfg.model,
        usage: {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        },
        error: null,
      };
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? (e.status ?? null) : null;
      const retryable = e instanceof Anthropic.APIConnectionError || (status !== null && RETRYABLE.has(status));
      if (retryable && i < RETRY_WAITS_MS.length) {
        await sleep(RETRY_WAITS_MS[i] as number);
        continue;
      }
      const kind = e instanceof Anthropic.APIConnectionError ? "connection" : status !== null ? `http_${status}` : e instanceof Error ? e.name : "unknown";
      return { text: null, stopReason: null, modelMatched: null, usage: zeroUsage(), error: kind };
    }
  }
}

export interface Task {
  c: EvalCase;
  attempt: number;
}

/** 回の順に並べる（途中で止めても、どの回も同じ問題の組になるように）。 */
export function planTasks(cases: EvalCase[], repeat: number): Task[] {
  const out: Task[] = [];
  for (let a = 1; a <= repeat; a++) for (const c of cases) out.push({ c, attempt: a });
  return out;
}

export function excludedOf(o: CallOutcome): Excluded | null {
  if (o.error) return "error";
  if (o.modelMatched === false) return "switched";
  if (o.stopReason === "refusal") return "refusal";
  if (o.stopReason === "max_tokens") return "max_tokens";
  return null;
}

export interface RunOptions {
  runId: string;
  tasks: Task[];
  userTextOf: (c: EvalCase) => string;
  call: (user: string) => Promise<CallOutcome>;
  price: Price;
  packUrls: string[];
  concurrency: number;
  /** この額を越えそうなら、新しい呼び出しを始めない。 */
  maxUsd: number;
  perCallEstimateUsd: number;
  onResult: (r: ResultRow) => void;
  now?: () => Date;
}

export async function runTasks(o: RunOptions): Promise<{ spentUsd: number; done: number; stopped: boolean }> {
  let next = 0;
  let spent = 0;
  let inflight = 0;
  let done = 0;
  let stopped = false;
  const now = o.now ?? (() => new Date());
  const worker = async (): Promise<void> => {
    while (next < o.tasks.length) {
      // 走っている呼び出しの見込みも足して、上限を越えないか見る
      if (spent + (inflight + 1) * o.perCallEstimateUsd > o.maxUsd) {
        stopped = true;
        return;
      }
      const t = o.tasks[next++] as Task;
      inflight++;
      const t0 = Date.now();
      const out = await o.call(o.userTextOf(t.c));
      inflight--;
      const cost = costUsd(out.usage, o.price);
      spent += cost;
      done++;
      const excluded = excludedOf(out);
      o.onResult({
        schema: RESULT_SCHEMA,
        runId: o.runId,
        caseId: t.c.id,
        rule: t.c.rule,
        split: t.c.split,
        attempt: t.attempt,
        at: now().toISOString(),
        modelMatched: out.modelMatched,
        switched: out.modelMatched === false,
        stopReason: out.stopReason,
        excluded,
        error: out.error,
        usage: out.usage,
        costUsd: cost,
        ms: Date.now() - t0,
        text: out.text,
        grade: out.text === null ? null : gradeCase(t.c, out.text, o.packUrls),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  return { spentUsd: spent, done, stopped: stopped || done < o.tasks.length };
}
