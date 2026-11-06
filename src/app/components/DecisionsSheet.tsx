// MERGE のシート「決定」（docs/screens.md 3.2、絵は Decisions.dc.html・docs/plan.md §2.9）：Claude が決めたことと、会話から写した人の答え。受けるまで、版は確定できない。
// 1 つの表に、受けていないものを先に並べる。列は「何を（種類の札）｜なぜ｜決めた人｜行｜受ける」。行は箱にせず、罫線だけ。
// - 当てはめの案（Claude が置いた規則）：1 規則 1 行。受けるか、確かめのダイアログを通して断る（state/crosswalk.ts の人だけの道）。
// - 台帳からの案（chart_propose の周期の案）：案ごとに 1 行（引いた印の数を行に）。受けると、その案の印をすべて受ける。
// - ルール案（計画ルールから出した周期の案。ID の頭 R）：台帳からの案と同じく案ごとに 1 行。
// - Claude の決定・会話から写した答え：1 行ずつ。
// 理由の欄は上に 1 つ。1 行ずつ受けるときも、まとめて受けるときも、その理由を使う（空のあいだは押せない）。受けたものは下にたたむ。
// 受けた決定はこのタブのメモリ（state/decisions.ts）に持ち、署名のダイアログがそこから読んで送る。
import { Alert, Button, Group, Modal, Stack, Table, Text, TextInput } from "@mantine/core";
import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MergeSideContext } from "../state/merge-side";
import { crosswalkSummary, heldRows, type CrosswalkProposal } from "../../plan/crosswalk";
import { pendingDecisions, type Decision } from "../../plan/diff";
import { applyAcceptedCycles, cycleIdOf, isLedgerCycle, isPlanRuleCycle } from "../../plan/cycle";
import { rejectCycleByHuman, rejectedCycles } from "../state/cycles";
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

const T = HUMAN_TEXT.decisions;
const KINDS = ["same", "crosswalk", "ledger", "rule", "relayed", "ai"] as const;
type Kind = (typeof KINDS)[number];
const W = TEXT.crosswalk;
const NO_PROPOSALS: readonly CrosswalkProposal[] = [];

/**
 * 受けていない決定（版の履歴で受けたものを除く）。署名のダイアログと下の帯も同じ数を使う。
 * 案のままの当てはめの規則が当てている行は、決定の 1 行ずつには出さない（規則の行で受ける。二重に出さない。台帳の新-4）。
 * openRules は案のままの規則の数（下の帯の数に足す）
 */
export function usePending(client: BridgeClient, plan: Plan | null): { pending: Decision[]; openRules: number; ready: boolean } {
  const [load] = usePlanStatus(client, plan?.planId ?? "", !!plan);
  const status = load.kind === "ready" ? load.status : null;
  const working = useWorkingPlan();
  const proposals = working?.proposals ?? NO_PROPOSALS;
  const pending = useMemo(() => {
    if (!plan || !status) return [];
    const held = new Set<string>();
    for (const p of proposals) if (p.state === "proposed") for (const ref of heldRows(plan, p)) held.add(ref.startsWith("n:") ? `item:${ref.slice(2)}` : `attr:${ref.slice(2)}`);
    return pendingDecisions(plan, status.accepted ?? []).filter((d) => !held.has(d.id));
  }, [plan, status, proposals]);
  return { pending, openRules: proposals.filter((p) => p.state === "proposed").length, ready: !!status };
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
/** 受けても作業のきっかけを変えない理由（計量値の枝・枝がいくつも・月の周期） */
function keptWhy(w: WorkT | undefined): string {
  const bs = ((w?.trigger as { branches?: { kind: string; meter?: string }[] } | null)?.branches ?? []) as { kind: string; meter?: string }[];
  if (bs.length > 1) return T.keptBranches(bs.length);
  if (bs[0]?.kind === "meter") return T.keptMeter(bs[0].meter ?? "");
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

/** 「なぜ」は短い 1 句：AI の理由の頭（句点か 30 字まで）。全文は title と詳しくへ（PM の決定） */
function shortWhy(basis: string): string {
  const head = basis.split(/[。\n]/)[0] ?? basis;
  return head.length > 30 ? `${head.slice(0, 30)}…` : head;
}

export function DecisionsSheet({ client, plan }: { client: BridgeClient; plan: Plan }) {
  const { pending, ready } = usePending(client, plan);
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
  // 却下のダイアログの「判断の理由」（開くときに上の欄の理由を入れておく。空のあいだは「却下」を押せない。Wire、11-06）
  const [rejectReason, setRejectReason] = useState("");
  const rejectOk = rejectReason.trim().length > 0;
  const pick = (p: CrosswalkProposal) => {
    setPicked(p);
    setPickedCycle(null);
    side?.show();
  };
  const pickCycle = (id: string) => {
    setPicked(null);
    setPickedCycle(id);
    side?.show();
  };
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
  // 受けた周期の案が同じ作業で年数の違うとき、その案の行に「- 重複」（朱）
  const conflicted = useMemo(() => new Set(cycleConflicts(plan, accepted)), [plan, accepted]);
  const detailWork = useMemo(() => new Map(plan.details.map((d) => [d.detailKey, d.workKey])), [plan]);
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
  const counts: Record<Kind, number> = {
    same: allOpenRules.filter((p) => p.sameAs !== undefined).length + openGroups.filter((g) => kindOfGroup(g) === "same").length,
    crosswalk: allOpenRules.filter((p) => p.sameAs === undefined).length,
    ledger: openGroups.filter((g) => kindOfGroup(g) === "ledger").length,
    rule: openGroups.filter((g) => kindOfGroup(g) === "rule").length,
    relayed: openGroups.filter((g) => kindOfGroup(g) === "relayed").length,
    ai: openGroups.filter((g) => kindOfGroup(g) === "ai").length,
  };
  const kinds = KINDS.filter((k) => counts[k] > 0);
  const kind: Kind | null = kindPick && kinds.includes(kindPick) ? kindPick : (kinds[0] ?? null);
  const openRules = allOpenRules.filter((p) => (kind === "same" ? p.sameAs !== undefined : kind === "crosswalk" ? p.sameAs === undefined : false));
  const visibleGroups = openGroups.filter((g) => kindOfGroup(g) === kind);
  const leftCount = openGroups.length + allOpenRules.length;
  const visibleCount = visibleGroups.length + openRules.length;
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
  // まとめて受けるのは、いま見えている種類の行だけ
  const acceptAll = () => {
    if (!ok) return;
    for (const g of visibleGroups) for (const d of g.ds) acceptDecision(d.id, d.hash, reason);
    let refused = 0;
    for (const p of openRules) if (!acceptByHuman(p.ruleId, reason).ok) refused++;
    setMsg({ color: refused ? "red" : "gray", text: T.bulkDone(visibleGroups.length + openRules.length - refused, refused) });
  };

  /** 周期の案の「| 却下」「| 確定」（行と横の板の詳細で同じ。判断の理由が要る） */
  const cycleButtons = (cycle: string, ds: Decision[]) => (
    <Group gap="xs" wrap="nowrap" justify="flex-end">
      <Button
        size="compact-sm"
        variant="default"
        disabled={!ok}
        title={ok ? undefined : T.needsReason}
        onClick={(e) => {
          e.stopPropagation();
          setRejectReason(reason);
          setRejectingCycle({ id: cycle, n: ds.length });
        }}
        data-testid="pending-reject"
      >
        {W.reject}
      </Button>
      <Button
        size="compact-sm"
        disabled={!ok}
        title={ok ? undefined : T.needsReason}
        onClick={(e) => {
          e.stopPropagation();
          ds.forEach((x) => acceptDecision(x.id, x.hash, reason));
        }}
        data-testid="pending-accept"
      >
        {T.accept}
      </Button>
    </Group>
  );

  const groupRow = ({ key, ds, cycle }: { key: string; ds: Decision[]; cycle: string | null }) => {
    const d = ds[0]!;
    const done = ds.every((x) => isAccepted(x.id, x.hash));
    return (
      <Table.Tr
        key={key}
        data-testid="pending-row"
        data-kind={cycle && isLedgerCycle(cycle) ? "ledger" : cycle && isPlanRuleCycle(cycle) ? "rule" : d.author}
        data-accepted={done ? "true" : "false"}
        data-cycle={cycle ?? undefined}
        {...(cycle ? { className: "moyai-pick-row", "aria-selected": pickedCycle === cycle, onClick: () => pickCycle(cycle), style: { cursor: "pointer" } } : {})}
      >
        <Table.Td>
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
        <Table.Td c="var(--text-2)">{d.basis}</Table.Td>
        <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }} data-testid="pending-count">
          {d.kind === "reading" ? (d.count ?? "―") : ds.length}
        </Table.Td>
        <Table.Td ta="right">
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
            cycleButtons(cycle, ds)
          ) : (
            <Button size="compact-sm" disabled={!ok} title={ok ? undefined : T.needsReason} onClick={() => ds.forEach((x) => acceptDecision(x.id, x.hash, reason))} data-testid="pending-accept">
              {T.accept}
            </Button>
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
      <Table.Td />
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
      <Table.Td>
        <Text size="sm">
          {p.target === "assetNode" ? T.ruleNodeHead : T.ruleWorkHead}
          {whenShort(p, names)} → {targetPath(p)}
        </Text>
        <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em" }}>
          {T.kind.crosswalk}
        </Text>
      </Table.Td>
      <Table.Td c="var(--text-2)" title={p.basis}>
        {shortWhy(p.basis)}
      </Table.Td>
      <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }} data-testid="crosswalk-matched">
        {p.matched}
      </Table.Td>
      <Table.Td ta="right">
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

  const cols = kind === "same" ? T.head.filter((_, i) => i !== 1) : T.head;
  const head = (
    <Table.Thead>
      <Table.Tr>
        {cols.map((h, i) => (
          <Table.Th key={h} ta={i >= 2 ? "right" : undefined} style={{ whiteSpace: "nowrap", width: i === 0 ? (kind === "same" ? "76%" : "40%") : i === 1 && kind !== "same" ? "36%" : i === cols.length - 2 ? 88 : undefined }}>
            {h}
          </Table.Th>
        ))}
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
      <Text size="xs" c="dimmed">
        {T.detailWhy}
      </Text>
      <Text size="sm">{cycleGroup.ds[0]!.basis}</Text>
      {isDone(cycleGroup.ds) ? (
        <Text size="xs" c="dimmed">
          {T.accepted}
        </Text>
      ) : (
        cycleButtons(cycleGroup.cycle, cycleGroup.ds)
      )}
    </Stack>
  );
  const rejectedRows = rejectedCycles();

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
    <Stack gap="md" px="xl" py="lg" data-testid="decisions-sheet">
      <Group align="flex-end" gap="md" wrap="wrap">
        <TextInput label={T.reasonLabel} placeholder={T.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} style={{ flex: "1 1 360px", maxWidth: 560 }} data-testid="decisions-reason" />
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
        <Table data-testid="decisions-table" verticalSpacing="sm" fz="sm">
          {head}
          <Table.Tbody>
            {openRules.map(kind === "same" ? sameRow : ruleRow)}
            {visibleGroups.map(groupRow)}
          </Table.Tbody>
        </Table>
      )}
      {proposals.length === 0 && (
        <Text size="xs" c="dimmed" data-testid="crosswalk-none">
          {W.none}
        </Text>
      )}

      {/* 受けたもの・断ったもの：下にたたむ（閉じていても DOM に残す） */}
      {(doneRules.length > 0 || doneGroups.length > 0 || rejectedRows.length > 0) && (
        <details data-testid="decisions-done">
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{T.doneTitle(doneRules.length + doneGroups.length + rejectedRows.length)}</summary>
          <Table verticalSpacing="xs" fz="sm" mt="xs">
            {head}
            <Table.Tbody>
              {doneRules.map(ruleRow)}
              {doneGroups.map(groupRow)}
              {rejectedRows.map((r) => (
                <Table.Tr key={`rejected:${r.id}`} data-testid="cycle-rejected" data-cycle={r.id}>
                  <Table.Td>
                    <Text size="sm">{T.cycleWhat(r.id, r.marks)}</Text>
                  </Table.Td>
                  <Table.Td c="var(--text-2)" title={r.basis}>
                    {shortWhy(r.basis)}
                  </Table.Td>
                  <Table.Td className="moyai-num" ta="right">
                    {r.marks}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs" c="dimmed">
                      {T.rejected}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
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
      {side?.el && detail && createPortal(detail, side.el)}
      {side?.el && !detail && cycleDetail && createPortal(cycleDetail, side.el)}
    </Stack>
  );
}
