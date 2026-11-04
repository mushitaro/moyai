// AI のツールの、タブの側の受け手（橋渡し → このタブ）。どれも取り込みの作業場（workspace.ts）か、作業中の計画の置き場を使う。
// 引数は橋渡しが型で確かめてあるが、ここでも確かめ直し（既定の値もここで埋まる）、答えも出力の型で確かめてから返す。
// AI に行のデータを引数で渡させない。返す行は星取表の行の一部だけで、上限は橋渡しが会話ごとに数える（§2.12）。
// 当てはめ（crosswalk_propose）は規則で案を置くだけで、数と行の参照だけを返す。人が受ける道はここに無い（画面だけ）。
// 写真（photo_transcribe）は、人が画面で許した写真の画像を 1 回だけ添えて返す（intake/photos.ts）。許す・確かめる道はここに無い。
import type { TabSentCode } from "../../shared/errors";
import { toolDef, type PhotoCellIn, type PhotoImage, type Rule, type ToolName } from "../../shared/tools";
import { buildChart } from "../../plan/chart";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { crosswalkSurvey, proposeFromAi } from "../state/crosswalk";
import { getWorkingPlan } from "../state/plan-store";
import { getPeerView } from "../state/peers";
import type { ReadingRule, ReadingScope } from "../../import/reading";
import { STAT_FIELDS } from "../../share/bands";
import { RECEIVE_MIN_K } from "../../share/k";
import type { StatCell } from "../../share/aggregate";
import { checkResultsOf, getReferenceDate } from "../state/review";
import { REVIEW_TEXT, TEXT } from "../text";
import type { BridgeClient } from "../bridge-client";
import type { IntakeWorkspace } from "./workspace";

/** image は photo_transcribe の receive だけ（人が許した写真 1 枚。橋渡しが許しと照らす） */
export type TabToolResult = { ok: true; data: Record<string, unknown>; image?: PhotoImage } | { ok: false; code: TabSentCode };
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
    { levelFallback: TEXT.chart.levelFallback, commonLevels: TEXT.chart.commonLevels, unmapped: TEXT.chart.unmapped, series: TEXT.chart.series },
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

/** 統計の行を、ツールの答えの形（low・high）にする */
function statOut(c: StatCell): Record<string, unknown> {
  if (c.shown === "x") return { shown: "x" };
  if (c.shown === "range") return { shown: "range", n: c.n, low: c.lo, high: c.hi };
  return { shown: "median", n: c.n, median: c.median, q1: c.q1, q3: c.q3 };
}

/** 人が星取表で開いた比べから、下限を守った集計と匿名の札だけを返す（鍵・見え方の値・年度・施設ごとの帯は返さない） */
function peerReference(commonItem: string | undefined): TabToolResult {
  const v = getPeerView();
  if (!v) return { ok: false, code: "no_peer_view" };
  const c = v.comparison;
  const aggregates: Record<string, unknown>[] = [];
  const cards: Record<string, unknown>[] = [];
  for (const p of c.places) {
    if (p.status !== "shown") continue;
    for (const r of p.agg.rows) {
      if (commonItem !== undefined && r.class !== commonItem) continue;
      const a: Record<string, unknown> = { place: p.kind, commonItem: r.class, work: r.work };
      for (const f of STAT_FIELDS) a[f] = statOut(r.stats[f]);
      aggregates.push(a);
      for (const peer of r.peers) cards.push({ place: p.kind, card: peer.label, commonItem: r.class, work: r.work });
    }
  }
  const places = c.places.map((p) => ({ place: p.kind, status: p.status, similar: p.status === "shown" ? p.agg.similar.length : p.status === "belowShow" ? p.similar : null }));
  return { ok: true, data: { position: c.position, floorK: RECEIVE_MIN_K, places, aggregates, cards } };
}

export const TAB_TOOL_RECEIVERS: Partial<Record<ToolName, Receiver>> = {
  reading_rules_propose: (ws, args) => {
    const rules = ws.proposeReading(String(args.name), args.scope as ReadingScope, args.rules as ReadingRule[]);
    const an = ws.analysis();
    const unresolved = [...an.composition.status.values()].filter((x) => x.s === "unresolved").length;
    ws.note("ai", T.readingProposed(String(args.name), (args.rules as unknown[]).length));
    return { ok: true, data: { name: args.name, rules, unresolvedCells: unresolved, openQuestions: an.open.length, planReady: an.composition.blockers.length === 0 } };
  },
  // 橋渡しが保管先に書く下書き（作業画面は中身を渡すだけ。書くのは橋渡し）
  reading_skill_register: (ws, args) => {
    const d = ws.draftReading(String(args.name));
    if (!d) return { ok: false, code: "no_reading_draft" };
    return { ok: true, data: { skill: d.skill, by: typeof args.by === "string" ? args.by : null, facilityKey: ws.facilityKey() } };
  },
  peer_reference: (_ws, args) => peerReference(typeof args.commonItem === "string" ? args.commonItem : undefined),
  intake_survey: (ws, args) => {
    const part = args.part as "all" | "questions" | "compose" | "crosswalk";
    // 当てはめの要約は、作業中の計画があるときだけ（行は写さず、欄ごとの要約と数だけ）
    const s: Record<string, unknown> = { ...ws.survey(), crosswalk: part === "all" || part === "crosswalk" ? crosswalkSurvey() : null };
    ws.note("ai", T.surveyed);
    if (part === "compose" || part === "crosswalk") return { ok: true, data: { ...s, files: [], samples: [], legends: [], notes: [], questions: [], stuck: [] } };
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
  // 案を置くだけ（作者「AI」・人が受けていない）。受ける・断るは画面の当てはめの欄だけにあり、ここからは呼ばない
  crosswalk_propose: (ws, args) => {
    const rules = args.rules as Rule[];
    const r = proposeFromAi(rules, Number(args.basedOnVersion));
    if (!r.ok) {
      ws.note("ai", T.crosswalkRefused(rules.length));
      return { ok: false, code: r.code };
    }
    ws.note("ai", T.crosswalkPlaced(rules.length, r.placed, r.data.conflicts));
    return { ok: true, data: r.data as unknown as Record<string, unknown> };
  },
  // 写真：人が許した写真を 1 枚受け取るか、受け取った写真に読んだ格子を置くだけ。許す・確かめる道はここに無い（画面だけ）
  photo_transcribe: (ws, args, ctx) =>
    args.mode === "receive"
      ? ws.photos.receive(args.imageRef as string | undefined, ctx.conversation)
      : ws.photos.place(args.grid as { imageRef: string; cells: PhotoCellIn[] }, ctx.conversation),
  // 検査の結果を読むだけ（画面と同じ基準日で、パックの検査の純粋な関数を走らせる）。検査を直す・判定を変える道は無い
  check_results: (ws, args) => {
    const working = getWorkingPlan();
    if (!working) return { ok: false, code: "no_working_plan" };
    const date = getReferenceDate();
    const data = checkResultsOf(working.plan, working.revision, date, args.checkId as string | undefined);
    ws.note("ai", REVIEW_TEXT.aiRead((data.checks as unknown[]).length, date));
    return { ok: true, data };
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
