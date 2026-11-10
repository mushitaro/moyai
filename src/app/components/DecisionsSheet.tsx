// MERGE のシート「決定」（docs/screens.md 3.2、絵は Decisions.dc.html・docs/plan.md §2.9）：Claude が決めたことと、会話から写した人の答え。受けるまで、版は確定できない。
// 1 つの表に、受けていないものを先に並べる。列は「何を（種類の札）｜なぜ｜決めた人｜行｜受ける」。行は箱にせず、罫線だけ。
// - 当てはめの案（Claude が置いた規則）：1 規則 1 行。受けるか、確かめのダイアログを通して断る（state/crosswalk.ts の人だけの道）。
// - 台帳からの案（chart_propose の周期の案）：案ごとに 1 行（引いた印の数を行に）。受けると、その案の印をすべて受ける。
// - ルール案（計画ルールから出した周期の案。ID の頭 R）：台帳からの案と同じく案ごとに 1 行。
// - 会話からの星取の案（chart_propose の stars。ID の頭 S。docs/screens.md 3.2、Wire、11-06 夜）：1 案 1 行。題は「計画の追加」「計画の削除」「計画の移動」
//   「実績の追加」「実績の削除」と機器 › 作業、下の行に年度と種類（会話の回答か Claude 判断）、件数は星取の数。詳しくに星取を 1 つずつ並べる。
//   追加は計画の明細（確定は state/decisions.ts）、削除は作業画面の状態（state/stars.ts。確定すると明細を外す）。
// - Claude の決定・会話から写した答え：1 行ずつ。
// 理由の欄は上に 1 つ。1 行ずつ受けるときも、まとめて受けるときも、その理由を使う（空のあいだは押せない）。受けたものは下にたたむ。
// 会話の回答は判断の理由を求めない（docs/screens.md 3.2「会話の回答の受け方」、Wire、11-07）：種類で「会話の回答」を選ぶと理由の欄を出さず、
// 上の行は「| 会話の回答 n 件を確定」だけ。行ごとの「| 確定」も理由なしで押せる。版の記録に入る理由は、Claude が置いた理由（会話の回答の理由）のまま。
// 「| 却下」は今どおり却下のダイアログで理由を書く。
// 件数は、数のある行が表示中の種類に 1 つも無ければ列ごと出さない。「理由」は 1 行で切り（全文は title と詳しく）、「| 却下」「| 確定」の列は右端に固定する。
// 受けた決定はこのタブのメモリ（state/decisions.ts）に持ち、署名のダイアログがそこから読んで送る。
import { Alert, Button, Group, Modal, Stack, Table, Text, TextInput } from "@mantine/core";
import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MergeSideContext } from "../state/merge-side";
import { requestChartJump, type ChartJump } from "../state/chart-jump";
import { sheetHash } from "../stages";
import { commonRowId, periodKeyOf } from "../../plan/chart";
import { crosswalkSummary, heldRows, type CrosswalkProposal } from "../../plan/crosswalk";
import { useConnection } from "../state/bridge";
import { pendingDecisions, type Decision } from "../../plan/diff";
import { applyAcceptedCycles, cycleIdOf, isLedgerCycle, isPlanRuleCycle } from "../../plan/cycle";
import { STAR_KIND_TEXT, basisWithoutReference, isStarProposal, proposalIdOf, starValueOfKey, type StarKind } from "../../plan/star";
import { rejectCycleByHuman, rejectedCycles } from "../state/cycles";
import {
  acceptRemovalsByHuman,
  openRemovalCount,
  rejectStarGroupByHuman,
  rejectedStarGroups,
  starGroups,
  clearStarPick,
  peekStarPick,
  undoRemovalsByHuman,
  useStarGroups,
  type StarGroup,
} from "../state/stars";
import type { Plan, WorkT } from "../../shared/plan";
import type { Acceptance } from "../../plan/diff";
import type { BridgeClient } from "../bridge-client";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { acceptByHuman, getCrosswalkBase, rejectByHuman, valueLabel } from "../state/crosswalk";
import { acceptDecision, isAccepted, unacceptDecision, useAccepted } from "../state/decisions";
import { useWorkingPlan } from "../state/plan-store";
import { HUMAN_TEXT, TEXT } from "../text";
import { DirectSet } from "./CrosswalkPanel";
import { usePlanStatus } from "./ConfirmDialog";
import { Switch } from "./Switch";
import { StarReference } from "./StarReference";

const T = HUMAN_TEXT.decisions;
const KINDS = ["same", "crosswalk", "ledger", "rule", "relayed", "ai"] as const;
type Kind = (typeof KINDS)[number];
/** 確定のシートの種類（第 n 版と同じ・紐付け案・台帳案・ルール案・会話の回答・Claude 判断） */
export type DecisionKind = Kind;
const W = TEXT.crosswalk;
const NO_PROPOSALS: readonly CrosswalkProposal[] = [];
/** 受けた記録の理由の上限（橋渡しの確定の形と、判断の理由の欄の上限） */
const REASON_MAX = 500;

/**
 * 会話の回答を受けるときに、版の記録に入れる理由（docs/screens.md 3.2「会話の回答の受け方」、Wire、11-07）。
 * 判断の理由は求めない（理由は会話にあり、受けるのは答えた本人）。入れるのは Claude が置いた理由（会話の回答の理由）のまま。
 * 上限の 500 字を越える分は切る。空なら種類の名前（「会話の回答」）を入れる（記録の理由は空にできない）。
 */
export function relayedReason(basis: string): string {
  const b = basis.trim();
  return (b.length > 0 ? b : T.kinds.relayed).slice(0, REASON_MAX);
}

/** 種類ごとの、受けるときの理由：会話の回答は Claude が置いた理由、ほかは人が書いた判断の理由 */
export function acceptReasonOf(kind: Kind, typed: string, basis: string): string {
  return kind === "relayed" ? relayedReason(basis) : typed;
}

/** 決定を受ける（1 行ずつも、まとめても同じ）。受けた数を返す（判断の理由が空なら受けない） */
export function acceptDecisionsAs(kind: Kind, ds: readonly Decision[], typed: string): number {
  let n = 0;
  for (const d of ds) if (acceptDecision(d.id, d.hash, acceptReasonOf(kind, typed, d.basis))) n++;
  return n;
}

/**
 * 受けていない決定（版の履歴で受けたものを除く）。署名のダイアログと下の帯も同じ数を使う。
 * 案のままの当てはめの規則が当てている行は、決定の 1 行ずつには出さない（規則の行で受ける。二重に出さない。台帳の新-4）。
 * openRules は案のままの規則の数（下の帯の数に足す）
 */
export function usePending(client: BridgeClient, plan: Plan | null): { pending: Decision[]; openRules: number; openRemovals: number; ready: boolean; problem: string | null } {
  // つながっているあいだだけ読む（つながる前に送って失敗したまま止まらないように。つなぎ直すと読み直す。Merge の版の読みと同じ）
  const { state: conn } = useConnection();
  const [load] = usePlanStatus(client, plan?.planId ?? "", !!plan && conn.kind === "open");
  const status = load.kind === "ready" ? load.status : null;
  const working = useWorkingPlan();
  const proposals = working?.proposals ?? NO_PROPOSALS;
  // 星取の削除の案（計画に無いので、ここから数える。案のままのものは確定を止める）
  useStarGroups();
  const openRemovals = openRemovalCount();
  const pending = useMemo(() => {
    if (!plan || !status) return [];
    const held = new Set<string>();
    for (const p of proposals) if (p.state === "proposed") for (const ref of heldRows(plan, p)) held.add(ref.startsWith("n:") ? `item:${ref.slice(2)}` : `attr:${ref.slice(2)}`);
    return pendingDecisions(plan, status.accepted ?? []).filter((d) => !held.has(d.id));
  }, [plan, status, proposals]);
  // 受けた決定を読めないあいだ（読込中・保存先が無い・読めない）は、受けていない決定を 0 と数えない。ready が false のうちは確定を止める（mushitaro/moyai#36）
  return { pending, openRules: proposals.filter((p) => p.state === "proposed").length, openRemovals, ready: !!status, problem: load.kind === "error" ? load.message : null };
}

// ─── 周期の案を受けたときの作業のきっかけ（Architect の 44。Wire、11-06） ───────────
/** 受けた決定のうち、計画の印（明細）の鍵 */
function acceptedDetailKeys(accepted: ReadonlyMap<string, Acceptance>): Set<string> {
  return new Set([...accepted.values()].filter((a) => a.id.startsWith("detail:")).map((a) => a.id.slice("detail:".length)));
}
/** 同じ作業に年数の違う周期の案を受けている作業（確定を止める。下の帯の「周期の案の重複 n」） */
export function cycleConflicts(plan: Plan | null, accepted: ReadonlyMap<string, Acceptance>): string[] {
  if (!plan) return [];
  const r = applyAcceptedCycles(plan, acceptedDetailKeys(accepted));
  return r.ok ? [] : r.conflicts;
}
/** 受けても作業のきっかけを変えない理由（稼働の枝・枝がいくつも・月の周期） */
function keptWhy(w: WorkT | undefined): string {
  const bs = ((w?.trigger as { branches?: { kind: string; meter?: string }[] } | null)?.branches ?? []) as { kind: string; meter?: string }[];
  if (bs.length > 1) return T.keptBranches(bs.length);
  if (bs[0]?.kind === "meter") return T.keptMeter;
  return T.keptMonths;
}
/** 1 つの周期の案を受けたら、作業のきっかけがどう変わるか：「周期 4 年 → 5 年」と「反映なし（…）」の字（同じ字は 1 つ） */
function cycleEffect(plan: Plan, ds: readonly Decision[]): { changes: string[]; kept: string[] } {
  const r = applyAcceptedCycles(plan, new Set(ds.map((d) => d.id.slice("detail:".length))));
  if (!r.ok) return { changes: [], kept: [] };
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  return {
    changes: [...new Set(r.changes.flatMap((c) => (c.kind !== "kept" && c.years !== null ? [T.cycleChange(c.from, c.years)] : [])))],
    // 年数を鍵から読めない前の形の案（years が null）は、きっかけを変えない（Architect の 61）
    kept: [...new Set(r.changes.filter((c) => c.kind === "kept").map((c) => T.cycleKept(c.years === null ? T.keptOldKey : keptWhy(works.get(c.workKey)))))],
  };
}

/** 規則の条件の値を人の言葉で（節や作業の鍵の条件は、その名前に読み替える） */
function whenValues(p: CrosswalkProposal, names: ReadonlyMap<string, string>): string[][] {
  return p.rule.when.map((c) => c.values.map((v) => (c.field === "assetNode.nodeKey" || c.field === "work.workKey" ? (names.get(String(v)) ?? String(v)) : String(v))));
}
/**
 * 短く：条件ごとに頭の 1 つと「ほか n」（「ごみクレーン」ほか 9）。全部は詳しくへ（Wire）。
 * 段の条件は短い言い方に出さない。系列の条件は、最初の条件の名前に添える（節「焼却炉本体（系列 2）」。Wire、2026-11-05）
 */
function whenShort(p: CrosswalkProposal, names: ReadonlyMap<string, string>): string {
  const vals = whenValues(p, names);
  let series: string | null = null;
  const parts: string[][] = [];
  p.rule.when.forEach((c, i) => {
    if (c.field === "assetNode.level") return;
    if (c.field === "assetNode.series") series = vals[i]?.[0] ?? null;
    else parts.push(vals[i] ?? []);
  });
  if (parts.length === 0) return whenText(p, names);
  return parts
    .map((vs, i) => `「${vs[0] || T.blank}${i === 0 && series !== null ? `（${TEXT.chart.series(series)}）` : ""}」${vs.length > 1 ? T.more(vs.length - 1) : ""}`)
    .join(T.and);
}
/** 全部：「焼却炉本体・1 号炉」かつ … */
function whenText(p: CrosswalkProposal, names: ReadonlyMap<string, string>): string {
  return whenValues(p, names)
    .map((vs) => `「${vs.join("・") || T.blank}」`)
    .join(T.and);
}

/** 会話からの星取の案の 1 行（追加は計画の明細の決定、削除・移動・却下は state/stars.ts の案） */
interface StarRow {
  id: string;
  kind: StarKind;
  workKey: string;
  /** human は人の試し（星取表で人が動かした ○。人が確定した削除なので、受けたものに並ぶ） */
  author: "ai" | "ai_relayed_human" | "human";
  basis: string;
  /** 追加の決定（計画の明細） */
  adds: Decision[];
  group: StarGroup | undefined;
}

/** 「なぜ」は短い 1 句：AI の理由の頭（句点か 30 字まで）。全文は title と詳しくへ（PM の決定） */
function shortWhy(basis: string): string {
  const head = basis.split(/[。\n]/)[0] ?? basis;
  return head.length > 30 ? `${head.slice(0, 30)}…` : head;
}

export function DecisionsSheet({ client, plan }: { client: BridgeClient; plan: Plan }) {
  const { pending, ready } = usePending(client, plan);
  return <DecisionsView plan={plan} pending={pending} ready={ready} />;
}

/** 確定のシートの中身。受けていない決定（版の履歴で受けたものを除いたもの）を受け取って描く（試験は react-dom/server でここを描く） */
export function DecisionsView({ plan, pending, ready }: { plan: Plan; pending: readonly Decision[]; ready: boolean }) {
  const accepted = useAccepted();
  const working = useWorkingPlan();
  const proposals = working?.proposals ?? [];
  const [reason, setReason] = useState("");
  const [kindPick, setKindPick] = useState<Kind | null>(null);
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<CrosswalkProposal | null>(null);
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const itemName = (code: string) => catalog?.items.get(code)?.name ?? catalog?.systems.get(code)?.name ?? code;
  const attrName = (code: string) => ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[code] ?? code;
  const ok = reason.trim().length > 0;
  const side = useContext(MergeSideContext);
  const [picked, setPicked] = useState<CrosswalkProposal | null>(null);
  // 周期の案（台帳案・ルール案・会話の回答・Claude 判断の L・C・R）を選ぶと、横の板の詳細に出す（「| 却下」「| 確定」）
  const [pickedCycle, setPickedCycle] = useState<string | null>(null);
  const [rejectingCycle, setRejectingCycle] = useState<{ id: string; n: number } | null>(null);
  // 会話からの星取の案（S）：選んだ案と、却下のダイアログ
  const [pickedStar, setPickedStar] = useState<string | null>(null);
  const [rejectingStar, setRejectingStar] = useState<StarRow | null>(null);
  // 周期の案でない 1 決定 1 行（取り込みの質問の答え・紐付け・明細）：選ぶと横の板の詳しくに理由の全文（Wire、11-07）
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const starState = useStarGroups();
  // 却下のダイアログの「判断の理由」（開くときに上の欄の理由を入れておく。空のあいだは「却下」を押せない。Wire、11-06）
  const [rejectReason, setRejectReason] = useState("");
  const rejectOk = rejectReason.trim().length > 0;
  const pick = (p: CrosswalkProposal) => {
    setPicked(p);
    setPickedCycle(null);
    setPickedStar(null);
    setPickedGroup(null);
    side?.show();
  };
  const pickCycle = (id: string) => {
    setPicked(null);
    setPickedStar(null);
    setPickedGroup(null);
    setPickedCycle(id);
    side?.show();
  };
  const pickStar = (id: string) => {
    setPicked(null);
    setPickedCycle(null);
    setPickedGroup(null);
    setPickedStar(id);
    side?.show();
  };
  const pickGroup = (key: string) => {
    setPicked(null);
    setPickedCycle(null);
    setPickedStar(null);
    setPickedGroup(key);
    side?.show();
  };
  // 会話の回答は判断の理由なしで押せる。ほかの種類は判断の理由が要る（Wire、11-07）
  const canAct = (k: Kind | null) => k === "relayed" || ok;
  const actTitle = (k: Kind | null) => (canAct(k) ? undefined : T.needsReason);
  // 却下のダイアログを開くときの理由：上の欄の理由（会話の回答は欄が無いので空から）
  const rejectStart = (k: Kind) => (k === "relayed" ? "" : reason);
  // 節と作業の鍵 → 名前（鍵で結んだ「第 n 版と同じ」の規則を、名前で読めるように）
  const names = useMemo(() => new Map<string, string>([...plan.assets.map((a) => [a.nodeKey, a.name] as const), ...plan.works.map((w) => [w.workKey, w.kind || w.workKey] as const)]), [plan]);
  // 行き先は項目の道（受入供給設備 › 計量機）か作業の属性の名前。内部の ID は出さない（Wire）
  const targetPath = (p: CrosswalkProposal) => {
    if (p.target === "work") return attrName(p.value);
    const it = catalog?.items.get(p.value);
    const sys = it ? catalog?.systems.get(it.systemCode)?.name : undefined;
    return it ? (sys ? `${sys}${T.pathSep}${it.name}` : it.name) : p.value;
  };
  // 行：台帳からの案は案ごとにまとめ、ほかは 1 決定 1 行
  const groups = useMemo(() => {
    const out: { key: string; ds: Decision[]; cycle: string | null }[] = [];
    const byCycle = new Map<string, Decision[]>();
    for (const d of pending) {
      // 星取の案（S）は下の starRows で 1 案 1 行にする
      if (d.kind === "detail" && proposalIdOf(d.id.slice("detail:".length))?.startsWith("S")) continue;
      const c = d.kind === "detail" ? cycleIdOf(d.id.slice("detail:".length)) : null;
      if (c === null) out.push({ key: d.id, ds: [d], cycle: null });
      else {
        if (!byCycle.has(c)) out.push({ key: `cycle:${c}`, ds: byCycle.set(c, []).get(c)!, cycle: c });
        byCycle.get(c)!.push(d);
      }
    }
    return out;
  }, [pending]);
  const isDone = (ds: Decision[]) => ds.every((x) => accepted.has(`${x.id}\u0000${x.hash}`));
  // 会話からの星取の案：追加の決定（明細の鍵 st-<案>-）と、作業画面の案（削除・移動）を案の ID でまとめる
  const detailsByKey = useMemo(() => new Map(plan.details.map((d) => [d.detailKey, d])), [plan]);
  const sg = starGroups();
  const starRows: StarRow[] = (() => {
    const adds = new Map<string, Decision[]>();
    for (const d of pending) {
      if (d.kind !== "detail") continue;
      const id = proposalIdOf(d.id.slice("detail:".length));
      if (id && isStarProposal(id)) adds.set(id, [...(adds.get(id) ?? []), d]);
    }
    const ids = [...new Set([...adds.keys(), ...sg.filter((g) => g.removes.length > 0 || adds.has(g.id)).map((g) => g.id)])];
    return ids.map((id) => {
      const ds = adds.get(id) ?? [];
      const g = sg.find((x) => x.id === id);
      const first = ds[0] ? detailsByKey.get(ds[0].id.slice("detail:".length)) : undefined;
      const kind: StarKind = g?.kind ?? (starValueOfKey(first?.detailKey ?? "") === "actual" ? "actualAdd" : "planAdd");
      return { id, kind, workKey: g?.workKey ?? first?.workKey ?? "", author: g?.author ?? (ds[0]?.author === "ai_relayed_human" ? "ai_relayed_human" : "ai"), basis: g?.basis ?? ds[0]?.basis ?? "", adds: ds, group: g };
    });
  })();
  const starDone = (r: StarRow) => r.adds.every((x) => isAccepted(x.id, x.hash)) && (!r.group || r.group.removes.length === 0 || r.group.state === "accepted");
  /** 星取の数（追加の明細と、削除する星取） */
  const starCount = (r: StarRow) => r.adds.length + (r.group?.removes.length ?? 0);
  const addYears = (r: StarRow) => r.adds.map((d) => detailsByKey.get(d.id.slice("detail:".length))?.fiscalYear).filter((y): y is number => y !== undefined).sort((a, b) => a - b);
  /** 下の行の年度：「2028 年度・2031 年度」、移動は「2027 年度 → 2028 年度」 */
  const starYears = (r: StarRow) =>
    r.kind === "planMove"
      ? (r.group?.pairs ?? []).map((p) => T.starMove(p.from, p.to)).join(T.starYearsSep)
      : (r.kind === "planRemove" || r.kind === "actualRemove" ? (r.group?.removes ?? []).map((x) => x.fiscalYear).sort((a, b) => a - b) : addYears(r)).map(T.starYear).join(T.starYearsSep);
  /** 題：「計画の追加　ごみクレーン › 分解整備」 */
  const starTitle = (r: { kind: StarKind; workKey: string }) => {
    const w = plan.works.find((x) => x.workKey === r.workKey);
    return T.starTitle(STAR_KIND_TEXT[r.kind], (w?.targets ?? []).map((k) => names.get(k) ?? k).join("、"), w?.kind || r.workKey);
  };
  /** 詳しくに並べる星取：「2027 年度　計画の削除」「2028 年度　計画の追加」 */
  const starItems = (r: StarRow) => {
    const v = r.kind.startsWith("actual") ? "実績" : "計画";
    return [
      ...(r.group?.removes ?? []).map((x) => ({ fy: x.fiscalYear, text: T.starItem(x.fiscalYear, `${v}の削除`) })),
      ...addYears(r).map((fy) => ({ fy, text: T.starItem(fy, `${v}の追加`) })),
    ].sort((a, b) => a.fy - b.fy);
  };
  const acceptStar = (r: StarRow) => {
    const k = kindOfStar(r);
    acceptDecisionsAs(k, r.adds, reason);
    const x = r.group && r.group.removes.length > 0 ? acceptRemovalsByHuman(r.id, acceptReasonOf(k, reason, r.basis)) : null;
    if (x && !x.ok) return false;
    return true;
  };
  const undoStar = (r: StarRow) => {
    r.adds.forEach((x) => unacceptDecision(x.id, x.hash));
    if (r.group?.state === "accepted") undoRemovalsByHuman(r.id);
  };
  // 受けた周期の案が同じ作業で年数の違うとき、その案の行に「- 重複」（朱）
  const conflicted = useMemo(() => new Set(cycleConflicts(plan, accepted)), [plan, accepted]);
  const detailWork = useMemo(() => new Map(plan.details.map((d) => [d.detailKey, d.workKey])), [plan]);
  // 台帳案の「| 星取表で見る」：共通台帳のその行（項目 × 作業）・いちばん早い年度を開く（台帳の案は項目 × 作業の単位で出るため。Wire、11-06）
  const cycleTarget = (ds: readonly Decision[]): ChartJump | null => {
    const byKey = new Map(plan.details.map((d) => [d.detailKey, d]));
    const worksBy = new Map(plan.works.map((w) => [w.workKey, w]));
    const assetsBy = new Map(plan.assets.map((a) => [a.nodeKey, a]));
    const first = ds
      .map((x) => byKey.get(x.id.slice("detail:".length)))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .sort((a, b) => a.fiscalYear - b.fiscalYear)[0];
    const w = first ? worksBy.get(first.workKey) : undefined;
    const a = w ? w.targets.map((t) => assetsBy.get(t)).find((x) => x?.commonItem && x.commonItemAccepted) : undefined;
    if (!first || !w) return null;
    const rowIds: string[] = [];
    if (a?.commonItem && w.attribute && w.attributeAccepted) {
      rowIds.push(commonRowId(a.commonItem, w.attribute), commonRowId(a.commonItem));
      const sys = catalog?.items.get(a.commonItem)?.systemCode;
      if (sys) rowIds.push(commonRowId(sys));
    } else rowIds.push(commonRowId("unmapped"));
    return { mode: "common", rowIds, periodKey: periodKeyOf(first, "year") };
  };
  const seeInChart = (j: ChartJump) => {
    requestChartJump(j);
    location.hash = sheetHash("chart");
  };
  const isDup = (ds: readonly Decision[]) => conflicted.size > 0 && ds.some((d) => isAccepted(d.id, d.hash) && conflicted.has(detailWork.get(d.id.slice("detail:".length)) ?? ""));
  const effectLines = (ds: readonly Decision[]) => {
    const e = cycleEffect(plan, ds);
    return (
      <>
        {e.changes.map((t) => (
          <Text key={t} size="xs" c="var(--text-2)" className="moyai-num" data-testid="cycle-change">
            {t}
          </Text>
        ))}
        {e.kept.map((t) => (
          <Text key={t} size="xs" c="var(--text-3)" data-testid="cycle-kept">
            {t}
          </Text>
        ))}
      </>
    );
  };
  const openGroups = groups.filter((g) => !isDone(g.ds));
  const doneGroups = groups.filter((g) => isDone(g.ds));
  const openStars = starRows.filter((r) => !starDone(r));
  const doneStars = starRows.filter(starDone);
  const allOpenRules = proposals.filter((p) => p.state === "proposed");
  const doneRules = proposals.filter((p) => p.state !== "proposed");
  // 種類の切り替え（Wire、2026-11-05）：第 n 版と同じ ／ 当てはめの案 ／ 台帳からの案 ／ 会話から写した答え ／ Claude の決定。数が 0 の種類は出さず、先頭の種類を既定にする
  // もとにした版から並べ直した周期の案（根拠に「第 n 版で受けた当てはめと同じ」）も「第 n 版と同じ」に入れる（台帳の新-10）
  const baseV = getCrosswalkBase()?.version ?? null;
  const sameAs = allOpenRules.find((p) => p.sameAs !== undefined)?.sameAs ?? baseV;
  const kindOfGroup = (g: { ds: Decision[]; cycle: string | null }): Kind =>
    g.cycle && baseV !== null && g.ds[0]!.basis.endsWith(W.sameAs(baseV))
      ? "same"
      : g.cycle && isLedgerCycle(g.cycle)
        ? "ledger"
        : g.cycle && isPlanRuleCycle(g.cycle)
          ? "rule"
          : g.ds[0]!.author === "ai_relayed_human"
          ? "relayed"
          : "ai";
  // 星取の案の種類は出どころ：前の版から写した追加は「第 n 版と同じ」、ほかは会話の回答か Claude 判断（新しい種類は作らない）
  const kindOfStar = (r: StarRow): Kind => (baseV !== null && r.adds[0]?.basis.endsWith(W.sameAs(baseV)) ? "same" : r.author === "ai_relayed_human" ? "relayed" : "ai");
  const starsOf = (k: Kind) => openStars.filter((r) => kindOfStar(r) === k).length;
  const counts: Record<Kind, number> = {
    same: allOpenRules.filter((p) => p.sameAs !== undefined).length + openGroups.filter((g) => kindOfGroup(g) === "same").length + starsOf("same"),
    crosswalk: allOpenRules.filter((p) => p.sameAs === undefined).length,
    ledger: openGroups.filter((g) => kindOfGroup(g) === "ledger").length,
    rule: openGroups.filter((g) => kindOfGroup(g) === "rule").length,
    relayed: openGroups.filter((g) => kindOfGroup(g) === "relayed").length + starsOf("relayed"),
    ai: openGroups.filter((g) => kindOfGroup(g) === "ai").length + starsOf("ai"),
  };
  const kinds = KINDS.filter((k) => counts[k] > 0);
  const kind: Kind | null = kindPick && kinds.includes(kindPick) ? kindPick : (kinds[0] ?? null);
  const openRules = allOpenRules.filter((p) => (kind === "same" ? p.sameAs !== undefined : kind === "crosswalk" ? p.sameAs === undefined : false));
  const visibleGroups = openGroups.filter((g) => kindOfGroup(g) === kind);
  const visibleStars = openStars.filter((r) => kindOfStar(r) === kind);
  const leftCount = openGroups.length + allOpenRules.length + openStars.length;
  const visibleCount = visibleGroups.length + openRules.length + visibleStars.length;
  /**
   * 件数（Wire、11-07）：取り込みの質問の答えは、その答えで決まった行の数を「n 行」（横の板の質問の「n 行」と同じ字）。
   * ほかの 1 決定 1 行と周期の案は、今どおり決定の数。数の無い行は null（「―」を並べない）
   */
  const groupCount = (g: { ds: Decision[] }): string | number | null => {
    const d = g.ds[0]!;
    if (d.kind === "reading") return d.rows === undefined ? null : TEXT.intake.questions.rows(d.rows);
    return g.ds.length;
  };
  // 表示中の種類に数のある行が 1 つも無ければ、件数の列を出さない（紐付けの規則と星取の案は、いつも数がある）
  const showCount = openRules.length > 0 || visibleStars.length > 0 || visibleGroups.some((g) => groupCount(g) !== null);
  // 星取表の詳しくの「| 確定のシートで見る」：その案を選び、その種類に切り替える（1 回だけ）
  useEffect(() => {
    // 版の履歴を読み終えて、その案の行が並んでから受け取る
    const id = peekStarPick();
    if (!id) return;
    const r = starRows.find((x) => x.id === id);
    if (!r) return;
    clearStarPick();
    setKindPick(kindOfStar(r));
    pickStar(id);
  }, [starState, pending]);
  // 「第 n 版と同じ」が見えているあいだは、受ける理由が空なら「第 n 版で受けた当てはめと同じ」を入れておく（人が直せる。Wire）
  useEffect(() => {
    if (kind === "same" && sameAs !== null && reason.trim() === "") setReason(W.sameAs(sameAs));
  }, [kind, sameAs]);
  const pickKind = (k: Kind) => {
    setKindPick(k);
    // 「第 n 版と同じ」では、受ける理由に「第 n 版で受けた当てはめと同じ」を入れておく（人が直せる）
    if (k === "same" && sameAs !== null && reason.trim() === "") setReason(W.sameAs(sameAs));
  };
  const s = crosswalkSummary(plan);

  const what = (d: Decision) => {
    if (d.kind === "detail") {
      const [pa, fy] = d.value.split(":");
      return `${d.target} · ${HUMAN_TEXT.confirm.pendingValue[pa ?? ""] ?? ""} · ${HUMAN_TEXT.confirm.pendingFiscal(fy ?? "")}`;
    }
    if (d.kind === "reading") return `${d.target} → ${d.value}`;
    return `${d.target} → ${d.kind === "attribute" ? attrName(d.value) : itemName(d.value)}`;
  };
  const acceptRule = (p: CrosswalkProposal) => {
    const r = acceptByHuman(p.ruleId, reason);
    setMsg(r.ok ? { color: "gray", text: W.acceptedDone(p.ruleId, r.rows) } : { color: "red", text: W.refused[r.reason] ?? "" });
    return r.ok;
  };
  // まとめて受けるのは、いま見えている種類の行だけ（会話の回答は判断の理由なしで受ける）
  const acceptAll = () => {
    if (!canAct(kind)) return;
    for (const g of visibleGroups) acceptDecisionsAs(kindOfGroup(g), g.ds, reason);
    let refused = 0;
    for (const p of openRules) if (!acceptByHuman(p.ruleId, reason).ok) refused++;
    for (const r of visibleStars) if (!acceptStar(r)) refused++;
    setMsg({ color: refused ? "red" : "gray", text: T.bulkDone(visibleGroups.length + openRules.length + visibleStars.length - refused, refused) });
  };

  /** 1 決定 1 行の「| 確定」（行と横の板の詳しくで同じ。会話の回答は判断の理由なしで押せる） */
  const acceptButton = (k: Kind, ds: Decision[]) => (
    <Button
      size="compact-sm"
      disabled={!canAct(k)}
      title={actTitle(k)}
      onClick={(e) => {
        e.stopPropagation();
        acceptDecisionsAs(k, ds, reason);
      }}
      data-testid="pending-accept"
    >
      {T.accept}
    </Button>
  );

  /** 周期の案の「| 却下」「| 確定」（行と横の板の詳細で同じ。会話の回答のほかは判断の理由が要る） */
  const cycleButtons = (cycle: string, ds: Decision[], k: Kind) => (
    <Group gap="xs" wrap="nowrap" justify="flex-end">
      <Button
        size="compact-sm"
        variant="default"
        disabled={!canAct(k)}
        title={actTitle(k)}
        onClick={(e) => {
          e.stopPropagation();
          setRejectReason(rejectStart(k));
          setRejectingCycle({ id: cycle, n: ds.length });
        }}
        data-testid="pending-reject"
      >
        {W.reject}
      </Button>
      {acceptButton(k, ds)}
    </Group>
  );

  /** 1 決定 1 行と周期の案の行。withCount が false なら件数の列を出さない */
  const groupRow = (g: { key: string; ds: Decision[]; cycle: string | null }, withCount: boolean) => {
    const { key, ds, cycle } = g;
    const d = ds[0]!;
    const k = kindOfGroup(g);
    const done = ds.every((x) => isAccepted(x.id, x.hash));
    const n = groupCount(g);
    return (
      <Table.Tr
        key={key}
        data-testid="pending-row"
        data-kind={cycle && isLedgerCycle(cycle) ? "ledger" : cycle && isPlanRuleCycle(cycle) ? "rule" : d.author}
        data-decision-kind={d.kind}
        data-accepted={done ? "true" : "false"}
        data-cycle={cycle ?? undefined}
        className="moyai-pick-row"
        aria-selected={cycle ? pickedCycle === cycle : pickedGroup === key}
        onClick={() => (cycle ? pickCycle(cycle) : pickGroup(key))}
        style={{ cursor: "pointer" }}
      >
        <Table.Td className="moyai-decisions-what">
          <Text size="sm">{cycle ? T.cycleWhat(cycle, ds.length) : what(d)}</Text>
          {cycle && effectLines(ds)}
          <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em" }}>
            {cycle && isLedgerCycle(cycle) ? T.kind.ledger : cycle && isPlanRuleCycle(cycle) ? T.kind.rule : d.author === "ai_relayed_human" ? T.kind.relayed : T.kind.ai}
            {cycle && isDup(ds) && (
              <span style={{ marginLeft: 8 }} data-testid="cycle-dup">
                {T.dup}
              </span>
            )}
          </Text>
          {d.kind === "reading" && d.where && (
            <Text size="xs" c="var(--text-3)" data-testid="pending-where">
              {T.where(d.where)}
            </Text>
          )}
        </Table.Td>
        <Table.Td c="var(--text-2)" className="moyai-decisions-why" title={d.basis} data-testid="pending-why">
          {d.basis}
        </Table.Td>
        {withCount && (
          <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }} data-testid="pending-count">
            {n}
          </Table.Td>
        )}
        <Table.Td ta="right" className="moyai-decisions-act">
          {done ? (
            <Group gap="xs" wrap="nowrap" justify="flex-end">
              <Text size="xs" c="dimmed" data-testid="pending-accepted">
                {T.accepted}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={(e) => {
                  e.stopPropagation();
                  ds.forEach((x) => unacceptDecision(x.id, x.hash));
                }}
              >
                {T.undo}
              </Button>
            </Group>
          ) : cycle ? (
            cycleButtons(cycle, ds, k)
          ) : (
            acceptButton(k, ds)
          )}
        </Table.Td>
      </Table.Tr>
    );
  };

  /** 星取の案の「| 却下」「| 確定」（行と詳しくで同じ。会話の回答のほかは判断の理由が要る） */
  const starButtons = (r: StarRow) => {
    const k = kindOfStar(r);
    return (
      <Group gap="xs" wrap="nowrap" justify="flex-end">
        <Button
          size="compact-sm"
          variant="default"
          disabled={!canAct(k)}
          title={actTitle(k)}
          onClick={(e) => {
            e.stopPropagation();
            setRejectReason(rejectStart(k));
            setRejectingStar(r);
          }}
          data-testid="pending-reject"
        >
          {W.reject}
        </Button>
        <Button
          size="compact-sm"
          disabled={!canAct(k)}
          title={actTitle(k)}
          onClick={(e) => {
            e.stopPropagation();
            setMsg(acceptStar(r) ? { color: "gray", text: T.starAcceptedDone(starCount(r)) } : { color: "red", text: T.cycleRejectRefused });
          }}
          data-testid="pending-accept"
        >
          {T.accept}
        </Button>
      </Group>
    );
  };
  // 会話からの星取の案：1 案 1 行。題、下の行に年度と種類、件数は星取の数
  const starRow = (r: StarRow, withCount: boolean) => {
    const done = starDone(r);
    return (
      <Table.Tr
        key={`star:${r.id}`}
        data-testid="pending-row"
        data-kind={r.author}
        data-star={r.id}
        data-star-kind={r.kind}
        data-accepted={done ? "true" : "false"}
        className="moyai-pick-row"
        aria-selected={pickedStar === r.id}
        onClick={() => pickStar(r.id)}
        style={{ cursor: "pointer" }}
      >
        <Table.Td className="moyai-decisions-what">
          <Text size="sm" data-testid="star-title">
            {starTitle(r)}
          </Text>
          <Group gap={8} wrap="nowrap">
            <Text size="xs" c="var(--text-2)" className="moyai-num" data-testid="star-years">
              {starYears(r)}
            </Text>
            <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
              {r.author === "human" ? T.kind.human : r.author === "ai_relayed_human" ? T.kind.relayed : T.kind.ai}
            </Text>
          </Group>
        </Table.Td>
        <Table.Td c="var(--text-2)" className="moyai-decisions-why" title={r.basis} data-testid="pending-why">
          {shortWhy(r.basis)}
        </Table.Td>
        {withCount && (
          <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }} data-testid="pending-count">
            {starCount(r)}
          </Table.Td>
        )}
        <Table.Td ta="right" className="moyai-decisions-act">
          {done ? (
            <Group gap="xs" wrap="nowrap" justify="flex-end">
              <Text size="xs" c="dimmed" data-testid="pending-accepted">
                {T.accepted}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={(e) => {
                  e.stopPropagation();
                  undoStar(r);
                }}
              >
                {T.undo}
              </Button>
            </Group>
          ) : (
            starButtons(r)
          )}
        </Table.Td>
      </Table.Tr>
    );
  };

  // 「第 n 版と同じ」：淡い字の 1 規則 1 行。行ごとの受ける・断るは置かない（Wire）
  const sameRow = (p: CrosswalkProposal) => (
    <Table.Tr
      key={p.ruleId}
      data-testid="crosswalk-rule"
      data-rule={p.ruleId}
      data-state={p.state}
      data-target={p.target}
      data-same={p.sameAs}
      aria-selected={picked?.ruleId === p.ruleId}
      className="moyai-pick-row"
      onClick={() => pick(p)}
      style={{ cursor: "pointer" }}
    >
      <Table.Td c="var(--text-3)">
        {p.target === "assetNode" ? T.ruleNodeHead : T.ruleWorkHead}
        {whenShort(p, names)} → {targetPath(p)}
      </Table.Td>
      <Table.Td className="moyai-num" ta="right" c="var(--text-3)">
        {p.matched}
      </Table.Td>
      <Table.Td className="moyai-decisions-act" />
    </Table.Tr>
  );

  const ruleRow = (p: CrosswalkProposal) => (
    <Table.Tr
      key={p.ruleId}
      data-testid="crosswalk-rule"
      data-rule={p.ruleId}
      data-state={p.state}
      data-target={p.target}
      aria-selected={picked?.ruleId === p.ruleId}
      className="moyai-pick-row"
      onClick={() => pick(p)}
      style={{ cursor: "pointer" }}
    >
      <Table.Td className="moyai-decisions-what">
        <Text size="sm">
          {p.target === "assetNode" ? T.ruleNodeHead : T.ruleWorkHead}
          {whenShort(p, names)} → {targetPath(p)}
        </Text>
        <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em" }}>
          {T.kind.crosswalk}
        </Text>
      </Table.Td>
      <Table.Td c="var(--text-2)" className="moyai-decisions-why" title={p.basis}>
        {shortWhy(p.basis)}
      </Table.Td>
      <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }} data-testid="crosswalk-matched">
        {p.matched}
      </Table.Td>
      <Table.Td ta="right" className="moyai-decisions-act">
        {p.state === "proposed" ? (
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            <Button size="compact-sm" variant="default" disabled={!ok} title={ok ? undefined : T.needsReason} onClick={() => (setRejectReason(reason), setRejecting(p))} data-testid="crosswalk-reject">
              {W.reject}
            </Button>
            <Button size="compact-sm" disabled={!ok} title={ok ? undefined : T.needsReason} onClick={() => acceptRule(p)} data-testid="crosswalk-accept">
              {T.accept}
            </Button>
          </Group>
        ) : (
          <Text size="xs" c="dimmed">
            {p.state === "accepted" ? T.accepted : T.rejected}
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );

  // 列：項目｜理由（第 n 版と同じでは置かない）｜件数（数のある行が無ければ置かない）｜「| 却下」「| 確定」（右端に固定。Wire、11-07）
  const headOf = (withWhy: boolean, withCount: boolean) => (
    <Table.Thead>
      <Table.Tr>
        <Table.Th style={{ whiteSpace: "nowrap", width: withWhy ? "40%" : "76%" }}>{T.head[0]}</Table.Th>
        {withWhy && <Table.Th style={{ whiteSpace: "nowrap", width: "36%" }}>{T.head[1]}</Table.Th>}
        {withCount && (
          <Table.Th ta="right" style={{ whiteSpace: "nowrap", width: 88 }} data-testid="decisions-count-head">
            {T.head[2]}
          </Table.Th>
        )}
        <Table.Th className="moyai-decisions-act">{T.head[3]}</Table.Th>
      </Table.Tr>
    </Table.Thead>
  );

  // 周期の案の詳細：種類・何を・理由の全文と「| 却下」「| 確定」
  const cycleGroup = pickedCycle ? groups.find((g) => g.cycle === pickedCycle) : undefined;
  const cycleKind = cycleGroup ? kindOfGroup(cycleGroup) : null;
  const cycleDetail = cycleGroup && cycleGroup.cycle && cycleKind && (
    <Stack gap="xs" data-testid="decision-detail" data-cycle={cycleGroup.cycle}>
      <Text size="sm" fw={700}>
        {cycleKind === "same" ? T.kinds.same(sameAs ?? 0) : T.kinds[cycleKind]}
      </Text>
      <Text size="sm">{T.cycleWhat(cycleGroup.cycle, cycleGroup.ds.length)}</Text>
      {effectLines(cycleGroup.ds)}
      {isLedgerCycle(cycleGroup.cycle) &&
        (() => {
          const j = cycleTarget(cycleGroup.ds);
          return (
            j && (
              <button type="button" className="moyai-inline-act" style={{ marginLeft: 0, alignSelf: "flex-start" }} onClick={() => seeInChart(j)} data-testid="cycle-see-in-chart">
                {T.seeInChart}
              </button>
            )
          );
        })()}
      <Text size="xs" c="dimmed">
        {T.detailWhy}
      </Text>
      <Text size="sm">{cycleGroup.ds[0]!.basis}</Text>
      {isDone(cycleGroup.ds) ? (
        <Text size="xs" c="dimmed">
          {T.accepted}
        </Text>
      ) : (
        cycleButtons(cycleGroup.cycle, cycleGroup.ds, cycleKind)
      )}
    </Stack>
  );
  // 1 決定 1 行（取り込みの質問の答え・紐付け・明細）の詳しく：種類・何を・効く所・件数（「n 行」）・理由の全文と「| 確定」
  const plainGroup = pickedGroup ? groups.find((g) => g.cycle === null && g.key === pickedGroup) : undefined;
  const plainDetail =
    plainGroup &&
    (() => {
      const d = plainGroup.ds[0]!;
      const k = kindOfGroup(plainGroup);
      return (
        <Stack gap="xs" data-testid="decision-detail" data-decision={d.id}>
          <Text size="sm" fw={700}>
            {k === "same" ? T.kinds.same(sameAs ?? 0) : T.kinds[k]}
          </Text>
          <Text size="sm">{what(d)}</Text>
          {d.kind === "reading" && d.where && (
            <Text size="xs" c="var(--text-3)">
              {T.where(d.where)}
            </Text>
          )}
          {d.kind === "reading" && d.rows !== undefined && (
            <Text size="sm" className="moyai-num" data-testid="decision-detail-rows">
              {TEXT.intake.questions.rows(d.rows)}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {T.detailWhy}
          </Text>
          <Text size="sm" data-testid="decision-detail-why">
            {d.basis}
          </Text>
          {isDone(plainGroup.ds) ? (
            <Text size="xs" c="dimmed">
              {T.accepted}
            </Text>
          ) : (
            <Group gap="xs" wrap="nowrap">
              {acceptButton(k, plainGroup.ds)}
            </Group>
          )}
        </Stack>
      );
    })();
  const rejectedRows = rejectedCycles();
  const rejectedStars = rejectedStarGroups();
  // 星取の案の詳しく：種類・題・星取を 1 つずつ・理由の全文と「| 却下」「| 確定」
  const starPicked = pickedStar ? starRows.find((r) => r.id === pickedStar) : undefined;
  const starDetail = starPicked && (
    <Stack gap="xs" data-testid="decision-detail" data-star={starPicked.id}>
      <Text size="sm" fw={700}>
        {(() => {
          const k = kindOfStar(starPicked);
          return k === "same" ? T.kinds.same(sameAs ?? 0) : T.kinds[k];
        })()}
      </Text>
      <Text size="sm">{starTitle(starPicked)}</Text>
      <Stack gap={2} data-testid="star-items">
        {starItems(starPicked).map((x) => (
          <Text key={x.text} size="sm" className="moyai-num" data-testid="star-item">
            {x.text}
          </Text>
        ))}
      </Stack>
      <Text size="xs" c="dimmed">
        {T.detailWhy}
      </Text>
      <Text size="sm">{starPicked.kind === "actualAdd" ? basisWithoutReference(starPicked.basis) : starPicked.basis}</Text>
      {starPicked.kind === "actualAdd" && addYears(starPicked).map((fy) => <StarReference key={fy} plan={plan} workKey={starPicked.workKey} fiscalYear={fy} />)}
      {starDone(starPicked) ? (
        <Text size="xs" c="dimmed">
          {T.accepted}
        </Text>
      ) : (
        starButtons(starPicked)
      )}
    </Stack>
  );

  const detail = picked && (
    <Stack gap="xs" data-testid="decision-detail" data-rule={picked.ruleId}>
      <Text size="sm" fw={700}>
        {picked.sameAs !== undefined ? T.kinds.same(picked.sameAs) : T.kinds.crosswalk}
      </Text>
      <Text size="xs" c="dimmed">
        {T.detailRule}
      </Text>
      <Text size="sm">
        {picked.target === "assetNode" ? T.ruleNodeHead : T.ruleWorkHead}
        {whenText(picked, names)} → {targetPath(picked)}
      </Text>
      <Text size="xs" c="dimmed">
        {T.detailWhy}
      </Text>
      <Text size="sm">{picked.basis}</Text>
      <Text size="xs" c="dimmed">
        {T.detailWhere}
      </Text>
      <Text size="sm" className="moyai-num">
        {picked.matched}
      </Text>
    </Stack>
  );

  return (
    <Stack gap="md" px="xl" py="lg" data-testid="decisions-sheet" data-kind={kind ?? undefined}>
      {kind === "relayed" ? (
        // 会話の回答：判断の理由の欄を出さず、上の行は「| 会話の回答 n 件を確定」だけ（押せる。Wire、11-07）
        <Group gap="md" align="center" wrap="nowrap" style={{ minHeight: "var(--h-m)" }}>
          <Button variant="default" disabled={visibleCount === 0} onClick={acceptAll} data-testid="decisions-bulk-accept">
            {T.relayedAccept(visibleCount)}
          </Button>
        </Group>
      ) : (
        <Group align="flex-end" gap="md" wrap="wrap">
          <TextInput label={T.reasonLabel} placeholder={T.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={REASON_MAX} style={{ flex: "1 1 360px", maxWidth: 560 }} data-testid="decisions-reason" />
          <Group gap="md" align="center" wrap="nowrap" style={{ minHeight: "var(--h-m)" }}>
            <Button variant="default" disabled={!ok || visibleCount === 0} onClick={acceptAll} data-testid="decisions-bulk-accept">
              {kind === "same" && sameAs !== null ? T.sameAccept(sameAs, visibleCount) : T.visibleAccept(visibleCount)}
            </Button>
            {!ok && leftCount > 0 && (
              <Text size="xs" c="dimmed" data-testid="decisions-bulk-reason">
                {T.bulkNeedsReason}
              </Text>
            )}
          </Group>
        </Group>
      )}
      {kinds.length > 0 && kind && (
        <Switch
          value={kind}
          onChange={pickKind}
          aria-label={T.kindSwitch}
          data-testid="decisions-kind"
          data={kinds.map((k) => ({ value: k, label: `${k === "same" ? T.kinds.same(sameAs ?? 0) : T.kinds[k]} ${counts[k]}` }))}
        />
      )}
      {msg && (
        <Alert color={msg.color} p="xs" data-testid="crosswalk-message">
          <Text size="xs">{msg.text}</Text>
        </Alert>
      )}

      {!ready ? (
        // 版の履歴（これまでに受けた決定）を読み終えるまでは、受けていない決定を数えない
        <Text size="sm" c="dimmed" data-testid="decisions-loading">
          {T.loading}
        </Text>
      ) : leftCount === 0 ? (
        <Text size="sm" c="dimmed" data-testid="decisions-none">
          {T.none}
        </Text>
      ) : (
        // 幅が足りないときは表を横に送る。「| 却下」「| 確定」の列は右端に固定（theme.css の .moyai-decisions-act）
        <div className="moyai-decisions-scroll">
          <Table data-testid="decisions-table" verticalSpacing="sm" fz="sm">
            {headOf(kind !== "same", showCount)}
            <Table.Tbody>
              {openRules.map(kind === "same" ? sameRow : ruleRow)}
              {visibleGroups.map((g) => groupRow(g, showCount))}
              {visibleStars.map((r) => starRow(r, showCount))}
            </Table.Tbody>
          </Table>
        </div>
      )}
      {proposals.length === 0 && (
        <Text size="xs" c="dimmed" data-testid="crosswalk-none">
          {W.none}
        </Text>
      )}

      {/* 受けたもの・断ったもの：下にたたむ（閉じていても DOM に残す） */}
      {(doneRules.length > 0 || doneGroups.length > 0 || rejectedRows.length > 0 || doneStars.length > 0 || rejectedStars.length > 0) && (
        <details data-testid="decisions-done">
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>
            {T.doneTitle(doneRules.length + doneGroups.length + rejectedRows.length + doneStars.length + rejectedStars.length)}
          </summary>
          <div className="moyai-decisions-scroll">
            <Table verticalSpacing="xs" fz="sm" mt="xs">
              {headOf(true, true)}
              <Table.Tbody>
                {doneRules.map(ruleRow)}
                {doneGroups.map((g) => groupRow(g, true))}
                {doneStars.map((r) => starRow(r, true))}
                {rejectedStars.map((g) => (
                  <Table.Tr key={`rejected-star:${g.id}`} data-testid="star-rejected" data-star={g.id}>
                    <Table.Td>
                      <Text size="sm">{starTitle(g)}</Text>
                    </Table.Td>
                    <Table.Td c="var(--text-2)" className="moyai-decisions-why" title={g.basis}>
                      {shortWhy(g.basis)}
                    </Table.Td>
                    <Table.Td className="moyai-num" ta="right">
                      {(g.rejectedAdds?.length ?? 0) + g.removes.length}
                    </Table.Td>
                    <Table.Td ta="right" className="moyai-decisions-act">
                      <Text size="xs" c="dimmed">
                        {T.rejected}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {rejectedRows.map((r) => (
                  <Table.Tr key={`rejected:${r.id}`} data-testid="cycle-rejected" data-cycle={r.id}>
                    <Table.Td>
                      <Text size="sm">{T.cycleWhat(r.id, r.marks)}</Text>
                    </Table.Td>
                    <Table.Td c="var(--text-2)" className="moyai-decisions-why" title={r.basis}>
                      {shortWhy(r.basis)}
                    </Table.Td>
                    <Table.Td className="moyai-num" ta="right">
                      {r.marks}
                    </Table.Td>
                    <Table.Td ta="right" className="moyai-decisions-act">
                      <Text size="xs" c="dimmed">
                        {T.rejected}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </details>
      )}

      <Group gap="lg" className="moyai-num">
        <Text size="xs" c="dimmed" data-testid="crosswalk-unmapped" data-nodes={s.nodes.none} data-works={s.works.none} data-records={s.unmappedRecords}>
          {W.unmapped(s.nodes.none, s.works.none, s.unmappedRecords)}
        </Text>
        <Text size="xs" c="dimmed" data-testid="crosswalk-accepted" data-nodes={s.nodes.accepted} data-works={s.works.accepted}>
          {W.accepted(s.nodes.accepted, s.nodes.targeted, s.works.accepted, s.works.total)}
        </Text>
      </Group>

      <details data-testid="crosswalk-direct-open">
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{W.direct.title}</summary>
        <DirectSet plan={plan} onDone={setMsg} />
      </details>

      <Modal opened={!!rejecting} onClose={() => setRejecting(null)} title={T.rejectTitle} centered data-testid="crosswalk-reject-dialog">
        {rejecting && (
          <Stack gap="sm">
            <Text size="sm" c="var(--text-2)" data-testid="reject-item">
              {rejecting.target === "assetNode" ? T.ruleNodeHead : T.ruleWorkHead}{whenShort(rejecting, names)} → {targetPath(rejecting)}
            </Text>
            <TextInput className="moyai-dialog-field" label={T.reasonLabel} value={rejectReason} onChange={(e) => setRejectReason(e.currentTarget.value)} maxLength={500} data-autofocus data-testid="reject-reason" />
            <Group justify="flex-end" gap="sm" wrap="nowrap">
              {!rejectOk && (
                <Text size="xs" c="var(--text-3)" data-testid="reject-disabled-reason">
                  {T.needsReason}
                </Text>
              )}
              <Button variant="default" onClick={() => setRejecting(null)}>
                {T.rejectLater}
              </Button>
              <Button
                data-testid="crosswalk-reject-confirm"
                disabled={!rejectOk}
                onClick={() => {
                  if (!rejectOk) return;
                  const r = rejectByHuman(rejecting.ruleId, rejectReason);
                  setMsg(r.ok ? { color: "gray", text: W.rejectedDone(rejecting.ruleId, r.rows) } : { color: "red", text: W.refused[r.reason] ?? "" });
                  setRejecting(null);
                }}
              >
                {T.rejectConfirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!rejectingCycle} onClose={() => setRejectingCycle(null)} title={T.rejectTitle} centered data-testid="cycle-reject-dialog">
        {rejectingCycle && (
          <Stack gap="sm">
            <Text size="sm" c="var(--text-2)" data-testid="reject-item">
              {T.cycleWhat(rejectingCycle.id, rejectingCycle.n)}
            </Text>
            <TextInput className="moyai-dialog-field" label={T.reasonLabel} value={rejectReason} onChange={(e) => setRejectReason(e.currentTarget.value)} maxLength={500} data-autofocus data-testid="reject-reason" />
            <Group justify="flex-end" gap="sm" wrap="nowrap">
              {!rejectOk && (
                <Text size="xs" c="var(--text-3)" data-testid="reject-disabled-reason">
                  {T.needsReason}
                </Text>
              )}
              <Button variant="default" onClick={() => setRejectingCycle(null)}>
                {T.rejectLater}
              </Button>
              <Button
                data-testid="cycle-reject-confirm"
                disabled={!rejectOk}
                onClick={() => {
                  if (!rejectOk) return;
                  const r = rejectCycleByHuman(rejectingCycle.id, rejectReason);
                  setMsg(r.ok ? { color: "gray", text: T.cycleRejectedDone(rejectingCycle.id, r.marks) } : { color: "red", text: T.cycleRejectRefused });
                  if (pickedCycle === rejectingCycle.id) setPickedCycle(null);
                  setRejectingCycle(null);
                }}
              >
                {T.rejectConfirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!rejectingStar} onClose={() => setRejectingStar(null)} title={T.rejectTitle} centered data-testid="star-reject-dialog">
        {rejectingStar && (
          <Stack gap="sm">
            <Text size="sm" c="var(--text-2)" data-testid="reject-item">
              {starTitle(rejectingStar)}
            </Text>
            <TextInput className="moyai-dialog-field" label={T.reasonLabel} value={rejectReason} onChange={(e) => setRejectReason(e.currentTarget.value)} maxLength={500} data-autofocus data-testid="reject-reason" />
            <Group justify="flex-end" gap="sm" wrap="nowrap">
              {!rejectOk && (
                <Text size="xs" c="var(--text-3)" data-testid="reject-disabled-reason">
                  {T.needsReason}
                </Text>
              )}
              <Button variant="default" onClick={() => setRejectingStar(null)}>
                {T.rejectLater}
              </Button>
              <Button
                data-testid="star-reject-confirm"
                disabled={!rejectOk}
                onClick={() => {
                  if (!rejectOk) return;
                  const r = rejectingStar;
                  const x = rejectStarGroupByHuman(r.id, rejectReason, { kind: r.kind, workKey: r.workKey, value: r.kind.startsWith("actual") ? "actual" : "plan", author: r.author, basis: r.basis });
                  setMsg(x.ok ? { color: "gray", text: T.starRejectedDone(starCount(r)) } : { color: "red", text: T.cycleRejectRefused });
                  if (pickedStar === r.id) setPickedStar(null);
                  setRejectingStar(null);
                }}
              >
                {T.rejectConfirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      {side?.el && detail && createPortal(detail, side.el)}
      {side?.el && !detail && starDetail && createPortal(starDetail, side.el)}
      {side?.el && !detail && cycleDetail && createPortal(cycleDetail, side.el)}
      {side?.el && !detail && plainDetail && createPortal(plainDetail, side.el)}
    </Stack>
  );
}
