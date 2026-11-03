// AI のツールの、タブの側の受け手（橋渡し → このタブ）。どれも取り込みの作業場（workspace.ts）か、作業中の計画の置き場を使う。
// 引数は橋渡しが型で確かめてあるが、ここでも確かめ直し（既定の値もここで埋まる）、答えも出力の型で確かめてから返す。
// AI に行のデータを引数で渡させない。返す行は星取表の行の一部だけで、上限は橋渡しが会話ごとに数える（§2.12）。
import type { TabSentCode } from "../../shared/errors";
import { toolDef, type ToolName } from "../../shared/tools";
import { buildChart } from "../../plan/chart";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { getWorkingPlan } from "../state/plan-store";
import { TEXT } from "../text";
import type { BridgeClient } from "../bridge-client";
import type { IntakeWorkspace } from "./workspace";

export type TabToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; code: TabSentCode };
export interface TabToolContext {
  conversation: string;
  /** この会話であと読める星取表の行（橋渡しが数える） */
  rowsRemaining: number;
}
type Receiver = (ws: IntakeWorkspace, args: Record<string, unknown>, ctx: TabToolContext) => TabToolResult;

const T = TEXT.intake.ai;

/** 星取表の行を AI に渡す形：段の道と、印のある年度だけ（印は画面と同じ記号） */
function chartRows(view: "base" | "adjusted", offset: number, limit: number, rowsRemaining: number): TabToolResult {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  const { plan } = working;
  const model = buildChart(
    plan,
    catalogFor(plan.packId) ?? emptyCatalog(),
    { levelFallback: TEXT.chart.levelFallback, commonLevels: TEXT.chart.commonLevels, unmapped: TEXT.chart.unmapped },
    { mode: "ledger", period: "year", layer: view === "base" ? "original" : "adjusted", foldLevel: null },
  );
  const take = Math.max(0, Math.min(limit, rowsRemaining));
  const rows = model.rows.slice(offset, offset + take).map((r) => {
    const cells: Record<string, string> = { [T.rowPath]: r.path.filter((x): x is string => !!x).join(TEXT.chart.pathSep) };
    for (const p of model.periods) {
      const c = r.cells[p.key];
      if (c?.mark) cells[TEXT.chart.fiscalYear(p.fiscalYear)] = `${c.review ? TEXT.chart.reviewPrefix : ""}${TEXT.chart.mark[c.mark]}`;
    }
    return { rowRef: r.id, cells };
  });
  return {
    ok: true,
    data: { rows, total: model.rows.length, remainingInConversation: rowsRemaining - rows.length, version: working.revision },
  };
}

export const TAB_TOOL_RECEIVERS: Partial<Record<ToolName, Receiver>> = {
  intake_survey: (ws, args) => {
    const s: Record<string, unknown> = { ...ws.survey() };
    const part = args.part as "all" | "questions" | "compose";
    ws.note("ai", T.surveyed);
    if (part === "compose") return { ok: true, data: { ...s, files: [], samples: [], legends: [], notes: [], questions: [] } };
    if (part === "questions") return { ok: true, data: { ...s, samples: [], legends: [], notes: [] } };
    return { ok: true, data: s };
  },
  intake_settle: (ws, args) => {
    const decisions = args.decisions as { questionId: string; answer: string; author: "ai" | "ai_relayed_human"; reason: string }[];
    const r = ws.settle(decisions);
    if (!r.ok) {
      ws.note("ai", T.settleRefused(decisions.length));
      return { ok: false, code: r.code };
    }
    ws.note("ai", T.settled(decisions.length, r.unresolved));
    return { ok: true, data: { cellsAffected: r.cellsAffected, rowsAffected: r.rowsAffected, unresolved: r.unresolved } };
  },
  intake_compose: (ws) => {
    const r = ws.startCompose("ai");
    ws.note("ai", r.started ? T.composeStarted : T.composeRunning);
    return { ok: true, data: r };
  },
  chart_rows: (ws, args, ctx) => {
    const r = chartRows(args.view as "base" | "adjusted", Number(args.offset), Number(args.limit), ctx.rowsRemaining);
    if (r.ok) ws.note("ai", T.rowsRead((r.data.rows as unknown[]).length, Number(r.data.remainingInConversation)));
    return r;
  },
};

/** AI のツールを 1 つ動かす。受け手の無いもの・型に合わないもの・途中の誤りは tool_failed */
export function runTabTool(ws: IntakeWorkspace, name: ToolName, rawArgs: Record<string, unknown>, ctx: TabToolContext): TabToolResult {
  const receiver = TAB_TOOL_RECEIVERS[name];
  if (!receiver) return { ok: false, code: "tool_failed" };
  const def = toolDef(name);
  const args = def.input.safeParse(rawArgs);
  if (!args.success) return { ok: false, code: "tool_failed" };
  const r = receiver(ws, args.data as Record<string, unknown>, ctx);
  if (r.ok && !def.output.safeParse(r.data).success) return { ok: false, code: "tool_failed" };
  return r;
}

/** 橋渡しとの接続に、このタブの作業場を AI のツールの受け手としてつなぐ（App が 1 回だけ呼ぶ） */
export function connectTabTools(client: BridgeClient, ws: IntakeWorkspace): void {
  client.setToolHandlers({
    call: async (name, args, ctx) => runTabTool(ws, name, args, ctx),
    unknown: (name) => ws.note("unknown", TEXT.intake.activity.unknown(name)),
  });
}
