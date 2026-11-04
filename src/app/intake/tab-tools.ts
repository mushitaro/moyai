// AI のツールの、タブの側の受け手（橋渡し → このタブ）。どれも取り込みの作業場（workspace.ts）か、作業中の計画の置き場を使う。
// 引数は橋渡しが型で確かめてあるが、ここでも確かめ直し（既定の値もここで埋まる）、答えも出力の型で確かめてから返す。
// AI に行のデータを引数で渡させない。返す行は星取表の行の一部だけで、上限は橋渡しが会話ごとに数える（§2.12）。
// 当てはめ（crosswalk_propose）は規則で案を置くだけで、数と行の参照だけを返す。人が受ける道はここに無い（画面だけ）。
// 写真（photo_transcribe）は、人が画面で許した写真の画像を 1 回だけ添えて返す（intake/photos.ts）。許す・確かめる道はここに無い。
import type { TabSentCode } from "../../shared/errors";
import { SKILL_CATALOG_TOOLS, toolDef, type PhotoCellIn, type PhotoImage, type Rule, type ToolName } from "../../shared/tools";
import { activeSkills, skillCatalog } from "../skills";
import { buildChart } from "../../plan/chart";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { crosswalkSurvey, proposeFromAi } from "../state/crosswalk";
import { getWorkingPlan } from "../state/plan-store";
import { proposeCyclesFromAi } from "../state/cycles";
import { getPeerView } from "../state/peers";
import type { ReadingRule, ReadingScope } from "../../import/reading";
import { RECEIVE_MIN_K } from "../../share/k";
import { peerAggregates } from "../../share/peer-reference";
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

/** 人が星取表で開いた比べから、下限を守った集計と匿名の札だけを返す（鍵・見え方の値・年度・施設ごとの帯は返さない） */
function peerReference(commonItem: string | undefined): TabToolResult {
  const v = getPeerView();
  if (!v) return { ok: false, code: "no_peer_view" };
  return { ok: true, data: { mode: "view", position: v.comparison.position, floorK: RECEIVE_MIN_K, ...peerAggregates(v.comparison, commonItem) } };
}

/** 公開の台帳だけを読むときは、作業画面は計画のパックと施設の規模を渡し、橋渡しが台帳を読んで比べる（人が比べを開かなくてよい。運営者の決定） */
function ledgerRequest(args: Record<string, unknown>): TabToolResult {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  const f = working.plan.facility;
  return { ok: true, data: { mode: "ledger", packId: working.plan.packId, facility: { scale: f.scale, scaleUnit: f.scaleUnit }, answers: args.answers ?? null, commonItem: args.commonItem ?? null } };
}

/** 周期の案を置く（chart_propose。docs/plan.md §2.18.4）：足すだけ。引いた印は作者 AI で、人が決定のシートで受けるまで決まらない */
function chartPropose(ws: IntakeWorkspace, args: Record<string, unknown>): TabToolResult {
  const r = proposeCyclesFromAi(args.rules as Rule[], Number(args.basedOnVersion), String(args.basis));
  if (!r.ok) return r;
  const marks = r.proposals.reduce((n, p) => n + p.detailKeys.length, 0);
  ws.note("ai", T.cyclesProposed(r.proposals.length, marks));
  const examples = r.proposals
    .flatMap((p) => p.detailKeys)
    .slice(0, 10)
    .map((k) => {
      const d = r.plan.details.find((x) => x.detailKey === k)!;
      return { rowRef: `d:${k}`, before: null, after: TEXT.chart.cycleMark(d.fiscalYear) };
    });
  return {
    ok: true,
    data: {
      matched: marks,
      conflicts: 0,
      examples,
      proposals: r.proposals.map((p) => ({ id: p.id, years: p.years, works: p.works, marks: p.detailKeys.length, skipped: p.skipped })),
      version: r.version,
    },
  };
}

/** 作業画面が今当てている Skill：選んでいるパック（作業中の計画のパック）と、当てている読み方 */
function skillsOf(ws: IntakeWorkspace) {
  return activeSkills(getWorkingPlan()?.plan.packId ?? (ws.settings.packId || null), ws.currentReadings());
}

export const TAB_TOOL_RECEIVERS: Partial<Record<ToolName, Receiver>> = {
  chart_propose: (ws, args) => chartPropose(ws, args),
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
  peer_reference: (_ws, args) => (args.place === "ledger" ? ledgerRequest(args) : peerReference(typeof args.commonItem === "string" ? args.commonItem : undefined)),
  intake_survey: (ws, args) => {
    const part = args.part as "all" | "questions" | "compose" | "crosswalk" | "skills";
    if (part === "skills") {
      const s: Record<string, unknown> = { ...ws.survey(), crosswalk: null, files: [], samples: [], legends: [], notes: [], questions: [], stuck: [] };
      ws.note("ai", T.skillsRead);
      return { ok: true, data: { ...s, skillTexts: skillsOf(ws) } };
    }
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
/**
 * 橋渡しが続きを作るツール（作業画面の答えは途中の中身で、AI へ返す型は橋渡しが確かめる）の、途中の中身の型。
 * 読み方を保管先に書く（作業画面は下書きを渡す）と、公開の台帳だけを読む（作業画面は計画のパックと規模を渡す）。
 */
const INTERMEDIATE: Partial<Record<ToolName, (d: Record<string, unknown>) => boolean>> = {
  reading_skill_register: (d) => !!d.skill && typeof d.skill === "object",
  peer_reference: (d) => d.mode === "ledger" && typeof d.packId === "string",
};

export function runTabTool(ws: IntakeWorkspace, name: ToolName, rawArgs: Record<string, unknown>, ctx: TabToolContext): TabToolResult {
  const receiver = TAB_TOOL_RECEIVERS[name];
  if (!receiver) return { ok: false, code: "tool_failed" };
  const def = toolDef(name);
  const args = def.input.safeParse(rawArgs);
  if (!args.success) return { ok: false, code: "tool_failed" };
  const r0 = receiver(ws, args.data as Record<string, unknown>, ctx);
  if (!r0.ok) return r0;
  // 今効いている Skill の目録を添える（本文は intake_survey の part: skills。docs/plan.md §2.18.3）
  const r: TabToolResult = (SKILL_CATALOG_TOOLS as readonly string[]).includes(name) ? { ...r0, data: { ...r0.data, skills: skillCatalog(skillsOf(ws)) } } : r0;
  // AI へ返す答えは型で確かめる。橋渡しへ渡す途中の中身は、その形だけを確かめる
  const mid = INTERMEDIATE[name];
  if (mid?.(r.data)) return r;
  if (!def.output.safeParse(r.data).success) return { ok: false, code: "tool_failed" };
  return r;
}

/** 橋渡しとの接続に、このタブの作業場を AI のツールの受け手としてつなぐ（App が 1 回だけ呼ぶ） */
export function connectTabTools(client: BridgeClient, ws: IntakeWorkspace): void {
  client.setToolHandlers({
    call: async (name, args, ctx) => runTabTool(ws, name, args, ctx),
    unknown: (name) => ws.note("unknown", TEXT.intake.activity.unknown(name)),
  });
}
