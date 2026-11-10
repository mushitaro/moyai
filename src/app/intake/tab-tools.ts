// AI のツールの、タブの側の受け手（橋渡し → このタブ）。どれも取り込みの作業場（workspace.ts）か、作業中の計画の置き場を使う。
// 引数は橋渡しが型で確かめてあるが、ここでも確かめ直し（既定の値もここで埋まる）、答えも出力の型で確かめてから返す。
// AI に行のデータを引数で渡させない。返す行は星取表の行の一部だけで、上限は橋渡しが会話ごとに数える（§2.12）。
// 当てはめ（crosswalk_propose）は規則で案を置くだけで、数と行の参照だけを返す。人が受ける道はここに無い（画面だけ）。
// 写真（photo_transcribe）は、人が画面で許した写真の画像を 1 回だけ添えて返す（intake/photos.ts）。許す・確かめる道はここに無い。
// 取り込みを読む受け手（要約・決定・読み方）は、取り込みの答えを待ってから答える（画面のタブでは取り込みが worker の中にあるので、
// 読み取りの途中に呼ばれたら、それが終わってから答える。古い写しで答えない）。worker の無い所（試験）では同じスレッドでその場で答える。
import type { TabSentCode } from "../../shared/errors";
import {
  READING_DROP_NOTE_MIN,
  SKILL_CATALOG_TOOLS,
  SURVEY_FILES_DEFAULT,
  intakeAddFilesFromTabSchema,
  intakeAddFilesToTabSchema,
  toolDef,
  type IntakeAddFilesFromTab,
  type PhotoCellIn,
  type PhotoImage,
  type Rule,
  type ToolName,
} from "../../shared/tools";
import { activeSkills, skillCatalog } from "../skills";
import { getHandoffMail } from "../state/handoff";
import { buildChart } from "../../plan/chart";
import { catalogFor, emptyCatalog, packChoices } from "../chart/catalog";
import { crosswalkSurvey, proposeFromAi } from "../state/crosswalk";
import { getWorkingPlan } from "../state/plan-store";
import { applyPlanRules, planRuleMarks, proposeCyclesFromAi, watchPlanRules } from "../state/cycles";
import { checkStarsFromAi, proposeStarsFromAi } from "../state/stars";
import { assetKeyOf, fiscalYearOf } from "../../plan/chart";
import { assetLabels } from "../../plan/asset-names";
import { workRowRef, type StarIn } from "../../plan/star";
import { getPeerView } from "../state/peers";
import { activeRules, dropsWholeFile, isPlanRule, wholeFileUnaimed, type ReadingRule, type ReadingScope } from "../../import/reading";
import { planRuleStatus, type VerifiedBases } from "../../plan/cycle";
import type { Plan } from "../../shared/plan";
import { RECEIVE_MIN_K } from "../../share/k";
import { peerAggregates } from "../../share/peer-reference";
import { checkResultsOf, getReferenceDate, packCheckOf } from "../state/review";
import { REVIEW_TEXT, TEXT } from "../text";
import type { BridgeClient } from "../bridge-client";
import { sheetHash } from "../stages";
import { andThen, type DroppedFile, type IntakeWorkspace, type Maybe, type ProposeOutcome } from "./workspace";
import { screenSet, type ScreenSetArgs } from "./screen-set";
import { displayPrefs, goTo } from "../state/screen";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { offerTemplate } from "../state/template-draft";
import { getShareChoice, placeClaudeShare } from "../state/share";
import { sharePreviewNeeds } from "../../share/share-preview";

/** image は photo_transcribe の receive だけ（人が許した写真 1 枚。橋渡しが許しと照らす） */
export type TabToolResult = { ok: true; data: Record<string, unknown>; image?: PhotoImage } | { ok: false; code: TabSentCode };
export interface TabToolContext {
  conversation: string;
  /** この会話であと読める星取表の行（橋渡しが数える） */
  rowsRemaining: number;
}
type Receiver = (ws: IntakeWorkspace, args: Record<string, unknown>, ctx: TabToolContext) => Maybe<TabToolResult>;

const T = TEXT.intake.ai;

/**
 * 機器の行（n:…）の作業を 1 行ずつ（chart_propose の stars で指すため）：行の id は w:<作業>、欄は機器の段の道・作業の名前・星取のある年度。
 * 機器の行でない id（m:・c:）や無い機器は 0 行
 */
function workRows(rowRef: string, offset: number, limit: number, rowsRemaining: number): TabToolResult {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  const { plan } = working;
  const nodeKey = assetKeyOf(rowRef);
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  // 機器の名前は星取表の階層と同じ見せる名前（号機で分かれる同じ名前の機器は「名前 号機」）
  const shown = assetLabels(plan.assets);
  const path: string[] = [];
  for (let a = nodeKey !== null ? byKey.get(nodeKey) : undefined; a; a = a.parentKey !== null ? byKey.get(a.parentKey) : undefined) path.unshift(shown.get(a.nodeKey) ?? a.name);
  const works = nodeKey !== null && byKey.has(nodeKey) ? plan.works.filter((w) => w.targets.includes(nodeKey)) : [];
  const take = Math.max(0, Math.min(limit, rowsRemaining));
  const rows = works.slice(offset, offset + take).map((w) => {
    const cells: Record<string, string> = { [T.rowPath]: path.join(TEXT.chart.pathSep), [T.rowWork]: w.kind || w.workKey };
    const by = new Map<number, { plan: boolean; actual: boolean; review: boolean }>();
    for (const d of plan.details) {
      if (d.workKey !== w.workKey) continue;
      const c = by.get(d.fiscalYear) ?? { plan: false, actual: false, review: false };
      if (d.planOrActual === "plan") c.plan = true;
      else c.actual = true;
      if (d.needsReview) c.review = true;
      by.set(d.fiscalYear, c);
    }
    for (const fy of [...by.keys()].sort((a, b) => a - b)) {
      const c = by.get(fy)!;
      const mark = c.plan && c.actual ? "both" : c.actual ? "actual" : "plan";
      cells[TEXT.chart.fiscalYear(fy)] = `${c.review ? TEXT.chart.reviewPrefix : ""}${TEXT.chart.mark[mark]}`;
    }
    return { rowRef: workRowRef(w.workKey), cells };
  });
  return { ok: true, data: { rows, total: works.length, remainingInConversation: rowsRemaining - rows.length, version: working.revision } };
}

/** 星取表の行を AI に渡す形：段の道と、印のある年度だけ（印は画面と同じ記号）。階層と行の並びは、画面の星取表と同じ施設の見せ方 */
function chartRows(view: "base" | "adjusted", offset: number, limit: number, rowsRemaining: number): TabToolResult {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  const { plan } = working;
  const prefs = displayPrefs(plan.facility.facilityKey);
  const model = buildChart(
    plan,
    catalogFor(plan.packId) ?? emptyCatalog(),
    { levelFallback: TEXT.chart.levelFallback, commonLevels: TEXT.chart.commonLevels, unmapped: TEXT.chart.unmapped, series: TEXT.chart.series },
    { mode: "ledger", period: "year", layer: view === "base" ? "original" : "adjusted", foldLevel: null, levelOrder: prefs.levelOrder, rowOrder: prefs.rowOrder },
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
  // 見え方の答えは、人が施設に答えたものを先に使い、AI の答え（会話から）は人が答えていない軸にだけ使う（監-4）
  const ai = (args.answers ?? null) as { facility?: Record<string, string | null>; inNationalTable?: boolean | null } | null;
  const human = f.profile ?? {};
  const hasHuman = Object.keys(human).length > 0 || f.inNationalTable !== null;
  const answers =
    ai || hasHuman
      ? { facility: { ...(ai?.facility ?? {}), ...human }, inNationalTable: f.inNationalTable ?? ai?.inNationalTable ?? null }
      : null;
  // AI の答えで埋めた軸（根拠に「会話から写した答え」と書けるように返す）
  const aiAxes = Object.keys(ai?.facility ?? {}).filter((k) => !(k in human)).sort();
  if (ai && f.inNationalTable === null && typeof ai.inNationalTable === "boolean") aiAxes.push("inNationalTable");
  return { ok: true, data: { mode: "ledger", packId: working.plan.packId, facility: { scale: f.scale, scaleUnit: f.scaleUnit }, answers, aiAxes, commonItem: args.commonItem ?? null } };
}

/**
 * 共有ファイルの形と数（share_preview。仕事 share-preview-v1）：作業画面は、作業中の計画の ID と、SHARE の画面の共有先・共有フォルダ
 * （画面が開いていなければ null で、画面を開いたときの既定）と、このタブで Claude が置いた見え方の答えを橋渡しに渡し、SHARE を開く（screen_set の go: share と同じ）。
 * Claude の answers・dest は、SHARE の画面の今の選びにするだけ（画面に「- Claude の入力」。2026-11-10、SHARE の引き算）。署名・送る・設定の道はここに無い。
 * 共有ファイルは橋渡しが SHARE の画面と同じ関数で作り、形と数だけを AI に返す。計画が無ければ画面は動かさず、何も置かずに needs を返す
 */
function sharePreviewRequest(ws: IntakeWorkspace, args: Record<string, unknown>): TabToolResult {
  const working = getWorkingPlan();
  if (!working) return { ok: true, data: sharePreviewNeeds("no_plan", false) };
  const planId = working.plan.planId;
  const placed = placeClaudeShare(planId, {
    ...(args.dest === "ring" || args.dest === "ledger" ? { dest: args.dest } : {}),
    ...(args.answers ? { answers: args.answers as { facility: Record<string, string | null>; inNationalTable: boolean | null } } : {}),
  });
  const c = getShareChoice();
  const mine = c && c.planId === planId ? c : null;
  const screen = goTo("share");
  ws.note("ai", T.sharePreviewRead);
  return {
    ok: true,
    data: {
      mode: "share",
      planId,
      // Claude が今置いた共有先が先、なければ画面の選び、どちらも無ければ既定（橋渡しが決める）
      dest: (args.dest === "ring" || args.dest === "ledger" ? args.dest : null) ?? mine?.dest ?? placed.dest ?? null,
      ringId: mine?.ringId ?? null,
      ai: placed.answers ? { facility: { ...placed.answers.facility }, inNationalTable: placed.answers.inNationalTable } : null,
      national: working.plan.facility.inNationalTable,
      screen,
    },
  };
}

/** 周期の案を置く（chart_propose。docs/plan.md §2.18.4）：足すだけ。引いた印は作者 AI で、人が決定のシートで受けるまで決まらない */
function chartPropose(ws: IntakeWorkspace, args: Record<string, unknown>): TabToolResult {
  // ledger は橋渡しが照らしてから渡す（照らせなければここまで来ない）。無ければ会話からの案
  const author = args.author === "ai_relayed_human" ? "ai_relayed_human" : "ai";
  // ほかの根拠は AI が指すだけ。中身（間隔・基準の名前と出典・ルールの版と文）は MOYAI が計画・パック・当てている読み方から引く（Architect の 42 の 3）
  const bases = (args.bases ?? {}) as { record?: boolean; pack?: { checkId: string }; rule?: { name: string; ruleId: string } };
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  const verified: VerifiedBases = {};
  if (bases.record) verified.record = true;
  if (bases.pack) {
    const c = packCheckOf(working.plan.packId, bases.pack.checkId);
    if (!c) return { ok: false, code: "pack_basis_unknown" };
    verified.pack = c;
  }
  if (bases.rule) {
    const want = bases.rule;
    const a = activeRules(ws.currentReadings()).find((x) => x.from.name === want.name && x.rule.id === want.ruleId && isPlanRule(x.rule));
    if (!a) return { ok: false, code: "plan_rule_unknown" };
    verified.rule = { name: a.from.name, version: a.from.version, ruleId: a.rule.id, text: a.rule.text, status: planRuleStatus(a.from) };
  }
  // 台帳の根拠：橋渡しが照らした集計（checked）が無ければ台帳の案にしない（Architect の 52）
  const lg = args.ledger as { ledgerVersion: string; commonItem: string; work: string; checked?: { n: number; median: string; q1: string; q3: string } } | undefined;
  if (lg && !lg.checked) return { ok: false, code: "ledger_basis_mismatch" };
  if (lg?.checked) verified.ledger = { version: lg.ledgerVersion, commonItem: lg.commonItem, work: lg.work, ...lg.checked };
  const rules = (args.rules ?? []) as Rule[];
  const stars = (args.stars ?? []) as StarIn[];
  // 星取の案（src/plan/star.ts）：実績は基準日の年度まで。周期の案と一緒なら、周期の案を置く前に確かめる（1 つでも合わなければ、どれも置かない）
  const starOpts = {
    author,
    verified,
    fromLedger: Boolean(args.ledger),
    actualUpTo: fiscalYearOf(getReferenceDate(), working.plan.facility.fiscalYearStartMonth),
  } as const;
  if (stars.length > 0) {
    if (Number(args.basedOnVersion) !== working.revision) return { ok: false, code: "stale_version" };
    const bad = checkStarsFromAi(stars, starOpts);
    if (bad) return { ok: false, code: bad };
  }
  const r =
    rules.length > 0
      ? proposeCyclesFromAi(rules, Number(args.basedOnVersion), String(args.basis), { fromLedger: Boolean(args.ledger), author, verified })
      : ({ ok: true, plan: working.plan, proposals: [], version: working.revision } as const);
  if (!r.ok) return r;
  const marks = r.proposals.reduce((n, p) => n + p.detailKeys.length, 0);
  if (rules.length > 0) ws.note("ai", T.cyclesProposed(r.proposals.length, marks));
  const s = stars.length > 0 ? proposeStarsFromAi(stars, r.version, String(args.basis), { ...starOpts, checkVersion: false }) : null;
  if (s && !s.ok) return s;
  const plan = getWorkingPlan()?.plan ?? r.plan;
  const starRows = s && s.ok ? starResults(s, plan) : [];
  if (s && s.ok) ws.note("ai", T.starsProposed(new Set(starRows.filter((x) => x.placed).map((x) => x.id)).size));
  const examples = r.proposals
    .flatMap((p) => p.detailKeys)
    .slice(0, 10)
    .map((k) => {
      const d = r.plan.details.find((x) => x.detailKey === k)!;
      return { rowRef: `d:${k}`, before: null, after: TEXT.chart.cycleMark(d.fiscalYear) };
    });
  // 星取の案の例：作業の行の id と、前後の星取（追加は前が無く後が案、削除は前が今の星取で後が無い、移動は前が元の年度で後が先の年度）
  const starExamples = starRows
    .filter((x) => x.placed)
    .map((x) => {
      const st = stars[x.index]!;
      const text = (fy: number, v: "plan" | "actual") => `${TEXT.chart.fiscalYear(fy)} ${TEXT.chart.mark[v]}`;
      if (st.op === "move") return { rowRef: st.rowRef, before: text(st.fromFiscalYear, "plan"), after: text(st.fiscalYear, "plan") };
      return { rowRef: st.rowRef, before: st.op === "add" ? null : text(st.fiscalYear, st.value), after: st.op === "add" ? text(st.fiscalYear, st.value) : null };
    });
  return {
    ok: true,
    data: {
      matched: marks + starRows.filter((x) => x.placed).length,
      conflicts: 0,
      examples: [...examples, ...starExamples].slice(0, 10),
      proposals: r.proposals.map((p) => ({ id: p.id, years: p.years, works: p.works, marks: p.detailKeys.length, skipped: p.skipped, bases: basesOf(r.plan, p.detailKeys[0]) })),
      ...(stars.length > 0 ? { stars: starRows } : {}),
      version: getWorkingPlan()?.revision ?? r.version,
    },
  };
}

/** 星取の案の結果を、引数の順に（追加は置いた明細の根拠の種類も） */
function starResults(s: Extract<ReturnType<typeof proposeStarsFromAi>, { ok: true }>, plan: Plan) {
  return s.results.map(({ detailKeys, ...x }) => {
    const add = detailKeys.find((k) => plan.details.some((d) => d.detailKey === k && d.author !== "human" && k.startsWith("st-")));
    return add ? { ...x, bases: basesOf(plan, add) } : x;
  });
}

/** 案の印の出どころから、照らした根拠の種類（印が無ければ空） */
function basesOf(plan: Plan, detailKey: string | undefined): string[] {
  const d = detailKey ? plan.details.find((x) => x.detailKey === detailKey) : undefined;
  return (d?.sources ?? []).map((s) => s.file.slice(0, s.file.indexOf(":")));
}

/** 作業画面が今当てている Skill：選んでいるパック（作業中の計画のパック）と、当てている読み方 */
function skillsOf(ws: IntakeWorkspace) {
  return activeSkills(getWorkingPlan()?.plan.packId ?? (ws.settings.packId || null), ws.currentReadings());
}

/** 規則の when が効かない種類（資料を丸ごと外す決まった答えの when.file だけは効く） */
const WHEN_IGNORED: ReadonlySet<string> = new Set(["sameAsset", "answer", "planCycle"]);

/**
 * reading_rules_propose の答えの note：置いた規則が、置く前に読めていたデータのセルを多く外したこと（READING_DROP_NOTE_MIN 以上）、
 * 資料を指していないので効かない「資料を丸ごと外す答え」、下書きに無いので外せなかった id。どれも無ければ null
 */
function proposeNote(placed: readonly ReadingRule[], out: ProposeOutcome): string | null {
  const ids = new Set(placed.map((r) => r.id));
  const parts: string[] = [];
  const heavy = out.rules.filter((r) => ids.has(r.id) && r.dropped >= READING_DROP_NOTE_MIN);
  if (heavy.length) parts.push(`${heavy.map((r) => `ルール ${r.id} が読めていた ${r.dropped.toLocaleString("en-US")} セルを外した`).join("。")}。外したい行・列だけに当たっているかを、利用者に見せて確かめてください`);
  const unaimed = placed.filter(wholeFileUnaimed).map((r) => r.id);
  if (unaimed.length) parts.push(`資料を丸ごと外す答えは、when.file で資料を指してください（${unaimed.join("・")} は効いていない）`);
  if (out.missing.length) parts.push(`下書きに無いので外していない id：${out.missing.join("・")}（承認済みのルールは外せない）`);
  return parts.length ? `${parts.join("。")}。` : null;
}

export const TAB_TOOL_RECEIVERS: Partial<Record<ToolName, Receiver>> = {
  chart_propose: (ws, args) => chartPropose(ws, args),
  // 作業画面の見せ方（chat-ops-v1）：人の操作と同じ関数を通す。保存先は設定の画面の欄に入れるだけ（保存は人）
  screen_set: (ws, args) => screenSet(ws, args as ScreenSetArgs),
  reading_rules_propose: (ws, args) => {
    // AI の経路から来た規則は、作者を AI に固め、決めた人の呼び名は捨てる（人と名乗らせない。台帳の新-8）
    const fromAi = ((args.rules ?? []) as ReadingRule[]).map(({ by: _by, ...r }) => ({ ...r, author: "ai" as const }) as ReadingRule);
    const remove = (args.remove ?? []) as string[];
    // when が効かない種類（同じ機器・決まった答え・計画ルール）に when を付けた規則は断る（黙って広く当てない。Architect の 57）。
    // ただし資料を丸ごと外す決まった答えは、when.file で資料を指したときだけ効く（見出しの文字では絞れない。会話の繰り返しの試験 11-08）
    if (fromAi.some((r) => r.when && WHEN_IGNORED.has(r.kind) && !(dropsWholeFile(r) && r.when.file && !r.when.headers))) return { ok: false, code: "reading_when_ignored" };
    const name = String(args.name);
    return andThen(ws.proposeReadingWith(name, args.scope as ReadingScope, fromAi, remove), (placed) => {
      // 計画ルールは、当たる作業に周期の案（R）を出す（人が確定のシートで受けるまで決まらない）。件数は引いた印の数
      applyPlanRules();
      const plan = getWorkingPlan()?.plan ?? null;
      const mine = ws.draftReading(name)?.skill.rules ?? [];
      const rules = placed.rules.map(({ dropped: _d, ...x }) => {
        const r = mine.find((y) => y.id === x.id);
        return r && isPlanRule(r) ? { ...x, hits: planRuleMarks(plan, name, x.id) } : x;
      });
      // 数は、規則を置いたあとの写し（読み直しを待ってから）
      const v = ws.view;
      if (fromAi.length) ws.note("ai", T.readingProposed(name, fromAi.length));
      if (placed.removed.length) ws.note("ai", T.readingRemoved(name, placed.removed.length));
      const note = proposeNote(fromAi, placed);
      return {
        ok: true,
        data: { name: args.name, rules, removed: placed.removed, unresolvedCells: v.unresolvedCells, openQuestions: v.open.length, planReady: v.blockers.length === 0, ...(note ? { note } : {}) },
      } as TabToolResult;
    });
  },
  // 保管先の読み方の一覧：作業画面は今の施設だけを渡し、橋渡しが保管先を読む（本文は今の施設の分だけ。台帳の中-4）
  reading_skills_list: (ws) => ({ ok: true, data: { facilityKey: ws.facilityKey() } }),
  // 橋渡しが保管先に書く下書き（作業画面は中身を渡すだけ。書くのは橋渡し）
  reading_skill_register: (ws, args) => {
    const d = ws.draftReading(String(args.name));
    if (!d) return { ok: false, code: "no_reading_draft" };
    // 担当者は橋渡しが設定の呼び名から決める（AI の引数から取らない。監-3）
    return { ok: true, data: { skill: d.skill, facilityKey: ws.facilityKey() } };
  },
  peer_reference: (_ws, args) => (args.place === "ledger" ? ledgerRequest(args) : peerReference(typeof args.commonItem === "string" ? args.commonItem : undefined)),
  // 共有ファイルの形と数：作業画面は計画と SHARE の選びを渡し、SHARE を開くだけ（数えるのは橋渡し）
  share_preview: (ws, args) => sharePreviewRequest(ws, args),
  intake_survey: (ws, args) => {
    const part = args.part as "all" | "questions" | "compose" | "crosswalk" | "skills" | "files";
    // 資料の一覧は part: all か files のときだけ、limit（既定 20）まで。part: files は cursor から（全部の数は filesTotal）
    const fileLimit = typeof args.limit === "number" ? args.limit : SURVEY_FILES_DEFAULT;
    const fileCursor = part === "files" && typeof args.cursor === "number" ? args.cursor : 0;
    return andThen(ws.surveyWith(), (survey): TabToolResult => {
      const empty = { files: [], samples: [], legends: [], notes: [], questions: [], stuck: [] };
      const filesTotal = survey.files.length;
      if (part === "skills") {
        const s: Record<string, unknown> = { ...survey, crosswalk: null, ...empty, filesTotal };
        ws.note("ai", T.skillsRead);
        return { ok: true, data: { ...s, skillTexts: skillsOf(ws) } };
      }
      // 当てはめの要約は、作業中の計画があるときだけ（行は写さず、欄ごとの要約と数だけ）
      const s: Record<string, unknown> = {
        ...survey,
        files: survey.files.slice(fileCursor, fileCursor + fileLimit),
        filesTotal,
        crosswalk: part === "all" || part === "crosswalk" ? crosswalkSurvey() : null,
        handoff: getHandoffMail(),
      };
      ws.note("ai", T.surveyed);
      if (part === "compose" || part === "crosswalk") return { ok: true, data: { ...s, ...empty } };
      if (part === "files") return { ok: true, data: { ...s, ...empty, files: s.files } };
      if (part === "questions") return { ok: true, data: { ...s, files: [], samples: [], legends: [], notes: [] } };
      return { ok: true, data: s };
    });
  },
  intake_settle: (ws, args) => {
    const decisions = args.decisions as { questionId: string; answer: string; author: "ai" | "ai_relayed_human"; reason: string }[];
    return andThen(ws.settleWith(decisions), (r): TabToolResult => {
      if (!r.ok) {
        ws.note("ai", T.settleRefused(decisions.length));
        return { ok: false, code: r.code };
      }
      ws.note("ai", T.settled(decisions.length, r.unresolved));
      return { ok: true, data: { cellsAffected: r.cellsAffected, rowsAffected: r.rowsAffected, unresolved: r.unresolved } };
    });
  },
  intake_compose: (ws) => {
    const r = ws.startCompose("ai");
    ws.note("ai", r.started ? T.composeStarted : T.composeRunning);
    return { ok: true, data: r };
  },
  chart_rows: (ws, args, ctx) => {
    const r =
      typeof args.rowRef === "string"
        ? workRows(args.rowRef, Number(args.offset), Number(args.limit), ctx.rowsRemaining)
        : chartRows(args.view as "base" | "adjusted", Number(args.offset), Number(args.limit), ctx.rowsRemaining);
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
 * 読み方を保管先に書く（作業画面は下書きを渡す）と、公開の台帳だけを読む（作業画面は計画のパックと規模を渡す）と、
 * 共有ファイルの形と数（作業画面は計画と SHARE の選びを渡す）。
 */
const INTERMEDIATE: Partial<Record<ToolName, (d: Record<string, unknown>) => boolean>> = {
  reading_skill_register: (d) => !!d.skill && typeof d.skill === "object",
  peer_reference: (d) => d.mode === "ledger" && typeof d.packId === "string",
  share_preview: (d) => d.mode === "share" && typeof d.planId === "string",
};

function runTabToolWith(ws: IntakeWorkspace, name: ToolName, rawArgs: Record<string, unknown>, ctx: TabToolContext): Maybe<TabToolResult> {
  const receiver = TAB_TOOL_RECEIVERS[name];
  if (!receiver) return { ok: false, code: "tool_failed" };
  const def = toolDef(name);
  const args = def.input.safeParse(rawArgs);
  if (!args.success) return { ok: false, code: "tool_failed" };
  return andThen(receiver(ws, args.data as Record<string, unknown>, ctx), (r0) => {
    if (!r0.ok) return r0;
    // 今効いている Skill の目録を添える（本文は intake_survey の part: skills。docs/plan.md §2.18.3）
    const r: TabToolResult = (SKILL_CATALOG_TOOLS as readonly string[]).includes(name) ? { ...r0, data: { ...r0.data, skills: skillCatalog(skillsOf(ws)) } } : r0;
    // AI へ返す答えは型で確かめる。橋渡しへ渡す途中の中身は、その形だけを確かめる
    const mid = INTERMEDIATE[name];
    if (mid?.(r.data)) return r;
    if (!def.output.safeParse(r.data).success) return { ok: false, code: "tool_failed" };
    return r;
  });
}

/** AI のツールを 1 つ動かし、その場で答える（取り込みの受け手が同じスレッドのときだけ。試験が使う） */
export function runTabTool(ws: IntakeWorkspace, name: ToolName, rawArgs: Record<string, unknown>, ctx: TabToolContext): TabToolResult {
  const r = runTabToolWith(ws, name, rawArgs, ctx);
  if (r instanceof Promise) throw new Error("取り込みが worker の中にあるときは runTabToolAsync で待つ");
  return r;
}

/** 資料の中身を取りに行く手（橋渡しの経路 tabIntakeFile。BridgeClient.fetchIntakeFile。試験は差し替える） */
export type FetchIntakeFile = (fileId: string) => Promise<Uint8Array | null>;

/** 作業画面にある資料の名前と件数（取り込みの資料はシートと行の数、写真の欄の画像は null） */
async function namesIn(ws: IntakeWorkspace): Promise<Map<string, { sheets: number | null; rows: number | null }>> {
  const m = new Map<string, { sheets: number | null; rows: number | null }>();
  for (const f of (await ws.surveyWith()).files) m.set(f.fileRef, { sheets: f.sheets, rows: f.rows });
  for (const e of ws.photoBook.entries()) if (!m.has(e.input.name)) m.set(e.input.name, { sheets: null, rows: null });
  return m;
}

/**
 * 施設設定の Skillパックと施設名を、作業画面のその欄が空のときだけ置く（人が画面で選んだ・打ったものは上書きしない）。
 * 置いたものと、欄に違う値があって置かなかったものを、AI の作業の欄に知らせる。
 */
function placeFacility(ws: IntakeWorkspace, pack: { id: string; name: string } | null, facilityName: string | null): void {
  const patch: { packId?: string; facilityName?: string } = {};
  const set: string[] = [];
  const kept: string[] = [];
  if (pack) {
    if (!ws.settings.packId) {
      patch.packId = pack.id;
      set.push(T.facilityPack(pack.name));
    } else if (ws.settings.packId !== pack.id) kept.push(T.facilityPack(pack.name));
  }
  if (facilityName) {
    const now = ws.settings.facilityName.trim();
    if (!now) {
      patch.facilityName = facilityName;
      set.push(T.facilityName(facilityName));
    } else if (now !== facilityName) kept.push(T.facilityName(facilityName));
  }
  // 1 回で置く（Skillパックが変わると読み直すので、2 回に分けない）
  if (set.length) {
    ws.setFacility(patch);
    ws.note("ai", T.facilitySet(set));
  }
  if (kept.length) ws.note("ai", T.facilityKept(kept));
}

/**
 * intake_add_files の作業画面の側（受け手の種類は bridge_then_tab）：橋渡しが選んだ資料を、資料の印で 1 つずつ取りに行き、
 * 人が落とした資料と同じ道（workspace の addFiles と、【架空】の印を見て架空にすること）で取り込む。
 * 返すのは、入れた資料の名前と件数（シートと行の数）、断った資料の名前と理由だけ（セルの値・文字は返さない。安全の決まり 3）。
 * デモの資料は、利用者の資料（デモで入れたもののほか。資料に【架空】とあっても）・架空でない資料・ほかのパックの資料と混ぜない。
 * Skillパックと施設名（demo はデモのもの、folder は AI が添えたもの）は、作業画面のその欄が空のときだけ置く（人が画面で選んだ・打ったものは上書きしない）。
 */
/** 資料を入れたあと、読み終わるのを待つ上限（ツールの待ちの上限 30 秒より短く） */
export const ADD_WAIT_MS = 20_000;

/** 作業中の計画の階層の名前（星取表の施設台帳の列。asset-first の順）。計画が無ければ undefined */
function planLevelNames(): string[] | undefined {
  const working = getWorkingPlan();
  if (!working) return undefined;
  const C = TEXT.chart;
  const model = buildChart(working.plan, catalogFor(working.plan.packId) ?? emptyCatalog(), { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series }, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
  return model.levelNames.slice(0, 12).map((n) => n.slice(0, 40));
}

/**
 * source: template（様式を EXPORT の様式の欄に入れる）：橋渡しが確かめた .xlsx 1 つを資料の印で取りに行き、Excel として読めたら
 * 画面の中の置き場（state/template-draft.ts）に置いて EXPORT を開く。保存はしない（出力と保存は人が「署名して出力」を押す）。
 * 返すのは名前とシートの数と、作業中の計画の階層の名前だけ（様式の形は橋渡しが読んで AI に返す）
 */
async function addTemplateFromBridge(ws: IntakeWorkspace, files: { fileId: string; name: string; size: number }[], fetchFile: FetchIntakeFile): Promise<TabToolResult> {
  const refused: IntakeAddFilesFromTab["refused"] = [];
  const added: IntakeAddFilesFromTab["added"] = [];
  for (const f of files) {
    const bytes = await fetchFile(f.fileId);
    if (!bytes || bytes.length !== f.size) {
      refused.push({ name: f.name, reason: "changed" });
      continue;
    }
    const name = f.name.replace(/\.xlsx$/i, "");
    try {
      const probe = new (patchedExcelJS().Workbook)();
      await probe.xlsx.load(bytes.slice().buffer as ArrayBuffer);
      if (probe.worksheets.length === 0) throw new Error("no sheet");
      offerTemplate({ name, bytes, probe, saved: null });
      added.push({ name: f.name, sheets: probe.worksheets.length, rows: null });
      ws.note("ai", T.templateAdded(name));
    } catch {
      refused.push({ name: f.name, reason: "unreadable" });
      ws.note("ai", T.templateRefused(name));
    }
  }
  if (added.length) goTo("export");
  const levels = added.length ? planLevelNames() : undefined;
  const data = { added, refused, ...(levels ? { levels } : {}) };
  return intakeAddFilesFromTabSchema.safeParse(data).success ? { ok: true, data } : { ok: false, code: "tool_failed" };
}

export async function addFilesFromBridge(ws: IntakeWorkspace, rawArgs: Record<string, unknown>, fetchFile: FetchIntakeFile): Promise<TabToolResult> {
  const p = intakeAddFilesToTabSchema.safeParse(rawArgs);
  if (!p.success) return { ok: false, code: "tool_failed" };
  const a = p.data;
  if (a.source === "template") return addTemplateFromBridge(ws, a.files, fetchFile);
  const demo = a.source === "demo";
  // 作業画面の Skillパックの欄で選べないものは置かない（橋渡しの packs/ と作業画面のビルドが合っていない）
  const pack = a.pack ? packChoices().find((c) => c.id === a.pack) : undefined;
  if (a.pack && !pack) {
    ws.note("ai", T.packNotOnScreen(a.pack));
    return { ok: false, code: "intake_pack_not_on_screen" };
  }
  if (demo) {
    // ほかの Skillパックが選ばれている作業画面には入れない（誤りで返す）
    const otherPack = !!ws.settings.packId && !!a.pack && ws.settings.packId !== a.pack;
    if (otherPack) {
      ws.note("ai", T.demoMixed);
      return { ok: false, code: "intake_demo_mixed" };
    }
    // 利用者の資料（デモで入れたもののほか。資料に【架空】とあっても）・架空でない資料・読込の途中の資料があれば、
    // どれも入れずに mixed で断る（利用者の資料と架空の資料を混ぜない。デモの資料どうしは今どおり、同じ名前として断る）
    if (ws.userFileNames.length > 0 || ws.readProgress !== null || (ws.fileCount > 0 && !ws.settings.fictional)) {
      ws.note("ai", T.demoMixed);
      const data = { added: [], refused: a.files.map((f) => ({ name: f.name, reason: "mixed" as const })) };
      return intakeAddFilesFromTabSchema.safeParse(data).success ? { ok: true, data } : { ok: false, code: "tool_failed" };
    }
  }
  placeFacility(ws, pack ?? null, a.facilityName);
  const before = await namesIn(ws);
  const refused: IntakeAddFilesFromTab["refused"] = [];
  const got: (DroppedFile & { name: string })[] = [];
  for (const f of a.files) {
    const bytes = await fetchFile(f.fileId);
    if (!bytes || bytes.length !== f.size) refused.push({ name: f.name, reason: "changed" });
    else got.push({ name: f.name, size: bytes.length, bytes: async () => bytes });
  }
  // 読み終わるまで待つのは 20 秒まで。資料が多い・大きいとき（北部CC の日報 5 冊など）は、入れたことだけを返し、
  // 読込の進みは intake_survey が返す（ツールの待ちの上限を越えて「結果不明」にしない。11-07）
  const reading = got.length ? ws.addFiles(got) : Promise.resolve();
  const late = await Promise.race([reading.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), ADD_WAIT_MS))]);
  if (late) {
    void reading.then(() => {
      if (demo) ws.markDemoFiles(got.map((f) => f.name));
      if (!ws.settings.fictional && (demo || ws.sourcesMarkedFictional())) ws.setFacility({ fictional: true });
    });
    ws.note("ai", T.filesAdded(demo, got.length, refused.length));
    if (got.length && typeof location !== "undefined") location.hash = sheetHash("files");
    const data = { added: got.map((f) => ({ name: f.name, sheets: null, rows: null })), refused };
    return intakeAddFilesFromTabSchema.safeParse(data).success ? { ok: true, data } : { ok: false, code: "tool_failed" };
  }
  // デモで入れた資料に印を付ける（ほかの資料は利用者の資料。次のデモを混ぜないため）
  if (demo) ws.markDemoFiles(got.map((f) => f.name));
  // 要約を待ってから見る（worker のときは、読み終わった写しが届いてから【架空】の印が分かる）
  const after = await namesIn(ws);
  if (got.length && !ws.settings.fictional && (demo || ws.sourcesMarkedFictional())) ws.setFacility({ fictional: true });
  const added: IntakeAddFilesFromTab["added"] = [];
  for (const f of got) {
    const x = after.get(f.name);
    if (x && !before.has(f.name)) added.push({ name: f.name, sheets: x.sheets, rows: x.rows });
    else refused.push({ name: f.name, reason: before.has(f.name) ? "same_name" : ws.skippedFiles.some((s) => s.file === f.name) ? "too_large" : "unreadable" });
  }
  ws.note("ai", T.filesAdded(demo, added.length, refused.length));
  // 人が資料を落としたときと同じに、資料のシートへ移る（画面は AI の作業を追う）
  if (added.length && typeof location !== "undefined") location.hash = sheetHash("files");
  const data = { added, refused };
  return intakeAddFilesFromTabSchema.safeParse(data).success ? { ok: true, data } : { ok: false, code: "tool_failed" };
}

/** 受け手の種類が bridge_then_tab のツールの、作業画面の側の受け手（中身を取りに行くので、答えを待つ） */
export const TAB_ASYNC_TOOL_RECEIVERS: Partial<Record<ToolName, (ws: IntakeWorkspace, args: Record<string, unknown>, fetchFile: FetchIntakeFile) => Promise<TabToolResult>>> = {
  intake_add_files: addFilesFromBridge,
};

/** AI のツールを 1 つ動かし、取り込みの答えを待って答える（橋渡しからの呼び出しはこれ。時間の上限は橋渡しが持つ） */
export async function runTabToolAsync(ws: IntakeWorkspace, name: ToolName, rawArgs: Record<string, unknown>, ctx: TabToolContext): Promise<TabToolResult> {
  return runTabToolWith(ws, name, rawArgs, ctx);
}

/** 橋渡しとの接続に、このタブの作業場を AI のツールの受け手としてつなぐ（App が 1 回だけ呼ぶ） */
export function connectTabTools(client: BridgeClient, ws: IntakeWorkspace): void {
  // 計画ルールの案（R）：作業中の計画か当てているルールが変わるたびに出し直す
  watchPlanRules();
  client.setToolHandlers({
    call: async (name, args, ctx) => {
      const later = TAB_ASYNC_TOOL_RECEIVERS[name];
      return later ? later(ws, args, (id) => client.fetchIntakeFile(id)) : runTabToolAsync(ws, name, args, ctx);
    },
    unknown: (name) => ws.note("unknown", TEXT.intake.activity.unknown(name)),
  });
}
