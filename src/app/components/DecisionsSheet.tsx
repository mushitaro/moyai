// MERGE のシート「決定」（docs/screens.md 3.2、絵は Decisions.dc.html・docs/plan.md §2.9）：Claude が決めたことと、会話から写した人の答え。受けるまで、版は確定できない。
// 1 つの表に、受けていないものを先に並べる。列は「何を（種類の札）｜なぜ｜決めた人｜行｜受ける」。行は箱にせず、罫線だけ。
// - 当てはめの案（Claude が置いた規則）：1 規則 1 行。受けるか、確かめのダイアログを通して断る（state/crosswalk.ts の人だけの道）。
// - 台帳からの案（chart_propose の周期の案）：案ごとに 1 行（引いた印の数を行に）。受けると、その案の印をすべて受ける。
// - Claude の決定・会話から写した答え：1 行ずつ。
// 理由の欄は上に 1 つ。1 行ずつ受けるときも、まとめて受けるときも、その理由を使う（空のあいだは押せない）。受けたものは下にたたむ。
// 受けた決定はこのタブのメモリ（state/decisions.ts）に持ち、署名のダイアログがそこから読んで送る。
import { Alert, Button, Group, Modal, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMemo, useState } from "react";
import { crosswalkSummary, heldRows, type CrosswalkProposal } from "../../plan/crosswalk";
import { pendingDecisions, type Decision } from "../../plan/diff";
import { cycleIdOf } from "../../plan/cycle";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { acceptByHuman, rejectByHuman, valueLabel } from "../state/crosswalk";
import { acceptDecision, isAccepted, unacceptDecision, useAccepted } from "../state/decisions";
import { useWorkingPlan } from "../state/plan-store";
import { HUMAN_TEXT, TEXT } from "../text";
import { DirectSet } from "./CrosswalkPanel";
import { usePlanStatus } from "./ConfirmDialog";

const T = HUMAN_TEXT.decisions;
const W = TEXT.crosswalk;

/** 受けていない決定（版の履歴で受けたものを除く）。署名のダイアログと下の帯も同じ数を使う */
export function usePending(client: BridgeClient, plan: Plan | null): { pending: Decision[]; ready: boolean } {
  const [load] = usePlanStatus(client, plan?.planId ?? "", !!plan);
  const status = load.kind === "ready" ? load.status : null;
  const pending = useMemo(() => (plan && status ? pendingDecisions(plan, status.accepted ?? []) : []), [plan, status]);
  return { pending, ready: !!status };
}

/** 規則の条件を人の言葉で（「焼却炉本体」かつ「1 号炉」） */
function whenText(p: CrosswalkProposal): string {
  return p.rule.when.map((c) => `「${c.values.join("・") || T.blank}」`).join(T.and);
}

export function DecisionsSheet({ client, plan }: { client: BridgeClient; plan: Plan }) {
  const { pending, ready } = usePending(client, plan);
  const accepted = useAccepted();
  const working = useWorkingPlan();
  const proposals = working?.proposals ?? [];
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<CrosswalkProposal | null>(null);
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const itemName = (code: string) => catalog?.items.get(code)?.name ?? catalog?.systems.get(code)?.name ?? code;
  const attrName = (code: string) => ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[code] ?? code;
  const ok = reason.trim().length > 0;
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
  const openGroups = groups.filter((g) => !isDone(g.ds));
  const doneGroups = groups.filter((g) => isDone(g.ds));
  const openRules = proposals.filter((p) => p.state === "proposed");
  const doneRules = proposals.filter((p) => p.state !== "proposed");
  const leftCount = openGroups.length + openRules.length;
  const s = crosswalkSummary(plan);

  const what = (d: Decision) => {
    if (d.kind === "detail") {
      const [pa, fy] = d.value.split(":");
      return `${d.target} · ${HUMAN_TEXT.confirm.pendingValue[pa ?? ""] ?? ""} · ${HUMAN_TEXT.confirm.pendingFiscal(fy ?? "")}`;
    }
    return `${d.target} → ${d.kind === "attribute" ? attrName(d.value) : itemName(d.value)}`;
  };
  const acceptRule = (p: CrosswalkProposal) => {
    const r = acceptByHuman(p.ruleId, reason);
    setMsg(r.ok ? { color: "gray", text: W.acceptedDone(p.ruleId, r.rows) } : { color: "red", text: W.refused[r.reason] ?? "" });
    return r.ok;
  };
  const acceptAll = () => {
    if (!ok) return;
    for (const g of openGroups) for (const d of g.ds) acceptDecision(d.id, d.hash, reason);
    let refused = 0;
    for (const p of openRules) if (!acceptByHuman(p.ruleId, reason).ok) refused++;
    setMsg({ color: refused ? "red" : "gray", text: T.bulkDone(openGroups.length + openRules.length - refused, refused) });
  };

  const groupRow = ({ key, ds, cycle }: { key: string; ds: Decision[]; cycle: string | null }) => {
    const d = ds[0]!;
    const done = ds.every((x) => isAccepted(x.id, x.hash));
    return (
      <Table.Tr key={key} data-testid="pending-row" data-kind={cycle ? "ledger" : d.author} data-accepted={done ? "true" : "false"}>
        <Table.Td>
          <Text size="sm">{cycle ? T.cycleWhat(cycle, ds.length) : what(d)}</Text>
          <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em" }}>
            {cycle ? T.kind.ledger : d.author === "ai_relayed_human" ? T.kind.relayed : T.kind.ai}
          </Text>
        </Table.Td>
        <Table.Td c="var(--text-2)">{d.basis}</Table.Td>
        <Table.Td c="var(--text-2)">{cycle ? T.by.ledger : d.author === "ai_relayed_human" ? T.by.relayed : TEXT.author[d.author]}</Table.Td>
        <Table.Td className="moyai-num" ta="right">
          {ds.length}
        </Table.Td>
        <Table.Td ta="right">
          {done ? (
            <Group gap="xs" wrap="nowrap" justify="flex-end">
              <Text size="xs" c="dimmed" data-testid="pending-accepted">
                {T.accepted}
              </Text>
              <Button size="compact-xs" variant="subtle" onClick={() => ds.forEach((x) => unacceptDecision(x.id, x.hash))}>
                {T.undo}
              </Button>
            </Group>
          ) : (
            <Button size="compact-sm" disabled={!ok} title={ok ? undefined : T.needsReason} onClick={() => ds.forEach((x) => acceptDecision(x.id, x.hash, reason))} data-testid="pending-accept">
              {T.accept}
            </Button>
          )}
        </Table.Td>
      </Table.Tr>
    );
  };

  const ruleRow = (p: CrosswalkProposal) => (
    <Table.Tr key={p.ruleId} data-testid="crosswalk-rule" data-rule={p.ruleId} data-state={p.state} data-target={p.target}>
      <Table.Td>
        <Text size="sm">
          {whenText(p)}
          {p.target === "assetNode" ? T.ruleNode : T.ruleWork} → {valueLabel(catalog, p.target, p.value)}
        </Text>
        <Text size="xs" c="var(--shu-text)" style={{ letterSpacing: "0.1em" }}>
          {T.kind.crosswalk}
        </Text>
      </Table.Td>
      <Table.Td c="var(--text-2)">{p.state === "proposed" ? p.basis : `${p.basis}（${T.humanReason}：${p.humanReason ?? ""}）`}</Table.Td>
      <Table.Td c="var(--text-2)">{T.by.ai}</Table.Td>
      <Table.Td className="moyai-num" ta="right" data-testid="crosswalk-matched">
        {p.matched}
      </Table.Td>
      <Table.Td ta="right">
        {p.state === "proposed" ? (
          <Group gap="xs" wrap="nowrap" justify="flex-end">
            <Button size="compact-sm" variant="default" disabled={!ok} title={ok ? undefined : T.needsReason} onClick={() => setRejecting(p)} data-testid="crosswalk-reject">
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

  const head = (
    <Table.Thead>
      <Table.Tr>
        {T.head.map((h, i) => (
          <Table.Th key={h} ta={i >= 3 ? "right" : undefined} style={{ width: i === 0 ? "34%" : i === 1 ? "30%" : undefined }}>
            {h}
          </Table.Th>
        ))}
      </Table.Tr>
    </Table.Thead>
  );

  return (
    <Stack gap="md" px="xl" py="lg" data-testid="decisions-sheet">
      <Group align="flex-end" gap="md" wrap="wrap">
        <TextInput label={T.reasonLabel} placeholder={T.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} style={{ flex: "1 1 360px", maxWidth: 560 }} data-testid="decisions-reason" />
        <Button variant="default" disabled={!ok || leftCount === 0} onClick={acceptAll} data-testid="decisions-bulk-accept">
          {T.bulkAccept}
        </Button>
        {!ok && leftCount > 0 && (
          <Text size="xs" c="dimmed">
            {T.bulkNeedsReason}
          </Text>
        )}
      </Group>
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
            {openRules.map(ruleRow)}
            {openGroups.map(groupRow)}
          </Table.Tbody>
        </Table>
      )}
      {proposals.length === 0 && (
        <Text size="xs" c="dimmed" data-testid="crosswalk-none">
          {W.none}
        </Text>
      )}

      {/* 受けたもの・断ったもの：下にたたむ（閉じていても DOM に残す） */}
      {(doneRules.length > 0 || doneGroups.length > 0) && (
        <details data-testid="decisions-done">
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{T.doneTitle(doneRules.length + doneGroups.length)}</summary>
          <Table verticalSpacing="xs" fz="sm" mt="xs">
            {head}
            <Table.Tbody>
              {doneRules.map(ruleRow)}
              {doneGroups.map(groupRow)}
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

      <Modal opened={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? W.rejectTitle(rejecting.ruleId) : ""} centered data-testid="crosswalk-reject-dialog">
        {rejecting && (
          <Stack gap="sm">
            <Text size="sm">{W.rejectBody(rejecting.ruleId, heldRows(plan, rejecting).length)}</Text>
            <Text size="xs" c="dimmed">
              {T.reasonLabel}：{reason}
            </Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setRejecting(null)}>
                {W.cancel}
              </Button>
              <Button
                data-testid="crosswalk-reject-confirm"
                onClick={() => {
                  const r = rejectByHuman(rejecting.ruleId, reason);
                  setMsg(r.ok ? { color: "gray", text: W.rejectedDone(rejecting.ruleId, r.rows) } : { color: "red", text: W.refused[r.reason] ?? "" });
                  setRejecting(null);
                }}
              >
                {W.rejectConfirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
